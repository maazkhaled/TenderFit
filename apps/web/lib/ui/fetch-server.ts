import { cookies, headers } from "next/headers";

function resolveBaseUrl() {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";
  if (host) return `${proto}://${host}`;
  return "http://localhost:3000";
}

export async function apiGet<T>(path: string): Promise<T> {
  const base = resolveBaseUrl();
  const cookieHeader = cookies().toString();
  const res = await fetch(`${base}${path}`, {
    headers: { cookie: cookieHeader },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`GET ${path} failed: ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function apiGetSafe<T>(path: string): Promise<T | null> {
  try {
    return await apiGet<T>(path);
  } catch {
    return null;
  }
}
