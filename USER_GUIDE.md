# TenderFit — User Guide

A step-by-step walkthrough of every feature. Read this once; you can come back later to look up any specific button.

**Live URL:** https://tenderfit.detex.site

---

## Table of contents

1. [First-time setup — what to do in your first 10 minutes](#first-time-setup)
2. [The four main pages](#the-four-main-pages)
3. [Capability profile — what to fill in and why](#capability-profile)
4. [Dashboard buttons — what each does and when to click](#dashboard-buttons)
5. [Reading a match — what every section means](#reading-a-match)
6. [Digest emails — schedule, recipients, sending](#digest-emails)
7. [Tuning the experience over time](#tuning-the-experience)
8. [Recommended workflow week-by-week](#recommended-workflow)
9. [Troubleshooting](#troubleshooting)

---

## First-time setup

The first ten minutes after you sign in. Do these in order.

### Step 1 — Sign in

Visit https://tenderfit.detex.site. You'll be sent to a sign-in screen.

- **Email** — any email. The first time you sign in with a given email, TenderFit creates a new company profile for you. Sign in with the same email later to get back to the same profile.
- **Password** — the shared access password your administrator gave you.

If you've never signed in before, after entering credentials you'll land on the **profile setup** page (`/onboard`). If you have signed in before, you'll go straight to the dashboard.

### Step 2 — Fill the capability profile

This is the most important step. The matcher scores tenders against this profile, so the more accurate and complete it is, the better your matches will be. Don't rush it; 5–10 minutes invested here saves hours of irrelevant matches later.

See [Capability profile](#capability-profile) below for what to put in each section.

### Step 3 — Set your digest schedule

Click **Schedule** in the top nav. Pick:
- **Cadence** — Daily / Every N days / Weekly / Monthly
- **Delivery window** — e.g. 8:00 – 18:00 Asia/Karachi (the email arrives anywhere in this window)
- **Minimum fit score** — start at 40, raise later if you're drowning in matches
- **Recipients** — type in email addresses, press Enter or comma after each. These are the people who get the digest emails.

Save. The schedule is now active.

### Step 4 — Click "Find new matches"

Back on the dashboard, scroll to the **Run now** card and click **Find new matches**. The button shows "Running…" while it works (3–8 minutes). When it finishes, the page refreshes automatically and your first matches appear below.

---

## The four main pages

You'll see these four links in the top navigation bar, always available once you're signed in.

### Dashboard (`/dashboard`)

Your main view. Lists your active matches (tenders that haven't expired and score above your threshold). The cards are clickable — open any to see the full analysis.

### Archive (`/archive`)

Matches for tenders whose deadlines have passed. Useful for tracking what you decided not to bid on, or reviewing what's recently closed.

### Profile (`/profile`)

Your capability profile. Edit any time — changes trigger a re-embed on the next worker cycle, so newer matches will reflect the update.

### Schedule (`/schedule`)

Digest delivery settings: cadence, time window, recipients, minimum fit score.

In the top right of the nav: your email + a **Sign out** button.

---

## Capability profile

Open `/profile` (or `/onboard` on first login).

### Company basics

- **Company name** — what shows up in match emails (e.g. *"15 new matches for R2V (Private) Limited"*).
- **One-liner** — the 30-second pitch. The matcher uses this. ≤280 characters. Avoid marketing fluff; use concrete capabilities.

  Good: *"AWS-native custom software dev shop, 18 engineers, ISO 27001 certified, regulated industries (banking, health, gov)."*
  Bad: *"World-class cutting-edge technology solutions provider."*

### Capabilities

All of these are tag inputs — press Enter or comma after each entry.

- **Industries** — sectors you serve. `fintech`, `healthcare`, `government`, etc.
- **Services** — what you sell. `custom software dev`, `cloud migration`, `data engineering`, etc.
- **Tech stack** — concrete technologies. `Node.js`, `AWS`, `Postgres`, `React`, etc.
- **Certifications** — formal ones only. `ISO 27001`, `SOC2`, `CMMI L3`, etc. **This matters a lot for gap analysis** — tenders frequently require specific certs.
- **Past clients** — names of past customers (optional, used as evidence).
- **Languages** — ISO 639-1 codes. `en`, `ur`, etc.

### Geographies — including the "International Collaboration" toggle

This section controls how the matcher treats geography.

**Default behaviour:** the matcher prefers tenders in countries you've marked as places you can deliver. Foreign tenders get scored lower.

**International Collaboration / JV mode (checkbox at top of the Geographies card):**

Tick the box if your company actively wants to bid on foreign tenders — for partnerships, joint ventures, or branching abroad. When this is on:
- Country / geography is ignored in the fit score
- The win-probability heuristic doesn't penalise foreign tenders
- The LLM prompt explicitly tells the model not to flag "company not located in tender country" as a gap

The checkbox is **prominently visible during profile setup** — you'll see it before you've finished onboarding. Toggle it any time later from `/profile`.

### Scale & budget

- **Team size** — integer. Used by the win-probability heuristic to penalise wildly oversized tenders.
- **Budget min / max (USD)** — the contract value range you typically operate in.

### Past projects

Click "Add a project" to add a representative win. Title + summary required, sector + USD value optional. These are used as evidence in the win-probability calculation — a tender in the same sector as one of your past projects gets a boost.

### Saving

Click **Save changes**. You'll see a green "Saved" confirmation. The next worker cycle re-embeds your profile and applies any changes to scoring.

---

## Dashboard buttons

Three buttons live in the **Run now** card at the top of the dashboard. Each runs the corresponding background job in the worker container.

### Fetch latest tenders

**What it does:** pulls new tenders from every enabled source. Updates the global pool of tenders, not just your matches.

**When to click:**
- You just made your first profile and want fresh data immediately
- A specific deadline-sensitive tender market is closing soon and you want to make sure the latest opportunities are in the system
- Otherwise: don't bother — the cron already does this every 6 hours

**How long:** 1–3 minutes typically. Some sources are slow; this is dominated by polite-scraping delays.

### Find new matches

**What it does:** embeds any tenders that don't have embeddings yet, then scores them against your profile, and creates new match results.

**When to click:**
- Right after you edited your profile (so the new profile vector is used)
- Right after **Fetch latest tenders** finished (so the new tenders get scored)
- When the dashboard says "No matches yet" but you know tenders should be in the system
- Otherwise: don't bother — the cron does this every hour

**How long:** 3–8 minutes. The dashboard auto-refreshes when it finishes.

### Send digest now

**What it does:** builds a digest email with the matches above your threshold and sends it immediately to everyone in your Recipients list.

**When to click:**
- You want to share a snapshot with the team right now (e.g. before a meeting)
- You added a new recipient and want to confirm they receive the email
- You want to verify the email is delivering correctly

**Notes:**
- The digest filters by your **minimum fit score** setting (the slider below the action panel)
- If your threshold is high and you have no qualifying matches, the digest is skipped and you see an error
- The digest includes only matches created since the last digest was sent

---

## Reading a match

Click any match card on the dashboard to open the detail page.

- **Fit score (big number top-left)** — 0–100 overall match quality.
- **Win-probability badge** — `Low` / `Medium` / `High`.
- **View original source** — opens the upstream tender page in a new tab.
- **Tender description** — the full text from the source (HTML decoded, paragraph breaks preserved).
- **Metadata** — deadline, publish date, budget band, sector.
- **Match analysis** (right column) — three bullets explaining the score. May be positive ("strong fit because…"), negative ("does not fit because…"), or mixed. The heading is intentionally neutral.
- **Capability gaps** — explicit requirements the tender asks for that your profile doesn't mention. Coloured by severity (Blocker = red, Major = amber, Minor = grey).
- **Minimum human resources** — the LLM's best guess at the smallest team that could deliver. Includes per-role breakdown when the tender is staffing-specific.
- **Win-probability reasoning** — one-sentence rationale.
- **Generate capability statement** (bottom button) — produces a tailored one-page capability statement you can paste into a bid document. ~30 seconds. The statement uses ONLY information from your profile (no hallucinations).

Each match card on the dashboard also shows **"Fetched N hr ago"** — the time TenderFit ingested that tender from the source. Useful for prioritising fresh opportunities.

---

## Digest emails

Configured at `/schedule`.

### Cadence

Pick one:

- **Daily** — once per day, inside your window.
- **Every N days** — pick any interval from 1 to 30 days (slider appears when selected). Example: every 2 days.
- **Weekly** — pick a day of week. Once per week.
- **Monthly** — pick a day of month (1–31; 31 falls back to the last day in short months). Once per month.

### Delivery time window

The digest fires somewhere inside this local-time window. Examples:

- `08:00 – 09:00` — narrow window, will fire in the first 15-minute cron tick that's in this hour.
- `08:00 – 18:00` — wide workday window; will fire at the first chance once cron checks.
- `18:00 – 18:00` — single-hour, exact-time delivery.

Pick your local timezone (defaults to UTC). Common timezones are in the dropdown.

### Minimum fit score

Slider 0–100. Matches scoring below this threshold are excluded from the digest. **This is the same threshold the dashboard uses** — adjusting it on the dashboard updates this too. They're a single setting under the hood.

### Recipients

Add as many emails as you want (up to 20). Each gets a copy of the digest. Press Enter or comma after each address.

To **remove a recipient**: click the small `×` on their chip in the tag input.

If the list is empty, the digest falls back to the legacy single-recipient fallback (the `DIGEST_TEST_RECIPIENT` env var on the server). Leave the list non-empty in production.

### Enabling / pausing

Top of the Filters card: **Digest enabled** checkbox. Untick to pause all scheduled deliveries without losing your settings. Tick again to resume. Manual "Send digest now" still works while paused.

### Sending a digest immediately

Click **Send digest now** on the dashboard. Always uses your current Recipients list and current threshold.

---

## Tuning the experience

Things to adjust over time as you learn what's useful:

| Symptom | Lever to pull |
|---|---|
| Drowning in low-quality matches | Raise the **minimum fit score** slider |
| Missing tenders you'd be interested in | Lower the threshold; revisit your profile (probably under-describing a service) |
| Too many tenders from outside your region | Either remove the country from your Geographies, OR if you DO want international, tick the **International Collaboration** box |
| Capability statements feel generic | Add more specific past projects to your profile |
| Digest too frequent | Switch cadence from Daily → Every 2 days → Weekly |
| Digest landing in spam | Verify your sender domain in Resend (talk to your administrator) |
| Want to test a setting change immediately | Save it, then click **Send digest now** to see the immediate effect |

---

## Recommended workflow

### Week 1

- Day 1: Sign in, fill profile thoroughly (don't skip past projects), set schedule to Daily with min fit score 30, add yourself as the only recipient
- Day 1: Click **Fetch latest tenders** → wait → click **Find new matches**
- Days 2–7: Open every match the matcher surfaces. Click **Interested** or **Not interested** on each (top-right corner of the match detail page) — this builds a feedback signal that future eval can use

### Week 2

- Look at the matches you marked Interested vs Not — is the matcher mostly right? Mostly wrong?
- If mostly right: raise the threshold to 50 to reduce noise. Add real team members as recipients.
- If mostly wrong: revisit your profile. The most common issue is too-generic service descriptions. Be specific.

### Month 1 onwards

- Review weekly — open the dashboard once a week, scan top matches, mark feedback
- Adjust cadence: if you're checking daily anyway, daily digest is fine; if matches accumulate slowly, switch to Weekly Monday-morning digest
- If the team is using TenderFit for actual bids, generate the capability statement from the match detail page before each bid — it speeds up the bid intro section by ~30 minutes

---

## Troubleshooting

**Login form doesn't accept my password.**
Either the password is wrong, or the shared password was rotated on the server. Talk to your administrator.

**Dashboard is blank but I just created a profile.**
The match worker hasn't run yet. Click **Find new matches** on the dashboard. First run takes 3–8 minutes.

**"Find new matches" stays in "Running…" forever.**
Refresh the page. If it still says running after 10 minutes, the worker likely hit a transient API rate limit (Gemini or Voyage). Wait 5 minutes and click again.

**Digest email never arrives.**
1. Check your spam folder
2. Visit `/schedule` and confirm recipients includes your address
3. Click **Send digest now** — the on-screen result will tell you if Resend errored
4. If "no qualifying matches", drop the min fit score temporarily

**Fit scores feel too low / too high.**
This is normal during the first week — the matcher learns your judgement via the Interested/Not buttons over time. Until that signal accumulates, the LLM is calibrated to be conservative.

**I see a match I want to keep but the tender deadline has expired — where does it go?**
The Archive (`/archive`) page shows all past-deadline matches. Click any match card there to open the full analysis. Past matches are kept forever.

**Can I get matches for multiple companies / brands from one login?**
Currently TenderFit is one-tenant-per-login. Multi-tenant switching is on the roadmap.

---

## Where to learn more

- Technical setup, deployment, and contributor docs: [`README.md`](./README.md)
- Source code: https://github.com/maazkhaled/TenderFit

For bugs, questions, or feature requests, contact your administrator.
