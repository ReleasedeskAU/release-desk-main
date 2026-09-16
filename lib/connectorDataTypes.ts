export type ConnectorDataTypeOption = {
  value: string;
  label: string;
  default: boolean;
  fixed?: boolean;
};

/** Only GitHub PRs/Issues/Documents map to StaffLess fields. Other sources index a fixed document set. */
export const CONNECTOR_DATA_TYPES: Record<string, ConnectorDataTypeOption[]> = {
  github: [
    { value: "pull_requests", label: "Pull Requests", default: true },
    { value: "issues", label: "Issues", default: true },
    {
      value: "repository_overview",
      label: "Repository overview (README, description, counts)",
      default: true,
    },
    {
      value: "commits",
      label: "Commits (message, files touched, line stats — all branches)",
      default: true,
    },
    {
      value: "files",
      label: "Documents (markdown / README — not source code)",
      default: false,
    },
  ],
  gitlab: [
    { value: "pull_requests", label: "Merge requests", default: true },
    { value: "issues", label: "Issues", default: true },
    {
      value: "repository_overview",
      label: "Project overview (README, description)",
      default: true,
    },
    {
      value: "commits",
      label: "Commits (message on the default branch)",
      default: true,
    },
  ],
  bitbucket: [
    { value: "pull_requests", label: "Pull requests", default: true },
    {
      value: "repository_overview",
      label: "Repository overview (README, description)",
      default: true,
    },
    {
      value: "commits",
      label: "Commits (message on the default branch)",
      default: true,
    },
  ],
};

export function defaultDataTypesForType(type: string): string[] {
  const options = CONNECTOR_DATA_TYPES[type] ?? [];
  const selected = options.filter((o) => o.default || o.fixed).map((o) => o.value);
  return selected.length > 0 ? selected : options.map((o) => o.value);
}

export function normalizeDataTypes(type: string, dataTypes: string[] | undefined): string[] {
  const valid = new Set((CONNECTOR_DATA_TYPES[type] ?? []).map((o) => o.value));
  const filtered = (dataTypes ?? []).filter((d) => valid.has(d));
  if (filtered.length > 0) return filtered;
  return defaultDataTypesForType(type);
}

export function dataTypesFromConfig(
  type: string,
  config: Record<string, unknown> | null | undefined
): string[] {
  const raw = config?.dataTypes;
  if (Array.isArray(raw)) {
    return normalizeDataTypes(
      type,
      raw.filter((v): v is string => typeof v === "string")
    );
  }
  return defaultDataTypesForType(type);
}
