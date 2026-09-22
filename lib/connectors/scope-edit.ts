/**
 * Whether an edit changed the indexed scope enough to require a full re-index.
 * Order does not matter. "All projects / all repos" is its own scope.
 */

export type ScopeSnapshot = {
  keys: string[];
  all?: boolean;
};

function normalized(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

/**
 * Compare two scope selections.
 * @param saved - Scope currently stored on the connector.
 * @param next - Scope the wizard will save.
 * @returns True when the indexed set would change.
 */
export function selectionChanged(saved: ScopeSnapshot, next: ScopeSnapshot): boolean {
  if (Boolean(saved.all) !== Boolean(next.all)) return true;
  if (saved.all && next.all) return false;
  const left = normalized(saved.keys);
  const right = normalized(next.keys);
  return left.length !== right.length || left.some((value, index) => value !== right[index]);
}

/**
 * Split a comma-separated team-name field into comparable names.
 * @param value - Wizard "Team names" text.
 * @returns Trimmed names.
 */
export function commaNames(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}
