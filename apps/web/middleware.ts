import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Sets x-pathname header so server components (e.g. (app)/layout.tsx) can
 * reliably read the current request path. Next.js doesn't expose this via
 * headers() consistently across build modes, which broke the
 * "no tenant → redirect to /onboard" guard in production (looped forever).
 */
export function middleware(req: NextRequest) {
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-pathname", req.nextUrl.pathname);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
