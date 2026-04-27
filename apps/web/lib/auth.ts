import { cookies } from "next/headers";
import { getIronSession, type SessionOptions } from "iron-session";
import { prisma } from "./db";
import { NotAuthError } from "./errors";

export type SessionData = {
  tenantId?: string;
  userId?: string;
};

const sessionOptions: SessionOptions = {
  password:
    process.env.SESSION_SECRET ??
    "dev-only-insecure-secret-change-me-change-me-change-me",
  cookieName: "beta_session",
  cookieOptions: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
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
} | null> {
  const session = await readSession();
  if (!session.tenantId || !session.userId) return null;
  return { tenantId: session.tenantId, userId: session.userId };
}

export async function requireSession(): Promise<{
  tenantId: string;
  userId: string;
}> {
  const s = await getSession();
  if (!s) throw new NotAuthError();
  return s;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "tenant";
}

export async function signInAsTenant(
  slugInput: string,
  companyName?: string,
): Promise<{ tenantId: string; userId: string; slug: string }> {
  const slug = slugify(slugInput);
  const tenant = await prisma.tenant.upsert({
    where: { slug },
    update: {},
    create: { slug, companyName: companyName ?? slug },
  });

  const email = `${slug}@dev.local`;
  const user = await prisma.user.upsert({
    where: { email },
    update: { tenantId: tenant.id },
    create: { email, tenantId: tenant.id, name: slug },
  });

  const session = await readSession();
  session.tenantId = tenant.id;
  session.userId = user.id;
  await session.save();

  return { tenantId: tenant.id, userId: user.id, slug: tenant.slug };
}

export async function setSessionFor(tenantId: string, userId: string) {
  const session = await readSession();
  session.tenantId = tenantId;
  session.userId = userId;
  await session.save();
}

export async function destroySession() {
  const session = await readSession();
  session.destroy();
}
