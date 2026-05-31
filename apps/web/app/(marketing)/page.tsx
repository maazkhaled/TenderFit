import Link from "next/link";
import { ArrowRight, Brain, GitCompareArrows, MailCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";

const FEATURES = [
  {
    icon: Brain,
    title: "AI Fit Scoring",
    body: "Every tender is scored 0–100 against your capability profile with a 3-bullet rationale grounded in the source text.",
  },
  {
    icon: GitCompareArrows,
    title: "Capability Gap Analysis",
    body: "We surface the certifications, tech, and scale you don't yet have — colour-coded by severity, before you waste a bid cycle.",
  },
  {
    icon: MailCheck,
    title: "Scheduled Smart Digests",
    body: "Never always-on. You pick the cadence, the cut-off score, and the timezone. Inbox respect, not interruption.",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen overflow-hidden bg-white">
      <header className="absolute inset-x-0 top-0 z-10">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="h-4 w-4 text-indigo-600" />
            Project Beta
          </div>
          <div className="flex items-center gap-2">
            <Link href="/login">
              <Button variant="ghost" size="sm">Sign in</Button>
            </Link>
            <Link href="/login">
              <Button size="sm">Try the demo</Button>
            </Link>
          </div>
        </div>
      </header>

      <section className="relative isolate">
        <div
          aria-hidden
          className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,_rgba(99,102,241,0.18),_transparent_55%),_radial-gradient(ellipse_at_bottom_right,_rgba(236,72,153,0.10),_transparent_50%)]"
        />
        <div className="mx-auto max-w-4xl px-6 pt-40 pb-32 text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-indigo-200/60 bg-white/60 px-3 py-1 text-xs font-medium text-indigo-700 backdrop-blur">
            <Sparkles className="h-3 w-3" />
            The matcher is the product
          </span>
          <h1 className="mt-6 text-balance text-5xl font-semibold tracking-tight text-ink sm:text-6xl">
            Tender intelligence for IT companies that actually bid to win.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-balance text-lg leading-relaxed text-zinc-600">
            We ingest opportunities from official sources only — SAM.gov, TED, UNGM, World Bank, PPRA — and use Claude to score fit, expose your gaps, and draft the capability statement before you open a bid doc.
          </p>
          <div className="mt-10 flex items-center justify-center gap-3">
            <Link href="/login">
              <Button size="lg">
                Sign in <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-32">
        <div className="grid gap-6 md:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="group rounded-2xl border border-zinc-200 bg-white p-6 transition-colors hover:border-indigo-200"
            >
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                <Icon className="h-5 w-5" />
              </div>
              <h3 className="mt-5 text-base font-semibold tracking-tight text-ink">
                {title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-600">{body}</p>
            </div>
          ))}
        </div>

        <div className="mt-20 flex flex-col items-center gap-4 rounded-2xl border border-zinc-200 bg-zinc-50/50 px-8 py-12 text-center">
          <h2 className="text-2xl font-semibold tracking-tight">
            Ready in three minutes.
          </h2>
          <p className="max-w-md text-sm text-zinc-600">
            Describe your company once. Get tender matches with rationale, gaps, win-probability, and a draft capability statement.
          </p>
          <Link href="/login">
            <Button size="lg">Sign in</Button>
          </Link>
        </div>
      </section>

      <footer className="border-t border-zinc-100 py-8 text-center text-xs text-zinc-500">
        Project Beta — official-source, license-friendly tender intelligence.
      </footer>
    </div>
  );
}
