// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// MEDIA TOOLS — Shared definitions + executors for image/voice/video gen
// Used by: Anorak vibecode chat, MCP tools, Merlin Claude Code sessions
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

export const OASIS_URL = process.env.NEXT_PUBLIC_OASIS_URL || process.env.OASIS_URL || 'http://localhost:4516'

export const IMAGE_MODELS = ['gemini-flash', 'riverflow', 'seedream', 'flux-klein'] as const
export type ImageModel = (typeof IMAGE_MODELS)[number]

export const VOICE_NAMES = ['rachel', 'adam', 'sam', 'elli', 'merlin'] as const
export type VoiceName = (typeof VOICE_NAMES)[number]

export const VIDEO_DURATIONS = [6, 8, 10, 12, 14, 16, 18, 20] as const
export type VideoDuration = (typeof VIDEO_DURATIONS)[number]

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface MediaToolResult {
  ok: boolean
  url?: string
  error?: string
}

// ═══════════════════════════════════════════════════════════════════════════
// Executor Functions
// ═══════════════════════════════════════════════════════════════════════════

function resolveUrl(url: string | undefined, baseUrl: string): string | undefined {
  if (!url) return undefined
  if (url.startsWith('http') || url.startsWith('blob:') || url.startsWith('data:')) return url
  if (url.startsWith('/')) return url
  return `${baseUrl}${url}`
}

export async function execGenerateImage(
  prompt: string,
  model?: string,
  baseUrl: string = OASIS_URL,
): Promise<MediaToolResult> {
  try {
    const res = await fetch(`${baseUrl}/api/media/image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, model }),
    })
    const data = await res.json()
    if (!res.ok) return { ok: false, error: data.error || `HTTP ${res.status}` }
    return { ok: true, url: resolveUrl(data.url, baseUrl) }
  } catch (e) {
    return { ok: false, error: `Image gen error: ${e}` }
  }
}

export async function execGenerateVoice(
  text: string,
  voice?: string,
  baseUrl: string = OASIS_URL,
  agentType?: string,
): Promise<MediaToolResult> {
  try {
    const res = await fetch(`${baseUrl}/api/media/voice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice, agentType }),
    })
    const data = await res.json()
    if (!res.ok) return { ok: false, error: data.error || `HTTP ${res.status}` }
    return { ok: true, url: resolveUrl(data.url, baseUrl) }
  } catch (e) {
    return { ok: false, error: `Voice gen error: ${e}` }
  }
}

export async function execGenerateVideo(
  prompt: string,
  duration?: number,
  imageUrl?: string,
  baseUrl: string = OASIS_URL,
): Promise<MediaToolResult> {
  try {
    const submitRes = await fetch(`${baseUrl}/api/media/video`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, duration, image_url: imageUrl }),
    })
    const submitData = await submitRes.json()
    if (!submitRes.ok) return { ok: false, error: submitData.error || `HTTP ${submitRes.status}` }
    if (submitData.status === 'completed' && submitData.url) {
      return { ok: true, url: resolveUrl(submitData.url, baseUrl) }
    }
    if (!submitData.requestId) {
      return { ok: false, error: `Unexpected response: ${JSON.stringify(submitData)}` }
    }
    // Poll for completion
    const endpoint = submitData.endpoint || ''
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 5000))
      const pollRes = await fetch(`${baseUrl}/api/media/video?requestId=${submitData.requestId}&endpoint=${encodeURIComponent(endpoint)}`)
      const pollData = await pollRes.json()
      if (pollData.status === 'completed' && pollData.url) {
        return { ok: true, url: resolveUrl(pollData.url, baseUrl) }
      }
      if (pollData.status === 'failed') {
        return { ok: false, error: pollData.error || 'Video generation failed' }
      }
    }
    return { ok: false, error: 'Video generation timed out (5 min)' }
  } catch (e) {
    return { ok: false, error: `Video gen error: ${e}` }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Dispatcher
// ═══════════════════════════════════════════════════════════════════════════

export async function execMediaTool(
  name: string,
  args: Record<string, unknown>,
  baseUrl?: string,
): Promise<MediaToolResult> {
  switch (name) {
    case 'generate_image':
      return execGenerateImage(args.prompt as string, args.model as string | undefined, baseUrl)
    case 'generate_voice':
      return execGenerateVoice(
        args.text as string,
        args.voice as string | undefined,
        baseUrl,
        args.agentType as string | undefined,
      )
    case 'generate_video':
      return execGenerateVideo(args.prompt as string, args.duration as number | undefined, args.image_url as string | undefined, baseUrl)
    default:
      return { ok: false, error: `Unknown media tool: ${name}` }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// OpenAI-Compatible Tool Definitions (shared schema for function-calling surfaces)
// ═══════════════════════════════════════════════════════════════════════════

export const mediaToolsOpenAI = [
  {
    type: 'function' as const,
    function: {
      name: 'generate_image',
      description: 'Generate an image from a text prompt. Returns a URL.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Text prompt describing the image to generate' },
          model: { type: 'string', enum: IMAGE_MODELS, description: 'Image model to use (default: gemini-flash)' },
        },
        required: ['prompt'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'generate_voice',
      description: 'Generate a voice note from text via ElevenLabs TTS. Returns a URL to the audio file.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Text to convert to speech (1-5000 chars)' },
          voice: { type: 'string', description: 'Voice alias (rachel, adam, sam, elli, merlin) or a raw ElevenLabs voice ID.' },
        },
        required: ['text'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'generate_video',
      description: 'Generate a video from a text prompt via fal.ai LTX 2.3. Submits job and polls until done.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Text prompt describing the video to generate' },
          duration: { type: 'number', description: 'Duration in seconds (even numbers)', enum: VIDEO_DURATIONS },
          image_url: { type: 'string', description: 'Optional reference image URL for image-to-video' },
        },
        required: ['prompt'],
      },
    },
  },
] as const

export const MEDIA_TOOL_NAMES = ['generate_image', 'generate_voice', 'generate_video'] as const
export type MediaToolName = (typeof MEDIA_TOOL_NAMES)[number]

export function isMediaTool(name: string): name is MediaToolName {
  return MEDIA_TOOL_NAMES.includes(name as MediaToolName)
}
