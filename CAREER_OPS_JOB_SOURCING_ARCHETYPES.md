         # Career-Ops: Job Sourcing & Archetype Detection in Detail

## Part 1: How Career-Ops Sources Jobs

### Overview
Career-Ops has **3-tier job sourcing strategy**:

```
┌──────────────────────────────────────────────────────┐
│          HOW CAREER-OPS FINDS NEW JOBS               │
└──────────────────────────────────────────────────────┘

TIER 1: Playwright (Real-time, Most Reliable)
    ↓
    Navigates to company careers pages
    Renders JavaScript (for SPAs like Greenhouse, Lever, Ashby)
    Extracts live job listings
    Capture: Title, URL, location, apply button state
    Speed: ~2-5 sec per company × parallel workers
    
TIER 2: API Direct (Fast, Structured Data)
    ↓
    Greenhouse API → JSON structured format
    Ashby API → JSON with compensation data
    Lever API → JSON with categories
    Capture: Title, URL, location, posting date
    Speed: ~1-2 sec per API, parallel batch requests
    Advantage: No rendering needed, structured data
    
TIER 3: WebSearch (Broad Discovery, May Be Stale)
    ↓
    Google: site:company.com + keyword filters
    Fallback when careers_url isn't accessible
    Capture: May need to extract from HTML snippet
    Speed: Slow, rate-limited by Google
    Reliability: Lower (cached results, may be outdated)
```

---

## Job Sourcing: Step-by-Step

### Step 1: Load Configuration (portals.yml)

**File:** `portals.yml` (user creates by copying `templates/portals.example.yml`)

```yaml
# Title filter (applies to ALL companies)
title_filter:
  positive:
    - "AI"
    - "ML"
    - "LLM"
    - "Agent"
    - "Agentic"
    - "MLOps"
    - "LLMOps"
  negative:
    - "intern"
    - "graduate"
    - "junior"  # (if user wants only mid+)

# Tracked companies
tracked_companies:
  - name: Anthropic
    careers_url: https://job-boards.greenhouse.io/anthropic
    api: https://boards-api.greenhouse.io/v1/boards/anthropic/jobs
    enabled: true

  - name: OpenAI
    careers_url: https://openai.com/careers
    scan_method: websearch
    scan_query: 'site:openai.com/careers "AI" OR "ML" OR "Solutions"'
    enabled: true

  - name: Retool
    careers_url: https://retool.com/careers
    scan_method: websearch
    enabled: true
```

### Step 2: API Detection

For each company, `scan.mjs` detects the ATS type:

```javascript
// Auto-detection logic

if (company.api.includes('greenhouse')) {
  api_type = 'greenhouse'
  api_url = company.api
}

if (careers_url.includes('jobs.ashbyhq.com')) {
  api_type = 'ashby'
  api_url = extract_company_slug_from_url()
}

if (careers_url.includes('jobs.lever.co')) {
  api_type = 'lever'
  api_url = extract_company_slug_from_url()
}

// If none match → fallback to Playwright
```

**ATS Coverage:**
- ✅ **Greenhouse** (most common) - 45+ companies
  - API: `https://boards-api.greenhouse.io/v1/boards/{company}/jobs`
  - Returns: JSON with title, url, location, posting_date
  
- ✅ **Ashby** (growing, AI-friendly) - 10+ companies
  - API: `https://api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true`
  - Returns: JSON with title, url, compensation data
  
- ✅ **Lever** (used by many startups) - 8+ companies
  - API: `https://api.lever.co/v0/postings/{company}`
  - Returns: JSON with title, categories (location, team), url
  
- ⚠️ **WebSearch** (fallback) - Any company
  - Site-specific queries: `site:company.com "Engineer" OR "AI"`
  - Returns: Organic search results (cached, 1-7 days old)

### Step 3: Fetch Job Listings

**For Greenhouse/Ashby/Lever:**
```javascript
fetch(api_url, {timeout: 10_000})
  .then(res => res.json())
  .parse(jobs => extract_title_url_location())
```

**Concurrency:** 10 parallel requests (CONCURRENCY = 10)
**Timeout:** 10 seconds per request

**For WebSearch:**
```javascript
// Slower, Google rate-limits
// Used as fallback only
// Results are 1-7 days old
```

### Step 4: Apply Title Filter

