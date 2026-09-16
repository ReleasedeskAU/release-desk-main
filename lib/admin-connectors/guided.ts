import type { ConnectorTypeId } from "@/lib/connectors/types";
import { isStafflessConnectorType } from "@/lib/staffless/create-payload";

/**
 * Jira, GitHub, GitLab, Bitbucket, Teams, IMAP, or Slack when this catalog tile should open the
 * Connectors guided wizard (live pickers, Check fields, POST /api/connectors).
 */
export function guidedConnectorType(sourceId: string): ConnectorTypeId | null {
  if (!isStafflessConnectorType(sourceId)) return null;
  const id = sourceId.trim().toLowerCase();
  if (
    id === "jira" ||
    id === "github" ||
    id === "gitlab" ||
    id === "bitbucket" ||
    id === "teams" ||
    id === "imap" ||
    id === "slack"
  ) {
    return id;
  }
  return null;
}

/**
 * True when this catalog tile uses the Connectors guided wizard.
 */
export function usesGuidedOnboarding(sourceId: string): boolean {
  return guidedConnectorType(sourceId) != null;
}
