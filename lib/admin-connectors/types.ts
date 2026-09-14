/**
 * Catalog types for Admin Connectors (engine source onboarding).
 * Field names match the index engine so create can pass them through.
 */

export type CatalogFieldType = "text" | "password" | "number" | "checkbox" | "list" | "select";

export type CatalogField = {
  name: string;
  label: string;
  type: CatalogFieldType;
  optional?: boolean;
  secret?: boolean;
  help?: string;
  default?: string | number | boolean;
  options?: { value: string; label: string }[];
  /** When false, the field is shown but not sent to the index engine. */
  passToEngine?: boolean;
};

export type ComingSoonReason = "oauth" | "upload" | "xenforo";

export type SourceCategory =
  | "wiki"
  | "storage"
  | "ticketing"
  | "messaging"
  | "sales"
  | "code"
  | "other";

export type AdminConnectorSource = {
  id: string;
  label: string;
  category: SourceCategory;
  inputType: "poll" | "load_state";
  comingSoon?: ComingSoonReason;
  credentialFields: CatalogField[];
  configFields: CatalogField[];
};

export const SOURCE_CATEGORIES: { id: SourceCategory; label: string }[] = [
  { id: "wiki", label: "Wiki" },
  { id: "storage", label: "Storage" },
  { id: "ticketing", label: "Tickets and tasks" },
  { id: "messaging", label: "Messaging and email" },
  { id: "sales", label: "Sales" },
  { id: "code", label: "Code" },
  { id: "other", label: "Other" },
];

export const COMING_SOON_COPY: Record<ComingSoonReason, string> = {
  oauth: "Sign-in for this source is not available yet.",
  upload: "File upload is not available yet.",
  xenforo: "This source cannot be added yet.",
};

export const FULL_ACCOUNT_WARNING =
  "This source has no project, folder, or channel filter. Connecting it indexes the entire account the credentials can see.";

/**
 * True when the source form has no scope fields (empty "What to index" step).
 */
export function warnsFullAccount(source: AdminConnectorSource): boolean {
  return source.configFields.length === 0;
}

/**
 * True when the wizard may create this source in Phase 1.
 */
export function isCatalogSourceReady(source: AdminConnectorSource): boolean {
  return source.comingSoon == null;
}
