import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('fs/promises', () => ({
  appendFile: vi.fn(),
  mkdir: vi.fn(),
}))

import { POST } from './route'

function postRequest(body: unknown) {
  return new Request('http://localhost/api/hackathon/spatial-submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as Parameters<typeof POST>[0]
}

describe('/api/hackathon/spatial-submit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('grades test submissions and returns a Gemini tutor prompt', async () => {
    const response = await POST(postRequest({
      formId: 'quiz-demo',
      submittedAt: '2026-05-09T12:00:00.000Z',
      destination: {
        type: 'local',
        testMode: true,
        geminiReview: true,
        answerKey: {
          'Capital of Colombia': 'Bogota',
          Colors: ['Red', 'Blue'],
        },
      },
      fields: [
        { id: 'field-1', label: 'Capital of Colombia', type: 'text', value: 'Bogota' },
        { id: 'field-2', label: 'Colors', type: 'multiselect', value: ['Red'] },
      ],
    }))

    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.message).toContain('Score: 1/2 (50%).')
    expect(json.data.grade).toMatchObject({
      correctCount: 1,
      totalCount: 2,
      percent: 50,
    })
    expect(json.data.grade.details).toEqual([
      expect.objectContaining({ label: 'Capital of Colombia', correct: true }),
      expect.objectContaining({ label: 'Colors', correct: false }),
    ])
    expect(json.data.geminiPrompt).toContain('The student just submitted the test.')
    expect(json.data.geminiPrompt).toContain('Capital of Colombia: correct')
    expect(json.data.geminiPrompt).toContain('Colors: wrong')
  })

  it('keeps spatial submissions successful when Google Forms forwarding rejects', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('', { status: 400 })) as unknown as typeof fetch

    try {
      const response = await POST(postRequest({
        formId: 'demo-google-form',
        submittedAt: '2026-05-09T12:00:00.000Z',
        destination: {
          type: 'google_form',
          formUrl: 'https://docs.google.com/forms/d/e/demo/viewform',
          fieldMap: { Name: 'entry.123' },
        },
        fields: [
          { id: 'field-1', label: 'Name', type: 'text', value: 'Lev' },
        ],
      }))
      const json = await response.json()

      expect(response.status).toBe(200)
      expect(json.ok).toBe(true)
      expect(json.message).toContain('Saved 1 spatial web fields')
      expect(json.data.forwardWarning).toContain('Google Forms submit failed: HTTP 400')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
