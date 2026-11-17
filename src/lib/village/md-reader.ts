// ░▒▓ MD READER — which text file the Oasis reader has open ▓▒░
// A markdown (or text) file an agent sent opens in the reader instead of downloading (components/village/
// MarkdownReader.tsx). This is only the "which file" store; the engine reads and saves it (files.js: only files an
// agent sent, only .md / .markdown / .mdx / .txt).

export interface MdReaderTarget {
  fileId: string
  name: string
}

let target: MdReaderTarget | null = null
const listeners = new Set<() => void>()

export const isReaderFile = (name: string): boolean => /\.(md|markdown|mdx|txt)$/i.test(name)

export function getMdReaderTarget(): MdReaderTarget | null {
  return target
}

export function openMdReader(next: MdReaderTarget): void {
  target = next
  listeners.forEach(listener => listener())
}

export function closeMdReader(): void {
  if (!target) return
  target = null
  listeners.forEach(listener => listener())
}

export function subscribeMdReader(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
