# Career-Ops Integration Analysis for GigGrab

**Date**: May 12, 2026
**Repository**: https://github.com/santifer/career-ops (cloned locally)
**Status**: Explored & Ready for Integration

---

## Executive Summary

**Career-Ops is highly integrable with GigGrab.** It provides 14 pre-built AI modes for job application automation that your scraper output can feed into. The system is designed to be modular and customizable—perfect for fast-food/QSR (quick-service restaurant) job applications.

---

## What Career-Ops Does

### Core Features
1. **Auto-Pipeline** - Paste URL → Full evaluation + PDF + tracker
2. **A-F Evaluation** - 10-weighted scoring system across:
   - Role match vs CV
   - Compensation research
   - Level strategy
   - Interview prep (STAR+Reflection framework)
   - Personalization strategy
3. **Portal Scanning** - Scrapes Greenhouse, Ashby, Lever, Wellfound (45+ companies pre-configured)
4. **Application Form Filling** - `apply.md` mode auto-fills Greenhouse forms with personalized responses
5. **Batch Processing** - Evaluate 10+ offers in parallel
6. **PDF Generation** - Generates ATS-optimized, keyword-injected CVs per job
7. **Dashboard TUI** - Terminal UI to browse and manage pipeline
8. **Interview Prep** - Story Bank accumulates STAR+Reflection narratives

### Key Tech Stack
- **Agent**: Claude Code + custom skill modes (markdown-based)
- **PDF**: Playwright/Puppeteer + HTML templates
- **Scanning**: Playwright + API integrations
- **Dashboard**: Go + Bubble Tea TUI
- **Data**: YAML configs + TSV tracking files + Markdown tables

---

## Integration Points with GigGrab

### 1. **Input Data Structure** ✅
Your current system generates:
```json
combined_jobs.json
├── burger_king_charlotte_nc.json
├── chipotle_austin_tx.json
├── subway_charlotte_nc.json
└── ...
```

Career-Ops expects:
- Job descriptions in any text format (JD files in `jds/` folder)
- Tracker data in TSV format (applications.md)
- YAML portal configs (portals.yml)

**Bridge**: Write a small adapter to convert your JSON → JD files + tracker entries

### 2. **Job Scraping Output** ✅ DIRECT COMPATIBLE
Career-Ops already handles 45+ companies, but for **QSR fast-food chains**, you can:
- Add McDonald's, Burger King, Chipotle, Subway, Taco Bell, Chick-fil-A to `portals.yml`
- Define custom parsing for their ATS (Taleo, Jobvite, custom career pages)
- Let career-ops scan them automatically OR feed your pre-scraped JSON

### 3. **Application Form Filling** ✅ CRITICAL FEATURE
Career-Ops has **`modes/apply.md`** — an interactive mode that:
- Reads active Chrome tab (form questions)
- Loads previous evaluation report from `reports/`
- Generates personalized responses for EACH question
- Shows formatted copy-paste responses

**For GigGrab**: This is the auto-apply mechanism. When a user scrapes a job:
1. Career-Ops evaluates it (`oferta.md`)
2. Saves report to `reports/{company}_{role}.md`
3. User applies through browser
4. Career-Ops `apply.md` fills the form with AI responses

### 4. **Evaluation Framework** ✅ CUSTOMIZABLE
Current: Spanish archetype-based scoring (LLMOps, Agentic, PM, SA, etc.)
**For GigGrab QSR jobs**: Adapt archetypes to:
- Shift Manager / Team Lead
- Crew Member / Cook
- Driver / Delivery Operator
- Corporate / Regional roles

Edit `modes/_shared.md` + `modes/_profile.md` to customize scoring weights

### 5. **Data Pipeline Architecture**
```
GigGrab Scraper Output
    ↓
combined_jobs.json
    ↓
[Adapter Script] → Convert to career-ops format
    ↓
jds/ folder (job descriptions)
    ↓
[Claude/Gemini CLI] → modes/oferta.md evaluation
    ↓
reports/ folder (evaluation reports)
    ↓
[Dashboard] → Browse pipeline
    ↓
[Apply mode] → Auto-fill forms when user applies
    ↓
Tracker.md ← Track application status
```

---

## File Structure Breakdown

