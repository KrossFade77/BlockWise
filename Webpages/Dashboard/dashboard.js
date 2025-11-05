import { initializeApp } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, deleteDoc, getDocs, collection } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBEuPV6piBqzJbl-gXZOt_YIS0F2cGIk00",
  authDomain: "testbase-ca192.firebaseapp.com",
  projectId: "testbase-ca192",
  storageBucket: "testbase-ca192.firebasestorage.app",
  messagingSenderId: "344945139722",
  appId: "1:344945139722:web:75aa2e9a5a364de11c3ff3",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app, "blockwise");

// Gate: wait for login and semester existence
onAuthStateChanged(auth, async (user) => {
  const gate = document.getElementById('gate');
  const appEl = document.getElementById('app');

  if (!user) {
    setGateText(gate, "You are signed out. Redirecting to login…");
    window.location.href = './index.html';
    return;
  }

  // Updated: Check /<UID>/semester document
  const semRef = doc(db, user.uid, "semester");
  try {
    const snap = await getDoc(semRef);
    if (!snap.exists()) {
      setGateText(gate, "No semester found. Redirecting to semester setup…");      
      window.location.href = './semester.html';
      return;
    }

    const data = snap.data() || {};
    const startDate = data.startDate;
    const endDate = data.endDate;

    if (!startDate || !endDate) {
      setGateText(gate, "Incomplete semester dates. Redirecting to semester setup…");
      window.location.href = './semester.html';
      return;
    }

    bootApp({ startDate, endDate }, user);
    if (gate) gate.style.display = 'none';
    if (appEl) appEl.style.display = 'block';
  } catch (e) {
    console.error('[Dashboard] Semester read error:', e);
    setGateText(gate, "Failed to load semester. Please try again.");
  }
});

function setGateText(el, text) {
  if (!el) return;
  el.textContent = "";
  el.appendChild(document.createTextNode(text));
}

