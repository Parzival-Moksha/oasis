// Breadcrumbs for the folder browser (FolderBrowser.tsx): client-safe, no node imports.

/** Breadcrumb pieces of a Windows or POSIX path, each with the path up to it. */
export function pathCrumbs(dir: string): Array<{ label: string; path: string }> {
  if (!dir) return []
  const windows = /^[a-zA-Z]:[\\/]/.test(dir) || dir.includes('\\')
  const sep = windows ? '\\' : '/'
  const parts = dir.split(/[\\/]+/).filter(Boolean)
  const crumbs: Array<{ label: string; path: string }> = []
  let acc = windows ? '' : '/'
  if (!windows) crumbs.push({ label: '/', path: '/' })
  parts.forEach((part, index) => {
    acc = windows ? (index === 0 ? `${part}${sep}` : `${acc}${acc.endsWith(sep) ? '' : sep}${part}`) : `${acc}${acc.endsWith('/') ? '' : '/'}${part}`
    crumbs.push({ label: part, path: acc })
  })
  return crumbs
}
