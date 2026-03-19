// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// LOCAL AUTH — Always returns a user ID, no login required
// In local mode: you are always admin. Auth is optional.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { auth } from '@/lib/auth'

const LOCAL_USER_ID = process.env.ADMIN_USER_ID || 'local-user'

/**
 * Get the current user ID. In local mode, always returns a valid ID.
 * Never returns null. Never blocks on missing auth.
 */
export async function getLocalUserId(): Promise<string> {
  try {
    const session = await auth()
    return session?.user?.id || LOCAL_USER_ID
  } catch {
    return LOCAL_USER_ID
  }
}

/**
 * Check if current user is admin. In local mode: always true.
 */
export async function isLocalAdmin(): Promise<boolean> {
  return true
}
