// LOCAL AUTH - identity for DB queries.
//
// Local mode is the single-user cloneable app, so DB ownership stays on
// `local-user` even when the browser carries an old viewer cookie. Hosted mode
// uses the viewer cookie until real auth replaces it.

import { isHostedOasis } from './oasis-profile'
import { getViewerUserId, VIEWER_FALLBACK } from './viewer-identity'

/** Returns the user ID for DB queries. Hosted reads the cookie; local stays local-user. */
export async function getLocalUserId(): Promise<string> {
  return isHostedOasis() ? getViewerUserId() : VIEWER_FALLBACK
}
