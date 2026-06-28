import Link from "next/link";
import { Brain, GitCompareArrows, Globe, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { BrandMark } from "@/components/ui/BrandMark";

const FEATURES = [
  {
    icon: Brain,
    title: "Bid Fit Score",
    body: "See a clear 0–100 score for each opportunity, with plain-language reasons tied to the tender text so you know why it is worth a look.",
  },
  {
    icon: GitCompareArrows,
    title: "Readiness Gap Check",
    body: "Spot missing certifications, required technologies, delivery scale, and other bid blockers before your team spends proposal time.",
  },
  {
    icon: Globe,
    title: "Partner-Ready Opportunities",
    body: "Find work beyond your usual markets when it fits your strengths, and see where a local partner, JV, or specialist subcontractor could help.",
  },
  {
    icon: MailCheck,
    title: "Tender Shortlist Digest",
    body: "Get a clean email shortlist on the schedule you choose, filtered by minimum fit score and sent to the right people in your team.",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen overflow-hidden bg-white">
      <header className="absolute inset-x-0 top-0 z-10">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <BrandMark />
            TenderFit
          </div>
          <div className="flex items-center gap-2">
            <Link href="/login">
              <Button size="sm">Try TenderFit</Button>
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
          <h1 className="text-balance text-5xl font-semibold tracking-tight text-ink sm:text-6xl">
            Tender intelligence for IT companies that actually bid to win.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-balance text-lg leading-relaxed text-zinc-600">
            TenderFit monitors official government and multilateral procurement portals for you, then turns the feed into a practical shortlist with fit reasons, readiness gaps, win signals, and a draft capability statement before your team opens the bid package.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-32">
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
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
        </div>
      </section>

      <footer className="border-t border-zinc-100 py-8 text-center text-xs text-zinc-500">
        TenderFit — official-source, license-friendly tender intelligence.
      </footer>
    </div>
  );
}
