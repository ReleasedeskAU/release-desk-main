/**
 * User-facing Ask copy. Infrastructure failures use ASK_PUBLIC_UNAVAILABLE —
 * never raw exceptions, stack traces, or vendor internals.
 */

export const ASK_PUBLIC_UNAVAILABLE =
  "I couldn't complete that lookup just now. I can give exact counts and breakdowns from the index, list matching documents (key, title, link), list values like assignees or statuses, look up a document by its key, or search indexed documents — try one of those.";

export const ASK_TOOL_FAILURE_HINT =
  "This lookup failed. Tell the user you could not complete that specific request. Offer exact counts, breakdowns by field, listing matching documents, listing values, looking up a document by key, or searching indexed documents. Do not guess numbers or invent documents.";

/** Zod rejected the tool JSON. Retry — do not treat this as a missing ticket. */
export const ASK_INVALID_ARGS_HINT =
  "Retry with published arguments: filter_field and filter_value, or filters[{filter_field, filter_value}]. Child tickets of a key: filter_field=parent, filter_value=<parent key>. Do not pass parent= as its own argument. Do not tell the user the lookup failed until a correctly shaped call also fails.";

/** Missing document_id on get_document_content. Retry — do not offer counts. */
export const ASK_DOCUMENT_CONTENT_ARGS_HINT =
  "Retry get_document_content with only document_id copied from search_indexed_documents or list_documents_matching. Do not pass title, link, or extra keys. Do not tell the user the lookup failed until that retry also fails.";

/** StaffLess body fetch failed. Do not pivot a replies/description question to counts. */
export const ASK_DOCUMENT_CONTENT_FAILURE_HINT =
  "Body lookup failed. Retry once with the exact document_id from search or list (not title, not link). If it fails again, quote any blurb you already have for that thread and say the full body could not be loaded. Do not offer counts or breakdowns for a description or replies question.";

export const ASK_NO_TOOL_HINT =
  "If no tool can answer the question, say clearly what they asked for that you cannot do, then offer the closest thing that is possible: exact counts, breakdowns by field, listing matching documents, listing values, looking up a document by key, or searching indexed content. Do not invent an answer.";
