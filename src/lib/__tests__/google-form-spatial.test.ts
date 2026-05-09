import { describe, expect, it } from 'vitest'

import { googleFormSpecToJourneyGroundTiles, googleFormSpecToSpatialWebObjects, parseGoogleFormHtml } from '../google-form-spatial'

describe('google form spatial adapter', () => {
  it('extracts Google Forms entry IDs and maps them to spatial submit destinations', () => {
    const html = `
      <html>
        <head><title>Hackathon RSVP - Google Forms</title></head>
        <body>
          <script>
            var FB_PUBLIC_LOAD_DATA_ = [null, ["Hackathon RSVP", null, null, null, [
              [123, "Your name", null, 0, [[111111111, null]]],
              [124, "Can you come?", null, 2, [[222222222, [["Yes"], ["Maybe"], ["No"]]]]],
              [125, "What will you bring?", null, 4, [[333333333, [["Snacks"], ["Ideas"]]]]]
            ]]];
          </script>
        </body>
      </html>
    `

    const spec = parseGoogleFormHtml(html, 'https://docs.google.com/forms/d/e/test/viewform')

    expect(spec.title).toBe('Hackathon RSVP')
    expect(spec.responseUrl).toBe('https://docs.google.com/forms/d/e/test/formResponse')
    expect(spec.fields).toEqual([
      { entryId: 'entry.111111111', label: 'Your name', type: 'text' },
      { entryId: 'entry.222222222', label: 'Can you come?', type: 'select', options: ['Yes', 'Maybe', 'No'] },
      { entryId: 'entry.333333333', label: 'What will you bring?', type: 'multiselect', options: ['Snacks', 'Ideas'] },
    ])

    const objects = googleFormSpecToSpatialWebObjects(spec, 'google-form-test')
    const submit = objects.find(object => object.type === 'button')
    const firstField = objects.find(object => object.id === 'google-form-test-field-1')
    const secondField = objects.find(object => object.id === 'google-form-test-field-2')

    expect(submit?.action?.type).toBe('submit_form')
    expect(submit?.visualStyle).toBe('portal-zero-button')
    expect(submit?.action?.destination?.type).toBe('google_form')
    expect(submit?.action?.destination?.fieldMap).toMatchObject({
      'Your name': 'entry.111111111',
      'Can you come?': 'entry.222222222',
      'What will you bring?': 'entry.333333333',
    })
    expect(firstField?.position[0]).toBeLessThan(0)
    expect(secondField?.position[0]).toBeGreaterThan(0)
    expect(firstField?.rotation?.[1]).toBeGreaterThan(0)
    expect(secondField?.rotation?.[1]).toBeLessThan(0)

    const groundTiles = googleFormSpecToJourneyGroundTiles(spec)
    expect(groundTiles['0,-3']).toBe('dirt')
    expect(Object.values(groundTiles)).toContain('cobble')
  })
})
