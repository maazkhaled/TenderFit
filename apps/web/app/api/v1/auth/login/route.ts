import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, parseJson } from "@/lib/api";
import { verifyPassword } from "@/lib/auth-password";
import { prisma } from "@/lib/db";
import { setActiveTenant } from "@/lib/auth";

const LoginSchema = z.object({
  email: z.string().email("Enter a valid email."),
  password: z.string().min(1, "Password is required."),
});

/**
 * POST /api/v1/auth/login
 *
 * Validates email + shared password against DEMO_PASSWORD env. On success:
 *   - Looks up the most recent tenant owned by this email (if any) and
 *     sets it as the active session tenant.
 *   - Returns { ok: true, redirectTo } so the client decides whether to
 *     land on /dashboard (existing tenant) or /onboard (first-time).
 *
 * On wrong password: returns 401 with a generic message — no hint about
 * whether the email exists.
 */
export const POST = apiHandler(async (req) => {
  const { email, password } = await parseJson(req, LoginSchema);

  if (!verifyPassword(password)) {
    return NextResponse.json(
      { error: "invalid_credentials", message: "Email or password is incorrect." },
      { status: 401 },
    );
  }

  // Find any tenant this email already owns; if found, set it active.
  // If not, the session is still set (with email only) and the UI sends the
  // user to /onboard to create their first tenant.
  const user = await prisma.user.findFirst({
    where: { email },
    orderBy: { createdAt: "desc" },
    select: { id: true, tenantId: true },
  });

  if (user) {
    await setActiveTenant(user.tenantId, user.id, email);
    return NextResponse.json({ ok: true, redirectTo: "/dashboard" });
  }

  // No tenant yet — write just the email into the session so /onboard can
  // attach the new tenant to this email.
  await setActiveTenant("", "", email).catch(() => {
    /* setActiveTenant requires non-empty IDs; we fall back below */
  });

  // Use a lightweight session write that only stores the email.
  const { cookies } = await import("next/headers");
  const { getIronSession } = await import("iron-session");
  const session = await getIronSession<{ userEmail?: string }>(cookies(), {
    password:
      process.env.SESSION_SECRET ??
      "dev-only-insecure-secret-change-me-change-me-change-me",
    cookieName: "beta_session",
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      secure:
        process.env.NODE_ENV === "production" &&
        (process.env.APP_URL?.startsWith("https://") ?? false),
      path: "/",
    },
  });
  session.userEmail = email;
  await session.save();

  return NextResponse.json({ ok: true, redirectTo: "/onboard" });
});
