'use client'

import { useEffect } from 'react'

export default function DocsRedirect() {
  useEffect(() => {
    window.open('https://parzival-moksha.github.io/af_oasis/', '_blank')
  }, [])

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      background: '#0a0a0f',
      color: '#94a3b8',
      fontFamily: 'monospace',
    }}>
      <div style={{ textAlign: 'center' }}>
        <p style={{ fontSize: '1.2rem', marginBottom: '1rem' }}>
          Opening docs in a new tab...
        </p>
        <a
          href="https://parzival-moksha.github.io/af_oasis/"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: '#14b8a6', textDecoration: 'underline' }}
        >
          Click here if it didn&apos;t open
        </a>
      </div>
    </div>
  )
}
