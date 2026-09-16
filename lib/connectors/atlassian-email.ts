/**
 * Shared Atlassian account-email shape for Jira and Bitbucket Check fields.
 * Does not prove the account exists.
 */

/** True for a non-empty email shape. Does not prove the Atlassian account exists. */
export function looksLikeAtlassianEmail(email: string): boolean {
  const trimmed = email.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}
