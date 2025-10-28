const express = require('express');
const path = require('path');
// const { generateSpacedRepetitionSchedule } = require('./scheduler');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'Dashboard')));

// schedule API endpoint
app.post('/api/generate-schedule', (req, res) => {
    const { semester, schedulerConfig, modules, personalEvents } = req.body;
    try {
        const schedule = generateSpacedRepetitionSchedule(
            semester,
            schedulerConfig,
            modules,
            personalEvents
        );
        res.json(schedule);
    } catch (error) {
        console.error('Schedule generation failed:', error);
        res.status(500).json({ error: 'Internal scheduler error' });
    }
});

// fallback is to redirect all unknown routes back to `dashboard.html`
app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'Dashboard', 'dashboard.html'));
});

// start server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});