**For each job, check title:**

```
Title: "Senior AI Engineer"
  ↓
  Match positive keywords? ("AI", "ML", "LLM", etc)
    YES
  Match negative keywords? ("intern", "graduate")
    NO
  ↓
  ✅ INCLUDE
  
---

Title: "Sales Engineer (AI Tools)"
  ↓
  Match positive? ("AI")
    YES
  Match negative? ("intern", "graduate", "sales")
    NO (assuming "sales" isn't in negative list)
  ↓
  ✅ INCLUDE
  
---

Title: "Machine Learning Intern"
  ↓
  Match positive? ("Machine Learning")
    YES
  Match negative? ("intern")
    YES
  ↓
  ❌ EXCLUDE
```

**Filter logic:**
```javascript
const hasPositive = positive.length === 0 || positive.some(k => title.includes(k))
const hasNegative = negative.some(k => title.includes(k))
return hasPositive && !hasNegative
```

### Step 5: Deduplication

**Against existing data:**

1. **scan-history.tsv** - Record of all jobs ever scanned
   - Format: `url | company | title | date_scanned | status`
   - If URL in history → skip (already scanned)

2. **applications.md** - Jobs already in tracker
   - If already applied or discarded → skip

**Example:**
```
scan-history.tsv:
https://job-board.com/anthropic/123  | Anthropic | Head of Applied AI | 2026-05-12 | seen
https://job-board.com/openai/456     | OpenAI    | AI Researcher      | 2026-05-11 | seen

New scan finds:
https://job-board.com/anthropic/123  ← Already in history → SKIP
https://job-board.com/anthropic/789  ← New URL → INCLUDE
```

### Step 6: Output Results

**New jobs appended to `pipeline.md`:**

```markdown
# Pipeline — New Offers to Evaluate

| # | Date | Company | Role | Level | Archetype | URL | Status |
|----|------|---------|------|-------|-----------|-----|--------|
| 1 | 2026-05-12 | Anthropic | Head of Applied AI | Director | Agentic | [link] | pending |
| 2 | 2026-05-12 | OpenAI | AI Researcher | Staff | LLMOps | [link] | pending |
```

**Record added to `scan-history.tsv`:**
```
https://job-board.com/anthropic/123 | Anthropic | Head of Applied AI | 2026-05-12 | seen
```

---

### Running the Scanner

```bash
# Scan all enabled companies
npm run scan
  # Reads portals.yml
  # Fetches all ATS APIs + WebSearch queries
  # Applies title filter
  # Deduplicates
  # Outputs new jobs to pipeline.md + scan-history.tsv

# Scan with preview (no file writes)
npm run scan -- --dry-run

# Scan single company
npm run scan -- --company "Anthropic"

# Full flow:
cd career-ops
node scan.mjs

Output:
✅ Scanned 45 companies in 12 seconds
  • Greenhouse: 23 companies, 87 jobs found, 15 new
  • Ashby: 10 companies, 34 jobs found, 8 new
  • Lever: 8 companies, 22 jobs found, 3 new
  • WebSearch: 4 companies, fallback used for 2
✅ Total new jobs: 26
✅ Appended to pipeline.md
✅ Updated scan-history.tsv
```

---

## Part 2: Archetype Detection

### What Are Archetypes?

Archetypes are **role category templates** that determine:
1. Which proof points to emphasize
2. How to frame your background
3. Which interview stories matter most
4. What compensation to target
5. How to position yourself in cover letters

Career-Ops detects **6 core archetypes** for AI/tech roles (customizable for QSR):

---

### The 6 Archetypes

#### 1. **LLMOps / AI Platform**
```
Keywords in JD: 
  "observability", "evals", "monitoring", "reliability", 
  "LLMOps", "pipelines", "production", "metrics"

What this role cares about:
  • System reliability at scale
  • Measurement (evals, metrics, dashboards)
  • Production hardening
  • Observability + debugging
  • Latency/cost optimization
  • Testing frameworks

Proof points to emphasize:
  ✅ "Built evaluation framework → reduced errors 45%"
  ✅ "Optimized LLM call costs from $5k to $800/month"
  ✅ "Implemented production monitoring dashboard"
  ❌ Avoid: UI polish, design thinking, art
  
Example company profiles:
  • Anthropic — responsible scale
  • OpenAI — production safety
  • Weights & Biases — monitoring platform
  • Langfuse — observability for LLMs
  • Arize AI — ML observability
```

