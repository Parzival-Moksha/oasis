// ░▒▓█ D3VCR4F7 — Notifications █▓▒░
// Timer beeps use AudioManager (kenney sounds). Sound selection in DevCraft ⚙ or global Settings → Audio.

import { useAudioManager } from '@/lib/audio-manager'

// Play notification via AudioManager (kenney sounds, user-configurable)
export function playNotification() {
  useAudioManager.getState().play('notification')
}

// Browser Notification API
export function requestNotificationPermission() {
  if (typeof window === 'undefined') return
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission()
  }
}

export function sendBrowserNotification(title: string, body: string) {
  if (typeof window === 'undefined') return
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, {
      body,
      icon: '/favicon.ico',
      tag: 'devcraft-timer',
    })
  }
}
