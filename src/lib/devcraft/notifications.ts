// ░▒▓█ D3VCR4F7 — Notification Sounds & Browser Notifications █▓▒░

export type SoundType = 'alert' | 'chime' | 'alarm' | 'ping'

// Get saved preferences from localStorage
export function getNotificationSettings(): { sound: SoundType; volume: number } {
  if (typeof window === 'undefined') return { sound: 'alert', volume: 70 }
  const sound = (localStorage.getItem('devcraft-notif-sound') as SoundType) || 'alert'
  const volume = parseInt(localStorage.getItem('devcraft-notif-volume') || '70')
  return { sound, volume }
}

export function saveNotificationSettings(sound: SoundType, volume: number) {
  localStorage.setItem('devcraft-notif-sound', sound)
  localStorage.setItem('devcraft-notif-volume', String(volume))
}

// Synthesized notification sounds via Web Audio API
export function playSound(type: SoundType, volume: number = 70) {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    const vol = volume / 100

    switch (type) {
      case 'alert': playAlert(ctx, vol); break
      case 'chime': playChime(ctx, vol); break
      case 'alarm': playAlarm(ctx, vol); break
      case 'ping': playPing(ctx, vol); break
    }
  } catch { /* Audio not available */ }
}

function playAlert(ctx: AudioContext, vol: number) {
  // Ascending triple-tone — urgent but clean
  const freqs = [440, 554.37, 659.25] // A4, C#5, E5
  freqs.forEach((freq, i) => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = freq
    osc.type = 'triangle'
    const start = ctx.currentTime + i * 0.15
    gain.gain.setValueAtTime(vol * 0.4, start)
    gain.gain.exponentialRampToValueAtTime(0.01, start + 0.14)
    osc.start(start)
    osc.stop(start + 0.15)
  })
}

function playChime(ctx: AudioContext, vol: number) {
  // Bell-like harmonic with decay
  const freqs = [523.25, 659.25, 783.99] // C5, E5, G5
  freqs.forEach((freq) => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = freq
    osc.type = 'sine'
    gain.gain.setValueAtTime(vol * 0.3, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.8)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.8)
  })
}

function playAlarm(ctx: AudioContext, vol: number) {
  // Aggressive rapid pulse pattern
  for (let i = 0; i < 6; i++) {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = i % 2 === 0 ? 880 : 660
    osc.type = 'square'
    const start = ctx.currentTime + i * 0.1
    gain.gain.setValueAtTime(vol * 0.25, start)
    gain.gain.exponentialRampToValueAtTime(0.01, start + 0.08)
    osc.start(start)
    osc.stop(start + 0.1)
  }
}

function playPing(ctx: AudioContext, vol: number) {
  // Single clean tone — minimal
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.frequency.value = 880
  osc.type = 'sine'
  gain.gain.setValueAtTime(vol * 0.4, ctx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3)
  osc.start(ctx.currentTime)
  osc.stop(ctx.currentTime + 0.3)
}

// Play the user's selected notification sound
export function playNotification() {
  const { sound, volume } = getNotificationSettings()
  playSound(sound, volume)
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
