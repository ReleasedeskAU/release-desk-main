/**
 * What each engine connector actually indexes. Points match the connector
 * implementation, not the vendor's full API.
 */

export type FetchSummary = {
  fetches: string[];
  skips: string[];
};

const FETCH_SUMMARIES: Record<string, FetchSummary> = {
  web: {
    fetches: ["Page HTML (cleaned text)", "PDF text when linked", "Recursive, single-page, or sitemap crawl"],
    skips: ["Login-walled pages", "Incremental date filter"],
  },
  lumapps: {
    fetches: ["Live pages (title and body)", "Metadata families", "Author email"],
    skips: ["Per-document access lists", "Attachments as separate files"],
  },
  github: {
    fetches: ["Pull request title and description", "Issue title and description", "Labels, state, assignees, merge info", "Optional text files from a branch"],
    skips: ["Issue and PR comments", "Review comments and reviews", "Diffs"],
  },
  testrail: {
    fetches: ["Test cases (title, steps, expected results)", "Preconditions", "Mapped custom fields"],
    skips: ["Runs, plans, and milestones", "Most unmapped custom fields"],
  },
  gitlab: {
    fetches: ["Merge request descriptions", "Issue descriptions"],
    skips: ["MR and issue comments", "Code files unless enabled on the server"],
  },
  bitbucket: {
    fetches: [
      "Pull request description and metadata (open, merged, declined)",
      "Repository name, description, language, and default branch",
      "README on the default branch",
      "Commit messages on the default branch (in the sync window)",
    ],
    skips: ["PR comments", "Commit diffs and source files", "Issues, wiki, and other branches"],
  },
  gitbook: {
    fetches: ["Pages in a space", "Page body as text"],
    skips: ["Other spaces", "Link-only / group pages"],
  },
  google_drive: {
    fetches: ["Docs, sheets, slides, and extractable files", "Owners and folder hierarchy"],
    skips: ["Drive comments", "Images unless enabled"],
  },
  gmail: {
    fetches: ["Thread and message plain-text bodies", "From / to as owners"],
    skips: ["Attachments", "Label picker in this form"],
  },
  bookstack: {
    fetches: ["Books, chapters, and shelves (name and description)", "Full page HTML"],
    skips: ["Scope to one book — indexes the whole instance"],
  },
  outline: {
    fetches: ["Documents (title and body)", "Collection titles and descriptions"],
    skips: ["Attachments", "Comments"],
  },
  confluence: {
    fetches: ["Pages (HTML body)", "Comments", "Optional attachments"],
    skips: ["CQL time filters (conflicts with sync window)"],
  },
  jira: {
    fetches: ["Issue summary and description", "Comments", "Standard fields (status, assignee, labels, parent, links)", "Last updater and prior statuses"],
    skips: ["Custom fields", "Attachments", "Worklogs, sprint, and story points"],
  },
  salesforce: {
    fetches: ["Chosen objects (or Account by default)", "Configured child records", "Optional custom field JSON"],
    skips: ["Attachments", "Chatter"],
  },
  sharepoint: {
    fetches: ["Library files (extracted text)", "Site pages (ASPX)", "Optional images and tables"],
    skips: ["List items", "Page comments"],
  },
  teams: {
    fetches: ["Channel thread text", "Authors as owners", "Channel access"],
    skips: ["Team / channel / author tags on the document", "Attachments and reactions", "1:1 chats"],
  },
  discourse: {
    fetches: ["Topics and full thread posts"],
    skips: ["Categories not listed by display name"],
  },
  drupal_wiki: {
    fetches: ["Wiki page HTML", "Optional attachments"],
    skips: ["Spaces you do not list (when IDs are set)"],
  },
  axero: {
    fetches: ["Articles, blogs, and wikis (HTML)", "Forum posts"],
    skips: ["Content-type toggles — all types are on"],
  },
  productboard: {
    fetches: ["Products, components, features, and objectives", "Name, description, owner, status"],
    skips: ["Notes, comments, and releases"],
  },
  slack: {
    fetches: ["Channel threads (message text)", "Channel name and access"],
    skips: ["File uploads", "Reactions", "Non-text blocks"],
  },
  slab: {
    fetches: ["Posts (title and body text)"],
    skips: ["Collection / topic filter"],
  },
  guru: {
    fetches: ["Knowledge cards (HTML body)", "Tags and collection names"],
    skips: ["Comments and attachments", "Collection picker — whole workspace"],
  },
  gong: {
    fetches: ["Call transcripts", "Call metadata and purpose"],
    skips: ["Calls still processing"],
  },
  loopio: {
    fetches: ["Library answers and related questions", "Topic and owners"],
    skips: ["Attachments"],
  },
  file: {
    fetches: ["Uploaded files (text, tables, images)"],
    skips: ["Live folders — only what you upload"],
  },
  zulip: {
    fetches: ["Public stream messages", "Sender, stream, and topic"],
    skips: ["Private streams and DMs unless the bot can see them"],
  },
  coda: {
    fetches: ["Doc pages", "Table rows"],
    skips: ["Workspace / doc picker — every accessible doc"],
  },
  notion: {
    fetches: ["Pages the integration can see", "Block text and database rows"],
    skips: ["File / PDF blocks", "Some unsupported block types"],
  },
  hubspot: {
    fetches: ["Tickets, companies, deals, and contacts (fixed fields)", "Associated objects and notes"],
    skips: ["Custom properties", "Marketing objects"],
  },
  document360: {
    fetches: ["Help articles (HTML, English)", "Category tree"],
    skips: ["Other languages", "Category description pages"],
  },
  clickup: {
    fetches: ["Tasks (description and status)", "Optional task comments"],
    skips: ["Docs and whiteboards"],
  },
  google_sites: {
    fetches: ["Published pages from an uploaded ZIP"],
    skips: ["Live Sites API", "Embeds and attachments"],
  },
  zendesk: {
    fetches: ["Help Center articles, or tickets with all comments", "Labels, status, and tags"],
    skips: ["Drafts", "The other content type you did not pick"],
  },
  linear: {
    fetches: ["Issues (description)", "All comment bodies", "Team and state"],
    skips: ["Projects, docs, and cycles"],
  },
  box: {
    fetches: ["Files under chosen folders (or root)", "Extracted text"],
    skips: ["Unsupported or oversized files"],
  },
  dropbox: {
    fetches: ["Files from the linked account root", "Extracted text"],
    skips: ["Folder picker — whole linked Dropbox"],
  },
  s3: {
    fetches: ["Objects under the bucket prefix", "Extracted text"],
    skips: ["Oversized objects", "Images unless enabled"],
  },
  r2: {
    fetches: ["Objects under the bucket prefix", "Extracted text"],
    skips: ["Oversized objects", "Images unless enabled"],
  },
  google_cloud_storage: {
    fetches: ["Objects under the bucket prefix", "Extracted text"],
    skips: ["Oversized objects"],
  },
  oci_storage: {
    fetches: ["Objects under the bucket prefix", "Extracted text"],
    skips: ["Oversized objects"],
  },
  wikipedia: {
    fetches: ["Article text by section", "Categories and last-edit time"],
    skips: ["Talk pages, history, and files"],
  },
  xenforo: {
    fetches: ["Public thread posts (text, author, time)"],
    skips: ["Private / logged-in forums"],
  },
  asana: {
    fetches: ["Tasks (notes)", "Stories / comments"],
    skips: ["Attachments", "Subtasks"],
  },
  mediawiki: {
    fetches: ["Page wikitext by section", "Categories"],
    skips: ["File and image upload pages"],
  },
  discord: {
    fetches: ["Text messages in allowed channels and threads"],
    skips: ["Attachments, embeds, and reactions"],
  },
  freshdesk: {
    fetches: ["Ticket description and ticket fields"],
    skips: ["Conversations and replies"],
  },
  fireflies: {
    fetches: ["Meeting transcripts (speaker sections)"],
    skips: ["Meetings with no transcript sentences"],
  },
  braintrust: {
    fetches: ["Prompts", "Dataset rows", "Experiment summaries and recent rows"],
    skips: ["Some object types outside prompts / datasets / experiments"],
  },
  canvas: {
    fetches: ["Published pages, assignments, and announcements"],
    skips: ["Unpublished items", "Files, discussions, and quizzes", "Course picker — every visible course"],
  },
  egnyte: {
    fetches: ["Files under the optional folder path", "Extracted text"],
    skips: ["Images"],
  },
  airtable: {
    fetches: ["Table records as text", "Attachments (extracted text)"],
    skips: ["Linked-record fields"],
  },
  highspot: {
    fetches: ["Spot items (title and description)", "Downloadable document text"],
    skips: ["Unsupported binaries"],
  },
  imap: {
    fetches: ["Message subject and first body part", "Sender and recipients"],
    skips: ["Attachments", "Mailbox name tags on the document"],
  },
};

const EMPTY: FetchSummary = { fetches: ["Indexed documents from this source"], skips: [] };

/**
 * Fetch/skip bullets for a catalog source.
 */
export function getFetchSummary(sourceId: string): FetchSummary {
  return FETCH_SUMMARIES[sourceId] ?? EMPTY;
}

/**
 * True when this source has a dedicated fetch summary.
 */
export function hasFetchSummary(sourceId: string): boolean {
  return Object.prototype.hasOwnProperty.call(FETCH_SUMMARIES, sourceId);
}
