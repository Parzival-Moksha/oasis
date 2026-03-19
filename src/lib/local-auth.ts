// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// LOCAL AUTH — The Oasis is local-first. You are always admin.
// No login. No sessions. No OAuth. Just build.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

/** Always returns 'local-user'. The Oasis has one user: you. */
export async function getLocalUserId(): Promise<string> {
  return 'local-user'
}

/** Always true. You are admin. */
export async function isLocalAdmin(): Promise<boolean> {
  return true
}
