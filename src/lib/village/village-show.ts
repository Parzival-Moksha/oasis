// ░▒▓ VILLAGE SHOW — which session the page was opened for (/oasis in Claude Code adds ?session=<id>) ▓▒░

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The session id in a page URL's query string (`?session=<uuid>`), or null. */
export function sessionToShow(search: string): string | null {
  const value = new URLSearchParams(search).get('session')
  return value && SESSION_ID.test(value) ? value.toLowerCase() : null
}

/** The same query string without `session`, so a reload doesn't walk the camera again. '' when nothing is left. */
export function withoutSession(search: string): string {
  const params = new URLSearchParams(search)
  params.delete('session')
  const rest = params.toString()
  return rest ? `?${rest}` : ''
}
