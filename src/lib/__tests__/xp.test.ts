import { describe, expect, it } from 'vitest'

import { DEFAULT_XP_AWARDS, getXpAwards, getXpForAction } from '../xp'

describe('xp local-first config', () => {
  it('returns a clone of the default awards', async () => {
    const awards = await getXpAwards()

    expect(awards).toEqual(DEFAULT_XP_AWARDS)
    expect(awards).not.toBe(DEFAULT_XP_AWARDS)
  })

  it('looks up known XP actions from local defaults', async () => {
    await expect(getXpForAction('PLACE_CATALOG_OBJECT')).resolves.toBe(
      DEFAULT_XP_AWARDS.PLACE_CATALOG_OBJECT,
    )
  })

  it('does not expose the removed feedback award', async () => {
    await expect(getXpForAction('SUBMIT_FEEDBACK')).resolves.toBe(0)
  })
})