#### 2. **Agentic / Automation**
```
Keywords in JD:
  "agent", "multi-agent", "orchestration", "HITL",
  "workflow", "automation", "tool use", "planning"

What this role cares about:
  • Coordinating multiple agents
  • Error recovery + fallbacks
  • Human-in-the-loop workflows
  • Tool/API orchestration
  • Reasoning chains
  • State management

Proof points to emphasize:
  ✅ "Designed 3-agent system, achieved 99.5% accuracy"
  ✅ "Built error recovery for document processing pipeline"
  ✅ "Implemented human feedback loop for agent improvement"
  ❌ Avoid: Single-agent chatbots, fine-tuning focus
  
Example companies:
  • Anthropic — constitutional agents
  • n8n — no-code automation
  • Temporal — workflow orchestration
  • Retool — automation builder
```

#### 3. **AI Solutions Architect**
```
Keywords in JD:
  "architecture", "enterprise", "integration",
  "design", "systems", "enterprise AI", "large-scale"

What this role cares about:
  • System design across multiple systems
  • Integration complexity
  • Enterprise governance
  • Scaling to multiple teams
  • Technology strategy
  • Vendor evaluation

Proof points to emphasize:
  ✅ "Architected AI system serving 100+ internal teams"
  ✅ "Integrated LLM APIs with enterprise data systems"
  ✅ "Led technology evaluation, selected stack"
  ❌ Avoid: Implementing small features, optimization details
  
Example companies:
  • Salesforce (Enterprise AI)
  • Google Cloud (AI infrastructure)
  • AWS (AI services)
  • Deloitte (Enterprise consulting)
```

#### 4. **AI PM (Product Manager)**
```
Keywords in JD:
  "PRD", "product manager", "roadmap", "discovery",
  "stakeholder", "vision", "strategy", "OKR"

What this role cares about:
  • User research + discovery
  • Competing priorities
  • Metrics that drive business
  • Stakeholder alignment
  • Go-to-market strategy
  • Trade-offs

Proof points to emphasize:
  ✅ "Shipped 3 AI features, drove $2M ARR"
  ✅ "User research revealed gap, pivoted product"
  ✅ "Led cross-team alignment on AI roadmap"
  ❌ Avoid: Implementation details, code quality
  
Example companies:
  • Anthropic (Claude product)
  • OpenAI (ChatGPT product)
  • Retool (AI SDK)
  • Airtable (AI automation)
```

#### 5. **Forward Deployed Engineer (FDE)**
```
Keywords in JD:
  "client-facing", "deployed", "field", "fast delivery",
  "prototype", "customer success", "customer engineering"

What this role cares about:
  • Speed (days, not weeks)
  • Customer problem-solving
  • Prototype → production quickly
  • Communication with non-technical customers
  • Shipping fast > perfect
  • Iteration cycles

Proof points to emphasize:
  ✅ "Deployed AI solution to customer in 4 weeks"
  ✅ "Built prototype, gathered feedback, iterated"
  ✅ "Communicated technical constraints to business team"
  ❌ Avoid: System optimization, architectural perfection
  
Example companies:
  • Retool (Forward Deployed Engineer is their core role)
  • Anthropic (Deployed ML Engineer)
  • Vercel (Solutions Engineer)
```

#### 6. **AI Transformation**
```
Keywords in JD:
  "change management", "adoption", "enablement",
  "transformation", "scaling", "enterprise adoption"

What this role cares about:
  • Getting people to use AI
  • Training + enablement
  • Organizational change
  • Resistance management
  • Metrics on adoption
  • Scaling across teams

Proof points to emphasize:
  ✅ "Trained 200+ employees on new AI tool"
  ✅ "Drove adoption from 5% to 60% over 6 months"
  ✅ "Managed change resistance, created champions"
  ❌ Avoid: Technical implementation details
  
Example companies:
  • Enterprise consulting (Deloitte, Accenture)
  • Large tech companies (Microsoft, Google)
  • Salesforce (customer success)
```

---

### How Archetype Detection Works

**Step 1: Parse JD Text**
```
Input: Full job description text
→ Extract keywords, phrases, requirements
```

