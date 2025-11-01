import { initializeApp } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";

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
    if (gate) gate.innerHTML = `<p>You are signed out. Redirecting to login…</p>`;
    window.location.href = './index.html';
    return;
  }

  // Updated: Check /<UID>/semester document
  const semRef = doc(db, user.uid, "semester");
  try {
    const snap = await getDoc(semRef);
    if (!snap.exists()) {
      if (gate) gate.innerHTML = `<p>No semester found. Redirecting to semester setup…</p>`;
      window.location.href = './semester.html';
      return;
    }

    const data = snap.data() || {};
    const startDate = data.startDate;
    const endDate = data.endDate;

    if (!startDate || !endDate) {
      if (gate) gate.innerHTML = `<p>Incomplete semester dates. Redirecting to semester setup…</p>`;
      window.location.href = './semester.html';
      return;
    }

    bootApp({ startDate, endDate }, user);
    if (gate) gate.style.display = 'none';
    if (appEl) appEl.style.display = 'block';
  } catch (e) {
    console.error('[Dashboard] Semester read error:', e);
    if (gate) gate.innerHTML = `<p>Failed to load semester. Please try again.</p>`;
  }
});

function bootApp(semesterFromFirestore, user) {
  Vue.createApp({
    data() {
      return {
        uid: user.uid,
        showForm: false,
        showConfig: false,
        modalInstance: null,
        deleteMode: null,
        event: {
          title: '',
          date: '',
          time: '',
          endTime: '',
          type: 'lesson',
          repeatDay: '1',
          courseCode: '',
          courseName: '',
          weightage: 1,
          repeat: false
        },
        events: [],
        schedulerConfig: {
          dailyStart: '10:00',
          dailyEnd: '22:00',
          minStudyDuration: 30,
          weeksToGenerate: 4
        },
        calendar: null,
        selectedEvent: {},
        selectedEventElement: null,
        editMode: false,
        semester: { startDate: '', endDate: '' },
      };
    },
    methods: {
      loadSemester() {
        this.semester = {
          startDate: semesterFromFirestore.startDate,
          endDate: semesterFromFirestore.endDate
        };
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
        const slug = (s) => s.toLowerCase().trim().replace(/\s+/S,'-').replace(/[^a-z0-9-]/g,'');
        return `${slug(e.title)}_${e.date}`; // e.g., "cs101_2025-09-01"
      },
      
      // helper: expand weekly occurrences from a seed event until semester end
      expandWeekly(e, semester) {
        const out = [];
        const end = new Date(semester.endDate);
        let d = new Date(e.date);
        // align to desired weekday
        const want = parseInt(e.repeatDay, 10);
        d.setDate(d.getDate() + ((want - d.getDay() + 7) % 7));
        while (d <= end) {
          const iso = d.toISOString().split('T')[0];
          out.push({ ...e, date: iso, isRecurring: true, originalDate: e.date });
          d.setDate(d.getDate() + 7);
        }
        return out;
      },
      
      async addEvent() {
        // validate
        if (!this.event.title || !this.event.date || !this.event.time) {
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
          time: this.event.time,
          endTime: this.event.endTime,
          type: this.event.type,
          courseCode: this.event.courseCode || '',
          courseName: this.event.courseName || '',
          weightage: this.event.weightage || 1,
          repeat: !!this.event.repeat,
          repeatDay: this.event.repeatDay || '1'
        };
      
        // expand if repeating
        const toAdd = base.repeat
          ? this.expandWeekly(base, this.semester)
          : [base];
      
        // add locally
        this.events.push(...toAdd);
        this.saveEventsLocal();
      
        // persist each occurrence to Firestore with unique ids
        try {
          await Promise.all(toAdd.map(e => this.saveEventToFirestore(e)));
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
          time: '',
          endTime: '',
          type: 'lesson',
          courseCode: '',
          courseName: '',
          weightage: 1,
          repeat: false,
          repeatDay: '1'
        };
      },

      saveEventsLocal() {
        try { localStorage.setItem('events', JSON.stringify(this.events)); }
        catch {}
      },

      async deleteEvent() {
        if (!this.selectedEventElement) return;
        const event = this.selectedEventElement;
        const title = event.title.replace(` (${event.classNames[0]})`, '');
        const type = event.classNames[0];
        const date = event.start.toISOString().split('T')[0];
        const isRecurring = !!this.events.find(e => e.title === title && e.type === type && e.repeat);

        // if event is recurring, delete all instances
        if (isRecurring && window.bootstrap) {
            const modal = new bootstrap.Modal('#deleteRecurringModal', { backdrop: 'static', keyboard: false});
            modal.show()
            return;
        }

        // this.events = this.events.filter(e => e.title !== title || e.type !== type);
        this.events = this.events.filter(e => !(e.title === title && e.type === type && e.date === date));
        this.saveEventsLocal();

        // remove exact occurance from firestore
        const target = { title, type, date };
        await this.deleteEventFromFirestore(target); // 🔹 Delete from Firestore

        event.remove();
        if (this.modalInstance) this.modalInstance.hide();
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

      updateCalendar() {
        if (!this.calendar) return;
        this.calendar.getEvents().forEach(e => e.remove());
        this.events.forEach(event => {
          this.calendar.addEvent({
            title: `${event.title} (${event.type})`,
            start: `${event.date}T${event.time}`,
            end: event.endTime ? `${event.date}T${event.endTime}` : null,
            allDay: false,
            className: event.type
          });
        });
      },
      confirmDelete(mode) {
        // mode ∈ {'this','future','all'}
        this.deleteMode = mode;
        const modal = bootstrap.Modal.getInstance(document.getElementById('deleteRecurringModal'));
        if (modal) modal.hide();
      
        this.performDelete();
      },
      async performDelete() {
        if (!this.selectedEventElement) return;
      
        const evEl = this.selectedEventElement;
        const type = evEl.classNames[0];
        const title = evEl.title.replace(` (${type})`, '');
        const clickedDate = evEl.start.toISOString().split('T')[0];
      
        if (this.deleteMode === 'this') {
          // local
          this.events = this.events.filter(e => !(e.title === title && e.type === type && e.date === clickedDate));
          this.saveEventsLocal();
          // firestore
          await this.deleteEventFromFirestore({ title, type, date: clickedDate });
      
        } else if (this.deleteMode === 'future') {
          // local: delete >= clicked date
          this.events = this.events.filter(e => !(e.title === title && e.type === type && e.date >= clickedDate));
          this.saveEventsLocal();
          // firestore: delete each >= clicked date
          const toDelete = [];
          let cur = new Date(clickedDate);
          const end = new Date(this.semester.endDate);
          while (cur <= end) {
            const d = cur.toISOString().split('T')[0];
            toDelete.push(this.deleteEventFromFirestore({ title, type, date: d }));
            cur.setDate(cur.getDate() + 7);
          }
          await Promise.allSettled(toDelete);
      
        } else if (this.deleteMode === 'all') {
          // local: delete all occurrences
          this.events = this.events.filter(e => !(e.title === title && e.type === type));
          this.saveEventsLocal();
          // firestore: delete the whole series via weekly steps from semester start
          const toDelete = [];
          // find weekday from any existing occurrence (fallback: clicked date)
          const weekday = evEl.start.getDay(); // 0-6
          // find the first occurrence on/after semester.startDate with that weekday
          let cur = new Date(this.semester.startDate);
          cur.setDate(cur.getDate() + ((weekday - cur.getDay() + 7) % 7));
          const end = new Date(this.semester.endDate);
          while (cur <= end) {
            const d = cur.toISOString().split('T')[0];
            toDelete.push(this.deleteEventFromFirestore({ title, type, date: d }));
            cur.setDate(cur.getDate() + 7);
          }
          await Promise.allSettled(toDelete);
        }
      
        // UI cleanup
        evEl.remove();
        if (this.modalInstance) this.modalInstance.hide();
        this.deleteMode = null;
      },      
    // handle Vue error before schedule is generated
      generateSchedule() {
        alert("Auto-schedule function not implemented yet.")
      }
    },
    mounted() {
      this.loadSemester();

      // Load locally cached events
      const stored = localStorage.getItem('events');
      if (stored) this.events = JSON.parse(stored);

      const calendarEl = document.getElementById('calendar');
      if (calendarEl && window.FullCalendar) {
        this.calendar = new window.FullCalendar.Calendar(calendarEl, {
          initialView: 'timeGridWeek',
          headerToolbar: { left: 'prev,next', center: 'title', right: 'timeGridWeek,timeGridDay' },
          editable: true,
          height: 'auto',
          slotMinTime: '08:00:00',
          slotMaxTime: '22:00:00',
          validRange: {
            start: this.semester.startDate,
            end: new Date(new Date(this.semester.endDate).setDate(
              new Date(this.semester.endDate).getDate() + 1
            )).toISOString().split('T')[0]
          },
          events: this.events.map(event => ({
            title: `${event.title} (${event.type})`,
            start: `${event.date}T${event.time}`,
            end: event.endTime ? `${event.date}T${event.endTime}` : null,
            allDay: false,
            className: event.type
          })),
          eventClick: (info) => {
            this.selectedEventElement = info.event;
            this.selectedEvent = {
              title: info.event.title.replace(` (${info.event.classNames[0]})`, ''),
              type: info.event.classNames[0]
            };
            const modalEl = document.getElementById('eventModal');
            const modal = new bootstrap.Modal(modalEl);
            this.modalInstance = modal;
            modal.show();
          }
        });
        this.calendar.render();
      }
    }
  }).mount('#app');
}
