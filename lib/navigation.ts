/**
 * Product sidebar — icons for UI; href/label/section live in lib/nav-data.ts
 * (shared with the voice navigation agent).
 */
import type { LucideIcon } from "lucide-react";
import {
  LayoutGrid,
  LayoutDashboard,
  Package,
  Calendar,
  History,
  Plug,
  Settings,
  Bot,
  LineChart,
  Briefcase,
  Share2,
  Columns2,
  Server,
  CalendarCheck,
  GitBranch,
  Workflow,
  Database,
  Inbox,
  AlertTriangle,
  GitCompareArrows,
  ClipboardCheck,
  CalendarOff,
  Network,
  AlertOctagon,
  Ban,
  Building2,
  UserCircle,
  Bell,
  HeartPulse,
  CalendarClock,
  MessageSquare,
  Mic,
  Stamp,
} from "lucide-react";
import { NAV_DATA_SECTIONS, type NavDataItem } from "@/lib/nav-data";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  pulse?: boolean;
};

export type NavSection = {
  title?: string;
  items: NavItem[];
};

/** Icons keyed by href — only place that maps routes to Lucide icons. */
const NAV_ICONS: Readonly<Record<string, LucideIcon>> = {
  "/inbox": Inbox,
  "/dashboard": LayoutDashboard,
  "/releases": Package,
  "/calendar": Calendar,
  "/booking": CalendarCheck,
  "/dependencies": Network,
  "/conflicts": AlertOctagon,
  "/blockers": Ban,
  "/system-mapping": GitBranch,
  "/integration-flows": Workflow,
  "/environments": Server,
  "/risks": AlertTriangle,
  "/drifts": GitCompareArrows,
  "/approvals": ClipboardCheck,
  "/signoffs": Stamp,
  "/leaves": CalendarOff,
  "/monitoring-alerts": Bell,
  "/incidents": AlertOctagon,
  "/application-status": HeartPulse,
  "/planned-maintenance": CalendarClock,
  "/executive": Briefcase,
  "/compare": Columns2,
  "/insights": LineChart,
  "/departments": Building2,
  "/applications": Package,
  "/users": UserCircle,
  "/risk-factors": AlertTriangle,
  "/lifecycle": GitBranch,
  "/knowledge-graph": Share2,
  "/agents": Bot,
  "/history": History,
  "/ask": MessageSquare,
  "/connectors": Plug,
  "/admin-connectors": LayoutGrid,
  "/admin/reference-data": Database,
  "/admin-voice": Mic,
  "/settings": Settings,
};

function withIcon(item: NavDataItem): NavItem {
  const icon = NAV_ICONS[item.href] ?? Settings;
  return {
    href: item.href,
    label: item.label,
    icon,
    ...(item.pulse ? { pulse: true } : {}),
  };
}

export const NAV_SECTIONS: NavSection[] = NAV_DATA_SECTIONS.map((section) => ({
  title: section.title,
  items: section.items.map(withIcon),
}));

export const NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((section) => section.items);
