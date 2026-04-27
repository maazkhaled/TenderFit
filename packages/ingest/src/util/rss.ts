import { XMLParser } from "fast-xml-parser";

export interface RssItem {
  title: string;
  link: string;
  description: string;
  pubDate: string | null;
  guid: string | null;
  raw: unknown;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
});

export function parseRss(xml: string): RssItem[] {
  const parsed = parser.parse(xml) as Record<string, unknown>;
  const channel =
    (parsed?.rss as Record<string, unknown> | undefined)?.channel ??
    (parsed?.feed as Record<string, unknown> | undefined) ??
    {};
  const rawItems =
    (channel as Record<string, unknown>).item ??
    (channel as Record<string, unknown>).entry ??
    [];
  const items = Array.isArray(rawItems) ? rawItems : [rawItems];

  return items
    .filter((it): it is Record<string, unknown> => Boolean(it) && typeof it === "object")
    .map((it) => normalizeItem(it));
}

function normalizeItem(it: Record<string, unknown>): RssItem {
  const link = pickLink(it);
  const guid = pickString(it.guid) ?? pickString((it as Record<string, unknown>).id) ?? null;
  return {
    title: pickString(it.title) ?? "",
    link,
    description: pickString(it.description) ?? pickString((it as Record<string, unknown>).summary) ?? "",
    pubDate:
      pickString(it.pubDate) ??
      pickString((it as Record<string, unknown>).published) ??
      pickString((it as Record<string, unknown>).updated) ??
      null,
    guid,
    raw: it,
  };
}

function pickString(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o["#text"] === "string") return o["#text"] as string;
  }
  return null;
}

function pickLink(it: Record<string, unknown>): string {
  const link = it.link;
  if (typeof link === "string") return link;
  if (Array.isArray(link)) {
    for (const l of link) {
      if (typeof l === "string") return l;
      if (l && typeof l === "object") {
        const href = (l as Record<string, unknown>)["@_href"];
        if (typeof href === "string") return href;
      }
    }
  }
  if (link && typeof link === "object") {
    const href = (link as Record<string, unknown>)["@_href"];
    if (typeof href === "string") return href;
    const text = (link as Record<string, unknown>)["#text"];
    if (typeof text === "string") return text;
  }
  return "";
}
