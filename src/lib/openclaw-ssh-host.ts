export interface OpenclawSshHostValidation {
  value: string
  valid: boolean
  reason: '' | 'relay_url' | 'local_loopback' | 'contains_spaces' | 'path_or_query'
}

export function sanitizeOpenclawSshHost(input: unknown): OpenclawSshHostValidation {
  const value = typeof input === 'string' ? input.trim() : ''
  if (!value) return { value: '', valid: true, reason: '' }

  const lower = value.toLowerCase()
  if (lower.includes('://')) {
    return { value: '', valid: false, reason: 'relay_url' }
  }
  if (/\s/.test(value)) {
    return { value: '', valid: false, reason: 'contains_spaces' }
  }
  if (/[/?\\]/.test(value)) {
    return { value: '', valid: false, reason: 'path_or_query' }
  }

  const hostPart = value.includes('@') ? value.slice(value.lastIndexOf('@') + 1) : value
  const normalizedHost = hostPart.replace(/^\[/, '').replace(/\](:\d+)?$/, '').replace(/:\d+$/, '').toLowerCase()
  if (
    normalizedHost === 'localhost' ||
    normalizedHost === '127.0.0.1' ||
    normalizedHost === '::1' ||
    normalizedHost === '0.0.0.0'
  ) {
    return { value: '', valid: false, reason: 'local_loopback' }
  }

  return { value, valid: true, reason: '' }
}

export function describeOpenclawSshHostIssue(reason: OpenclawSshHostValidation['reason']): string {
  switch (reason) {
    case 'relay_url':
      return 'That looks like a relay URL. Paste it into the bridge command, not SSH host.'
    case 'local_loopback':
      return 'Local OpenClaw does not need an SSH host. Leave this blank.'
    case 'contains_spaces':
      return 'SSH host must be one alias or user@host, with no spaces.'
    case 'path_or_query':
      return 'SSH host should be only an alias or user@host, not a URL/path.'
    default:
      return ''
  }
}
