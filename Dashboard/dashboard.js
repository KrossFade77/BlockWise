const app = Vue.createApp({
    data() {
        return {
            showForm: false,
            showConfig: false,
            modalInstance: null,
            event: {
                id: null,
                title: '',
                date: '',
                time: '',
                endTime: '',
                type: 'lesson',
                repeatDay: '1',  // Monday by default
                courseCode: '', // ADDED
                courseName: '', // ADDED
                weightage: 1, // ADDED
                repeat: false // ADDED
            },
            events: [],
            schedulerConfig: { // ADDED
                dailyStart: '10:00',
                dailyEnd: '22:00',
                minStudyDuration: 30,
                // maxStudyDuration: 120,
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
        loadEvents() {
            try {
                const stored = localStorage.getItem('events');
                if (stored) {
                    this.events = JSON.parse(stored);
                    console.log('Loaded events from localStorage:', this.events);
                } else {
                    console.log('No events in localStorage, initializing empty array');
                }
            } catch (error) {
                console.error('Error loading events from localStorage:', error);
                this.events = [];
            }
        },
        loadSemester() {
            try {
                const stored = localStorage.getItem('semester');
                if (stored) {
                    this.semester = JSON.parse(stored);
                    console.log('Loaded semester from localStorage:', this.semester);
                } else {
                    console.log('No semester in localStorage, initializing empty');
                }
            } catch (error) {
                console.error('Error loading semester from localStorage:', error);
            }
        },
        saveEvents() {
            try {
                localStorage.setItem('events', JSON.stringify(this.events));
                console.log('Saved events to localStorage:', this.events);
                console.log('localStorage events after save:', JSON.parse(localStorage.getItem('events')));
            } catch (error) {
                console.error('Error saving events to localStorage:', error);
            }
        },
        loadSchedulerConfig() {
            try {
                const stored = localStorage.getItem('schedulerConfig');
                if (stored) {
                    this.schedulerConfig = JSON.parse(stored);
                    console.log('Loaded schedulerConfig from localStorage:', this.schedulerConfig);
                } else {
                    console.log('No schedulerConfig found in localStorage, initializing with defaults')
                    this.schedulerConfig = {
                        dailyStart: '10:00',
                        dailyEnd: '22:00',
                        minStudyDuration: 30,
                        weeksToGenerate: 4
                    }
                }
            } catch (error) {
                console.log('Error loading schedulerConfig from localStorage:', error);
                this.schedulerConfig = {
                    dailyStart: '',
                    dailyEnd: '',
                    minStudyDuration: null
                };
            }
        },
        saveSchedulerConfig() {
            try {
                if (
                    ! this.schedulerConfig.dailyStart ||
                    ! this.schedulerConfig.dailyEnd ||
                    ! this.schedulerConfig.minStudyDuration
                ) {
                    alert('Please fill in all scheduler configuration fields before saving.');
                    return;
                }

                localStorage.setItem('schedulerConfig', JSON.stringify(this.schedulerConfig));
                console.log('Saved schedulerCOnfig to localStorage:', this.schedulerConfig);
                console.log('localStorage schedulerConfig after save:', JSON.parse(localStorage.getItem('schedulerConfig')));

                alert('Scheduler configuration saved scucessfully!');
                this.showConfig = false;
            } catch (error) {
                console.error('Error saving schedulerConfig to localStorage:', error);
                alert('Failed to save scheduler configuration.');
            }
        },
        showEventForm() {
            this.showForm = !this.showForm;
            console.log('Add Event clicked, showForm:', this.showForm);
        },
        addEvent() {
            if (!this.isEventWithinSemester(this.event.date)) {
                alert('Event date is outside the semester period.');
                return;
            }

            const baseEvent = {
                title: this.event.title,
                date: this.event.date,
                time: this.event.time,
                endTime: this.event.endTime,
                type: this.event.type,
                courseCode: this.event.courseCode || '',
                courseName: this.event.courseName || '',
                weightage: this.event.weightage || 1
            };

            const eventsToAdd = [];

            if (this.event.repeat) {
                // Generate weekly events
                const start = new Date(this.event.date);
                const end = new Date(this.semester.endDate);
                const day = parseInt(this.event.repeatDay);

                let current = new Date(start);
                current.setDate(current.getDate() + ((day - current.getDay() + 7) % 7));

                while (current <= end) {
                if (this.isEventWithinSemester(current.toISOString().split('T')[0])) {
                    eventsToAdd.push({
                    ...baseEvent,
                    date: current.toISOString().split('T')[0],
                    isRecurring: true,
                    originalDate: this.event.date
                    });
                }
                current.setDate(current.getDate() + 7);
                }
            } else {
                eventsToAdd.push(baseEvent);
            }

            this.events.push(...eventsToAdd);
            console.log('Added recurring events:', eventsToAdd);
            this.saveEvents();
            this.showForm = false;
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
            this.updateCalendar();
        },
        isEventWithinSemester(date) {
            if (!this.semester.startDate || !this.semester.endDate) return true;
            const eventDate = new Date(date);
            const startDate = new Date(this.semester.startDate);
            const endDate = new Date(this.semester.endDate);
            return eventDate >= startDate && eventDate <= endDate;
        },
        updateCalendar() {
            if (this.calendar) {
                this.calendar.getEvents().forEach(event => event.remove());
                this.events.forEach(event => {
                    try {
                        this.calendar.addEvent({
                            title: `${event.title} (${event.type})`,
                            start: `${event.date}T${event.time}`,
                            end: event.endTime ? `${event.date}T${event.endTime}` : null,
                            allDay: false,
                            className: event.type
                        });
                    } catch (error) {
                        console.error('Error adding event to calendar:', event, error);
                    }
                });
                console.log('Calendar updated with events:', this.events);
            }
        },
        exportSchedulerData() {
            if (!this.semester.startDate || !this.semester.endDate) {
                alert("Please set your semester dates first.");
                return null;
            }
            if (!this.schedulerConfig.dailyStart || !this.schedulerConfig.dailyEnd) {
                alert("Please complete the scheduler settings before generating a schedule.");
                return null;
            }
            if (this.events.filter(e => e.type === 'lesson').length === 0) {
                alert("Please add at least one event before generating your schedule.");
                return null;
            }

            const payload = {
                semester: this.semester,
                schedulerConfig: this.schedulerConfig,
                modules: this.events.filter(e => e.type === 'lesson'),
                personalEvents: this.events.filter(e => e.type === 'non-lesson')
            };

            console.log("Schedule request payload:", payload);
            return payload;
        },
        async generateSchedule() {
            const payload = this.exportSchedulerData();
            if (!payload) return;

            try {
                console.log('Sending payload to backend...');
                const res = await axios.post('/api/generate-schedule', payload);
                console.log('Received generated schedule:', res.data);

                this.renderGeneratedSchedule(res.data);

                alert('Schedule successfully generated!');
            } catch (error) {
                console.error('Error generating schedule:', error);
                alert('Failed to generate schedule. Please try again.');
            }
        },
        renderGeneratedSchedule(schedule) {
            schedule.forEach(task => {
                this.calendar.addEvent({
                    title: `${task.moduleName} Review`,
                    start: task.start,
                    end: task.end,
                    className: 'review-session'
                });
            });

            console.log('Rendered generated schedule to calendar:', schedule);
        },
        handleEventDrop(info) {
            const event = info.event;
            const newDate = event.start.toISOString().split('T')[0];
            const startTime = event.start.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
            let endTime = null;
            if (event.end) {
                endTime = event.end.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
            }
            if (!this.isEventWithinSemester(newDate)) {
                alert('Cannot move event outside semester period.');
                info.revert();
                return;
            }
            let matched = false;
            this.events = this.events.map(ev => {
                const oldStart = new Date(`${ev.date}T${ev.time}+08:00`).toISOString().split('.')[0];
                const oldEventStart = info.oldEvent.start.toISOString().split('.')[0];
                console.log('Comparing:', { title: `${ev.title} (${ev.type})`, oldStart, oldEventStart });
                if (`${ev.title} (${ev.type})` === event.title && oldStart === oldEventStart) {
                    matched = true;
                    return { ...ev, date: newDate, time: startTime, endTime: endTime || ev.endTime };
                }
                return ev;
            });
            if (!matched) {
                console.error('No matching event found for drop:', { title: event.title, oldStart: info.oldEvent.start });
            }
            console.log('Event dropped:', { title: event.title, date: newDate, startTime, endTime });
            console.log('Updated events:', this.events);
            this.saveEvents();
            this.updateCalendar();
        },
        handleEventClick(info) {
            if (!window.bootstrap) {
                console.error('Bootstrap JS not loaded, falling back to alert');
                if (confirm(`Delete "${info.event.title}"?`)) {
                    info.event.remove();
                    this.events = this.events.filter(ev => 
                        `${ev.title} (${ev.type})` !== info.event.title ||
                        `${ev.date}T${ev.time}` !== info.event.startStr
                    );
                    console.log('Event deleted:', info.event.title);
                    console.log('Updated events:', this.events);
                    this.saveEvents();
                }
                return;
            }
            const event = info.event;
            const newDate = event.start.toISOString().split('T')[0];
            const startTime = event.start.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
            let endTime = null;
            if (event.end) {
                endTime = event.end.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
            }
            this.selectedEvent = {
                title: event.title.replace(` (${event.classNames[0]})`, ''),
                date: newDate,
                startTime,
                endTime,
                type: event.classNames[0],
                originalTitle: event.title,
                originalStart: `${newDate}T${startTime}`
            };
            this.selectedEventElement = event;
            this.editMode = false;
            const modalEl = document.getElementById('eventModal');
            if (!modalEl) {
                console.error('Modal element not found');
                return;
            }

            const modal = new bootstrap.Modal(modalEl, {
                backdrop: 'static',
                keyboard: false
            });

            this.modalInstance = modal;

            modal.show();

            modalEl.addEventListener('hidden.bs.modal', () => {
                modal.dispose();
                this.editMode = false;
                this.selectedEvent = {};
            }, { once: true });
        },
        deleteEvent() {
            if (!this.selectedEventElement) return;

            this.selectedEventElement.remove();
            this.events = this.events.filter(ev => 
                `${ev.title} (${ev.type})` !== this.selectedEvent.originalTitle ||
                `${ev.date}T${ev.time}` !== this.selectedEvent.originalStart
            );
            this.saveEvents();

            if (this.modalInstance) {
                this.modalInstance.hide();
            }
        },

        saveEditedEvent() {
            if (!this.selectedEventElement) return;

            if (!this.isEventWithinSemester(this.selectedEvent.date)) {
                alert('Cannot edit event to a date outside semester period.');
                return;
            }

            this.selectedEventElement.remove();
            this.events = this.events.filter(ev => 
                `${ev.title} (${ev.type})` !== this.selectedEvent.originalTitle ||
                `${ev.date}T${ev.time}` !== this.selectedEvent.originalStart
            );
            this.events.push({
                title: this.selectedEvent.title,
                date: this.selectedEvent.date,
                time: this.selectedEvent.startTime,
                endTime: this.selectedEvent.endTime,
                type: this.selectedEvent.type,
                courseCode: this.selectedEvent.courseCode || '',
                courseName: this.selectedEvent.courseName || '',
                weightage: this.selectedEvent.weightage || 1
            });
            this.saveEvents();
            this.updateCalendar();

            if (this.modalInstance) {
                this.modalInstance.hide();
            }
            this.editMode = false;
        },
    },
    mounted() {
        console.log('FullCalendar available:', typeof window.FullCalendar);
        this.loadEvents();
        this.loadSemester();
        this.loadSchedulerConfig();
        console.log('Events after load:', this.events);
        const calendarEl = document.getElementById('calendar');
        console.log('Calendar element:', calendarEl);
        if (calendarEl && window.FullCalendar) {
            this.calendar = new window.FullCalendar.Calendar(calendarEl, {
                initialView: 'timeGridWeek',
                headerToolbar: {
                    left: 'prev,next',
                    center: 'title',
                    right: 'timeGridWeek,timeGridDay'
                },
                editable: true,
                height: 'auto',
                slotMinTime: '08:00:00',
                slotMaxTime: '22:00:00',
                validRange: {
                    start: this.semester.startDate || undefined,
                    end: this.semester.endDate ? new Date(new Date(this.semester.endDate).setDate(new Date(this.semester.endDate).getDate() + 1)).toISOString().split('T')[0] : undefined
                },
                events: this.events.map(event => {
                    try {
                        return {
                            title: `${event.title} (${event.type})`,
                            start: `${event.date}T${event.time}`,
                            end: event.endTime ? `${event.date}T${event.endTime}` : null,
                            allDay: false,
                            className: event.type
                        };
                    } catch (error) {
                        console.error('Error mapping event for calendar:', event, error);
                        return null;
                    }
                }).filter(event => event !== null),
                eventDrop: this.handleEventDrop.bind(this),
                eventClick: this.handleEventClick.bind(this)
            });
            console.log('FullCalendar initialized:', this.calendar);
            this.calendar.render();
            console.log('Calendar rendered');
        } else {
            console.error('Calendar initialization failed: FullCalendar or element missing');
        }
    }
}).mount('#app');