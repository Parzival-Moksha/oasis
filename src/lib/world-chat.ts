'use client'

import { create } from 'zustand'
import type { MultiplayerRoomChatInput, MultiplayerRoomChatMessage } from './multiplayer-room-client'

export type WorldChatMessage = MultiplayerRoomChatMessage

const WORLD_CHAT_MAX_MESSAGES = 80
const WORLD_CHAT_MAX_TEXT = 280

let worldChatSender: ((input: MultiplayerRoomChatInput) => void) | null = null

function cleanChatText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, WORLD_CHAT_MAX_TEXT)
}

function makeChatId(): string {
  const rand = Math.random().toString(36).slice(2, 8)
  return `chat-${Date.now().toString(36)}-${rand}`
}

interface WorldChatState {
  worldId: string | null
  localSessionId: string | null
  connected: boolean
  open: boolean
  messages: WorldChatMessage[]
  setWorldId: (worldId: string | null) => void
  setLocalSessionId: (sessionId: string | null) => void
  setConnected: (connected: boolean) => void
  setOpen: (open: boolean) => void
  append: (message: WorldChatMessage) => void
  clear: () => void
}

export const useWorldChat = create<WorldChatState>((set, get) => ({
  worldId: null,
  localSessionId: null,
  connected: false,
  open: false,
  messages: [],
  setWorldId: worldId => set(state => {
    if (state.worldId === worldId) return { worldId }
    return { worldId, messages: [], open: false }
  }),
  setLocalSessionId: localSessionId => set({ localSessionId }),
  setConnected: connected => set({ connected }),
  setOpen: open => set({ open }),
  append: message => set(state => {
    if (state.worldId && message.worldId !== state.worldId) return state
    if (state.messages.some(item => item.id === message.id)) return state
    return { messages: [...state.messages, message].slice(-WORLD_CHAT_MAX_MESSAGES) }
  }),
  clear: () => set({ messages: [] }),
}))

export function setWorldChatSender(sender: ((input: MultiplayerRoomChatInput) => void) | null): void {
  worldChatSender = sender
  useWorldChat.getState().setConnected(Boolean(sender))
}

export function sendWorldChatMessage(text: string): boolean {
  const clean = cleanChatText(text)
  if (!clean || !worldChatSender) return false
  worldChatSender({ id: makeChatId(), text: clean })
  return true
}

export function appendWorldChatMessage(message: WorldChatMessage): void {
  useWorldChat.getState().append(message)
}
