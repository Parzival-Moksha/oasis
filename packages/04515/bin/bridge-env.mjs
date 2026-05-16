export function envValue(name, fallback = '') {
  const value = globalThis.process?.env?.[name]
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

export function firstEnvValue(names, fallback = '') {
  for (const name of names) {
    const value = envValue(name)
    if (value) return value
  }
  return fallback
}

export function envFlag(name) {
  return envValue(name) === '1'
}
