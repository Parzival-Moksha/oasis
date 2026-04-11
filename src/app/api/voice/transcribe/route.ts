import { handleVoiceTranscriptionGet, handleVoiceTranscriptionPost } from '@/lib/voice/transcription-route'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const GET = handleVoiceTranscriptionGet
export const POST = handleVoiceTranscriptionPost
