"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input, Field } from "@/components/ui/Input";

interface Props {
  defaultEmail?: string;
  /** ?redirect=/some/path comes from middleware-style 401 redirects. */
  redirectTo?: string;
}

export function LoginForm({ defaultEmail = "", redirectTo }: Props) {
  const router = useRouter();
  const [email, setEmail] = useState(defaultEmail);
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        redirectTo?: string;
        error?: string;
      };
      if (!res.ok || !body.ok) {
        setError(body.message ?? "Sign-in failed. Try again.");
        return;
      }
      // Server tells us where to land: /dashboard if a tenant exists, /onboard otherwise.
      // ?redirect= takes precedence when set (e.g. after a 401 redirect).
      const dest = redirectTo && redirectTo.startsWith("/")
        ? redirectTo
        : body.redirectTo ?? "/dashboard";
      router.push(dest);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="Email" htmlFor="login-email">
        <Input
          id="login-email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@yourcompany.com"
        />
      </Field>
      <Field label="Password" htmlFor="login-password">
        <Input
          id="login-password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Shared access password"
        />
      </Field>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <Button
        type="submit"
        size="lg"
        className="w-full"
        disabled={submitting || !email || !password}
      >
        {submitting ? "Signing in…" : "Sign in"}
      </Button>

      <p className="pt-2 text-center text-xs text-zinc-500">
        New here? After sign-in we'll walk you through creating your company
        profile.
      </p>
    </form>
  );
}
