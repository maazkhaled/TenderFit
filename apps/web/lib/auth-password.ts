import { timingSafeEqual } from "node:crypto";

/**
 * Single-shared-password auth for the pilot deployment.
 *
 * Why not bcrypt + per-user passwords yet:
 *   - SCOPE.md flagged auth as "stubbed for MVP, real auth deferred"
 *   - The first customer is a single company; one shared credential is the
 *     same risk surface as "everyone has the URL bookmarked"
 *   - Adding a User.passwordHash column would need a migration AND a signup
 *     UI that handles validation, reset flows, etc. — not the right scope
 *     for the night before a customer demo.
 *
 * Upgrade path: when we move to per-user passwords, swap verifyPassword's
 * body for `bcrypt.compare(input, user.passwordHash)` and add a hash column
 * to the User model in prisma/schema.prisma. The callers (login route +
 * UI form) stay unchanged.
 */

const DEFAULT_PASSWORD = "demo123";

function expectedPassword(): string {
  const fromEnv = process.env.DEMO_PASSWORD?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_PASSWORD;
}

/**
 * Compare candidate against the configured password in constant time.
 * Returns false for empty / mismatched / mistyped inputs without leaking
 * length information via early-exit timing.
 */
export function verifyPassword(candidate: string | undefined | null): boolean {
  const expected = expectedPassword();
  const input = candidate ?? "";
  // Pad / truncate to the longer length so timingSafeEqual never throws,
  // then also compare lengths so different-length strings always lose.
  const len = Math.max(expected.length, input.length);
  const a = Buffer.alloc(len, 0);
  const b = Buffer.alloc(len, 0);
  a.write(expected);
  b.write(input);
  const tsEq = timingSafeEqual(a, b);
  return tsEq && expected.length === input.length;
}
