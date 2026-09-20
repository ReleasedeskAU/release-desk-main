import { StatusBadge } from "@/components/badges/StatusBadge";
import { ASK_GROUNDING_INDEX, ASK_GROUNDING_INDEX_HINT, ASK_GROUNDING_SEARCH } from "@/lib/staffless/ask-copy";
import type { AskGrounding } from "@/lib/staffless/ask-grounding";
import { statusTokens } from "@/lib/palette";
import { cn } from "@/lib/utils";

/**
 * Subtle trust chip for an Ask answer. Catalog lookups are "From index", not live-system truth.
 */
export function AskGroundingBadge({ kind }: { kind: AskGrounding }) {
  if (kind === "verified") return <IndexChip />;
  if (kind === "search") return <SearchChip />;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <IndexChip />
      <SearchChip />
    </span>
  );
}

function IndexChip() {
  const token = statusTokens.Verified;
  return (
    <span
      title={ASK_GROUNDING_INDEX_HINT}
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-theme-xs font-medium",
        token.bg,
        token.text
      )}
    >
      {ASK_GROUNDING_INDEX}
    </span>
  );
}

function SearchChip() {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-theme-xs font-medium",
        "bg-gray-100 text-gray-600"
      )}
    >
      {ASK_GROUNDING_SEARCH}
    </span>
  );
}