**Step 2: Match Against Archetype Signals**
```
Scan JD for archetype keywords:

"observability", "monitoring", "reliability" → LLMOps
"agent", "orchestration", "multi-agent" → Agentic
"architecture", "design", "enterprise systems" → Solutions Architect
"product manager", "PRD", "roadmap" → PM
"client-facing", "fast delivery", "prototype" → Forward Deployed
"adoption", "enablement", "transformation" → Transformation
```

**Step 3: Score Each Archetype**
```javascript
archetype_scores = {
  LLMOps: count_keyword_matches('observability', 'evals', 'monitoring'),
  Agentic: count_keyword_matches('agent', 'orchestration', 'HITL'),
  Solutions_Architect: count_keyword_matches('architecture', 'enterprise', 'design'),
  PM: count_keyword_matches('PRD', 'product manager', 'roadmap'),
  Forward_Deployed: count_keyword_matches('client-facing', 'deploy', 'fast delivery'),
  Transformation: count_keyword_matches('adoption', 'enablement', 'change')
}

winner = archetype with highest score
```

**Step 4: Detect Hybrid (if needed)**
```
If top 2 archetypes have similar scores:
  → Note as "Hybrid: Primary=LLMOps, Secondary=Agentic"
  
Example:
  "Build observable multi-agent system for enterprise"
  → LLMOps score: 8 points
  → Agentic score: 7 points
  → Solutions Architect score: 5 points
  → Detected: "Agentic (primary) + LLMOps (secondary)"
```

**Step 5: Verify Against JD Context**
```
Double-check for contradictions:

JD says: "Senior Agentic AI Engineer"
Keywords suggest: Agentic (strong)
Actual requirements: Multi-agent, HITL, orchestration
Context clues: "Build scalable agent coordination"
→ ✅ Confirmed: Agentic

JD says: "AI PM"
Keywords suggest: LLMOps (stronger signal)
Actual content: Mostly about evals, observability
Context clues: But title is "Product Manager"
→ ⚠️ Hybrid or mismatch? Read job description carefully
```

---

### Why Archetypes Matter

#### Example: Same skill, different framing

**CV proof point:**
"Built monitoring system for ML production"

**How it's reframed per archetype:**

```
If Archetype = LLMOps:
  "Built monitoring system that detected and prevented 
   99% of production errors, reducing customer incidents"
  → Emphasizes: Reliability, measurement, production hardening

If Archetype = Agentic:
  "Built monitoring system that tracks multi-agent state,
   enabling fallback recovery when agent confidence < 0.7"
  → Emphasizes: Agent coordination, error recovery

If Archetype = Solutions Architect:
  "Designed monitoring system integrating 5+ data sources,
   unified dashboard for C-level visibility into AI system health"
  → Emphasizes: System design, enterprise visibility

If Archetype = Forward Deployed:
  "Shipped monitoring dashboard to client in 2 weeks,
   trained their team to debug issues independently"
  → Emphasizes: Speed, customer enablement

If Archetype = PM:
  "Prioritized monitoring based on user research, feature
   adoption grew 40% after launch"
  → Emphasizes: User-driven decision making

If Archetype = Transformation:
  "Created monitoring training program, 80% team adoption,
   reduced incident response time by 60%"
  → Emphasizes: Change adoption, team enablement
```

---

### Customizing Archetypes for QSR (Fast Food)

For GigGrab's quick-service restaurant use case, you'd customize archetypes:

```
# QSR Archetype Examples

## Crew Member
Keywords: "food safety", "speed", "team coordination", "customer service"
Signals: Efficiency, quality, compliance
Proof points to match: "Consistently fast order fulfillment", "perfect compliance audit"

## Shift Manager
Keywords: "leadership", "operations", "cost control", "scheduling", "team"
Signals: Management capability, process optimization, people skills
Proof points: "Managed $500k food cost budget", "trained 12 employees"

## Area Manager
Keywords: "multi-location", "P&L", "strategic", "regional growth"
Signals: Scale, business acumen, leadership
Proof points: "Grew region revenue 30%", "oversaw 8 locations"

## Corporate / HQ Roles
Keywords: Depends on function (Finance, Operations, Marketing, Supply Chain)
Signals: Strategic, data-driven, systems thinking
Proof points: "Implemented inventory system across 200 locations"
```

---

### Detection in Career-Ops Workflow

