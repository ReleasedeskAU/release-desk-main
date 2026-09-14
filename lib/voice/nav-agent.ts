/**
 * Voice Navigation Agent — single registry for sidebar tabs, path aliases,
 * optional speech synonyms, live DOM sidebar sync, and detail-route awareness.
 *
 * The Live LLM should call `lookup_navigation` when unsure of a URL instead of
 * inventing paths. `navigate_to` still performs the actual route change.
 */
import { NAV_DATA_SECTIONS } from "@/lib/nav-data";
import { VOICE_DYNAMIC_ROUTE_PATTERNS } from "@/lib/voice/route-allowlist-patterns";

export type NavRegistryEntry = {
  href: string;
  label: string;
  section: string;
  kind: "sidebar" | "extra" | "dom";
  synonyms: readonly string[];
};

export type NavLookupHit = {
  href: string;
  label: string;
  section: string;
  kind: NavRegistryEntry["kind"] | "detail" | "alias";
};

export type NavLookupResult = {
  ok: boolean;
  query: string;
  match?: NavLookupHit;
  candidates?: NavLookupHit[];
  reason?: string;
};

/** Speech nicknames only — new tabs work from label/href without an entry here. */
const VOICE_NAV_SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  "/inbox": ["inbox", "morning inbox", "morning tab"],
  "/dashboard": ["dashboard", "home", "home page", "main dashboard"],
  "/releases": ["releases", "release list", "release desk releases"],
  "/calendar": ["calendar", "release calendar", "calender", "schedule"],
  "/booking": [
    "env booking",
    "environment booking",
    "booking",
    "bookings",
    "env book",
    "environment book",
    "uat booking",
  ],
  "/dependencies": ["dependencies", "dependency", "deps"],
  "/conflicts": ["conflicts", "conflict list"],
  "/blockers": ["blockers", "blocker list"],
  "/system-mapping": ["system mapping", "sys mapping", "mapping"],
  "/integration-flows": ["integration flows", "flows", "integration flow"],
  "/environments": [
    "versions and config",
    "versions & config",
    "environments",
    "env config",
    "versions",
  ],
  "/risks": ["risk", "risks", "risk register"],
  "/drifts": ["drift", "drifts", "drift dashboard"],
  "/approvals": ["approvals", "approval queue", "approval tab"],
  "/signoffs": ["signoffs", "sign-offs", "sign off", "sign-off queue"],
  "/leaves": ["leave calendar", "leaves", "leave"],
  "/monitoring-alerts": ["monitoring alerts", "alerts", "monitoring"],
  "/incidents": ["incidents", "incident list"],
  "/application-status": ["application status", "app status"],
  "/planned-maintenance": ["planned maintenance", "maintenance"],
  "/executive": ["executive", "exec"],
  "/compare": ["compare"],
  "/insights": ["insights"],
  "/departments": ["departments", "depts"],
  "/applications": ["applications", "apps"],
  "/users": ["users", "user list"],
  "/risk-factors": ["risk factors"],
  "/lifecycle": [
    "lifecycle settings",
    "lifecycle",
    "release lifecycle",
    "lifecycle config",
  ],
  "/knowledge-graph": ["knowledge graph", "kg"],
  "/agents": ["agents"],
  "/history": ["history", "history log"],
  "/ask": ["ask", "ask tab", "search chat", "document search"],
  "/connectors": ["connectors"],
  "/admin-connectors": ["admin connectors", "add source", "index sources"],
  "/admin/reference-data": ["reference data"],
  "/admin-voice": ["voice admin", "voice usage admin", "admin voice"],
  "/settings": ["settings", "preferences"],
};

/** Common wrong / alternate paths → canonical sidebar href. */
export const VOICE_PATH_ALIASES: Readonly<Record<string, string>> = {
  "/bookings": "/booking",
  "/env-booking": "/booking",
  "/envbooking": "/booking",
  "/environment-booking": "/booking",
  "/environment-bookings": "/booking",
  "/calender": "/calendar",
  "/release": "/releases",
  "/blocker": "/blockers",
  "/conflict": "/conflicts",
  "/dependency": "/dependencies",
  "/approval": "/approvals",
  "/signoff": "/signoffs",
  "/sign-off": "/signoffs",
  "/sign-offs": "/signoffs",
  "/alert": "/monitoring-alerts",
  "/alerts": "/monitoring-alerts",
  "/incident": "/incidents",
  "/risk": "/risks",
  "/drift": "/drifts",
  "/home": "/dashboard",
  "/settings/lifecycle": "/lifecycle",
  "/settings/release-lifecycle": "/lifecycle",
  "/release-lifecycle": "/lifecycle",
  "/ask-ai": "/ask",
};

/** Shell extras not always in NAV_DATA (reserved for non-NAV_DATA shell links). */
const EXTRA_SIDEBAR: readonly NavRegistryEntry[] = [];

/** Runtime DOM-discovered tabs (merged on sync). */
let domExtras: NavRegistryEntry[] = [];

