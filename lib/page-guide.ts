import { NAV_SECTIONS } from "./navigation";

export type PageDataSource = "database" | "demo" | "both" | "config" | "none";

export type PageGuideEntry = {
  key: string;
  title: string;
  description: string;
  dataSource: PageDataSource;
  tips: string[];
  related: { label: string; href: string }[];
  workflowStep?: number;
};

const DATA_SOURCE_LABEL: Record<PageDataSource, string> = {
  database: "Release Desk · SQLite data",
  demo: "Demo · synthetic portfolio",
  both: "Database + demo data",
  config: "Admin configuration",
  none: "App shell",
};

export function dataSourceLabel(source: PageDataSource): string {
  return DATA_SOURCE_LABEL[source];
}

export const RELEASE_DESK_WORKFLOW = [
  { step: 1, label: "Reference Data", href: "/admin/reference-data", detail: "Set up departments, apps, and environments" },
  { step: 2, label: "Releases", href: "/releases", detail: "Plan releases and link applications" },
  { step: 3, label: "Env Booking", href: "/booking", detail: "Reserve TEST/UAT windows" },
  { step: 4, label: "System Mapping", href: "/system-mapping", detail: "Check upstream/downstream risks" },
  { step: 5, label: "Morning Inbox", href: "/inbox", detail: "Act on blockers, P1s, and priorities daily" },
] as const;