```
User pastes job description
        ↓
Step 0: Detect Archetype
  • Parse JD keywords
  • Score against 6 archetypes
  • Note primary + secondary if hybrid
        ↓
Step A: Role Summary
  • Output detected archetype (e.g., "Agentic (primary) + LLMOps (secondary)")
        ↓
Step B: CV Match
  • For this archetype, which proof points are most relevant?
  • Map CV experience to archetype-specific signals
  • LLMOps role? Highlight production experience
  • Agentic role? Highlight coordination + HITL
        ↓
Step C: Level Strategy
  • How does this archetype map to seniority?
  • What sells well at each level?
        ↓
Step F: Interview Prep
  • Select STAR stories that match archetype
  • For Agentic: "Multi-agent orchestration story"
  • For LLMOps: "Production incident + resolution"
        ↓
Cover Letter Personalization
  • Frame experience through archetype lens
  • Quote specific JD language that signals archetype
```

---

### Example: Real Job Description → Archetype Detection

**Input JD:**
```
Role: Head of Applied AI

We're looking for a Head of Applied AI to:
- Build observable, production-grade AI systems
- Design multi-agent workflows for customer success
- Mentor team of 8-12 engineers
- Ship fast, measure impact, iterate
- Enterprise integration architecture
- Lead adoption across 100+ customer deployments

Required:
- 8+ years building production AI systems
- Experience with evals, observability, monitoring
- Multi-agent orchestration
- Enterprise system design
- Customer-facing impact focus
```

**Detection Process:**

```
Keyword scan:
  ✅ "observable, production-grade" → LLMOps (+3)
  ✅ "multi-agent workflows" → Agentic (+3)
  ✅ "enterprise integration architecture" → Solutions Architect (+2)
  ✅ "enterprise system design" → Solutions Architect (+1)
  ✅ "Customer-facing impact" → Forward Deployed (+1)
  ✅ "Ship fast, measure" → Forward Deployed (+1)

Scores:
  LLMOps: 3 points
  Agentic: 3 points
  Solutions Architect: 3 points
  Forward Deployed: 2 points
  PM: 0 points
  Transformation: 0 points

Context verification:
  "Head of Applied AI" title suggests leadership
  Multiple architectures suggests broad responsibility
  Enterprise + customer = scale focus
  
Final detection:
  ⭐ PRIMARY: Agentic + LLMOps (tied)
  ⭐ SECONDARY: Solutions Architect
  
Recommendation: Hybrid "Agentic/LLMOps with Enterprise Scale"
```

**How this affects evaluation:**

```
Block A (Summary):
  Archetype: Agentic/LLMOps + Enterprise Scale
  → Tells candidate: This role needs both agent coordination AND production reliability
  
Block B (CV Match):
  Emphasize: 
    • Production incident responses (LLMOps)
    • Multi-agent system architecture (Agentic)
    • Enterprise customer deployments (Solutions Architect)
    
Block F (Interview Prep):
  Stories to prepare:
    • Story 1: "Multi-agent system I built, issue, action, result, reflection"
    • Story 2: "Production incident, debugging, impact"
    • Story 3: "Enterprise architecture decision"
```

---

## Summary

### Job Sourcing
1. **Load portals.yml** with tracked companies + title filters
2. **Detect ATS type** (Greenhouse/Ashby/Lever/WebSearch)
3. **Fetch listings** in parallel (10 concurrent requests)
4. **Filter by title** (positive keywords must match, negative must not)
5. **Dedup** against scan-history.tsv and applications.md
6. **Output** to pipeline.md + scan-history.tsv

**Result:** New jobs ready to evaluate

### Archetype Detection
1. **Parse JD keywords** for archetype signals
2. **Score each archetype** (count matching keywords)
3. **Detect primary + secondary** if scores are close
4. **Verify against context** (title, requirements, company)

**Result:** Archetype classification that shapes all 6 evaluation blocks

### Impact
- ✅ LLMOps detection → emphasize production hardening + evals
- ✅ Agentic detection → emphasize orchestration + error recovery
- ✅ Solutions Architect → emphasize scale + integration
- ✅ Forward Deployed → emphasize speed + customer value
- ✅ PM → emphasize discovery + metrics
- ✅ Transformation → emphasize adoption + change

Each archetype has its own "language" for how to present your background.
