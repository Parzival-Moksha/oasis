import { defineConfig } from 'vitest/config'

export default defineConfig({
  oxc: {
    jsx: 'automatic' as never,
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
})