const STATIC_GUIDES: Record<string, PageGuideEntry> = {
  "/inbox": {
    key: "inbox",
    title: "Morning Inbox",
    description:
      "Your daily action queue. See blocked and at-risk releases, open P1 issues, mapping conflicts, Go/No-Go deadlines, and releases you own — with Top 3 priorities and an AI briefing.",
    dataSource: "database",
    workflowStep: 5,
    tips: [
      "Start here every day after login.",
      "Use section filters (Blocked, P1, My releases) to narrow the list.",
      "Top 3 actions link directly to the release or task that needs you.",
    ],
    related: [
      { label: "Dashboard", href: "/dashboard" },
      { label: "Needs attention", href: "/releases?attention=1" },
      { label: "Releases", href: "/releases" },
    ],
  },
  "/dashboard": {
    key: "dashboard",
    title: "Dashboard",
    description:
      "Portfolio snapshot for your filtered scope: release counts by status, open P1 issues, needs-attention highlights, and an AI-generated summary.",
    dataSource: "database",
    tips: [
      "Use the filter bar to scope by department, application, or environment.",
      "Switch Month / Quarter / Year to change the reporting window.",
      "Click a stuck release to open its command center.",
    ],
    related: [
      { label: "Morning Inbox", href: "/inbox" },
      { label: "Releases", href: "/releases" },
    ],
  },
  "/releases": {
    key: "releases",
    title: "Releases",
    description:
      "Master list of database releases (editable) and demo command-center releases. Filter, sort by readiness, use playbooks to create releases, or open Needs attention.",
    dataSource: "both",
    workflowStep: 2,
    tips: [
      "DB rows (RD-2026-*) are editable; demo rows open the synthetic command center.",
      "Editors can use Playbooks & clone to pre-fill apps and checklists.",
      "Sort by Readiness or Blockers to find trouble spots quickly.",
    ],
    related: [
      { label: "Calendar", href: "/calendar" },
      { label: "Env Booking", href: "/booking" },
    ],
  },
  "/calendar": {
    key: "calendar",
    title: "Release Calendar",
    description:
      "Timeline view of database and demo releases. Shows environment capacity heat when bookings overlap apps in scope.",
    dataSource: "both",
    tips: [
      "Filter by dept/app to see load for a specific train.",
      "Use heat indicators to avoid over-booking shared environments.",
      "Click a release bar to open its detail page.",
    ],
    related: [
      { label: "Env Booking", href: "/booking" },
      { label: "Releases", href: "/releases" },
    ],
  },
  "/booking": {
    key: "booking",
    title: "Environment Booking",
    description:
      "Select applications, pick dates, check availability, and book TEST/UAT windows. The booking assistant suggests conflict-free slots and flags overlapping releases.",
    dataSource: "database",
    workflowStep: 3,
    tips: [
      "Hold Ctrl/Cmd to select multiple apps for end-to-end testing.",
      "Use suggested windows from the booking assistant when the calendar is busy.",
      "Follow the mapping link to verify downstream env risks for your window.",
    ],
    related: [
      { label: "System Mapping", href: "/system-mapping" },
      { label: "Calendar", href: "/calendar" },
      { label: "Reference Data", href: "/admin/reference-data" },
    ],
  },
  "/system-mapping": {
    key: "system-mapping",
    title: "System Mapping",
    description:
      "Document which environments depend on each other, generate mapping from notes (AI), and analyse booking conflicts for a date range.",
    dataSource: "database",
    workflowStep: 4,
    tips: [
      "Set the analysis period to match your planned test window.",
      "Mapping risks appear when a required downstream env is already booked.",
      "Editors can add edges or generate mapping from free-text notes.",
    ],
    related: [
      { label: "Env Booking", href: "/booking" },
      { label: "Versions & Config", href: "/environments" },
    ],
  },
  "/environments": {
    key: "environments",
    title: "Versions & Config",
    description:
      "Environment desk: version matrix across apps, booking timeline, topology view, and AI briefing on promotion state — tied to Release Desk reference data.",
    dataSource: "both",
    tips: [
      "Compare PROD vs TEST versions before approving a release.",
      "Use topology to see service dependencies at a glance.",
      "Bookings here reflect live SQLite reservations.",
    ],
    related: [
      { label: "Env Booking", href: "/booking" },
      { label: "System Mapping", href: "/system-mapping" },
    ],
  },
  "/executive": {
    key: "executive",
    title: "Executive",
    description:
      "C-level portfolio view: team risk heatmap, releases at risk, ML ship/rollback forecasts, and AI executive summary — primarily demo portfolio data.",
    dataSource: "demo",
    tips: [
      "Best for stakeholder demos and exec readouts.",
      "Pair with Insights for trend context.",
      "DB releases appear on Dashboard and Inbox for live desk work.",
    ],
    related: [
      { label: "Insights", href: "/insights" },
      { label: "Compare", href: "/compare" },
    ],
  },
  "/compare": {
    key: "compare",
    title: "Compare Releases",
    description:
      "Side-by-side comparison of two demo releases: readiness, blockers, gates, ML forecasts — useful for good vs bad release storytelling.",
    dataSource: "demo",
    tips: [
      "Use URL params ?left= & ?right= to deep-link a comparison.",
      "Open from a demo release detail via Compare links.",
    ],
    related: [
      { label: "Executive", href: "/executive" },
      { label: "Demo releases", href: "/releases?view=demo" },
    ],
  },
  "/insights": {
    key: "insights",
    title: "Insights",
    description:
      "Org-wide analytics: predictive readiness model, risk trends, and AI interpretation of portfolio patterns — demo data with ML-style forecasts.",
    dataSource: "demo",
    tips: [
      "Risk Agent can interpret forecast charts on demand.",
      "Use for quarterly planning narratives, not daily desk actions.",
    ],
    related: [
      { label: "Executive", href: "/executive" },
      { label: "Agents", href: "/agents" },
    ],
  },
  "/knowledge-graph": {
    key: "knowledge-graph",
    title: "Knowledge Graph",
    description:
      "Interactive graph connecting releases, services, people, tickets, and change records. Optional ?release= focus for a single release neighbourhood.",
    dataSource: "demo",
    tips: [
      "Click nodes to navigate to related releases or services.",
      "Use from demo release detail via Knowledge Graph links.",
    ],
    related: [
      { label: "Ask", href: "/ask" },
      { label: "History Log", href: "/history" },
    ],
  },
  "/agents": {
    key: "agents",
    title: "Agent Control Room",
    description:
      "Overview of 13 AI agents (Risk, Build, Comms, Dependency, etc.). Pause agents globally and expand cards for live AI findings on the demo portfolio.",
    dataSource: "demo",
    tips: [
      "DB releases use the same agents inline (Risk on detail, Comms, Inbox briefing).",
      "Requires OPENAI_API_KEY or ANTHROPIC_API_KEY in .env.local.",
      "Pause agents during recordings if you want static demo behaviour.",
    ],
    related: [
      { label: "Morning Inbox", href: "/inbox" },
      { label: "Connectors", href: "/connectors" },
    ],
  },
  "/history": {
    key: "history",
    title: "History Log",
    description:
      "Audit timeline of Go/No-Go decisions, deployments, rollbacks, and agent actions — persisted in SQLite live-state for demo command center.",
    dataSource: "demo",
    tips: [
      "Filter with ?release=rel-* for a single demo release.",
      "DB releases have their own audit trail on the release detail page.",
    ],
    related: [
      { label: "Ask", href: "/ask" },
      { label: "Agents", href: "/agents" },
    ],
  },
  "/ask": {
    key: "ask",
    title: "Ask",
    description:
      "Search chat over documents indexed from Connectors (hybrid keyword and vector search). Conversation stays in this tab until you start a new chat. Does not use the knowledge graph.",
    dataSource: "none",
    tips: [
      "Answers only use what Connectors have already synced — a thin index yields a thin answer, not an error.",
      "Cited sources are the retrieved documents, when the engine returns them.",
      "Separate from the floating in-app assistant, which talks about Release Desk records rather than the search index.",
    ],
    related: [
      { label: "Connectors", href: "/connectors" },
      { label: "Knowledge Graph", href: "/knowledge-graph" },
    ],
  },
  "/admin-connectors": {
    key: "admin-connectors",
    title: "Admin Connectors",
    description:
      "Catalog of index sources. Add a source so Ask can search its documents. Status and delete stay on Connectors.",
    dataSource: "none",
    tips: [
      "Coming soon tiles cannot be created yet (sign-in, file upload, or XenForo).",
      "Search filters tiles by source name or id.",
      "Jira, GitHub, Teams, and Email use the same guided add as Connectors.",
      "Other sources list what they actually index before you set scope.",
      "Sources with no filter index the entire account the credentials can see.",
    ],
    related: [
      { label: "Connectors", href: "/connectors" },
      { label: "Ask", href: "/ask" },
    ],
  },
  "/connectors": {
    key: "connectors",
    title: "Connectors",
    description:
      "Integration hub: Jira, GitHub, Splunk, ServiceNow, etc. Shows connection status, last sync, and open connector issues surfaced to agents.",
    dataSource: "demo",
    tips: [
      "Jira work items on DB releases use seeded data until live sync is enabled.",
      "Filter with ?filter=issues for connectors needing attention.",
    ],
    related: [
      { label: "Ask", href: "/ask" },
      { label: "Admin Connectors", href: "/admin-connectors" },
      { label: "Reference Data", href: "/admin/reference-data" },
    ],
  },
  "/admin/reference-data": {
    key: "reference-data",
    title: "Reference Data",
    description:
      "Admin setup for departments, applications, and environments. Every dropdown in Booking, Releases, and Mapping reads from here.",
    dataSource: "config",
    workflowStep: 1,
    tips: [
      "Run npm run db:setup to reset demo reference data and releases.",
      "Admin role required to add or edit rows.",
      "Link each app to a department before booking envs.",
    ],
    related: [
      { label: "Env Booking", href: "/booking" },
      { label: "Releases", href: "/releases" },
    ],
  },
  "/settings": {
    key: "settings",
    title: "Settings",
    description:
      "Team roster and role labels for the demo. Production would connect to Entra ID / SSO.",
    dataSource: "none",
    tips: ["Sign in role (Admin/Editor/Read only) is chosen at login."],
    related: [{ label: "Sign in", href: "/sign-in" }],
  },
};

