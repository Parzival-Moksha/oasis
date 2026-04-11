'use client'

import type { ButtonHTMLAttributes } from 'react'

import type { AgentVoiceInputController } from '@/hooks/useAgentVoiceInput'

interface AgentVoiceInputButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'title'> {
  controller: AgentVoiceInputController
  titleReady: string
  titleLoading?: string
  titleIdle?: string
  titleUnsupported?: string
  idleLabel?: string
  readyLabel?: string
  warmingLabel?: string
  listeningLabel?: string
  transcribingLabel?: string
}

export function AgentVoiceInputButton({
  controller,
  titleReady,
  titleLoading = 'Local voice model is loading',
  titleIdle = 'Load the local voice model and start recording',
  titleUnsupported = 'Browser microphone capture is unavailable here',
  idleLabel = 'mic',
  readyLabel = 'mic ready',
  warmingLabel = 'loading',
  listeningLabel = 'stop rec',
  transcribingLabel = 'transcribing',
  disabled,
  ...buttonProps
}: AgentVoiceInputButtonProps) {
  const isDisabled = Boolean(disabled || !controller.supported || controller.transcribing || controller.warming)
  const label = controller.transcribing
    ? transcribingLabel
    : controller.listening
      ? listeningLabel
      : controller.warming
        ? warmingLabel
        : controller.ready
          ? readyLabel
          : idleLabel
  const title = !controller.supported
    ? titleUnsupported
    : controller.warming
      ? controller.backendMessage || titleLoading
      : controller.ready
        ? titleReady
        : titleIdle

  return (
    <button
      {...buttonProps}
      onClick={() => void controller.toggle()}
      disabled={isDisabled}
      aria-pressed={controller.listening}
      title={title}
    >
      {label}
    </button>
  )
}
