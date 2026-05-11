// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// Library permissions — local-first only allows asset-library mutations.
// Deployed/production builds are read-only. Override with
// NEXT_PUBLIC_OASIS_ALLOW_LIBRARY_DELETE=1 (e.g. admin dashboard builds).
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

export function canMutateLibrary(): boolean {
  if (process.env.NEXT_PUBLIC_OASIS_ALLOW_LIBRARY_DELETE === '1') return true
  return process.env.NODE_ENV !== 'production'
}