function releaseDetailGuide(pathname: string): PageGuideEntry {
  const isDemo = pathname.includes("rel-");
  return {
    key: isDemo ? "release-demo" : "release-db",
    title: isDemo ? "Demo Release Command Center" : "DB Release Command Center",
    description: isDemo
      ? "Full synthetic command center: gates, build, deploy, CAB, AI risk, and live Go/No-Go — for stakeholder demos."
      : "Live release desk view: lifecycle, AI risk analysis, blockers, readiness, Jira items, Go/No-Go, stakeholder comms, and audit trail.",
    dataSource: isDemo ? "demo" : "database",
    workflowStep: 2,
    tips: isDemo
      ? [
          "Go/No-Go and deployment persist via live-state API.",
          "Compare with related releases or open Dependencies for impact.",
        ]
      : [
          "Check AI risk analysis and predictive nudge at the top.",
          "Use Dependencies for slip impact on downstream releases.",
          "Draft stakeholder comms from live readiness and blockers.",
        ],
    related: [
      { label: "Dependencies", href: `${pathname}/dependencies` },
      { label: "Env Booking", href: "/booking" },
      { label: "All releases", href: "/releases" },
    ],
  };
}

const dependenciesGuide: PageGuideEntry = {
  key: "release-dependencies",
  title: "Dependency Map",
  description:
    "Visual graph of release dependencies, system mapping edges, and slip-impact analysis — who gets affected if this release moves.",
  dataSource: "database",
  tips: [
    "Review downstream releases before changing the target date.",
    "Shared env bookings in the next 14 days appear in impact summary.",
  ],
  related: [
    { label: "System Mapping", href: "/system-mapping" },
    { label: "Calendar", href: "/calendar" },
  ],
};