function bootApp(semesterFromFirestore, user) {
  Vue.createApp({
    data() {
      return {
        uid: user.uid,
        today: new Date(),
        isDarkMode: false,
        quote: { text: 'Loading...', author: '' },
        isGenerating: false,
        showForm: false,
        showConfig: false,
        modalInstance: null,
        deleteMode: null,
        event: {
          title: '',
          date: '',
          startTime: '',
          endTime: '',
          type: '',
          courseCode: '',
          courseName: '',
          weightage: 1,
          repeat: false
        },
        events: [],
        holidays: [],
        schedulerConfig: {
          dailyStart: '10:00',
          dailyEnd: '22:00',
          minStudyDuration: 30,
          weeksToGenerate: 4
        },
        calendar: null,
        selectedEvent: {},
        selectedEventElement: null,
        originalEventForEdit: null,
        editMode: false,
        semester: { startDate: '', endDate: '' },
        showSidebar: false,
        activeModuleFilter: null,
      };
    },

    computed: {

      todayFormatted() {
         // Formats the date as "Tuesday, November 4"
         const options = { weekday: 'long', month: 'long', day: 'numeric' };
         return this.today.toLocaleDateString('en-US', options);
       },

      /**
       * Scans all events and returns a unique, sorted list of modules.
       */
      uniqueModules() {
          console.log("[DEBUG] Re-computing unique modules...");
          const modules = {};

          // 1. Find all 'lesson' events and get their course codes
          this.events.forEach(event => {
              if (event.type === 'lesson' && event.courseCode) {
                  // Use an object to automatically handle duplicates
                  modules[event.courseCode.toUpperCase()] = {
                      code: event.courseCode.toUpperCase(),
                      name: event.courseName || '',
                      weight: event.weightage || 1
                  };
              }
          });

          // 2. Convert object back to an array and sort it
          const moduleList = Object.values(modules).sort((a, b) => a.code.localeCompare(b.code));

          console.log(`[DEBUG] Found ${moduleList.length} unique modules.`);
          return moduleList;
      },

      holidayEvents() {
        console.log("[DEBUG] Re-computing holiday events...");
        return this.holidays.map(holiday => {
            return {
                title: holiday.name, // e.g., "New Year's Day"
                start: holiday.date, // e.g., "2025-01-01"
                allDay: true,

                backgroundColor: 'var(--color-holiday-bg)',
                borderColor: 'var(--color-holiday-bg)',
                textColor: 'var(--color-holiday-text)'      // A dark red for the text
            };
        });
      }
    },

    methods: {

      async fetchQuote() {
  			try {
  				// Note: The 'no-cors' mode is a workaround for this specific API 
  				// when called from a local file. It might need adjustment.
  				// We'll use a proxy to bypass local CORS issues.
  				const response = await fetch('https://proxy.cors.sh/https://zenquotes.io/api/random');
  
  				if (!response.ok) {
  					throw new Error('Network response was not ok');
  				}
  
  				const data = await response.json();
  
  				if (data && data[0]) {
  					this.quote.text = data[0].q; // The quote text
  					this.quote.author = data[0].a; // The author
  				} else {
  					this.quote.text = 'Stay focused and keep going.';
  					this.quote.author = 'BlockWise';
  				}
  			} catch (error) {
  				console.error('Failed to fetch quote:', error);
  				// Fallback quote in case of an API error
  				this.quote.text = 'Success is not final, failure is not fatal: it is the courage to continue that counts.';
  				this.quote.author = 'Winston Churchill';
  			}
   		},

      async checkCourseNudges() {
        const now = new Date();
        const courseCount = {}; // track study sessions passed per course
        // if quiz taken, return function
        if (localStorage.getItem('quizTaken') === 'true') {
          const banner = document.getElementById('nudge-banner');
          if (banner) banner.style.display = 'none';
          return;
        }
        // Count completed study (review) sessions per course
        this.events.forEach(ev => {
          if (ev.type === 'review' && ev.courseCode) {
            const evDate = new Date(ev.date);
            if (now > evDate) {
              const code = ev.courseCode.toUpperCase();
              courseCount[code] = (courseCount[code] || 0) + 1;
            }
          }
        });
      
        // Identify courses that crossed 3 completed sessions
        const triggeredCourses = Object.keys(courseCount).filter(c => courseCount[c] >= 3);
      
        const banner = document.getElementById('nudge-banner');
        const list = document.getElementById('nudge-list');
        if (!banner || !list) return;
      
        // Clear old list safely
        while (list.firstChild) list.removeChild(list.firstChild);
      
        if (triggeredCourses.length > 0) {
          banner.style.display = 'block';
          triggeredCourses.forEach(code => {
            const li = document.createElement('li');
            li.textContent = `Time to test yourself for ${code}!`;
            list.appendChild(li);
          });
        } else {
          banner.style.display = 'none';
        }
      },
      

      toggleTheme() {
  			this.isDarkMode = !this.isDarkMode;
  			const theme = this.isDarkMode ? 'dark' : 'light';
  			document.documentElement.setAttribute('data-theme', theme);
  			localStorage.setItem('theme', theme); // Save the user's choice
   		},

      async loadSemester() {
        if (!this.uid) {
            console.log("No UID, cannot load semester.");
            return;
        }
        
        const docRef = doc(db, this.uid, "semester");
        const docSnap = await getDoc(docRef); 

        if (docSnap.exists()) {
            this.semester = docSnap.data();
            console.log("[DEBUG] Semester loaded:", this.semester);
            
            // Now that we have the semester, load events
            await this.loadEventsFromFirestore();
            
            // And now, load the holidays
            await this.loadPublicHolidays();
            
        } else {
            console.error("No semester document found! Redirecting...");
            alert("Please set up your semester dates first.");
            window.location.href = 'semester.html';
        }
    },

      toggleSidebar() {
       this.showSidebar = !this.showSidebar;
       console.log(`[DEBUG] Sidebar toggled. Show: ${this.showSidebar}`);

         // Wait for the DOM to update, then resize the calendar
        this.$nextTick(() => {
          if (this.calendar) {
          console.log("[DEBUG] Forcing calendar resize");
          this.calendar.updateSize();
         }
       });
     },

      setFilter(moduleCode) {
       if (this.activeModuleFilter === moduleCode) {
        // If clicking the same filter, turn it off
       this.activeModuleFilter = null;
       console.log("[DEBUG] Module filter cleared.");
       } else {
        this.activeModuleFilter = moduleCode;
        console.log(`[DEBUG] Module filter set to: ${moduleCode}`);
      }
      // We need to re-render the calendar
      this.updateCalendar();
    },

      /** 🔹 Save event to Firestore under /<UID>/semester/{lesson|nonlesson}/{title} */
      async saveEventToFirestore(event) {
        try {
          const id = this.docIdFor(event);
          const path = event.type === "lesson"
            ? [this.uid, "semester", "lesson", id]
            : [this.uid, "semester", "nonlesson", id];
          const ref = doc(db, ...path);
          await setDoc(ref, event, { merge: true });
          console.log(`[Firestore] Saved ${event.type}:`, event.title);
        } catch (e) {
          console.error("[Firestore] Save failed:", e);
        }
      },

      /** 🔹 Delete event from Firestore */
      async deleteEventFromFirestore(event) {
        try {
          const id = this.docIdFor(event);
          const path = event.type === "lesson"
            ? [this.uid, "semester", "lesson", id]
            : [this.uid, "semester", "nonlesson", id];
          const ref = doc(db, ...path);
          await deleteDoc(ref);
          console.log(`[Firestore] Deleted ${event.type}:`, event.title, event.date);
        } catch (e) {
          console.error("[Firestore] Delete failed:", e);
        }
      },

      showEventForm() { this.showForm = !this.showForm; },

      // helper: build a stable doc id so multiple dates don't overwrite each other
   	  docIdFor(e) {
        // Check if e itself exists, if not, return a random key to prevent crashes
        if (!e) {
            return `invalid-event-${Math.random()}`;
        }

   		const slug = (s) => (s || '').toLowerCase().trim().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'');
 		
        // FIX: Check if startTime exists. If not, use '00-00' as a fallback.
        const timeSlug = (e.startTime || '00-00').replace(':', '-'); 
 		
        return `${slug(e.title)}_${e.date || 'no-date'}_${timeSlug}`;
   	  },
      
      // helper: expand weekly occurrences from a seed event until semester end
      expandWeekly(e, semester) {
         const out = [];
         const end = new Date(semester.endDate);
        let d = new Date(e.date); // Start on the date the user picked

         while (d <= end) {
           const iso = d.toISOString().split('T')[0];
           out.push({ ...e, date: iso, isRecurring: true, originalDate: e.date });
          d.setDate(d.getDate() + 7); // Go to the next week
         }
         return out;
       },
      
      async addEvent() {
        // validate
        if (!this.event.title || !this.event.date || !this.event.startTime) {
          alert('Please fill in title, date and start time.');
          return;
        }
        if (!this.isEventWithinSemester(this.event.date)) {
          alert('Event date is outside the semester period.');
          return;
        }
      
        // base event object
        const base = {
          title: this.event.title,
          date: this.event.date,
          startTime: this.event.startTime,
          endTime: this.event.endTime,
          type: this.event.type,
          courseCode: this.event.courseCode || '',
          courseName: this.event.courseName || '',
          weightage: this.event.weightage || 1,
          repeat: !!this.event.repeat,
          originalDate: this.event.date
        };
      
        // expand if repeating
        const toAdd = base.repeat
        ? this.expandWeekly(base, this.semester)
        : [base];
      
        // add locally
        this.events.push(...toAdd);
      
        // persist each occurrence to Firestore with unique ids
        try {
          await Promise.all(toAdd.map(e => this.saveEventToFirestore(e)));
          this.updateCalendar();
        } catch (e) {
          console.error('[Firestore] batch save failed', e);
          alert('Saved locally, but Firestore save failed. Check console.');
        }
      
        // reset UI
        this.showForm = false;
        this.resetEventForm();
        this.updateCalendar();
      },
      

      resetEventForm() {
        this.event = {
          title: '',
          date: '',
          startTime: '',
          endTime: '',
          type: 'lesson',
          courseCode: '',
          courseName: '',
          weightage: 1,
          repeat: false,
        };
      },

      async deleteEvent() {
          if (!this.originalEventForEdit) {
              console.error("Cannot delete: originalEventForEdit is not set.");
              return;
          }

          const eventToDelete = this.originalEventForEdit;

          // 1. Check if the event is recurring
          if (eventToDelete.repeat) {
              // It is a recurring event, show the "Delete All" modal
              const modal = new bootstrap.Modal('#deleteRecurringModal', { backdrop: 'static', keyboard: false });
              modal.show();
              return; // Stop here and let performDelete() take over
          }

          // 2. It's a single, non-recurring event. Delete it directly.
          try {
              console.log("[DEBUG] Deleting single event:", eventToDelete);

              // Remove from local array
              this.events = this.events.filter(e => this.docIdFor(e) !== this.docIdFor(eventToDelete));

              // Remove from Firestore
              await this.deleteEventFromFirestore(eventToDelete);

              // Remove from calendar UI
              this.selectedEventElement.remove();

              if (this.modalInstance) this.modalInstance.hide();
              this.updateCalendar(); // Refresh the calendar

          } catch (e) {
              console.error("Error deleting single event:", e);
              alert("Failed to delete event. Check console.");
          }
      },

      async saveEditedEvent() {
        console.log("[DEBUG] saveEditedEvent() triggered.");

        // 1. Get the new (edited) data
        const newData = this.selectedEvent;
        // 2. Get the original data we saved
        const oldData = this.originalEventForEdit;

        console.log("[DEBUG] Old data:", oldData);
        console.log("[DEBUG] New data:", newData);

        // 3. Check if the ID needs to change
        // This happens if the user changed the title, date, or startTime
        const oldId = this.docIdFor(oldData);
        const newId = this.docIdFor(newData);

        try {
            // 4. Update Firestore
            if (oldId !== newId) {
                // ID changed: we must delete the old doc and create a new one
                console.log(`[DEBUG] ID changed. Deleting ${oldId}, Creating ${newId}`);
                await this.deleteEventFromFirestore(oldData);
                await this.saveEventToFirestore(newData);
            } else {
                // ID is the same: just update the existing doc
                console.log(`[DEBUG] ID same. Merging data for ${newId}`);
                await this.saveEventToFirestore(newData);
            }

            // 5. Update the local `this.events` array
            const index = this.events.findIndex(e => this.docIdFor(e) === oldId);
            if (index !== -1) {
                // Replace the old event with the new one
                this.events.splice(index, 1, newData);
            } else {
                // This shouldn't happen, but as a fallback, add it
                this.events.push(newData);
            }

            // 6. Refresh the calendar
            this.updateCalendar();

            // 7. Close the modal
            this.modalInstance.hide();
            this.editMode = false;

        } catch (e) {
            console.error("[DEBUG] Error saving edited event:", e);
            alert("There was an error saving your changes. Please check the console.");
        }
    },

    async handleEventChange(info) {
      console.log(`[DEBUG] Event changed: ${info.event.id}`);
      const oldEvent = this.events.find(e => this.docIdFor(e) === info.event.id);
      if (!oldEvent) {
        console.error("CRITICAL: Could not find event to update after drop/resize!");
        return;
      }

        // Create new event data based on the drop
        const newEvent = {
          ...oldEvent, // Copy all old data (title, type, weight, etc.)
          date: this.formatDate(info.event.start),
          startTime: this.formatTime(info.event.start),
          endTime: info.event.end ? this.formatTime(info.event.end) : oldEvent.endTime,
        };

      // Get old and new IDs
      const oldId = this.docIdFor(oldEvent);
      const newId = this.docIdFor(newEvent);
      console.log(`[DEBUG] ID changing from ${oldId} to ${newId}`);

      try {
        // Update Firestore (delete old, create new)
        await this.deleteEventFromFirestore(oldEvent);
        await this.saveEventToFirestore(newEvent);

        // Update local 'this.events' array
        const index = this.events.findIndex(e => this.docIdFor(e) === oldId);
        if (index !== -1) {
          this.events.splice(index, 1, newEvent);
        }

        // Refresh module list
        this.updateCalendar(); 
      } catch (e) {
          console.error("Error updating event after drop:", e);
          // Revert the visual change on failure
          info.revert();
      }
     },


      isEventWithinSemester(date) {
        if (!this.semester.startDate || !this.semester.endDate) return true;
        const eventDate = new Date(date);
        const startDate = new Date(this.semester.startDate);
        const endDate = new Date(this.semester.endDate);
        return eventDate >= startDate && eventDate <= endDate;
      },

      logout() {
        signOut(auth).then(() => window.location.href = './index.html');
      },

      hidePreloader() {
        const preloader = document.getElementById('preloader');
        if (preloader) {
            // Fade it out
            preloader.style.opacity = '0';
            setTimeout(() => {
                // Hide it completely after the fade
                preloader.style.display = 'none';
            }, 500); // 500ms matches the CSS transition
        }
    },

      // Helper to format time as HH:MM (e.g., "09:00")
      formatTime(date) {
        return date.toLocaleTimeString('en-US', {
            hour12: false,
            hour: '2-digit',
            minute: '2-digit'
        });
      },

      // Helper to format date as YYYY-MM-DD
      formatDate(date) {
        return date.toISOString().split('T')[0];
      },

      confirmDelete(mode) {
        // mode ∈ {'this','future','all'}
        this.deleteMode = mode;
        const modal = bootstrap.Modal.getInstance(document.getElementById('deleteRecurringModal'));
        if (modal) modal.hide();
      
        this.performDelete();
      },

      async loadSchedulerConfig() {
        try {
          const ref = doc(db, this.uid, 'schedulerConfig');
          const snap = await getDoc(ref);
          if (snap.exists()) {
            const d = snap.data();
            this.schedulerConfig = {
              dailyStart: d.dailyStart || '10:00',
              dailyEnd: d.dailyEnd || '22:00',
              minStudyDuration: d.minStudyDuration ?? 30,
              weeksToGenerate: d.weeksToGenerate ?? 4
            };
            console.log('[DEBUG] Loaded schedulerConfig (FS):', this.schedulerConfig);
          } else {
            console.log('[DEBUG] No schedulerConfig doc yet; using defaults.');
          }
        } catch (error) {
          console.error('[DEBUG] loadSchedulerConfig (FS) failed:', error);
        }
      },

      async saveSchedulerConfig() {
        const sc = this.schedulerConfig;
        if (!sc.dailyStart || !sc.dailyEnd || !sc.minStudyDuration || !sc.weeksToGenerate) {
          alert('Please fill in all scheduler configuration fields before saving.');
          return;
        }

        try {
          const ref = doc(db, this.uid, 'schedulerConfig');
          await setDoc(ref, sc, { merge: true });
          alert('Scheduler configuration saved successfully!');
          this.showConfig = false;
        } catch (error) {
          console.error('[DEBUG] saveSchedulerConfig (FS) failed:', error);
          alert('Failed to save scheduler configuration. Check console.');
        }
      },
      
      exportSchedulerData() {
        // data validation first
        if (!this.semester.startDate || !this.semester.endDate) {
          alert('Please set your semester dates first.');
          return null;
        }
        if (!this.schedulerConfig.dailyStart || !this.schedulerConfig.dailyEnd) {
          alert('Please complete the scheduler settings before geenrating a scheduler');
          return null;
        }
        
        const lessons = this.events.filter(e => e.type === 'lesson');
        if (lessons.length === 0) {
          alert('Please add at least one lesson before generating your schedule');
          return null;
        }

        // main payload export
        const payload = {
          semester: this.semester,
          schedulerConfig: this.schedulerConfig,
          modules: lessons,
          personalEvents: this.events.filter(e => e.type === 'non-lesson')
        };

        console.log('[DEBUG] Schedule request payload:', payload);
        return payload;
      },

      async applyGeneratedSchedule(schedule) {
        if (!schedule || !Array.isArray(schedule.sessions)) {
          console.error(typeof(schedule));
          console.error(typeof(schedule.sessions));
          console.error('[DEBUG] Unexpected schedule shape:', schedule);
          alert('Scheduler returned an unexpected result.');
          return;
        }

        await this.clearGeneratedReviews();

        const reviewEvents = schedule.sessions.map(s => this.mapSessionToEvent(s)); // convert review sessions (to add into cal)
        
        const results = await Promise.allSettled(reviewEvents.map(e => this.saveReviewToFirestore(e)));
        const saved = [];
        results.forEach((r, i) => {
          if (r.status === 'fulfilled') {
            saved.push(reviewEvents[i]);
          }
        })

        if (saved.length === 0) {
          alert('Failed to save generated schedule. Please try again.');
          return;
        }

        if (saved.length < reviewEvents.length) {
          console.warn('[DEBUG] Some review events failed to persist. See logs for details.');
        }

        // merge and render
        this.events.push(...reviewEvents);
        this.updateCalendar();
      },

      mapSessionToEvent(session) {
        // expected session fields from backend : { moduleName, start, end, interval, status }
        const start = new Date(session.start);
        const end = session.end ? new Date(session.end) : null;

        return {
          title: `${session.moduleName} [${session.interval}d]`,
          date: this.formatDate(start),
          startTime: this.formatTime(start),
          endTime: end ? this.formatTime(end) : this.formatTime(start),
          type: 'review',
          courseCode: session.moduleName || '',
          courseName: '',
          weightage: 1,
          repeat: false,
          generated: true
        };
      },

      async saveReviewToFirestore(e) {
        try {
          const id = this.docIdFor(e);
          const ref = doc(db, this.uid, 'schedule', 'reviews', id);
          await setDoc(ref, e, { merge: true });
        } catch (error) {
          console.error('[DEBUG] Failed to save review to Firestore:', error);
        }
      },

      async performDelete() {
        if (!this.selectedEventElement) return;

        const evEl = this.selectedEventElement;
        const type = evEl.classNames[0];
        const title = evEl.title.replace(` (${type})`, '');
        const clickedDate = evEl.start.toISOString().split('T')[0];
        const startTime = this.selectedEvent.startTime;

        if (this.deleteMode === 'this') {
            this.events = this.events.filter(e => !(e.title === title && e.type === type && e.date === clickedDate));
            await this.deleteEventFromFirestore({ title, type, date: clickedDate, startTime });

        } else if (this.deleteMode === 'future') {
            this.events = this.events.filter(e => !(e.title === title && e.type === type && e.date >= clickedDate));
            const toDelete = [];
            let cur = new Date(clickedDate);
            const end = new Date(this.semester.endDate);
            while (cur <= end) {
                const d = cur.toISOString().split('T')[0];
                toDelete.push(this.deleteEventFromFirestore({ title, type, date: d, startTime }));
                cur.setDate(cur.getDate() + 7);
            }
            await Promise.allSettled(toDelete);

        } else if (this.deleteMode === 'all') {
             // *** FIX: Find seedEvent BEFORE filtering ***
             const seedEvent = this.events.find(e => e.title === title && e.type === type && e.originalDate);

             this.events = this.events.filter(e => !(e.title === title && e.type === type));

              if (!seedEvent) {
                console.warn("No seed event found for series delete");
                evEl.remove();
                if (this.modalInstance) this.modalInstance.hide();
                this.deleteMode = null;
                this.updateCalendar();
                return;
              }

            // *** FIX: Simplified delete loop ***
             const originalDate = seedEvent.originalDate;
             let cur = new Date(originalDate);
             const end = new Date(this.semester.endDate);

             const toDelete = [];
             while (cur <= end) {
              const d = cur.toISOString().split('T')[0];
              toDelete.push(this.deleteEventFromFirestore({ title, type, date: d, startTime }));
              cur.setDate(cur.getDate() + 7);
             }
             await Promise.allSettled(toDelete);
            }

            // UI cleanup
            evEl.remove();
            if (this.modalInstance) this.modalInstance.hide();
            this.deleteMode = null;
            this.updateCalendar();
        },  

      // handle Vue error before schedule is generated
        async generateSchedule() {
      // 1. Prevent spam-clicking
      if (this.isGenerating) return; 

      // 2. Set the loading state
      this.isGenerating = true;
      console.log("[Scheduler] Starting schedule generation...");

      try {
          // 3. This is the existing code
          const payload = this.exportSchedulerData();
          if (!payload) {
              // Throw an error to be caught by the finally block
              // This ensures the button re-enables
              throw new Error("No scheduler data to export.");
          }

          console.log('[DEBUG] Sending payload to backend...');
          const res = await fetch('/api/generate-schedule', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
          });

          if (!res.ok) {
              // Get error details from backend if possible
              const errorBody = await res.text();
              throw new Error(`HTTP ${res.status}: ${errorBody}`);
          }

          const data = await res.json();
          console.log('[DEBUG] Received schedule:', data);

          // 4. Apply the schedule
          await this.applyGeneratedSchedule(data);

          // 5. Success! (Replaced the ugly alert)
          console.log('Schedule successfully generated!');
          // We could add a premium "toast" notification here later

      } catch (error) {
          console.error('[Scheduler] Error generating schedule:', error);
          // We should show a premium error toast here instead of an alert
          // alert('Failed to generate schedule. Please try again.');

      } finally {
          // 6. IMPORTANT: Always re-enable the button
          this.isGenerating = false;
      }
  },
      async clearGeneratedReviews() {
        this.events = this.events.filter(e => e.type !== 'review');

        try {
          const snap = await getDocs(collection(db, this.uid, 'schedule', 'reviews'));
          const ops = [];
          snap.forEach(d => ops.push(deleteDoc(doc(db, this.uid, 'schedule', 'reviews', d.id))));
          await Promise.allSettled(ops);
          console.log('[DEBUG] Cleared review docs in Firestore');
        } catch (error) {
          console.warn('[DEBUG] Could not clear review docs in Firestore:', error);
        }

        this.updateCalendar();
      },


      async loadEventsFromFirestore() {
        try {
          const lessonSnap = await getDocs(collection(db, this.uid, 'semester', 'lesson'));
          const nonLessonSnap = await getDocs(collection(db, this.uid, 'semester', 'nonlesson'));

          const events = [];
          lessonSnap.forEach(doc => events.push(doc.data()));
          nonLessonSnap.forEach(doc => events.push(doc.data()));

          console.log('[DEBUG] Raw events from Firestore:', events);

          this.events = events;
          console.log('[DEBUG] this.events set:', this.events);

          const calendarEl = document.getElementById('calendar');
          console.log('[DEBUG] calendarEl:', calendarEl);
          console.log('[DEBUG] window.FullCalendar:', !!window.FullCalendar);

          if (calendarEl && window.FullCalendar && !this.calendar) {
            this.calendar = new window.FullCalendar.Calendar(calendarEl, {
              initialView: 'timeGridWeek',
              headerToolbar: { left: 'prev,next', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay' },
              editable: true,
              selectable: true,
              height: 'auto',
              slotMinTime: '08:00:00',
              slotMaxTime: '22:00:00',
              validRange: {
                start: this.semester.startDate,
                end: new Date(new Date(this.semester.endDate).setDate(
                  new Date(this.semester.endDate).getDate() + 1
                )).toISOString().split('T')[0]
              },
              // REPLACE the old eventClick handler with this:
              eventClick: (info) => {
                 console.log("[DEBUG] Event clicked, ID:", info.event.id);

                 // Use the ID to find the event in our master array
                   const originalEvent = this.events.find(e => this.docIdFor(e) === info.event.id);

                 if (!originalEvent) {
                   console.error("[DEBUG] CRITICAL: No event found for ID!", info.event.id);
                   return; // Can't do anything
                 }

                 // --- THIS IS THE KEY FIX ---
                // Store the original event from the array
                 this.originalEventForEdit = originalEvent;
                 // Create a *copy* for the modal form to edit
                 this.selectedEvent = { ...originalEvent };
                 // --- END OF FIX ---

                 this.selectedEventElement = info.event; // Still need this for .remove()

                 console.log("[DEBUG] Original event set:", this.originalEventForEdit);
                 console.log("[DEBUG] Copy for modal set:", this.selectedEvent);

                 const modalEl = document.getElementById('eventModal');
                 const modal = new bootstrap.Modal(modalEl);
                 this.modalInstance = modal;
                 modal.show();
              },

              select: (selectionInfo) => {
                console.log('[DEBUG] Calendar selected:', selectionInfo);

                const start = selectionInfo.start;
                const end = selectionInfo.end;

                // Pre-fill the event form data
                this.event.date = this.formatDate(start);
                this.event.startTime = this.formatTime(start);

                // FullCalendar's 'end' is exclusive. 
                // E.g., a drag from 9:00 to 10:00 will have an 'end' of 10:00.
                this.event.endTime = this.formatTime(end);

                // Open the form
                this.showForm = true;

                console.log(`[DEBUG] Set event data: ${this.event.date} from ${this.event.startTime} to ${this.event.endTime}`);
            },

            eventDrop: (info) => {
              this.handleEventChange(info);
            },

            eventResize: (info) => {
              this.handleEventChange(info);
            }


            });
            this.calendar.render();
            this.updateCalendar();

            setTimeout(() => {
              console.log("[DEBUG] Forcing calendar resize");
              this.calendar.updateSize();
          }, 100);
            console.log('[DEBUG] Calendar initialized and rendered');
          }

          console.log('[Dashboard] Loaded events from Firestore:', events.length);
        } catch (e) {
          console.error('[Firestore] Load events failed:', e);
        }
      },

      async loadPublicHolidays() {
     		// 1. Check if we have a country code
     		if (!this.semester || !this.semester.countryCode) {
     			console.log("[DEBUG] No country code set. Skipping holiday load.");
     			return;
     		}

     		// 2. Get the current year
     		const year = new Date().getFullYear();
     		const countryCode = this.semester.countryCode;

     		console.log(`[DEBUG] Fetching holidays for ${countryCode}, ${year}...`);

     		try {
     			// 3. Call the Nager API
     			const response = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/${countryCode}`);
     			if (!response.ok) {
     				throw new Error('Network response was not ok');
     			}
     			const holidays = await response.json();

     			// 4. Log the result!
     			this.holidays = holidays;
   			  console.log(`[DEBUG] Stored ${this.holidays.length} holidays.`);

          this.updateCalendar();

     		} catch (error) {
     			console.error("[DEBUG] Failed to fetch public holidays:", error);
     		}
     	},

      async loadReviewsFromFirestore() {
        try {
          const snap = await getDocs(collection(db, this.uid, 'schedule', 'reviews'));
          const reviews = [];
          snap.forEach(d => reviews.push(d.data()));

          this.events.push(...reviews);
          this.updateCalendar();
        } catch (error) {
          console.warn('[DEBUG] Could not load review docs from Firestore:', error);
        }
      },

      async deleteReviewFromFirestore(e) {
        const id = this.docIdFor(e);
        const ref = doc(db, this.uid, 'schedule', 'reviews', id);
        await deleteDoc(ref);
      },

      updateCalendar() {
          console.log(`[DEBUG] updateCalendar() called. Filter: ${this.activeModuleFilter}`);
          if (!this.calendar) {
              console.log("[DEBUG] Calendar not ready, aborting update.");
              return;
          }

          // 1. Clear all old events
          this.calendar.removeAllEvents();

          // --- THIS IS THE NEW LOGIC ---
          // 2. Filter the events list based on the active filter
          const filteredEvents = this.events.filter(event => {
              // If no filter is active, show all events
              if (!this.activeModuleFilter) {
                  return true; 
              }

              // If a filter is active, only show events that match
              // We'll show all non-lessons, and lessons that match the code
              if (event.type !== 'lesson') {
                  return true; // Always show non-lessons (e.g., lunch, gym)
              }

              // For lessons, check if the course code matches
              return event.courseCode && event.courseCode.toUpperCase() === this.activeModuleFilter;
          });
          // --- END OF NEW LOGIC ---

          // 3. Add the *filtered* events to the calendar
          console.log(`[DEBUG] Rendering ${filteredEvents.length} of ${this.events.length} total events.`);
          filteredEvents.forEach(event => {
              const docId = this.docIdFor(event); 
              this.calendar.addEvent({
                  id: docId, 
                  title: `${event.title} (${event.type})`,
                  start: `${event.date}T${event.startTime}`,
                  end: event.endTime ? `${event.date}T${event.endTime}` : null,
                  allDay: false,
                  className: event.type
              });
          });

          this.holidayEvents.forEach(holiday => {
            this.calendar.addEvent(holiday);
          });

          console.log(`[DEBUG] Rendering ${filteredEvents.length} events + ${this.holidayEvents.length} holidays.`);
      },
    },
    mounted() {
      this.loadSemester();
      this.loadSchedulerConfig();

      this.loadEventsFromFirestore()
        .then(() => this.loadReviewsFromFirestore())
        .then(() => this.checkCourseNudges());

      const savedTheme = localStorage.getItem('theme') || 'light';
  		this.isDarkMode = (savedTheme === 'dark');
   		document.documentElement.setAttribute('data-theme', savedTheme);
      this.fetchQuote();
      this.hidePreloader();
      
    }
  }).mount('#app');
}
