import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import {
  Archive,
  CalendarClock,
  LayoutDashboard,
  Sparkles,
  UserCog,
} from "lucide-react";
import { getEmailOnlySession } from "@/lib/auth";
import { LogoutButton } from "@/components/auth/LogoutButton";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/archive", label: "Archive", icon: Archive },
  { href: "/profile", label: "Profile", icon: UserCog },
  { href: "/schedule", label: "Schedule", icon: CalendarClock },
];

/**
 * Every page inside (app)/** is session-gated. Visitors without a valid
 * session land on /login; after sign-in they're sent here (or back to the
 * page they originally asked for via ?redirect=).
 *
 * /onboard is a special case: it lives under (app) so the same gate
 * applies, but the page itself is what a new user sees right after
 * login when they have no tenant yet — getSession returns null when
 * activeTenantId is missing, so we fall through to the email-only
 * branch instead of redirecting in a loop.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getEmailOnlySession();
  if (!session) {
    redirect("/login");
  }

  // Brand-new user: email cookie is set but no tenant exists yet. Push them
  // to /onboard unless they're already there (Next gives us the pathname via
  // the x-invoke-path / next-url header, depending on rendering mode).
  if (!session.activeTenantId) {
    const path =
      headers().get("x-invoke-path") ??
      headers().get("next-url") ??
      "";
    if (!path.startsWith("/onboard")) {
      redirect("/onboard");
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50/50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <Sparkles className="h-4 w-4 text-indigo-600" />
            Project Beta
          </Link>
          <nav className="flex items-center gap-1">
            {NAV.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-ink-soft hover:bg-zinc-100"
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            ))}
            <div className="ml-3 flex items-center gap-2 border-l border-zinc-200 pl-3 text-xs text-zinc-500">
              <span className="hidden sm:inline">{session.userEmail}</span>
              <LogoutButton />
            </div>
            {/* Note: session is the email-only check; it always has userEmail
                 when we reach here (we redirected to /login otherwise). */}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-10">{children}</main>
    </div>
  );
}
