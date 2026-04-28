// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// TESTS — anorak-renderers.tsx
// Shared rendering: renderInline, renderMarkdownLine, renderMarkdown,
// CollapsibleBlock, ToolCallCard
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { describe, it, expect } from 'vitest'
import React from 'react'
import {
  renderInline,
  renderMarkdownLine,
  renderMarkdown,
  CollapsibleBlock,
  ToolCallCard,
  isScreenshotToolDisplay,
  extractToolResultMediaReferences,
} from '../anorak-renderers'

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS — walk React element trees for assertions
// ═══════════════════════════════════════════════════════════════════════════

/** Recursively extract all text content from a React element tree */
function extractText(node: React.ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (React.isValidElement(node)) {
    const props = node.props as Record<string, unknown>
    const children = props.children
    if (children == null) return ''
    if (Array.isArray(children)) return children.map(extractText).join('')
    return extractText(children as React.ReactNode)
  }
  return ''
}

/** Flatten a React tree into an array of elements */
function flattenElements(node: React.ReactNode): React.ReactElement[] {
  const result: React.ReactElement[] = []
  function walk(n: React.ReactNode) {
    if (n == null || typeof n !== 'object') return
    if (Array.isArray(n)) { n.forEach(walk); return }
    if (React.isValidElement(n)) {
      result.push(n)
      const props = n.props as Record<string, unknown>
      const children = props.children
      if (children != null) {
        if (Array.isArray(children)) children.forEach(walk)
        else walk(children as React.ReactNode)
      }
    }
  }
  walk(node)
  return result
}

/** Check if any element in the tree is of a specific type (tag or component name) */
function hasElementType(node: React.ReactNode, type: string | Function): boolean {
  return flattenElements(node).some(el => el.type === type)
}

/** Get all elements of a specific tag type */
function findByType(node: React.ReactNode, type: string | Function): React.ReactElement[] {
  return flattenElements(node).filter(el => el.type === type)
}

// ═══════════════════════════════════════════════════════════════════════════
// renderInline
// ═══════════════════════════════════════════════════════════════════════════

