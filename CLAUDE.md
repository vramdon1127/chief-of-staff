# STWRD — Claude Code Orientation

## What STWRD is

STWRD is a household OS built for married couples juggling jobs, kids, side hustles, and faith. It's a vertical Claude wrapper for households that non-technical couples can actually use.

**Core vision:** shared task visibility, household life balance score, partner digest, and AI that does the work invisibly.

**Tagline:** "The AI works. You don't have to."

**Target user:** non-technical couples who find AI overwhelming.

**Positioning principle:** invisible complexity, visible results — users never see the prompt or the loop.

**Current milestone:** Mia onboards as first beta user, then identify 5 couples for beta.

---

## Stack

- **Hosting:** Vercel (single `index.html` at repo root)
- **Frontend:** vanilla HTML/CSS/JS — no framework
- **Auth:** Google OAuth (production URL configured)
- **Database:** Supabase — project `fnnegalrrdzcgoelljmi.supabase.co`
- **AI:** Claude API (key via environment variable, never commit)
- **Domain:** getstwrd.com (Namecheap DNS → Vercel)
- **Daily digest:** cron-job.org at 7:00am CT (Vercel cron status unverified — need to confirm Vercel cron is disabled to avoid duplicate digests)

### Supabase `tasks` table

Key columns include: `project`, `category`, `priority`, `life_area` (plus standard id/user/created/completed fields).

---

## Repo state

- Single `index.html` at root today. A refactor into a proper project structure is planned and is the first major Claude Code task.
- No build step yet.
- `.env` (or equivalent) holds API keys — never commit secrets.

---

## Active backlog — NOW (Apr–May)

Work these in roughly this order:

1. Fix AI Complete / AI Assist bug
2. Prominent checkbox (mobile tappable)
3. Fix banner UX
4. Dynamic projects screen
5. Mobile audit
6. Unwind Zapier (only after Todoist routing bug is confirmed stable)
7. Update API key life area

## NEXT (May–Jun)

8. Chat-to-task (Claude offers "want me to add that as a STWRD task?" and writes via Supabase)
9. Sort by priority in project view
10. Add tasks from within project view
11. Relationship / family nudges
12. Calendar time-blocking
13. Task notes field
14. Dark theme digest
15. Inbox triage — AI monitors Gmail, flags urgent / actionable / noise, surfaces in digest or dedicated tab

## LATER (Jun–Aug)

18. Persistent Supabase context
19. Mia life score
20. Quick undo on task completion
21. Task completion celebration badges
22. Bulk task actions
23. Drag-drop project reorder
24. Smart note review auto-suggest
25. Voice dictation brain dump
26. Task grouping / clustering
27. Mia digest email

## FUTURE

28. Oura Ring integration
29. GNE couple gifting (free STWRD for wedding couples Vijay DJs — gated on stable partner linking)
30. Duolingo engagement research
31. AI financial advisor merge into STWRD
32. Ralph Loop AI Complete — true multi-step agentic execution with self-verification and retry

**Deprioritized:** Life score as currently built is broken (shows 100 without family tasks). Move to LATER or cut.

---

## Season 2 vision (do not build yet — high priority context)

One-tap OAuth integrations: Google Calendar, Gmail, Plaid. Couples connect accounts Mint/YNAB-style, STWRD merges both partners' data into the digest automatically. Let beta couples signal which integrations matter first.

---

## Development approach

### Ralph Loop method

One goal per loop. Watch output. Fix the failure domain. Don't expand scope mid-loop.

### Ralph Loop AI Complete (the feature, phased)

- **Phase 1 (Season 1):** basic loop with self-verification. Claude attempts → grades own output → retries up to 3x → escalates if all fail. ~50–100 lines JS.
- **Phase 2:** add web search tool use.
- **Phase 3:** full multi-step autonomous agent.

### Claude category prompt rule

If a task implies "write / draft / text / email / find / research / compare / summarize / create list / give options" → route to **AI Complete**. Current prompt is too vague — needs explicit examples and intent-based reasoning.

### Session workflow

- Use `claude --continue` to resume.
- Hooks can auto-run lint / deploy after each loop.
- Keep changes small, commit often, verify in prod (Vercel auto-deploys on push to main).

---

## Known constraints & gotchas

- Beta guide PDF (`stwrd_beta_guide.pdf`) reflects older state (7 static life areas, 6am CT digest). Update it as features change — don't let it drift silently.
- Login tagline "AI for the life you're actually living" is strong but doesn't communicate the couples/household differentiator. Consider adding "Built for couples managing real life together" beneath it.
- Vercel cron vs cron-job.org: only one should be firing the 7am CT digest. Confirm before debugging duplicate-send issues.

---

## What Claude Code should do on a fresh session

1. Read this file.
2. Read `index.html` (or the refactored entry point once it exists).
3. Confirm understanding of the current NOW item being worked.
4. Ask before making structural changes outside the stated goal.