### Core Directories
```
career-ops/
├── modes/                    # 14 skill modes (evaluation logic)
│   ├── _shared.md            # Shared context (customize this)
│   ├── _profile.md           # User-specific customizations (YOUR RULES)
│   ├── oferta.md             # Single job evaluation (6 blocks)
│   ├── pdf.md                # PDF generation from JD + CV
│   ├── apply.md              # Form-filling assistant ⭐
│   ├── batch.md              # Batch evaluate 10+ jobs
│   ├── scan.md               # Portal scanner
│   ├── interview-prep.md     # STAR+Reflection story bank
│   └── ... (8 more modes)
│
├── templates/
│   ├── cv-template.html      # ATS-optimized HTML template
│   ├── portals.example.yml   # Scanner config (ADD QSR chains here)
│   └── states.yml            # Application status states
│
├── batch/
│   ├── batch-prompt.md       # Worker prompt for parallel processing
│   └── batch-runner.sh       # Orchestrator (claude -p)
│
├── config/
│   └── profile.example.yml   # User profile template
│
├── dashboard/                # Go TUI application
├── data/                     # Your job data (gitignored)
├── reports/                  # Evaluation reports (gitignored)
├── output/                   # Generated PDFs (gitignored)
└── jds/                      # Job descriptions input folder

Key Scripts (Node.js/mjs):
├── scan.mjs                  # Portal scanning
├── generate-pdf.mjs          # PDF generation
├── merge-tracker.mjs         # Merge application trackers
├── dedup-tracker.mjs         # Remove duplicates
├── normalize-statuses.mjs    # Standardize status values
├── check-liveness.mjs        # Detect closed postings
└── gemini-eval.mjs           # Standalone Gemini API evaluator
```

### Key Configuration Files

**portals.example.yml** (33KB!)
```yaml
# Example structure (for your QSR chains):
# AI Labs:
#   Anthropic:
#     - type: "greenhouse"
#       url: "https://anthropic.greenhouse.io/"
# 
# You'll add:
# QSR:
#   McDonald's:
#     - type: "taleo"
#       url: "https://mcd.taleo.net/"
#   Burger King:
#     - type: "greenhouse" 
#       url: "https://bk.greenhouse.io/"
```

**config/profile.example.yml** 
```yaml
# User profile template
name: "John"
title: "Senior Engineer"
location: "San Francisco, CA"
salary_target: 250000
role_preferences:
  remote: "full"
  industries: ["tech", "ai"]
```

**templates/states.yml**
```yaml
# Application status taxonomy
new: "New posting"
applied: "Application submitted"
rejected: "Rejected"
interview: "In interview process"
offer: "Offer received"
accepted: "Accepted"
```

---

## Integration Strategy

### Phase 1: Setup (Day 1)
```bash
# 1. Copy career-ops to giggrab_website
cp -r career-ops/ giggrab_website/career-ops/

# 2. Create data adapter
# Convert combined_jobs.json → jds/*.txt

# 3. Configure QSR portals
# Add McDonald's, Burger King, Chipotle to portals.yml

# 4. Customize profile
# Set user preferences in config/profile.yml
```

### Phase 2: Adapter Script (Day 1-2)
Create `giggrab_website/scripts/adapt-to-career-ops.js`:
```javascript
// Input: combined_jobs.json
// Output: career-ops/jds/*.txt + tracker.md entry
// Maps: company → portal type, salary → comp range, etc.
```

### Phase 3: Workflow Integration (Day 2-3)
```
User Flow:
1. User runs: giggrab scrape
   → Generates combined_jobs.json
2. User runs: npm run adapt-careers
   → Feeds data into career-ops/
3. User runs: claude (or gemini)
   → Evaluates jobs using oferta.md mode
4. Reports saved to career-ops/reports/
5. User applies through browser
6. Career-ops apply.md fills forms automatically
7. Tracker.md updated with application status
```

### Phase 4: Dashboard & Automation (Day 3+)
```bash
# Build dashboard
cd career-ops/dashboard && go build -o career-dashboard .
./career-dashboard --path ..

# Set up automatic scanning
node career-ops/scan.mjs --portals portals.yml

# Batch evaluate new jobs
node career-ops/batch/batch-runner.sh
```

---

## Key Configuration for QSR Use Case

### 1. Customize `modes/_profile.md`
Define QSR-specific archetypes:
```markdown
## Archetypes for Fast Food Industry

### Archetype 1: Crew Member / Cook
- Speed & efficiency (throughput matters)
- Food safety & quality
- Team coordination
- Customer service

### Archetype 2: Shift Manager / Supervisor
- Staff management & scheduling
- Inventory & cost control
- Customer escalation
- Training & compliance

### Archetype 3: Area/Regional Manager
- Multi-location oversight
- P&L responsibility
- Hiring & retention
- Regional growth

### Archetype 4: Corporate / HQ Roles
- Operations, Finance, Marketing, Supply Chain
- Strategic planning
- System standardization
```

### 2. Extend `portals.example.yml`
```yaml
QSR - Fast Food:
  McDonald's:
    - type: "taleo"
      url: "https://mcd.taleo.net/"
      search_queries:
        - "crew member"
        - "shift manager"
        - "restaurant manager"
  
  Burger King:
    - type: "greenhouse"
      url: "https://burgerking.greenhouse.io/"
  
  Chipotle:
    - type: "custom"
      url: "https://careers.chipotle.com/"
      css_selector: ".job-posting"  # CSS to extract jobs
```

