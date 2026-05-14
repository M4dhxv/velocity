# Career-Ops Application Workflow & Tracking System

## End-to-End Process Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          CAREER-OPS WORKFLOW                                 │
└─────────────────────────────────────────────────────────────────────────────┘

USER PASTES JOB (URL or description)
        │
        ▼
┌──────────────────────────────────────────────────────────────────┐
│ STEP 1: EXTRACT JOB DESCRIPTION                                  │
├──────────────────────────────────────────────────────────────────┤
│ • If URL → Use Playwright (renders SPA), WebFetch, or WebSearch   │
│ • If text → Use directly                                          │
│ • Output: Cleaned job description                                │
└────────────┬─────────────────────────────────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────────────────────────────┐
│ STEP 2: ARCHETYPE DETECTION (5 seconds)                          │
├──────────────────────────────────────────────────────────────────┤
│ Classify into: LLMOps / Agentic / PM / SA / FDE / Transformation │
│ • Determines evaluation weight priorities                         │
│ • Guides which proof points matter most                           │
│ • Sets interview prep story selection                            │
└────────────┬─────────────────────────────────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────────────────────────────┐
│ STEP 3: DETAILED 6-BLOCK EVALUATION (1-2 minutes)                │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│ ┌─ BLOCK A: Role Summary                                         │
│ │  • Archetype, domain, function, seniority, remote, team size  │
│ │  • Output: Table with basics                                  │
│ │                                                                │
│ ├─ BLOCK B: CV Match vs Gaps (reads cv.md)                      │
│ │  • Maps each JD requirement to exact CV lines                 │
│ │  • Identifies gaps + mitigation strategies                    │
│ │  • Hard blockers vs nice-to-haves                             │
│ │  • Output: Requirements table + gap analysis                  │
│ │                                                                │
│ ├─ BLOCK C: Level & Selling Strategy                            │
│ │  • Detected JD level vs candidate's natural level             │
│ │  • "Sell senior without lying" strategy                       │
│ │  • Downlevel negotiation tactics                              │
│ │  • Output: Strategic talking points                           │
│ │                                                                │
│ ├─ BLOCK D: Compensation Research                               │
│ │  • WebSearch for actual salary ranges (Levels.fyi, Blind)     │
│ │  • Geographic cost adjustment                                 │
│ │  • Equity impact calculations                                 │
│ │  • Output: Comp range + negotiation leverage                  │
│ │                                                                │
│ ├─ BLOCK E: Personalization Plan                                │
│ │  • Company + role specific research                           │
│ │  • Why candidate wants THIS job                               │
│ │  • Rewritten cover letter angles                              │
│ │  • Output: 3-4 compelling narratives                          │
│ │                                                                │
│ └─ BLOCK F: Interview Prep (STAR+Reflection)                   │
│    • Match 5-10 master stories from Story Bank to role          │
│    • Frame each for this specific role archetype               │
│    • Include reflection (what you'd do differently)             │
│    • Output: Interview talking points                           │
│                                                                   │
└────────────┬─────────────────────────────────────────────────────┘
             │
             ▼
        ┌────────────────────┐
        │ GENERATE SCORE     │
        │ (A-F / 5.0)        │
        └────────┬───────────┘
                 │
        ┌────────▼──────────────────┐
        │ Score < 4.0?              │
        │ (Skip threshold)          │
        ├──────────────────────────┤
        │ YES → STOP (mark SKIP)    │
        │ NO  → CONTINUE           │
        └────────┬──────────────────┘
                 │
                 ▼
┌──────────────────────────────────────────────────────────────────┐
│ STEP 4: SAVE EVALUATION REPORT                                   │
├──────────────────────────────────────────────────────────────────┤
│ File: reports/{###}-{company-slug}-{YYYY-MM-DD}.md              │
│ • Contains all 6 blocks A-F                                      │
│ • Includes Block G: Posting Legitimacy                           │
│ • Draft application answers (if score >= 4.5)                   │
│ • Fully self-contained (can reference offline)                  │
└────────────┬─────────────────────────────────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────────────────────────────┐
│ STEP 5: GENERATE ATS PDF                                         │
├──────────────────────────────────────────────────────────────────┤
│ • Reads cv.md + JD (from report)                                │
│ • Extracts keywords from JD                                      │
│ • Generates tailored CV (keyword-injected)                      │
│ • Output: output/{company}_{role}_{date}.pdf                    │
│ • Design: Space Grotesk + DM Sans (ATS-friendly)               │
└────────────┬─────────────────────────────────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────────────────────────────┐
│ STEP 6: UPDATE TRACKER                                           │
├──────────────────────────────────────────────────────────────────┤
│ File: data/applications.md                                       │
│ • Add new row with:                                              │
│   - Date, Company, Role, Score, Status ("evaluated")             │
│   - Link to PDF ✅                                               │
│   - Link to Report ✅                                            │
│ • All data stays in this single markdown table                  │
└────────────┬─────────────────────────────────────────────────────┘
             │
             ▼
        ┌──────────────────────────┐
        │ READY TO APPLY           │
        │ (User has full context)  │
        └──────────────────────────┘


┌─────────────────────────────────────────────────────────────────────────────┐
│                    WHEN USER GOES TO APPLY (Step 7)                          │
└─────────────────────────────────────────────────────────────────────────────┘

USER VISITS JOB PAGE TO APPLY
        │
        ▼
┌──────────────────────────────────────────────────────────────────┐
│ APPLY MODE ACTIVATED (modes/apply.md)                            │
├──────────────────────────────────────────────────────────────────┤
│ • Reads active Chrome tab (screenshot/URL)                       │
│ • Extracts company + role                                        │
│ • Searches for existing report in reports/                       │
└────────────┬─────────────────────────────────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────────────────────────────┐
│ LOAD CONTEXT FROM REPORT                                         │
├──────────────────────────────────────────────────────────────────┤
│ • Finds matching report (company + role)                        │
│ • Loads all 6 blocks of evaluation                              │
│ • Loads Block G (draft application answers)                     │
│ • Detects any role changes since evaluation                     │
└────────────┬─────────────────────────────────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────────────────────────────┐
│ ANALYZE FORM QUESTIONS                                           │
├──────────────────────────────────────────────────────────────────┤
│ Common questions on Greenhouse/Lever:                            │
│ • Why interested in this role?                                   │
│ • Why want to work at [Company]?                                 │
│ • Tell us about a relevant project                              │
│ • What makes you a good fit?                                     │
│ • How did you hear about us?                                     │
│ • (Custom fields)                                                │
└────────────┬─────────────────────────────────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────────────────────────────┐
│ GENERATE PERSONALIZED ANSWERS                                    │
├──────────────────────────────────────────────────────────────────┤
│ Framework (tone: "I'm choosing you"):                            │
│                                                                   │
│ Q: "Why interested?"                                             │
│ A: "Your [specific thing] maps directly to [specific             │
│     thing I built]."                                             │
│                                                                   │
│ Q: "Why this company?"                                           │
│ A: "I've been using [product] for [time], and I want            │
│     to build on that."                                           │
│                                                                   │
│ Q: "Relevant project?"                                           │
│ A: "Built [X] that achieved [metric]. This role lets me         │
│     scale that approach."                                        │
│                                                                   │
│ Q: "Good fit?"                                                   │
│ A: "I sit at the intersection of [A] and [B], which              │
│     is exactly where this role lives."                           │
│                                                                   │
│ Q: "How hear?"                                                   │
│ A: "Found through [source], evaluated against my                │
│     criteria, scored highest."                                   │
│                                                                   │
│ Output: Formatted responses ready for copy-paste                │
└────────────┬─────────────────────────────────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────────────────────────────┐
│ USER COPIES & PASTES INTO FORM                                   │
├──────────────────────────────────────────────────────────────────┤
│ • Claude doesn't auto-submit (human decision)                    │
│ • User manually fills form + clicks submit                       │
│ • (Safety: User stays in control)                                │
└────────────┬─────────────────────────────────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────────────────────────────┐
│ STEP 8: MANUAL TRACKER UPDATE                                    │
├──────────────────────────────────────────────────────────────────┤
│ User updates data/applications.md:                               │
│ • Status: "evaluated" → "applied"                                │
│ • Date submitted: (manually entered)                             │
│ • Notes: Any relevant info (e.g., "custom answers", etc)        │
└────────────┬─────────────────────────────────────────────────────┘
             │
             ▼
        ┌──────────────────────────────────┐
        │ APPLICATION SUBMITTED            │
        │ (Tracked & managed)              │
        └──────────────────────────────────┘
```

---

## Application Tracker Structure

### File: `data/applications.md`

**Format:**
```markdown
| # | Date | Company | Role | Location | Score | Status | Report | PDF | Notes |
|----|------|---------|------|----------|-------|--------|--------|-----|-------|
| 1 | 2026-05-12 | Anthropic | Head of Applied AI | SF, CA | 4.8 | applied | [📋 Report](../reports/001-anthropic-2026-05-12.md) | [📄 PDF](../output/anthropic_head-ai_2026-05-12.pdf) | Strong fit, negotiating comp |
| 2 | 2026-05-12 | OpenAI | AI Researcher | SF, CA | 4.5 | evaluated | [📋 Report](../reports/002-openai-2026-05-12.md) | [📄 PDF](../output/openai_ai-researcher_2026-05-12.pdf) | Waiting for form link |
| 3 | 2026-05-11 | Mistral | LLMOps Lead | Remote | 3.2 | skip | — | — | Compensation too low |
```

### Status Values

```
evaluated  ────────────────┐
                           │
                      (candidate decides)
                           │
                           ▼
                    ┌─────────────────┐
                    │   applied   ◄───┤ (submitted application)
                    └────────┬────────┘
                             │
                (company or candidate reaches out)
                             │
                    ┌────────▼────────┐
                    │   responded     │ (e.g., recruiter contacted)
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │   interview     │ (active interview process)
                    └────────┬────────┘
                             │
                    ┌────────▼─────────┐
                    │      offer       │ (offer received)
                    └─────────────────┘
                    
                    (or terminal states)
                    ┌────────────────┐
                    │   rejected      │
                    ├────────────────┤
                    │   discarded     │ (by candidate)
                    ├────────────────┤
                    │   skip          │ (don't apply)
                    └────────────────┘
```

**Status Aliases (language support):**
- `evaluated` = evaluada
- `applied` = aplicado, enviada, sent
- `responded` = respondido
- `interview` = entrevista
- `offer` = oferta
- `rejected` = rechazado/a
- `discarded` = descartado/a, cerrada, cancelada
- `skip` = no_aplicar, monitor

---

## Report File Structure

### File: `reports/{###}-{company-slug}-{YYYY-MM-DD}.md`

**Example: `001-anthropic-2026-05-12.md`**

```markdown
# Anthropic — Head of Applied AI
**Legitimacy:** Tier 1 (Active, no flags)

## Block A: Role Summary
| Field | Value |
|-------|-------|
| Company | Anthropic |
| Title | Head of Applied AI |
| Level | Director (Principal IC equivalent) |
| Remote | Hybrid (SF office 2x/week) |
| Team Size | 8-12 people |
| Archetype | Agentic (multi-agent orchestration) |

## Block B: CV Match vs Gaps
| Requirement | CV Coverage | Gap Level |
|------------|-------------|-----------|
| 10+ years AI/ML | ✅ Founder 2015-2025 | Covered |
| Multi-agent systems | ✅ Built agent orchestration | Covered |
| Team leadership | ✅ Managed 12-person team | Covered |
| Enterprise sales | ⚠️ Only indirect (partnership) | Minor Gap |
| Regulatory compliance | ⚠️ No direct experience | Mitigation: Adjacent in startup ops |

**Gap Mitigation Strategy:**
- Enterprise: "While I built product-market-fit first, I sold to 20+ enterprise customers"
- Compliance: "Built compliance infrastructure for 3 enterprise deployments"

## Block C: Level & Strategy
**Detected:** Director/VP level
**Recommendation:** Sell senior without overstating
- Highlight founder exit as proof of execution capability
- Frame team leadership experience (12 people) as readiness for 8-12 person team
- Position as peer to existing leadership, not individual contributor

**If downleveled:** Negotiate 6-month review to director level with clear criteria

## Block D: Compensation
| Metric | Range | Notes |
|--------|-------|-------|
| Base Salary | $250k-300k | Anthropic typically 280k for Director |
| Equity | 0.4-0.8% | 4-year vest standard |
| Total Comp (Year 1) | $400k-450k | Assuming 25% equity bonus |
| Market Reference | Levels.fyi shows 290k avg for "VP AI" |

**Leverage:** Multiple offers at $320k base gives you $300k floor

## Block E: Personalization
**Why Anthropic?**
"I've been tracking Anthropic's research since the founding team published the Constitutional AI paper. Your work on RLHF + safety is where I want to spend the next chapter. I'm especially interested in Claude's real-world deployment strategy for agents."

**Cover Letter Hook:**
"I spent 10 years building applied AI products. Now I want to help scale the most responsible AI foundation to production."

## Block F: Interview Prep (STAR+Reflection)
### Story 1: Multi-Agent System (Architecture Design)
**Situation:** Built 3-agent orchestration system for document processing
**Task:** Reduce error rate from 12% to 0.5%
**Action:** Designed agent hierarchy, error handling, human-in-the-loop
**Result:** 99.5% accuracy, 40% cost savings
**Reflection:** "If I did this now, I'd start with evaluation framework first—would have saved 2 weeks of debugging"

### Story 2: Team Leadership
**Situation:** Scaled team from 4 to 12 people during Series B
**Task:** Maintain execution velocity while onboarding rapidly
**Action:** Built engineering culture playbook, mentored junior hires, ran weekly tech talks
**Result:** Shipped 3 major features despite 3x headcount growth
**Reflection:** "I'd invest more upfront in documentation. Scaling is communication, not code."

(... more stories ...)

## Block G: Draft Application Answers

### Q: Why are you interested in this role?
A: I've spent a decade building applied AI products from idea to market. Your focus on agent orchestration—especially the Constitutional AI approach to safety—is exactly where I want to apply that experience. This role sits at the intersection of research rigor and production reality.

### Q: Why do you want to work at Anthropic?
A: I've been following Anthropic's work since the founding team's research on RLHF and Constitutional AI. The approach to scaling AI safely, while maintaining competitive performance, appeals to me deeply—both professionally and personally. I want to help turn that research into trusted products.

### Q: Tell us about a relevant project/achievement
A: I founded an AI systems company that built multi-agent orchestration for enterprise document processing. We grew to $2M ARR and sold in 2025. The work taught me how to coordinate complex agent behavior, handle failure gracefully, and maintain user trust in AI-driven decision-making.

### Q: What makes you a good fit for this position?
A: I sit at the intersection of AI research, product development, and scaling teams. I've built agent systems in production. I've led teams through hypergrowth. And I'm deeply aligned with Anthropic's mission around AI safety. That combination is rare, and it's exactly what this role needs.

### Q: How did you hear about this role?
A: I found this posting while scanning roles that align with my applied AI focus. I evaluated it against my criteria: mission alignment, technical depth, leadership opportunity. It scored highest. Your compensation and charter make this the role I want next.

---

**Score: 4.8/5.0 ⭐**
**Recommendation:** APPLY (strong fit)
```

---

## Data Integrity & Maintenance

### Deduplication (dedup-tracker.mjs)
**Problem:** Same job applied twice, or duplicate entries

**Solution:**
```javascript
// Groups by normalized company + fuzzy role matching
// Keeps highest score entry
// If discarded entry had more advanced status, preserves it
// Merges notes

Example:
Before:
| Anthropic | Head of Applied AI | 4.8 | applied |
| Anthropic | Head AI | 4.7 | evaluated |
→ Merged:
| Anthropic | Head of Applied AI | 4.8 | applied |
```

Run: `npm run dedup`

### Status Normalization (normalize-statuses.mjs)
**Problem:** Mixed Spanish/English, typos, inconsistent capitalization

**Solution:**
```javascript
// Maps aliases to canonical values
"rechazado" → "rejected"
"evaluada" → "evaluated"
"aplicada" → "applied"

Run: `npm run normalize`
```

### Liveness Checks (check-liveness.mjs)
**Problem:** Posting closed but still in tracker

**Solution:**
```javascript
// Re-crawls portals, checks for "applications closed" banners
// Marks as "discarded" if posting closed
// Prevents wasted application effort

Run: `npm run liveness`
```

### Tracker Merging (merge-tracker.mjs)
**Problem:** Multiple tracker files from different devices/dates

**Solution:**
```javascript
// Combines multiple tracker files
// Deduplicates automatically
// Preserves most advanced status per application
// Merges all notes

Run: `npm run merge`
```

---

## Dashboard View

The **Go TUI Dashboard** (`dashboard/career-dashboard`) provides:

```
┌────────────────────────────────────────────────────────┐
│ Career Dashboard — Application Pipeline View           │
├────────────────────────────────────────────────────────┤
│                                                         │
│ Filters: [New] [Applied] [Interview] [Offer] [Rejected]│
│ Sort: Score ↓ | Date | Status                         │
│                                                         │
│ EVALUATED (3)                                           │
│ ├─ 4.8 ⭐ Anthropic — Head of Applied AI              │
│ ├─ 4.5 🔵 OpenAI — AI Researcher                      │
│ └─ 4.2 🔵 Mistral — LLMOps Engineer                   │
│                                                         │
│ APPLIED (7)                                             │
│ ├─ 4.8 ✅ Anthropic — Head of Applied AI              │
│ ├─ 4.7 ✅ Google DeepMind — Research Lead             │
│ └─ 4.3 ✅ Salesforce AI Research — Sr. Scientist      │
│                                                         │
│ INTERVIEW (2)                                           │
│ ├─ 4.6 🎤 Retool — Head of AI Platform (Round 2)      │
│ └─ 4.4 🎤 Temporal — Workflow AI Lead (Screening)     │
│                                                         │
│ OFFER (1)                                               │
│ └─ 4.8 💰 Anthropic — Head of Applied AI              │
│                                                         │
│ REJECTED (3) | SKIPPED (8)                             │
│                                                         │
│ Stats: 22 total | 8.5 avg score | 36% interview rate  │
│ Avg days to respond: 4.2 days                          │
│                                                         │
│ [Preview Report] [Update Status] [View PDF] [Contact]  │
│ [👁️ Watch] [🗑️ Archive] [📝 Notes]                      │
└────────────────────────────────────────────────────────┘
```

Features:
- 6 filter tabs
- 4 sort modes (score, date, status, company)
- Grouped/flat view
- Lazy-loaded previews (show report snippet on hover)
- Inline status changes (click to update)
- Statistics: total, avg score, response time, conversion rate

---

## Batch Processing for Multiple Jobs

### Workflow
```
node career-ops/batch/batch-runner.sh \
  --jds-folder jds/ \
  --workers 4 \
  --output reports/

What happens:
1. Reads all .txt files in jds/
2. Splits into 4 parallel workers
3. Each worker runs: claude -p (Claude Prompt with AGENTS.md context)
4. Worker evaluates 2-3 jobs (dependent on --workers setting)
5. Saves reports to reports/ folder
6. Merges all results into tracker
7. Reports aggregated stats

Parallelization: "claude -p" (paid Claude API feature)
- 4 workers × 2 minutes = 8 total time (vs 60+ sequential)
```

---

## Workflow Integration with GigGrab

```
Your GigGrab Scraper
        │
        ▼
    combined_jobs.json
        │
    [Adapter] ──────────────────┐
        │                       │
        ├─ jds/*.txt            │
        └─ tracker.md entry     │
        │                       │
        ▼                       │
    Claude Code                 │
    /career-ops {JD}           │
        │                       │
        ├─ oferta.md evaluation │ (2-3 min)
        ├─ Generate PDF         │ (1 min)
        ├─ Save report          │ (auto)
        └─ Update tracker       │ (auto)
        │                       │
        ▼                       ▼
    reports/ + output/   + data/applications.md
        │
        │ (User applies)
        │
    ▼
    apply.md mode
    (Form auto-filling)
        │
        ▼
    User updates tracker
    Status: "evaluated" → "applied"
```

---

## Key Takeaways

**Process:**
1. ✅ Paste job → Auto-evaluate (6 blocks)
2. ✅ Save report + PDF + tracker entry
3. ✅ User applies through browser
4. ✅ Apply mode generates form answers
5. ✅ User updates tracker manually
6. ✅ Dashboard shows pipeline

**Tracking:**
- **Single source of truth:** `data/applications.md` (markdown table)
- **Linked artifacts:** Each tracker row links to report + PDF
- **Status flow:** evaluated → applied → responded → interview → offer/rejected
- **Integrity checks:** Dedup, normalize, liveness, merge scripts

**Automation Level:**
- Evaluation: 100% AI (oferta.md)
- PDF generation: 100% AI
- Form filling: AI generates answers (user copy-pastes)
- Submission: User does manually (safety first)
- Tracking: User updates manually (encouraged to do after applying)

**Control Points:**
- User decides whether to apply (score >= 4.0 recommended, not enforced)
- User fills form manually (not auto-submitted)
- User updates tracker manually (can be automated with webhooks)