describe('renderInline', () => {
  it('renders plain text unchanged', () => {
    const result = renderInline('hello world')
    expect(extractText(result)).toBe('hello world')
  })

  it('renders inline code with backticks', () => {
    const result = renderInline('use `npm install` here')
    const text = extractText(result)
    expect(text).toBe('use npm install here')
    // Should contain a <code> element
    expect(hasElementType(result, 'code')).toBe(true)
    const codes = findByType(result, 'code')
    expect(extractText(codes[0])).toBe('npm install')
  })

  it('renders bold text with double asterisks', () => {
    const result = renderInline('this is **bold** text')
    const text = extractText(result)
    expect(text).toBe('this is bold text')
    // Should contain a <strong> element
    expect(hasElementType(result, 'strong')).toBe(true)
    const strongs = findByType(result, 'strong')
    expect(extractText(strongs[0])).toBe('bold')
  })

  it('handles mixed bold and code', () => {
    const result = renderInline('**bold** and `code`')
    const text = extractText(result)
    expect(text).toBe('bold and code')
    expect(hasElementType(result, 'strong')).toBe(true)
    expect(hasElementType(result, 'code')).toBe(true)
  })

  it('handles multiple code spans', () => {
    const result = renderInline('use `foo` and `bar`')
    const codes = findByType(result, 'code')
    expect(codes).toHaveLength(2)
    expect(extractText(codes[0])).toBe('foo')
    expect(extractText(codes[1])).toBe('bar')
  })

  it('handles multiple bold spans', () => {
    const result = renderInline('**first** then **second**')
    const strongs = findByType(result, 'strong')
    expect(strongs).toHaveLength(2)
    expect(extractText(strongs[0])).toBe('first')
    expect(extractText(strongs[1])).toBe('second')
  })

  it('handles unclosed backtick as plain text', () => {
    const result = renderInline('unclosed `backtick')
    const text = extractText(result)
    expect(text).toBe('unclosed `backtick')
    expect(hasElementType(result, 'code')).toBe(false)
  })

  it('handles unclosed bold as plain text', () => {
    const result = renderInline('unclosed **bold')
    const text = extractText(result)
    expect(text).toBe('unclosed **bold')
    expect(hasElementType(result, 'strong')).toBe(false)
  })

  it('handles empty string', () => {
    const result = renderInline('')
    const text = extractText(result)
    expect(text).toBe('')
  })

  it('handles code before bold in sequence', () => {
    const result = renderInline('`code` then **bold**')
    const text = extractText(result)
    expect(text).toBe('code then bold')
    expect(hasElementType(result, 'code')).toBe(true)
    expect(hasElementType(result, 'strong')).toBe(true)
  })

  it('handles text with no formatting markers', () => {
    const result = renderInline('just plain text with no markers')
    expect(extractText(result)).toBe('just plain text with no markers')
    expect(hasElementType(result, 'code')).toBe(false)
    expect(hasElementType(result, 'strong')).toBe(false)
  })

  it('handles adjacent bold markers', () => {
    const result = renderInline('**a****b**')
    // First bold "a" gets parsed, then "**b**" gets parsed
    expect(hasElementType(result, 'strong')).toBe(true)
    const text = extractText(result)
    expect(text).toContain('a')
    expect(text).toContain('b')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// renderMarkdownLine
// ═══════════════════════════════════════════════════════════════════════════

describe('renderMarkdownLine', () => {
  it('renders h1 heading', () => {
    const result = renderMarkdownLine('# Hello', 0)
    expect(extractText(result)).toBe('Hello')
  })

  it('renders h2 heading', () => {
    const result = renderMarkdownLine('## Sub-heading', 0)
    expect(extractText(result)).toBe('Sub-heading')
  })

  it('renders h3 heading', () => {
    const result = renderMarkdownLine('### Third level', 0)
    expect(extractText(result)).toBe('Third level')
  })

  it('renders unordered list with dash', () => {
    const result = renderMarkdownLine('- list item', 0)
    const text = extractText(result)
    expect(text).toContain('list item')
    // Should have a bullet point
    expect(text).toContain('•')
  })

  it('renders unordered list with asterisk', () => {
    const result = renderMarkdownLine('* asterisk item', 0)
    const text = extractText(result)
    expect(text).toContain('asterisk item')
    expect(text).toContain('•')
  })

  it('renders ordered list', () => {
    const result = renderMarkdownLine('1. first item', 0)
    const text = extractText(result)
    expect(text).toContain('1. first item')
  })

  it('renders horizontal rule for dashes', () => {
    const result = renderMarkdownLine('---', 0)
    expect(React.isValidElement(result)).toBe(true)
    const el = result as React.ReactElement
    expect(el.type).toBe('hr')
  })

  it('renders horizontal rule for long dashes', () => {
    const result = renderMarkdownLine('----------', 0)
    expect(React.isValidElement(result)).toBe(true)
    const el = result as React.ReactElement
    expect(el.type).toBe('hr')
  })

  it('renders empty line as spacer', () => {
    const result = renderMarkdownLine('', 0)
    expect(React.isValidElement(result)).toBe(true)
    // Should be a div with h-1 class (spacer)
    const el = result as React.ReactElement
    expect(el.type).toBe('div')
    expect((el.props as Record<string, string>).className).toContain('h-1')
  })

  it('renders regular text as inline-formatted div', () => {
    const result = renderMarkdownLine('just some text', 0)
    expect(extractText(result)).toBe('just some text')
  })

  it('renders inline formatting within list items', () => {
    const result = renderMarkdownLine('- use **bold** in lists', 0)
    const text = extractText(result)
    expect(text).toContain('bold')
    expect(text).toContain('•')
  })

  it('preserves key prop from idx parameter', () => {
    const result = renderMarkdownLine('test', 42)
    expect(React.isValidElement(result)).toBe(true)
    expect((result as React.ReactElement).key).toBe('42')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// renderMarkdown
// ═══════════════════════════════════════════════════════════════════════════

describe('renderMarkdown', () => {
  it('renders simple text content', () => {
    const result = renderMarkdown('Hello world')
    expect(extractText(result)).toBe('Hello world')
  })

  it('renders multiple lines', () => {
    const result = renderMarkdown('Line one\nLine two\nLine three')
    const text = extractText(result)
    expect(text).toContain('Line one')
    expect(text).toContain('Line two')
    expect(text).toContain('Line three')
  })

  it('renders a fenced code block', () => {
    const md = '```js\nconsole.log("hi")\n```'
    const result = renderMarkdown(md)
    const text = extractText(result)
    expect(text).toContain('console.log("hi")')
    // Should contain the language label
    expect(text).toContain('js')
    // Should have <pre> and <code> elements
    expect(hasElementType(result, 'pre')).toBe(true)
    expect(hasElementType(result, 'code')).toBe(true)
  })

  it('renders code block without language', () => {
    const md = '```\nsome code\n```'
    const result = renderMarkdown(md)
    const text = extractText(result)
    expect(text).toContain('some code')
    expect(hasElementType(result, 'pre')).toBe(true)
  })

  it('handles unclosed code block gracefully', () => {
    const md = '```python\ndef foo():\n  pass'
    const result = renderMarkdown(md)
    const text = extractText(result)
    expect(text).toContain('def foo():')
    expect(text).toContain('pass')
    // Should still render the code block (unclosed fallback)
    expect(hasElementType(result, 'pre')).toBe(true)
    // Language label should be present
    expect(text).toContain('python')
  })

  it('renders a markdown table', () => {
    const md = '| Name | Age |\n| --- | --- |\n| Alice | 30 |\n| Bob | 25 |'
    const result = renderMarkdown(md)
    const text = extractText(result)
    expect(text).toContain('Name')
    expect(text).toContain('Age')
    expect(text).toContain('Alice')
    expect(text).toContain('30')
    expect(text).toContain('Bob')
    expect(text).toContain('25')
    expect(hasElementType(result, 'table')).toBe(true)
    expect(hasElementType(result, 'thead')).toBe(true)
    expect(hasElementType(result, 'tbody')).toBe(true)
  })

  it('renders table with alignment separators', () => {
    const md = '| Left | Center | Right |\n| :--- | :---: | ---: |\n| a | b | c |'
    const result = renderMarkdown(md)
    const text = extractText(result)
    expect(text).toContain('Left')
    expect(text).toContain('Center')
    expect(text).toContain('Right')
    expect(hasElementType(result, 'table')).toBe(true)
  })

  it('renders mixed content: text + code block + text', () => {
    const md = 'Before code\n```\ncode line\n```\nAfter code'
    const result = renderMarkdown(md)
    const text = extractText(result)
    expect(text).toContain('Before code')
    expect(text).toContain('code line')
    expect(text).toContain('After code')
  })

  it('renders headings inside markdown', () => {
    const md = '# Title\n## Subtitle\nParagraph text'
    const result = renderMarkdown(md)
    const text = extractText(result)
    expect(text).toContain('Title')
    expect(text).toContain('Subtitle')
    expect(text).toContain('Paragraph text')
  })

  it('handles empty content', () => {
    const result = renderMarkdown('')
    // Should produce a fragment with an empty-line spacer
    expect(React.isValidElement(result)).toBe(true)
  })

  it('renders multiple code blocks', () => {
    const md = '```\nfirst\n```\ntext\n```\nsecond\n```'
    const result = renderMarkdown(md)
    const text = extractText(result)
    expect(text).toContain('first')
    expect(text).toContain('text')
    expect(text).toContain('second')
    const pres = findByType(result, 'pre')
    expect(pres.length).toBe(2)
  })

  it('renders list items inside markdown', () => {
    const md = '- item one\n- item two\n- item three'
    const result = renderMarkdown(md)
    const text = extractText(result)
    expect(text).toContain('item one')
    expect(text).toContain('item two')
    expect(text).toContain('item three')
  })

  it('handles code block with content after unclosed block', () => {
    const md = '```\nunclosed code block line 1\nunclosed code block line 2'
    const result = renderMarkdown(md)
    const text = extractText(result)
    expect(text).toContain('unclosed code block line 1')
    expect(text).toContain('unclosed code block line 2')
  })

  it('handles text after table', () => {
    const md = '| h1 | h2 |\n| -- | -- |\n| a | b |\nAfter table'
    const result = renderMarkdown(md)
    const text = extractText(result)
    expect(text).toContain('After table')
    expect(hasElementType(result, 'table')).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// CollapsibleBlock — React component (vdom tree assertions)
// ═══════════════════════════════════════════════════════════════════════════

describe('CollapsibleBlock', () => {
  it('creates a valid React element', () => {
    const el = React.createElement(CollapsibleBlock, {
      label: 'Test Block',
      icon: '🧪',
      content: 'block content here',
    })
    expect(React.isValidElement(el)).toBe(true)
  })

  it('accepts all props without error', () => {
    const el = React.createElement(CollapsibleBlock, {
      label: 'Error Block',
      icon: '❌',
      content: 'error content',
      defaultOpen: true,
      accentColor: 'rgba(255,0,0,0.5)',
      isError: true,
      compact: true,
    })
    expect(React.isValidElement(el)).toBe(true)
  })

  it('renders with the label visible in the tree', () => {
    const el = React.createElement(CollapsibleBlock, {
      label: 'Thinking...',
      icon: '💭',
      content: 'deep thoughts',
    })
    // The element is a CollapsibleBlock component, verify props pass through
    expect((el.props as Record<string, unknown>).label).toBe('Thinking...')
    expect((el.props as Record<string, unknown>).icon).toBe('💭')
    expect((el.props as Record<string, unknown>).content).toBe('deep thoughts')
  })

  it('defaults defaultOpen to false', () => {
    const el = React.createElement(CollapsibleBlock, {
      label: 'Closed',
      icon: '📦',
      content: 'hidden',
    })
    expect((el.props as Record<string, unknown>).defaultOpen).toBeUndefined()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// ToolCallCard — React component (vdom tree assertions)
// ═══════════════════════════════════════════════════════════════════════════

describe('ToolCallCard', () => {
  it('detects screenshot tools from Codex MCP display names', () => {
    expect(isScreenshotToolDisplay('Screenshot Viewport', 'oasis.screenshot_viewport')).toBe(true)
    expect(isScreenshotToolDisplay('MCP Tool', 'oasis.screenshot_avatar')).toBe(true)
    expect(isScreenshotToolDisplay('MCP Tool', 'oasis.avatarpic_merlin')).toBe(true)
    expect(isScreenshotToolDisplay('Generate Voice', 'oasis.generate_voice')).toBe(false)
  })

  it('extracts generated media URLs from tool result JSON', () => {
    const refs = extractToolResultMediaReferences({
      preview: '',
      fullResult: JSON.stringify({
        ok: true,
        data: {
          mediaUrls: ['/generated-voices/voice-1.mp3'],
          url: '/generated-images/image-1.webp',
        },
      }),
    })

    expect(refs).toEqual(expect.arrayContaining([
      { path: '/generated-voices/voice-1.mp3', mediaType: 'audio' },
      { path: '/generated-images/image-1.webp', mediaType: 'image' },
    ]))
  })

  it('creates a valid React element', () => {
    const el = React.createElement(ToolCallCard, {
      name: 'Read',
      icon: '📖',
      display: 'Read: /src/index.ts',
    })
    expect(React.isValidElement(el)).toBe(true)
  })

  it('accepts tool call with input and result', () => {
    const el = React.createElement(ToolCallCard, {
      name: 'Bash',
      icon: '⚡',
      display: 'Bash: ls -la',
      input: { command: 'ls -la' },
      result: { preview: 'total 42\n...', isError: false, length: 200 },
    })
    expect(React.isValidElement(el)).toBe(true)
    expect((el.props as Record<string, unknown>).name).toBe('Bash')
  })

  it('accepts error result', () => {
    const el = React.createElement(ToolCallCard, {
      name: 'Bash',
      icon: '⚡',
      display: 'Bash: bad-cmd',
      input: { command: 'bad-cmd' },
      result: { preview: 'command not found', isError: true, length: 20 },
    })
    expect(React.isValidElement(el)).toBe(true)
    expect((el.props as Record<string, unknown>).result).toEqual({
      preview: 'command not found',
      isError: true,
      length: 20,
    })
  })

  it('accepts compact mode', () => {
    const el = React.createElement(ToolCallCard, {
      name: 'Grep',
      icon: '🔍',
      display: 'Grep: "TODO"',
      compact: true,
    })
    expect(React.isValidElement(el)).toBe(true)
    expect((el.props as Record<string, unknown>).compact).toBe(true)
  })

  it('handles Edit tool with old_string and new_string', () => {
    const el = React.createElement(ToolCallCard, {
      name: 'Edit',
      icon: '✏️',
      display: 'Edit: /src/file.ts',
      input: {
        file_path: '/src/file.ts',
        old_string: 'const x = 1',
        new_string: 'const x = 2',
      },
    })
    expect(React.isValidElement(el)).toBe(true)
    const input = (el.props as Record<string, unknown>).input as Record<string, unknown>
    expect(input.old_string).toBe('const x = 1')
    expect(input.new_string).toBe('const x = 2')
  })

  it('handles result with fullResult', () => {
    const el = React.createElement(ToolCallCard, {
      name: 'Read',
      icon: '📖',
      display: 'Read: /src/big.ts',
      result: {
        preview: 'first 200 chars...',
        isError: false,
        length: 5000,
        fullResult: 'the full content here...',
      },
    })
    expect(React.isValidElement(el)).toBe(true)
    const result = (el.props as Record<string, unknown>).result as Record<string, unknown>
    expect(result.fullResult).toBe('the full content here...')
    expect(result.length).toBe(5000)
  })

  it('handles no input (no details to expand)', () => {
    const el = React.createElement(ToolCallCard, {
      name: 'Unknown',
      icon: '❓',
      display: 'Unknown tool',
      input: undefined,
    })
    expect(React.isValidElement(el)).toBe(true)
  })

  it('handles empty input object (no details to expand)', () => {
    const el = React.createElement(ToolCallCard, {
      name: 'Noop',
      icon: '🔇',
      display: 'Noop',
      input: {},
    })
    expect(React.isValidElement(el)).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// TRUSTED_MEDIA regex (tested via pattern import/re-creation since it's
// not exported — we test the pattern logic directly)
// ═══════════════════════════════════════════════════════════════════════════

describe('TRUSTED_MEDIA regex pattern', () => {
  // Re-create the fixed regex from AnorakProPanel
  const TRUSTED_MEDIA = /^(\/|https?:\/\/(localhost|127\.0\.0\.1|fal\.media|fal-cdn\.|oaidalleapiprodscus\.|replicate\.delivery)[^\s]*)/

  it('matches local absolute paths', () => {
    expect(TRUSTED_MEDIA.test('/conjured/model.glb')).toBe(true)
  })

  it('matches localhost URLs', () => {
    expect(TRUSTED_MEDIA.test('https://localhost:4516/image.png')).toBe(true)
  })

  it('matches 127.0.0.1 URLs', () => {
    expect(TRUSTED_MEDIA.test('http://127.0.0.1:3000/file.jpg')).toBe(true)
  })

  it('matches fal.media URLs', () => {
    expect(TRUSTED_MEDIA.test('https://fal.media/files/abc/123.mp4')).toBe(true)
  })

  it('matches fal-cdn subdomain URLs (with dot)', () => {
    expect(TRUSTED_MEDIA.test('https://fal-cdn.net/abc.png')).toBe(true)
  })

  it('does NOT match fal-cdnEVIL (no dot after fal-cdn)', () => {
    // The fixed regex requires a dot after fal-cdn
    expect(TRUSTED_MEDIA.test('https://fal-cdnevil.com/bad.png')).toBe(false)
  })

  it('matches oaidalleapiprodscus subdomain URLs (with dot)', () => {
    expect(TRUSTED_MEDIA.test('https://oaidalleapiprodscus.blob.core.windows.net/image.png')).toBe(true)
  })

  it('does NOT match oaidalleapiprodscusEVIL (no dot)', () => {
    expect(TRUSTED_MEDIA.test('https://oaidalleapiprodscusevil.com/bad.png')).toBe(false)
  })

  it('matches replicate.delivery URLs', () => {
    expect(TRUSTED_MEDIA.test('https://replicate.delivery/abc/out.png')).toBe(true)
  })

  it('does NOT match arbitrary external URLs', () => {
    expect(TRUSTED_MEDIA.test('https://evil.com/payload.exe')).toBe(false)
  })

  it('does NOT match non-URL strings', () => {
    expect(TRUSTED_MEDIA.test('not a url at all')).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// StreamEntry interface shape (structural validation)
// ═══════════════════════════════════════════════════════════════════════════

describe('StreamEntry enriched fields', () => {
  // Verify the enriched StreamEntry shape works with ToolCallCard props
  it('enriched tool entry fields map correctly to ToolCallCard props', () => {
    const entry = {
      id: 1,
      type: 'tool' as const,
      content: 'Read: /src/index.ts',
      lobe: 'anorak-pro',
      timestamp: Date.now(),
      toolName: 'Read',
      toolIcon: '📖',
      toolInput: { file_path: '/src/index.ts' },
      toolDisplay: 'Read: /src/index.ts',
    }

    // These should map directly to ToolCallCard props
    const cardProps = {
      name: entry.toolName || entry.content,
      icon: entry.toolIcon || '🔧',
      display: entry.toolDisplay || entry.content,
      input: entry.toolInput,
      compact: true,
    }
    expect(cardProps.name).toBe('Read')
    expect(cardProps.icon).toBe('📖')
    expect(cardProps.display).toBe('Read: /src/index.ts')
    expect(cardProps.input).toEqual({ file_path: '/src/index.ts' })
  })

  it('enriched tool_result entry fields map to ToolCallCard result props', () => {
    const entry = {
      id: 2,
      type: 'tool_result' as const,
      content: 'file contents preview...',
      lobe: 'anorak-pro',
      timestamp: Date.now(),
      toolName: 'Read',
      toolIcon: '📖',
      toolDisplay: 'Read: /src/index.ts',
      isError: false,
      resultLength: 5000,
    }

    const cardProps = {
      name: entry.toolName!,
      icon: entry.toolIcon || '🔧',
      display: entry.toolDisplay || entry.toolName!,
      result: {
        preview: entry.content,
        isError: !!entry.isError,
        length: entry.resultLength || entry.content.length,
      },
      compact: true,
    }
    expect(cardProps.result.isError).toBe(false)
    expect(cardProps.result.length).toBe(5000)
    expect(cardProps.result.preview).toBe('file contents preview...')
  })

  it('error tool result maps isError correctly', () => {
    const entry = {
      id: 3,
      type: 'tool_result' as const,
      content: 'command not found',
      lobe: 'anorak-pro',
      timestamp: Date.now(),
      toolName: 'Bash',
      isError: true,
      resultLength: 20,
    }

    const result = {
      preview: entry.content,
      isError: !!entry.isError,
      length: entry.resultLength || entry.content.length,
    }
    expect(result.isError).toBe(true)
  })

  it('fallback when toolName is missing uses content', () => {
    const entry: {
      id: number; type: 'tool'; content: string; lobe: string; timestamp: number;
      toolName?: string; toolIcon?: string; toolInput?: Record<string, unknown>; toolDisplay?: string;
    } = {
      id: 4,
      type: 'tool' as const,
      content: 'some tool call',
      lobe: 'anorak-pro',
      timestamp: Date.now(),
      // No toolName — intentionally omitted
    }

    const name = entry.toolName || entry.content
    expect(name).toBe('some tool call')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Mission #28 — MEDIA_URL_RE pattern (internal regex, tested via recreation)
// ═══════════════════════════════════════════════════════════════════════════

describe('MEDIA_URL_RE pattern', () => {
  // Mirror of the internal regex so we can unit-test the pattern directly
  const MEDIA_URL_RE = /((?:https?:\/\/(?:localhost|127\.0\.0\.1|fal\.media|fal-cdn\.|oaidalleapiprodscus\.|replicate\.delivery)[^\s]+)|(?:\/generated-(?:images|voices|videos)\/[^\s]+))/i

  // --- local generated paths ---
  it('matches /generated-images/ local path', () => {
    const m = '/generated-images/abc123.png'.match(MEDIA_URL_RE)
    expect(m).not.toBeNull()
    expect(m![0]).toBe('/generated-images/abc123.png')
  })

  it('matches /generated-voices/ local path', () => {
    const m = '/generated-voices/narration.mp3'.match(MEDIA_URL_RE)
    expect(m).not.toBeNull()
    expect(m![0]).toBe('/generated-voices/narration.mp3')
  })

  it('matches /generated-videos/ local path', () => {
    const m = '/generated-videos/clip.mp4'.match(MEDIA_URL_RE)
    expect(m).not.toBeNull()
    expect(m![0]).toBe('/generated-videos/clip.mp4')
  })

  // --- trusted external domains ---
  it('matches localhost URL', () => {
    expect(MEDIA_URL_RE.test('https://localhost:4516/image.png')).toBe(true)
  })

  it('matches 127.0.0.1 URL', () => {
    expect(MEDIA_URL_RE.test('http://127.0.0.1:3000/file.jpg')).toBe(true)
  })

  it('matches fal.media URL', () => {
    const m = 'https://fal.media/files/abc/123.png'.match(MEDIA_URL_RE)
    expect(m).not.toBeNull()
  })

  it('matches fal-cdn. subdomain URL', () => {
    expect(MEDIA_URL_RE.test('https://fal-cdn.net/abc.png')).toBe(true)
  })

  it('matches oaidalleapiprodscus. URL', () => {
    expect(MEDIA_URL_RE.test('https://oaidalleapiprodscus.blob.core.windows.net/img.png')).toBe(true)
  })

  it('matches replicate.delivery URL', () => {
    expect(MEDIA_URL_RE.test('https://replicate.delivery/abc/out.png')).toBe(true)
  })

  // --- untrusted / rejected ---
  it('rejects arbitrary external URL', () => {
    expect(MEDIA_URL_RE.test('https://evil.com/payload.exe')).toBe(false)
  })

  it('rejects plain text that is not a URL', () => {
    expect(MEDIA_URL_RE.test('hello world no url here')).toBe(false)
  })

  it('rejects URL with untrusted domain', () => {
    expect(MEDIA_URL_RE.test('https://notfal.media/trick.png')).toBe(false)
  })

  it('rejects /generated-other/ (only images/voices/videos allowed)', () => {
    expect(MEDIA_URL_RE.test('/generated-other/something.txt')).toBe(false)
  })

  // --- embedded in text ---
  it('extracts URL from surrounding text', () => {
    const line = 'Here is the image: /generated-images/photo.jpg please check'
    const m = line.match(MEDIA_URL_RE)
    expect(m).not.toBeNull()
    expect(m![0]).toBe('/generated-images/photo.jpg')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Mission #28 — detectMediaType (internal fn, tested via recreation)
// ═══════════════════════════════════════════════════════════════════════════

describe('detectMediaType', () => {
  // Mirror of the internal function
  function detectMediaType(url: string): 'image' | 'audio' | 'video' | null {
    if (/\/generated-images\/|\.(?:png|jpg|jpeg|gif|webp)(?:\?|$)/i.test(url)) return 'image'
    if (/\/generated-voices\/|\.(?:mp3|wav|ogg)(?:\?|$)/i.test(url)) return 'audio'
    if (/\/generated-videos\/|\.(?:mp4|webm)(?:\?|$)/i.test(url)) return 'video'
    return null
  }

  // --- image extensions ---
  it('returns image for .png', () => {
    expect(detectMediaType('/generated-images/photo.png')).toBe('image')
  })

  it('returns image for .jpg', () => {
    expect(detectMediaType('https://fal.media/files/abc.jpg')).toBe('image')
  })

  it('returns image for .jpeg', () => {
    expect(detectMediaType('https://localhost/pic.jpeg')).toBe('image')
  })

  it('returns image for .gif', () => {
    expect(detectMediaType('https://localhost/anim.gif')).toBe('image')
  })

  it('returns image for .webp', () => {
    expect(detectMediaType('https://localhost/modern.webp')).toBe('image')
  })

  it('returns image for /generated-images/ path regardless of extension', () => {
    expect(detectMediaType('/generated-images/no-ext')).toBe('image')
  })

  // --- audio extensions ---
  it('returns audio for .mp3', () => {
    expect(detectMediaType('/generated-voices/narration.mp3')).toBe('audio')
  })

  it('returns audio for .wav', () => {
    expect(detectMediaType('https://localhost/sound.wav')).toBe('audio')
  })

  it('returns audio for .ogg', () => {
    expect(detectMediaType('https://localhost/clip.ogg')).toBe('audio')
  })

  it('returns audio for /generated-voices/ path regardless of extension', () => {
    expect(detectMediaType('/generated-voices/no-ext')).toBe('audio')
  })

  // --- video extensions ---
  it('returns video for .mp4', () => {
    expect(detectMediaType('/generated-videos/clip.mp4')).toBe('video')
  })

  it('returns video for .webm', () => {
    expect(detectMediaType('https://localhost/stream.webm')).toBe('video')
  })

  it('returns video for /generated-videos/ path regardless of extension', () => {
    expect(detectMediaType('/generated-videos/no-ext')).toBe('video')
  })

  // --- null for unknowns ---
  it('returns null for .txt', () => {
    expect(detectMediaType('https://localhost/readme.txt')).toBeNull()
  })

  it('returns null for .exe', () => {
    expect(detectMediaType('https://localhost/payload.exe')).toBeNull()
  })

  it('returns null for URL with no extension and no generated path', () => {
    expect(detectMediaType('https://localhost/api/data')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(detectMediaType('')).toBeNull()
  })

  // --- query string after extension ---
  it('returns image for .png with query string', () => {
    expect(detectMediaType('https://fal.media/img.png?token=abc')).toBe('image')
  })

  it('returns video for .mp4 with query string', () => {
    expect(detectMediaType('https://replicate.delivery/out.mp4?v=2')).toBe('video')
  })

  it('returns audio for .mp3 with query string', () => {
    expect(detectMediaType('https://localhost/voice.mp3?cb=1')).toBe('audio')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Mission #28 — renderMarkdownLine media URL auto-detection
// ═══════════════════════════════════════════════════════════════════════════

describe('renderMarkdownLine media auto-detection', () => {
  // Helper: check if the React tree contains a MediaBubble component
  function containsMediaBubble(node: React.ReactNode): boolean {
    return flattenElements(node).some(el => {
      // MediaBubble is a function component, check by name
      if (typeof el.type === 'function' && (el.type as Function).name === 'MediaBubble') return true
      // Also check if the props match MediaBubble signature (url + mediaType)
      const props = el.props as Record<string, unknown>
      if (props.url && props.mediaType) return true
      return false
    })
  }

  function getMediaBubbleProps(node: React.ReactNode): { url: string; mediaType: string } | null {
    for (const el of flattenElements(node)) {
      const props = el.props as Record<string, unknown>
      if (props.url && props.mediaType) {
        return { url: props.url as string, mediaType: props.mediaType as string }
      }
    }
    return null
  }

  // --- renders MediaBubble for local generated paths ---
  it('renders MediaBubble for /generated-images/ URL', () => {
    const result = renderMarkdownLine('/generated-images/photo.png', 0)
    expect(containsMediaBubble(result)).toBe(true)
    const props = getMediaBubbleProps(result)
    expect(props).not.toBeNull()
    expect(props!.url).toBe('/generated-images/photo.png')
    expect(props!.mediaType).toBe('image')
  })

  it('renders MediaBubble for /generated-voices/ URL', () => {
    const result = renderMarkdownLine('/generated-voices/narration.mp3', 0)
    expect(containsMediaBubble(result)).toBe(true)
    const props = getMediaBubbleProps(result)
    expect(props!.mediaType).toBe('audio')
  })

  it('renders MediaBubble for /generated-videos/ URL', () => {
    const result = renderMarkdownLine('/generated-videos/clip.mp4', 0)
    expect(containsMediaBubble(result)).toBe(true)
    const props = getMediaBubbleProps(result)
    expect(props!.mediaType).toBe('video')
  })

  // --- renders MediaBubble for trusted external domains ---
  it('renders MediaBubble for fal.media image URL', () => {
    const result = renderMarkdownLine('https://fal.media/files/abc/output.png', 0)
    expect(containsMediaBubble(result)).toBe(true)
    const props = getMediaBubbleProps(result)
    expect(props!.mediaType).toBe('image')
  })

  it('renders MediaBubble for replicate.delivery video URL', () => {
    const result = renderMarkdownLine('https://replicate.delivery/abc/out.mp4', 0)
    expect(containsMediaBubble(result)).toBe(true)
    const props = getMediaBubbleProps(result)
    expect(props!.mediaType).toBe('video')
  })

  // --- does NOT render MediaBubble for untrusted URLs ---
  it('does NOT render MediaBubble for untrusted external URL', () => {
    const result = renderMarkdownLine('https://evil.com/hack.png', 0)
    expect(containsMediaBubble(result)).toBe(false)
  })

  // --- preserves surrounding text ---
  it('preserves surrounding text when media URL is embedded', () => {
    const result = renderMarkdownLine('Check this out /generated-images/photo.png', 0)
    expect(containsMediaBubble(result)).toBe(true)
    const text = extractText(result)
    expect(text).toContain('Check this out')
  })

  it('renders surrounding text and MediaBubble together', () => {
    const result = renderMarkdownLine('Here is the result: /generated-videos/output.mp4', 0)
    expect(containsMediaBubble(result)).toBe(true)
    const text = extractText(result)
    expect(text).toContain('Here is the result:')
    const props = getMediaBubbleProps(result)
    expect(props!.mediaType).toBe('video')
  })

  // --- does NOT break non-media lines ---
  it('does not render MediaBubble for plain text', () => {
    const result = renderMarkdownLine('just some regular text', 0)
    expect(containsMediaBubble(result)).toBe(false)
  })

  it('does not render MediaBubble for headings', () => {
    const result = renderMarkdownLine('# Heading', 0)
    expect(containsMediaBubble(result)).toBe(false)
  })

  it('does not render MediaBubble for empty line', () => {
    const result = renderMarkdownLine('', 0)
    expect(containsMediaBubble(result)).toBe(false)
  })

  // --- edge: trusted domain with unknown extension now infers media type ---
  it('renders MediaBubble for trusted domain even with unknown extension', () => {
    // After trusted-domain feature: fal.media defaults to image regardless of extension
    const result = renderMarkdownLine('https://fal.media/files/abc/readme.txt', 0)
    expect(containsMediaBubble(result)).toBe(true)
    const props = getMediaBubbleProps(result)
    expect(props!.mediaType).toBe('image')
  })

  // --- URL only on its own line ---
  it('renders MediaBubble for a line that is just a media URL', () => {
    const result = renderMarkdownLine('https://localhost:4516/generated-images/out.webp', 0)
    expect(containsMediaBubble(result)).toBe(true)
    const props = getMediaBubbleProps(result)
    expect(props!.mediaType).toBe('image')
  })
})