export function resolvePageGuide(pathname: string): PageGuideEntry | null {
  if (STATIC_GUIDES[pathname]) return STATIC_GUIDES[pathname];
  if (/^\/releases\/[^/]+\/dependencies$/.test(pathname)) return dependenciesGuide;
  if (/^\/releases\/[^/]+$/.test(pathname)) return releaseDetailGuide(pathname);
  return null;
}

export type GuideSection = {
  title?: string;
  items: { href: string; label: string; guide: PageGuideEntry }[];
};

export function allGuideSections(): GuideSection[] {
  const byHref = new Map<string, PageGuideEntry>();
  Object.entries(STATIC_GUIDES).forEach(([href, guide]) => byHref.set(href, guide));

  return NAV_SECTIONS.map((section) => ({
    title: section.title,
    items: section.items
      .map((item) => {
        const guide = byHref.get(item.href);
        return guide ? { href: item.href, label: item.label, guide } : null;
      })
      .filter(Boolean) as GuideSection["items"],
  }));
}

export const LOGIN_GUIDE: PageGuideEntry = {
  key: "login",
  title: "Sign in",
  description:
    "Demo login for Release Desk. Editors and Admins can create releases, book environments, and edit mapping. Default landing is Morning Inbox.",
  dataSource: "none",
  tips: [
    "Try priya@company.com as Editor — lands on Morning Inbox with realistic items.",
    "Use Admin for Reference Data setup.",
    "Press ⌘K after login for natural-language search.",
  ],
  related: [
    { label: "Morning Inbox", href: "/inbox" },
    { label: "Releases", href: "/releases" },
  ],
};

const DISMISS_KEY = "sentinel-help-dismissed";

export function loadDismissedHelp(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(DISMISS_KEY) ?? "{}") as Record<string, boolean>;
  } catch {
    return {};
  }
}

export function saveDismissedHelp(map: Record<string, boolean>) {
  if (typeof window !== "undefined") {
    localStorage.setItem(DISMISS_KEY, JSON.stringify(map));
  }
}

export function restoreAllPageHelp() {
  if (typeof window !== "undefined") {
    localStorage.removeItem(DISMISS_KEY);
  }
}
