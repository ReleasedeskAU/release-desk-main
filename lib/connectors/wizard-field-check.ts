/**
 * Client-safe Check fields required-field messages. Does not call vendors or log credentials.
 */

/** Must stay identical to SLACK_TOKEN_REQUIRED in lib/slack/probe.ts. */
const SLACK_BOT_TOKEN_REQUIRED_MESSAGE = "Enter a Slack bot token.";

export type WizardFieldCheckError = {
  ok: false;
  message: string;
};

/**
 * Named error when Check fields is clicked with blank required wizard fields.
 * Slack empty name+token must name both — never a silent no-op.
 */
export function localWizardFieldCheckError(input: {
  type: string;
  name: string;
  credentials: Record<string, string>;
}): WizardFieldCheckError | null {
  const type = input.type.trim().toLowerCase();
  const name = input.name.trim();
  const token = (input.credentials.token ?? "").trim();
  if (type === "slack") {
    if (!name && !token) {
      return { ok: false, message: "Enter a display name and a Slack bot token." };
    }
    if (!token) return { ok: false, message: SLACK_BOT_TOKEN_REQUIRED_MESSAGE };
    if (!name) return { ok: false, message: "Enter a display name." };
    return null;
  }
  if (!name) return { ok: false, message: "Enter a display name." };
  return null;
}
