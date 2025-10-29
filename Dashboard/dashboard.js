const app = Vue.createApp({
    data() {
        return {
            showForm: false,
            event: {
                title: '',
                date: '',
                time: '',
                endTime: '',
                type: 'lesson',
                repeat: false,
                repeatDay: '1'  // Monday by default
            },
            events: [],
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
                type: this.event.type
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
            this.event = { title: '', date: '', time: '', endTime: '', type: 'lesson', repeat: false, repeatDay: '1' };
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
            if (modalEl) {
                const modal = new bootstrap.Modal(modalEl);
                modal.show();
                modalEl.addEventListener('hidden.bs.modal', () => {
                    if (document.activeElement && modalEl.contains(document.activeElement)) {
                        document.activeElement.blur();
                    }
                    modalEl.setAttribute('aria-hidden', 'true');
                    modalEl.setAttribute('inert', '');
                }, { once: true });
            } else {
                console.error('Modal element not found');
            }
        },
        deleteEvent() {
            if (this.selectedEventElement) {
                this.selectedEventElement.remove();
                this.events = this.events.filter(ev => 
                    `${ev.title} (${ev.type})` !== this.selectedEvent.originalTitle ||
                    `${ev.date}T${ev.time}` !== this.selectedEvent.originalStart
                );
                console.log('Event deleted:', this.selectedEvent.originalTitle);
                console.log('Updated events:', this.events);
                this.saveEvents();
                const modalEl = document.getElementById('eventModal');
                if (modalEl && window.bootstrap) {
                    const modal = bootstrap.Modal.getInstance(modalEl);
                    if (modal) {
                        modal.hide();
                        document.querySelector('body').focus();
                        modalEl.setAttribute('inert', '');
                    }
                }
            }
        },
        saveEditedEvent() {
            if (this.selectedEventElement) {
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
                    type: this.selectedEvent.type
                });
                console.log('Event updated:', this.selectedEvent);
                console.log('All events:', this.events);
                this.saveEvents();
                this.updateCalendar();
                const modalEl = document.getElementById('eventModal');
                if (modalEl && window.bootstrap) {
                    const modal = bootstrap.Modal.getInstance(modalEl);
                    if (modal) {
                        modal.hide();
                        document.querySelector('body').focus();
                        modalEl.setAttribute('inert', '');
                    }
                }
                this.editMode = false;
            }
        }
    },
    mounted() {
        console.log('FullCalendar available:', typeof window.FullCalendar);
        this.loadEvents();
        this.loadSemester();
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