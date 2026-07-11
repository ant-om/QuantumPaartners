# Task: Team Sprint Tracker (Trello, weekly sprints)

**Goal:** Replace the current "messy meeting" workflow with a shared Trello board that
tracks ALL work (mine + teammates' n8n/data/quant tasks) on a 1-week sprint cadence,
so standups/weekly meetings just "walk the board".

**Decisions (locked):**
- Platform: **Trello** (free, friendliest for non-dev n8n teammates)
- Team size: 2–3 people
- Cadence: **1-week sprints**, Mon → Sun

## Checklist
1. [x] Pick platform + cadence (Trello, weekly)
2. [x] Design board structure (lists + labels + sprint flow)
3. [x] Write reproducible setup script (`tools/setup-trello.sh`) using Trello REST API
4. [x] Seed the board with the real current backlog
5. [ ] User grabs Trello API key + token and runs the script
6. [ ] Invite the 2 teammates to the board
7. [ ] Run first sprint-planning pass (move cards into "This Week", assign owners + due dates)
8. [x] Document methodology in `doc/sprint-tracker.md`

## Board design
**Lists (columns):** 📥 Backlog · 🎯 This Week · 🔨 Doing · 👀 Review/Blocked · ✅ Done
**Labels (work area):** n8n · Frontend · Data/Supabase · Quant/Python · Bug · Infra/Security
**Assignee:** Trello card "members". **Sprint scope:** everything in "This Week" + a due date.
