
"use client";

import type { ReactNode } from "react";

/**
 * Table prefs are fetched on demand by the mounted list page.
 * Prefetching every pageKey on app load stampeded the Neon pool (~22 parallel
 * Clerk+DB requests) and made dashboard/live-state wait 50s+.
 */
export function ColumnPreferencesProvider({ children }: { children: ReactNode }) {
  return children;
}
