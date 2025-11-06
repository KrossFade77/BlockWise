# BlockWise

BlockWise is a web-based personal study planning and spaced-repetition scheduling tool built for university students. It converts weekly class schedules into a balanced study plan by generating optimised study schedules using spaced repetition, module priority weighting, and personal availability. The scheduler intelligently places review sessions into the student's calendar while respecting class times, personal events, and workload balance to improve long-term knowledge retention. BlockWise helps students review by also generating and parsing multiple-choice questions (MCQs) from prompts or lecture text. It integrates Firebase (Auth, Firestore, Hosting, Cloud Functions) with a Vue/FullCalendar frontend and a conflict-aware scheduling algorithm.


The system is built using **Firebase**, **Firestore**, and **Cloud Functions**, with a **Vue.js** frontend and **custom scheduling engine**.

---

## ✨ Key Features

- **Spaced-Repetition Scheduling**
  - Per-module cycles using intervals **+1d → +3d → +7d**
  - Cycles repeat across a chosen horizon (e.g., 1–8 weeks); partial cycles allowed when horizon or semester end truncates
  - **Priority by Module Weight** (e.g., 5=heavy → 1=light) so scarce slots go to critical modules first
  - **Conflict-Aware Placement**: avoids lessons, personal events, and previously placed sessions
  - **Adaptive Duration** by interval and weight (e.g., heavier modules get longer review sessions)
  - **Empty-Schedule Spacing**: spreads sessions within the day/week when time is abundant

- **Calendar & Data**
  - Interactive calendar via **FullCalendar** library
  - Persist lessons, personal events, and generated reviews in **Firestore**
  - **One-click** re-generation; safe clear & re-apply of generated reviews
  - Optional **Public Holiday** display (Nager API)

- **MCQ Generation & Parsing**
  - **/api/generate**: Uses **Google Gemini** to generate a block of MCQs from a prompt (lecture notes, pdf files, textbook excerpts, etc.)
  - **/api/parse**: Converts the generated MCQ text into clean JSON shape:
    ```json
    { "questions": [ { "Question": "...", "Options": ["A","B","C","D"], "Correct": "..." } ] }
    ```
  - Designed for downstream quiz UI, spaced recall, or export

- **Security & Ops**
  - Firebase Hosting rewrites for clean API routes
  - Functions constrained by region (`asia-southeast1`) and `maxInstances` for cost control
  - Secret management via **Firebase Functions params** (e.g., `GEMINI_API_KEY`)

## 🧠 How the Scheduler Works (Overview)

1. **Inputs**: semester dates, weekly lessons (by module), personal recurring events, study window (e.g., 10:00–22:00), and **weeksToGenerate**.
2. **Horizon Window**: `[windowStart, windowEnd]` = clamped by today/semester and user’s weeks horizon.
3. **Anchors**: For each module, pick lesson anchors at or after the rolling per-module cycle cursor.
4. **Intervals**: Try +1d, +3d, +7d in order for each anchor; allow partial cycles near horizon end.
5. **Placement**: Find the earliest feasible slot on/after each target day without overlapping busy windows.
6. **Fairness & Priority**: Modules are processed by descending weight to avoid starvation; low-weight modules back-off when space is scarce so important modules dominate earlier in the week.
7. **Persistence**: Save generated sessions to Firestore and render them in FullCalendar.

## 🧩 How MCQ Generation Works (Overview)

- **/api/generate** (`POST { prompt }`)  
  Calls Google Gemini with your prompt and returns raw MCQ text (multi-question block).
- **/api/parse** (`POST { mcq_text }`)  
  Parses the above text into structured JSON with `Question`, `Options[]`, and `Correct`, ready for rendering or export.
- **Typical Flow**: Instructor/student pastes notes → **/api/generate** returns a formatted MCQ block → **/api/parse** returns normalized JSON for quiz components or spaced-recall decks.


## Structure
**BlockWise/**
**├─ Webpages/**
**│  └─ Dashboard/**
│     ├─ dashboard.html            # App UI (Vue + FullCalendar)
│     ├─ dashboard.js              # Auth, Firestore, calendar wiring, generate button
│     └─ scheduler.js              # Reference algorithm (frontend mirror; backend runs in functions/)
**└─ functions/**
├─ index.js                     # Cloud Functions: /api/generate, /api/parse, /api/generate-schedule
└─ scheduler.js                 # Production scheduling algorithm (Node)