### 3. Add QSR-specific Evaluation Rules
In `modes/_shared.md`, add:
```markdown
## QSR Scoring Weights (customize as needed)

For Crew Member roles:
- Food Safety & Compliance: 25%
- Speed & Efficiency: 25%
- Team Work: 20%
- Customer Service: 15%
- Schedule Flexibility: 15%

For Manager roles:
- Leadership & Coaching: 25%
- Operations & Process: 25%
- Cost Control: 20%
- Food Quality: 15%
- Compliance: 15%
```

---

## Data Conversion Example

### Input (GigGrab combined_jobs.json)
```json
{
  "brand": "Burger King",
  "location": "Charlotte, NC",
  "position": "Crew Member",
  "url": "https://careers.burgerking.com/job-posting/123456",
  "salary": "$15-16/hour",
  "requirements": "Fast-paced environment, food safety cert preferred"
}
```

### Output (Career-Ops jds/burger_king_crew_charlotte.txt)
```
Job Title: Crew Member
Company: Burger King
Location: Charlotte, NC
URL: https://careers.burgerking.com/job-posting/123456
Salary: $15-16/hour

Job Description:
Fast-paced environment, food safety cert preferred

---
Source: GigGrab | Scraped: 2026-05-12
```

### Tracker Entry (career-ops/tracker.md)
```markdown
| Company | Role | Location | Date Applied | Status | Salary | Notes |
|---------|------|----------|--------------|--------|--------|-------|
| Burger King | Crew Member | Charlotte, NC | 2026-05-12 | new | $15-16/hr | GigGrab import |
```

---

## Important Considerations

### ✅ Advantages
1. **Pre-built evaluation framework** - 2000+ lines of well-tested logic
2. **Automated form-filling** - `apply.md` mode handles Greenhouse + Ashby
3. **Multi-chain support** - Easy to add more QSR chains
4. **Data integrity** - Built-in dedup, normalization, liveness checks
5. **Human-in-the-loop** - Never auto-submits, always reviews
6. **Customizable** - Modes are markdown, easy to modify
7. **Active development** - 50 contributors, 44k GitHub stars

### ⚠️ Considerations
1. **Claude/Gemini CLI required** - Uses AI for evaluation (cost: $0.01-0.10 per job)
2. **Playwright dependency** - Browser automation requires Chrome/Chromium
3. **Requires cv.md** - Users must provide their CV for matching
4. **Learning curve** - First 20-30 evaluations won't be great (trains as it learns)
5. **Portal coverage** - Career-ops focused on tech/AI; QSR chains less documented
6. **Rate limiting** - Portal scanners may hit rate limits on some ATS

### 🔒 Data Privacy
- **All local** - No data sent to career-ops servers
- **AI provider direct** - Data sent only to Claude/Gemini (your choice)
- **User controls** - You manage CV, profile, all personal data
- **Open source** - MIT licensed, full transparency

---

## Quick Integration Checklist

- [ ] Copy career-ops repo into giggrab_website/
- [ ] Create data adapter script (combined_jobs.json → jds/ + tracker)
- [ ] Add QSR chains to portals.yml
- [ ] Customize modes/_profile.md with QSR archetypes
- [ ] Create user onboarding guide (setup cv.md, config/profile.yml)
- [ ] Test full pipeline: scrape → evaluate → apply → track
- [ ] Deploy dashboard TUI for application viewing
- [ ] Set up automated scanning + batch evaluation
- [ ] Add error handling & logging
- [ ] Document QSR-specific workflows

---

## Next Steps

1. **Adapter Script** - Build data conversion layer
2. **Portal Config** - Map QSR chain URLs + ATS types
3. **User Testing** - Get feedback on evaluation quality
4. **Workflow Docs** - Document end-to-end user experience
5. **Dashboard Polish** - Customize TUI colors/layout for GigGrab brand

---

## Files to Review

**Priority 1 (Core functionality):**
- `modes/oferta.md` - Job evaluation logic
- `modes/apply.md` - Application form filling
- `modes/_shared.md` - Shared context & scoring framework
- `AGENTS.md` - Canonical agent instructions

**Priority 2 (Configuration):**
- `templates/portals.example.yml` - Portal configurations
- `config/profile.example.yml` - User profile template
- `templates/states.yml` - Application status states

**Priority 3 (Scripts):**
- `scan.mjs` - Portal scanning logic
- `merge-tracker.mjs` - Tracker merging
- `generate-pdf.mjs` - CV generation

**Priority 4 (Infrastructure):**
- `dashboard/` - TUI application (Go)
- `batch/batch-runner.sh` - Parallel evaluation orchestration

---

## Contact & Resources

- **GitHub**: https://github.com/santifer/career-ops
- **Discord**: https://discord.gg/8pRpHETxa4
- **Portfolio**: https://santifer.io/career-ops-system (case study)
- **License**: MIT (permissive, commercial-friendly)

---

*This analysis prepared for GigGrab integration. All code references are current as of commit 8e554cc (v1.7.0, May 2026).*
