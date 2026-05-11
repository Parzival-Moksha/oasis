// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// LOCAL AUTH — Identity for DB queries
// ─═̷─═̷─🔑─═̷─═̷─ Cookie-backed in v1; OAuth migration is v2 ─═̷─═̷─🔑─═̷─═̷─
//
// Local dev: cookie is rarely set, so callers get 'local-user' (legacy
// behavior). Hosted: every browser gets a stable `oasis-viewer-id` cookie
// once they hit /api/viewer/me (or any route that calls ensureViewerUserId),
// and that cookie becomes the userId for asset/world ownership.
//
// Function name stays getLocalUserId() so the 60+ call sites don't churn.
// Treat it as "the current viewer's stable id" from now on.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { getViewerUserId } from './viewer-identity'

/** Returns the user ID for all DB queries. Reads the browser cookie if
 *  present, falls back to 'local-user' otherwise. */
export async function getLocalUserId(): Promise<string> {
  return getViewerUserId()
}
