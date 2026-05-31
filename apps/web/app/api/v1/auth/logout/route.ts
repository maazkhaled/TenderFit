import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api";
import { destroySession } from "@/lib/auth";

/**
 * POST /api/v1/auth/logout
 *
 * Clears the iron-session cookie. The client should redirect to /login
 * after a successful response.
 */
export const POST = apiHandler(async () => {
  await destroySession();
  return NextResponse.json({ ok: true });
});
