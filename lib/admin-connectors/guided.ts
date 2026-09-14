import type { ConnectorTypeId } from "@/lib/connectors/types";
import { isStafflessConnectorType } from "@/lib/staffless/create-payload";

/**
 * Jira, GitHub, Teams, or IMAP when this catalog tile should open the
 * Connectors guided wizard (live pickers, Check fields, POST /api/connectors).
 */
export function guidedConnectorType(sourceId: string): ConnectorTypeId | null {
  if (!isStafflessConnectorType(sourceId)) return null;
  const id = sourceId.trim().toLowerCase();
  if (id === "jira" || id === "github" || id === "teams" || id === "imap") return id;
  return null;
}

/**
 * True when this catalog tile uses the Connectors guided wizard.
 */
export function usesGuidedOnboarding(sourceId: string): boolean {
  return guidedConnectorType(sourceId) != null;
}
