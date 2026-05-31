import { cookies } from "next/headers";
import { getIronSession, type SessionOptions } from "iron-session";
import { prisma } from "./db";
import { NotAuthError, NotFoundError } from "./errors";

/**
 * Stub session for MVP.
 *
 * The session carries:
 *   - userEmail: stable across the browser lifetime; identifies "who"
 *   - activeTenantId: which tenant the user is currently viewing
 *
 * One email can own N tenants (via the User table's composite unique on
 * (email, tenantId)). Switching tenants only changes activeTenantId.
 *
 * tenantId/userId are kept on the session object for back-compat with
 * code that still reads them; they always mirror activeTenantId + the
 * User row for that (email, activeTenantId) pair.
 */
export type SessionData = {
  userEmail?: string;
  activeTenantId?: string;
  tenantId?: string;
  userId?: string;
};

const DEV_DEFAULT_EMAIL =
  process.env.DEV_DEFAULT_EMAIL?.trim() || "dev@local.test";
const isHttpsApp = process.env.APP_URL?.startsWith("https://") ?? false;

const sessionOptions: SessionOptions = {
  password:
    process.env.SESSION_SECRET ??
    "dev-only-insecure-secret-change-me-change-me-change-me",
  cookieName: "beta_session",
  cookieOptions: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && isHttpsApp,
    path: "/",
  },
};

async function readSession() {
  const store = cookies();
  return getIronSession<SessionData>(store, sessionOptions);
}

export async function getSession(): Promise<{
  tenantId: string;
  userId: string;
  userEmail: string;
} | null> {
  const session = await readSession();
  if (!session.userEmail || !session.activeTenantId) return null;
  const user = await prisma.user.findUnique({
    where: {
      email_tenantId: {
        email: session.userEmail,
        tenantId: session.activeTenantId,
      },
    },
    select: { id: true },
  });
  if (!user) return null;
  return {
    tenantId: session.activeTenantId,
    userId: user.id,
    userEmail: session.userEmail,
  };
}

export async function requireSession(): Promise<{
  tenantId: string;
  userId: string;
  userEmail: string;
}> {
  const s = await getSession();
  if (!s) throw new NotAuthError();
  return s;
}

/**
 * Email-only session check.
 *
 * Returns the userEmail if the visitor has signed in (regardless of whether
 * they've created their first tenant yet), or null otherwise. Use this in
 * layouts that need to distinguish "anonymous → /login" from "signed-in
 * but no tenant → /onboard".
 *
 * Distinct from getSession (which also requires an active tenant) so the
 * post-login → onboard path doesn't redirect-loop.
 */
export async function getEmailOnlySession(): Promise<{
  userEmail: string;
  activeTenantId: string | null;
} | null> {
  const session = await readSession();
  if (!session.userEmail) return null;
  return {
    userEmail: session.userEmail,
    activeTenantId: session.activeTenantId ?? null,
  };
}

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "tenant"
  );
}

async function uniqueSlug(base: string): Promise<string> {
  const baseSlug = slugify(base);
  let slug = baseSlug;
  for (let i = 1; i < 1000; i++) {
    const existing = await prisma.tenant.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!existing) return slug;
    slug = `${baseSlug}-${i + 1}`;
  }
  return `${baseSlug}-${Date.now()}`;
}

/** Reads (or initialises with DEV_DEFAULT_EMAIL) the cookie's stable user email. */
export async function getOrInitUserEmail(): Promise<string> {
  const session = await readSession();
  if (session.userEmail) return session.userEmail;
  session.userEmail = DEV_DEFAULT_EMAIL;
  await session.save();
  return session.userEmail;
}

/** Create a fresh tenant + User row owned by the given email; set as active. */
export async function createTenantForEmail(
  email: string,
  companyName: string,
): Promise<{ tenantId: string; userId: string; slug: string }> {
  const slug = await uniqueSlug(companyName);
  const tenant = await prisma.tenant.create({
    data: { slug, companyName },
  });
  const user = await prisma.user.create({
    data: { email, tenantId: tenant.id, name: slug },
  });
  await setActiveTenant(tenant.id, user.id, email);
  return { tenantId: tenant.id, userId: user.id, slug: tenant.slug };
}

/**
 * Back-compat with the legacy onboard route. Always creates a NEW tenant
 * under the current session's email — onboarding a "new company" no
 * longer rebinds an existing tenant.
 */
export async function signInAsTenant(
  slugInput: string,
  companyName?: string,
): Promise<{ tenantId: string; userId: string; slug: string }> {
  const email = await getOrInitUserEmail();
  return createTenantForEmail(email, companyName ?? slugInput);
}

export async function setActiveTenant(
  tenantId: string,
  userId: string,
  email?: string,
) {
  const session = await readSession();
  if (email) session.userEmail = email;
  session.activeTenantId = tenantId;
  session.tenantId = tenantId;
  session.userId = userId;
  await session.save();
}

/** Switch the session to a tenant the current email owns. */
export async function switchActiveTenant(tenantId: string): Promise<{
  tenantId: string;
  userId: string;
}> {
  const email = await getOrInitUserEmail();
  const user = await prisma.user.findUnique({
    where: { email_tenantId: { email, tenantId } },
    select: { id: true },
  });
  if (!user) throw new NotFoundError();
  await setActiveTenant(tenantId, user.id, email);
  return { tenantId, userId: user.id };
}

export interface OwnedTenant {
  id: string;
  slug: string;
  companyName: string;
  hasProfile: boolean;
  isActive: boolean;
  createdAt: Date;
}

export async function listOwnedTenants(): Promise<OwnedTenant[]> {
  const session = await readSession();
  if (!session.userEmail) return [];
  const rows = await prisma.user.findMany({
    where: { email: session.userEmail },
    include: { tenant: { include: { profile: { select: { id: true } } } } },
    orderBy: { createdAt: "asc" },
  });
  const activeId = session.activeTenantId ?? null;
  return rows.map((u) => ({
    id: u.tenant.id,
    slug: u.tenant.slug,
    companyName: u.tenant.companyName,
    hasProfile: u.tenant.profile !== null,
    isActive: u.tenant.id === activeId,
    createdAt: u.tenant.createdAt,
  }));
}

/** Delete a tenant the current email owns. Cascades to profile + matches. */
export async function deleteOwnedTenant(tenantId: string): Promise<void> {
  const email = await getOrInitUserEmail();
  const user = await prisma.user.findUnique({
    where: { email_tenantId: { email, tenantId } },
    select: { id: true },
  });
  if (!user) throw new NotFoundError();
  await prisma.tenant.delete({ where: { id: tenantId } });
  const session = await readSession();
  if (session.activeTenantId === tenantId) {
    session.activeTenantId = undefined;
    session.tenantId = undefined;
    session.userId = undefined;
    await session.save();
  }
}

export async function setSessionFor(tenantId: string, userId: string) {
  await setActiveTenant(tenantId, userId);
}

export async function destroySession() {
  const session = await readSession();
  session.destroy();
}
