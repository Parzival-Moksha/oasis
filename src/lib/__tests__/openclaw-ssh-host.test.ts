import { describe, expect, it } from 'vitest'

import {
  describeOpenclawSshHostIssue,
  sanitizeOpenclawSshHost,
} from '../openclaw-ssh-host'

describe('sanitizeOpenclawSshHost', () => {
  it('keeps normal aliases and user hosts', () => {
    expect(sanitizeOpenclawSshHost('parzival-us')).toEqual({ value: 'parzival-us', valid: true, reason: '' })
    expect(sanitizeOpenclawSshHost(' art3mis@example.com ')).toEqual({ value: 'art3mis@example.com', valid: true, reason: '' })
  })

  it('rejects relay URLs and local loopback hosts', () => {
    expect(sanitizeOpenclawSshHost('ws://localhost:4517/?role=agent')).toMatchObject({ valid: false, reason: 'relay_url' })
    expect(sanitizeOpenclawSshHost('127.0.0.1:4516 ws://localhost:4517/?role=agent')).toMatchObject({ valid: false, reason: 'relay_url' })
    expect(sanitizeOpenclawSshHost('127.0.0.1')).toMatchObject({ valid: false, reason: 'local_loopback' })
  })

  it('explains the common paste mistakes', () => {
    expect(describeOpenclawSshHostIssue('relay_url')).toContain('relay URL')
    expect(describeOpenclawSshHostIssue('contains_spaces')).toContain('no spaces')
  })
})
