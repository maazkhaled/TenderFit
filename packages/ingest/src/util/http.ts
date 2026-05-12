import type { HttpJsonOpts } from "../types.ts";

const USER_AGENT = "ProjectBeta/0.1 (+contact@example.com)";
const DEFAULT_TIMEOUT_MS = 30_000;

export async function httpJson<T = unknown>(url: string, opts: HttpJsonOpts = {}): Promise<T> {
  const { method = "GET", headers = {}, body, timeoutMs = DEFAULT_TIMEOUT_MS, asText = false } = opts;

  const finalHeaders: Record<string, string> = {
    "User-Agent": USER_AGENT,
    Accept: asText ? "application/xml, text/xml, */*" : "application/json",
    ...headers,
  };

  let payload: BodyInit | undefined;
  if (body !== undefined) {
    if (typeof body === "string") {
      payload = body;
    } else {
      payload = JSON.stringify(body);
      if (!finalHeaders["Content-Type"]) {
        finalHeaders["Content-Type"] = "application/json";
      }
    }
  }

  const attempt = async (): Promise<Response> => {
    return fetch(url, {
      method,
      headers: finalHeaders,
      body: payload,
      signal: AbortSignal.timeout(timeoutMs),
    });
  };

  let res: Response;
  try {
    res = await attempt();
  } catch (err) {
    await sleep(500);
    res = await attempt();
  }

  if (res.status >= 500 && res.status < 600) {
    await sleep(1_000);
    res = await attempt();
  }

  if (!res.ok) {
    const text = await safeText(res);
    throw new Error(`httpJson ${method} ${url} -> ${res.status} ${res.statusText}: ${text.slice(0, 500)}`);
  }

  if (asText) {
    return (await res.text()) as unknown as T;
  }
  return (await res.json()) as T;
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
