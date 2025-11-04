## Algorithm Constraints and Assumptions

These assumptions reflect typical university schedules and are **explicitly incorporated** into the algorithm:

| Factor | Typical Reality | Scheduling Impact |
|-------|----------------|------------------|
| Class session length | 1h45m – 3h30m, once or twice per week | Class **length does not directly determine review length** (prevents overlong reviews) |
| Personal events | 2–3 hours/day (meals, travel, commute, CCA commitments) | Treated as **Non-Lesson blocks** the scheduler must avoid |
| Study window | e.g., 10:00 – 22:00 (configurable) | Review sessions can only be placed within this range |
| Minimum effective review | 30 minutes | **No review session is ever shorter than 30 minutes** |

---

## 2. Module Weight System (Importance-Based Study Time)

Each module is assigned a **weight (1–5)** reflecting importance, difficulty, or workload.  
This determines how much total review time the module receives per week.

| Module Weight | Meaning | Weekly Total Review Time |
|---|---|---|
| 5 | Core / content-heavy / exam-critical | **4.5 hours/week** |
| 4 | Strong emphasis needed | **3.5 hours/week** |
| 3 | Standard module | **2.5 hours/week** |
| 2 | Lower priority | **1.5 hours/week** |
| 1 | Minimal reinforcement | **1.0 hour/week** |

This ensures **higher-weight modules are reviewed more often and for longer** 

---

## 3. Spaced Repetition Intervals

Each weekly review load is split across three reinforcement sessions:
- **Day +1**
- **Day +3**
- **Day +7**

| Interval | Memory Purpose | % of Weekly Review Time |
|---|---|---|
| **+1 day** | **50%** |
| **+3 days** | **30%** |
| **+7 days** | **20%** |

---

## 4. Review Session Duration Table (Fixed, Deterministic)

| Weight | Day +1 | Day +3 | Day +7 | Weekly Total |
|---|:---:|:---:|:---:|---|
| **5** | 120 min | 75 min | 45 min | 4.5 hrs |
| **4** | 90 min | 60 min | 45 min | 3.5 hrs |
| **3** | 60 min | 45 min | 30 min | 2.5 hrs |
| **2** | 45 min | 30 min | 30 min | 1.5 hrs |
| **1** | 30 min | 30 min | 30 min | 1.0 hr |

> Default minimum review duration is **30 minutes**, regardless of weight or spacing.

---

## 5. Scheduling Strategy (Greedy + Constraint Satisfaction)

The scheduler does makes sure to place review sessions near class time.  

### Placement Priority:
1. **Higher weight modules first**
2. **Earlier spaced interval first** (+1 → +3 → +7)
3. **Longer sessions first** (so they don’t get stranded)

### Placement Algorithm:
For each review session:
1. Compute its target review date (classDate + interval)
2. List all free study windows on that date
3. Attempt to place the session in the **earliest valid block**
4. If blocked → shift later in 30-minute increments
5. If day is fully blocked → **defer to the next nearest appropriate day**
6. Ensure session still falls within reasonable spacing tolerance

### Review Session Deferrence
When the schedule does not permit the insertion of a review session / study block,
the scheduler pushes the block back by a day, with a maximum limit of 1d deferrence.

---