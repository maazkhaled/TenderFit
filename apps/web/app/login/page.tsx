import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { BrandMark } from "@/components/ui/BrandMark";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

/**
 * Sign-in page. Sits OUTSIDE the (app) route group so it's not gated by
 * the session check in (app)/layout.tsx.
 *
 * If the visitor is already signed in, we short-circuit to /dashboard so
 * the login form doesn't replace a working session by accident.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams?: { redirect?: string; error?: string };
}) {
  const session = await getSession();
  if (session) {
    redirect(searchParams?.redirect ?? "/dashboard");
  }

  const defaultEmail = process.env.DEV_DEFAULT_EMAIL ?? "";

  return (
    <div className="min-h-screen bg-zinc-50 flex flex-col">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex h-14 max-w-6xl items-center px-6">
          <Link
            href="/"
            className="flex items-center gap-2 text-sm font-semibold tracking-tight"
          >
            <BrandMark />
            TenderFit
          </Link>
        </div>
      </header>
      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
            <CardDescription>
              Enter your email and the shared access password to view your
              tender matches.
            </CardDescription>
          </CardHeader>
          <CardBody>
            <LoginForm
              defaultEmail={defaultEmail}
              redirectTo={searchParams?.redirect}
            />
          </CardBody>
        </Card>
      </main>
    </div>
  );
}
