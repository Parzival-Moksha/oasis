import { describe, expect, it } from 'vitest'

import { pathCrumbs } from '../path-crumbs'

describe('pathCrumbs', () => {
  it('Windows paths: the drive, then each folder, with the path up to it', () => {
    expect(pathCrumbs('C:\\7c_oasis\\docs')).toEqual([
      { label: 'C:', path: 'C:\\' },
      { label: '7c_oasis', path: 'C:\\7c_oasis' },
      { label: 'docs', path: 'C:\\7c_oasis\\docs' },
    ])
    expect(pathCrumbs('D:\\')).toEqual([{ label: 'D:', path: 'D:\\' }])
  })

  it('POSIX paths start at /', () => {
    expect(pathCrumbs('/Users/l/code')).toEqual([
      { label: '/', path: '/' },
      { label: 'Users', path: '/Users' },
      { label: 'l', path: '/Users/l' },
      { label: 'code', path: '/Users/l/code' },
    ])
  })

  it('the top level has no crumbs', () => {
    expect(pathCrumbs('')).toEqual([])
  })
})
