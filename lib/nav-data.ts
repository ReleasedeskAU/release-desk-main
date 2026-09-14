/**
 * Icon-free product sidebar inventory — single source of truth for href/label/section.
 * UI (`lib/navigation.ts`) attaches icons; voice nav-agent reads this directly so the
 * Live client chunk does not pull lucide-react.
 */

export type NavDataItem = {
  href: string;
  label: string;
  /** When true, sidebar may pulse the item (UI-only hint). */
  pulse?: boolean;
};

export type NavDataSection = {
  title?: string;
  items: readonly NavDataItem[];
};

/**
 * Canonical sidebar sections. Adding a tab here is enough for the UI and for
 * the voice navigation agent (no second hardcoded voice route list).
 */
export const NAV_DATA_SECTIONS: readonly NavDataSection[] = [
  {
    items: [
      { href: "/inbox", label: "Morning Inbox", pulse: true },
      { href: "/ask", label: "Ask" },
      { href: "/dashboard", label: "Dashboard" },
    ],
  },
  {
    title: "Release Desk",
    items: [
      { href: "/releases", label: "Releases" },
      { href: "/calendar", label: "Calendar" },
      { href: "/booking", label: "Env Booking" },
      { href: "/dependencies", label: "Dependencies" },
      { href: "/conflicts", label: "Conflicts" },
      { href: "/blockers", label: "Blockers" },
      { href: "/system-mapping", label: "System Mapping" },
      { href: "/integration-flows", label: "Integration Flows" },
      { href: "/environments", label: "Versions & Config" },
    ],
  },
  {
    title: "Governance",
    items: [
      { href: "/risks", label: "Risk" },
      { href: "/drifts", label: "Drift Dashboard" },
      { href: "/approvals", label: "Approval Queue" },
      { href: "/signoffs", label: "Sign-offs" },
      { href: "/leaves", label: "Leave Calendar" },
    ],
  },
  {
    title: "Monitoring",
    items: [
      { href: "/monitoring-alerts", label: "Monitoring Alerts" },
      { href: "/incidents", label: "Incidents" },
      { href: "/application-status", label: "Application Status" },
      { href: "/planned-maintenance", label: "Planned Maintenance" },
    ],
  },
  {
    title: "Portfolio",
    items: [
      { href: "/executive", label: "Executive" },
      { href: "/compare", label: "Compare" },
      { href: "/insights", label: "Insights" },
    ],
  },
  {
    title: "Master Data",
    items: [
      { href: "/departments", label: "Departments" },
      { href: "/applications", label: "Applications" },
      { href: "/users", label: "Users" },
      { href: "/risk-factors", label: "Risk Factors" },
    ],
  },
  {
    title: "Lifecycle",
    items: [{ href: "/lifecycle", label: "Lifecycle Settings" }],
  },
  {
    title: "Operations",
    items: [
      { href: "/knowledge-graph", label: "Knowledge Graph" },
      { href: "/agents", label: "Agents", pulse: true },
      { href: "/history", label: "History Log" },
      { href: "/connectors", label: "Connectors" },
      { href: "/admin-connectors", label: "Admin Connectors" },
      { href: "/admin/reference-data", label: "Reference Data" },
      { href: "/admin-voice", label: "Voice Admin" },
      { href: "/settings", label: "Settings" },
    ],
  },
];

/** Flat list of all sidebar items (order preserved). */
export const NAV_DATA_ITEMS: readonly NavDataItem[] = NAV_DATA_SECTIONS.flatMap(
  (section) => [...section.items]
);
