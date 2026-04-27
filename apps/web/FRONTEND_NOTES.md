# Frontend Notes

## Pages
- `app/(marketing)/page.tsx` — landing (hero + 3 feature cards + CTA).
- `app/(app)/layout.tsx` — shared authed app shell (header + nav).
- `app/(app)/onboard/page.tsx` — capability profile builder (client, zod-validated).
- `app/(app)/dashboard/page.tsx` — server component, fetches `/api/v1/matches?minScore=60`.
- `app/(app)/matches/[id]/page.tsx` — server component, fetches `/api/v1/matches/[id]`.
- `app/(app)/matches/[id]/MatchActions.tsx` — client child for capability-statement + feedback.
- `app/(app)/schedule/page.tsx` — digest schedule (client, GET/PUT `/api/v1/schedule`).

## Components
- `components/ui/`: `Button`, `Card` (+Header/Body/Footer/Title/Description), `Badge`, `Input` (+`Field`), `Textarea`, `Select`, `Slider`.
- `components/domain/`: `MatchCard`, `FitScore`, `WinProbBadge`, `GapList`, `CountryFlag`.
- `components/forms/`: `TagInput`, `RepeatableSection` (generic).
- `lib/ui/`: `cn` (clsx wrapper), `fetch-server` (cookie-forwarding server fetch), `countries` (ISO list, flag, timezones).

## Tailwind
- Added `tailwind.config.ts`, `postcss.config.mjs`, `app/globals.css` with `@tailwind` directives. `app/layout.tsx` imports globals.

## TODOs for lead
- TODO(lead): confirm `/api/v1/matches` list response shape — frontend assumes `{ matches: [{ id, fitScore, winProbability, tender: { title, buyer, country, deadlineAt } }] }`.
- TODO(lead): confirm `/api/v1/matches/[id]` returns nested `tender` with `description`, `url`, `publishedAt`, `budgetMinUsd/MaxUsd`, `currency`. Frontend types align with `NormalizedTender` minus `raw`.
- TODO(lead): `/api/v1/schedule` GET shape — frontend accepts `{ schedule }` or bare object.
- TODO(lead): capability-statement POST returns `{ capabilityStatement: string }` — wire backend service accordingly.
- TODO(lead): integrate auth — the marketing "Sign in" link points to `/dashboard`; real auth will replace this.