const FILLER_RE =
  /^(?:please\s+)?(?:open|go\s+to|goto|show|navigate\s+to|take\s+me\s+to|switch\s+to)\s+/i;
const SURFACE_RE =
  /\b(?:page|tab|section|screen|view|menu|link|area)\b/gi;

/**
 * Normalize spoken / typed nav language for catalog matching.
 * @param raw - User or model phrase (may include “tab”/“page”).
 * @returns Lowercased phrase without filler words.
 */
export function normalizeSpokenNavPhrase(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(FILLER_RE, "")
    .replace(SURFACE_RE, " ")
    .replace(/^(?:the|a|an)\s+/i, "")
    .replace(/[_/]+/g, " ")
    .replace(/[^a-z0-9\s&-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalize a path for registry / allowlist matching.
 * Collapses accidental `//`, strips query/hash, rejects traversal.
 * @param raw - Candidate path or absolute URL.
 * @returns Normalized pathname or null if unusable.
 */
export function normalizeNavPath(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let pathname: string;
  try {
    if (/^https?:\/\//i.test(trimmed)) {
      pathname = new URL(trimmed).pathname;
    } else {
      pathname = trimmed.split(/[?#]/)[0] ?? "";
    }
  } catch {
    return null;
  }
  // Models sometimes emit "//settings/lifecycle"
  pathname = pathname.replace(/\/{2,}/g, "/");
  if (!pathname.startsWith("/")) pathname = `/${pathname}`;
  if (pathname.includes("..")) return null;
  if (pathname.length > 1 && pathname.endsWith("/")) {
    pathname = pathname.slice(0, -1);
  }
  return pathname === "/" ? pathname : pathname || null;
}

function buildFromNavData(): NavRegistryEntry[] {
  const out: NavRegistryEntry[] = [];
  for (const section of NAV_DATA_SECTIONS) {
    const sectionTitle = section.title ?? "Top";
    for (const item of section.items) {
      out.push({
        href: item.href,
        label: item.label,
        section: sectionTitle,
        kind: "sidebar",
        synonyms: VOICE_NAV_SYNONYMS[item.href] ?? [],
      });
    }
  }
  return out;
}

/**
 * Full sidebar registry (nav-data + extras + live DOM sync).
 * @returns Deduped entries keyed by href (DOM/extras cannot drop nav-data rows).
 */
export function listNavRegistry(): NavRegistryEntry[] {
  const byHref = new Map<string, NavRegistryEntry>();
  for (const entry of [...buildFromNavData(), ...EXTRA_SIDEBAR, ...domExtras]) {
    const prev = byHref.get(entry.href);
    if (!prev) {
      byHref.set(entry.href, entry);
      continue;
    }
    // Prefer nav-data label/section; merge synonyms from later sources.
    const syn = new Set([...prev.synonyms, ...entry.synonyms]);
    if (entry.label && entry.label !== prev.label) syn.add(entry.label.toLowerCase());
    byHref.set(entry.href, {
      ...prev,
      synonyms: [...syn],
    });
  }
  return [...byHref.values()];
}

/**
 * Sync live sidebar anchors tagged with data-voice-nav into the registry.
 * Safe to call in the browser; no-op on the server.
 * Side effects: updates module-level domExtras.
 */
export function syncSidebarFromDom(
  doc: { querySelectorAll: (sel: string) => ArrayLike<{ getAttribute: (n: string) => string | null; textContent: string | null }> } | null = typeof document !== "undefined" ? document : null
): number {
  if (!doc) return 0;
  const nodes = doc.querySelectorAll("[data-voice-nav]");
  const next: NavRegistryEntry[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i];
    const href = normalizeNavPath(el.getAttribute("data-voice-nav") ?? "");
    if (!href || seen.has(href)) continue;
    seen.add(href);
    const label =
      (el.textContent ?? "").replace(/\s+/g, " ").trim() || href;
    next.push({
      href,
      label,
      section: "Live sidebar",
      kind: "dom",
      synonyms: [label.toLowerCase()],
    });
  }
  domExtras = next;
  return next.length;
}

/**
 * Reset DOM extras (tests).
 * Side effects: clears module-level domExtras.
 */
export function resetNavAgentDomExtras(): void {
  domExtras = [];
}

function entryToHit(
  entry: NavRegistryEntry,
  kind: NavLookupHit["kind"] = entry.kind
): NavLookupHit {
  return {
    href: entry.href,
    label: entry.label,
    section: entry.section,
    kind,
  };
}

function matchPhrase(phrase: string, entry: NavRegistryEntry): boolean {
  const keys = [entry.label, ...entry.synonyms].map((s) =>
    normalizeSpokenNavPhrase(s)
  );
  for (const nk of keys) {
    if (!nk) continue;
    if (phrase === nk || phrase === `${nk}s`) return true;
  }
  // Loose: spoken phrase may wrap the synonym ("the env booking thing").
  // Do NOT use nk.includes(phrase) — that maps "settings" → "lifecycle settings".
  for (const nk of keys) {
    if (nk.length >= 4 && phrase.includes(nk)) return true;
  }
  return false;
}

function isDetailPath(pathname: string): boolean {
  return VOICE_DYNAMIC_ROUTE_PATTERNS.some((pattern) => {
    const body = pattern
      .split("/")
      .map((seg) => {
        if (!seg) return "";
        if (seg.startsWith(":")) return "[^/]+";
        return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      })
      .join("/");
    return new RegExp(`^${body}/?$`).test(pathname);
  });
}

/**
 * Resolve a spoken name, label, synonym, or path to a known navigation target.
 * @param raw - e.g. "lifecycle settings", "//settings/lifecycle", "/bookings".
 * @returns Canonical hit or null.
 */
export function resolveNavTarget(raw: string): NavLookupHit | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const registry = listNavRegistry();

  if (trimmed.startsWith("/") || /^https?:\/\//i.test(trimmed)) {
    const pathname = normalizeNavPath(trimmed);
    if (!pathname) return null;
    const aliased =
      VOICE_PATH_ALIASES[pathname.toLowerCase()] ?? pathname;
    const hit = registry.find((i) => i.href === aliased);
    if (hit) {
      return entryToHit(
        hit,
        aliased !== pathname ? "alias" : hit.kind
      );
    }
    if (isDetailPath(aliased)) {
      const last = aliased.split("/").filter(Boolean).pop() ?? aliased;
      return {
        href: aliased,
        label: decodeURIComponent(last),
        section: "",
        kind: "detail",
      };
    }
    if (aliased.startsWith("/")) {
      return { href: aliased, label: aliased, section: "", kind: "detail" };
    }
    return null;
  }

  const phrase = normalizeSpokenNavPhrase(trimmed);
  if (!phrase) return null;

  for (const item of registry) {
    if (matchPhrase(phrase, item)) return entryToHit(item);
  }
  return null;
}

/**
 * Navigation agent lookup for the Live LLM.
 * Prefer this over inventing URLs when the spoken page is unclear.
 * @param query - Spoken name, guessed path, or synonym.
 * @returns Structured match / candidates for the tool response.
 */
export function lookupNavigation(query: string): NavLookupResult {
  const q = query.trim();
  if (!q) {
    return { ok: false, query: q, reason: "Empty navigation query" };
  }

  // Refresh from live sidebar when available (client).
  syncSidebarFromDom();

  const match = resolveNavTarget(q);
  if (match) {
    const knownSidebar = listNavRegistry().some((e) => e.href === match.href);
    const knownDetail = isDetailPath(match.href);
    if (knownSidebar || knownDetail || match.kind === "alias") {
      return { ok: true, query: q, match };
    }
    // Path-shaped invent (e.g. /foo/bar) that is not in registry/patterns.
    if (q.startsWith("/") || /^https?:\/\//i.test(q)) {
      return {
        ok: false,
        query: q,
        reason:
          "Unknown page — not in sidebar registry or detail patterns. Try lookup_navigation with the spoken tab name.",
      };
    }
  }

  const phrase = normalizeSpokenNavPhrase(q);
  const candidates = listNavRegistry()
    .filter((e) => {
      const label = normalizeSpokenNavPhrase(e.label);
      return (
        phrase.length >= 3 &&
        (label.includes(phrase) ||
          phrase.includes(label) ||
          e.synonyms.some((s) => normalizeSpokenNavPhrase(s).includes(phrase)))
      );
    })
    .slice(0, 5)
    .map((e) => entryToHit(e));

  if (candidates.length === 1) {
    return { ok: true, query: q, match: candidates[0] };
  }
  if (candidates.length > 1) {
    return {
      ok: false,
      query: q,
      candidates,
      reason: "Ambiguous — pick one candidate.href and call navigate_to",
    };
  }
  return {
    ok: false,
    query: q,
    reason:
      "Unknown page — call lookup_navigation with another name, or search_entity for a record",
  };
}

/**
 * Compact sidebar inventory for Live systemInstruction / session context.
 * @returns Brief listing every registry sidebar href.
 */
export function voiceNavAgentBrief(): string {
  const entries = listNavRegistry()
    .filter((e) => e.kind === "sidebar" || e.kind === "extra")
    .map((i) => `${i.label}=${i.href}`)
    .join("; ");
  return [
    "Navigation agent: call lookup_navigation when unsure of any tab/URL (never invent paths).",
    "Sidebar tabs (also openable via navigate_to with label or synonym):",
    `${entries}.`,
    "Aliases: bookings→/booking, calender→/calendar, settings/lifecycle→/lifecycle, versions and config→/environments, reference data→/admin/reference-data.",
    "tab/page/section mean the same. Never say you cannot open a listed sidebar tab.",
  ].join(" ");
}

/**
 * Static sidebar href/label pairs for the navigate_to allowlist.
 * @returns Derived from the nav registry (not a second hardcoded list).
 */
export function listSidebarNavRoutes(): readonly { href: string; label: string }[] {
  return listNavRegistry()
    .filter((e) => e.kind === "sidebar" || e.kind === "extra")
    .map((e) => ({ href: e.href, label: e.label }));
}
