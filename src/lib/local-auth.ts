// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// LOCAL AUTH — The Oasis is local-first. You are always admin.
// No login. No sessions. No OAuth. Just build.
//
// Returns ADMIN_USER_ID from .env if set (preserves backward compat with
// existing SQLite data created under the old Google OAuth ID).
// Falls back to 'local-user' for fresh installs.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

/** Returns the user ID for all DB queries. Reads .env for backward compat. */
export async function getLocalUserId(): Promise<string> {
  return process.env.ADMIN_USER_ID || 'local-user'
}

