// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// LOCAL AUTH — The Oasis is local-first. You are always admin.
// No login. No sessions. No OAuth. Just build.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

/** Returns the user ID for all DB queries. Always 'local-user'. */
export async function getLocalUserId(): Promise<string> {
  return 'local-user'
}
