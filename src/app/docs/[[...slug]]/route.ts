import { access, readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'

import { NextResponse } from 'next/server'

const docsRoot = resolve(process.cwd(), 'public', 'docs-site')

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml; charset=utf-8',
}

function safeResolve(...segments: string[]) {
  const target = resolve(docsRoot, ...segments)
  if (target !== docsRoot && !target.startsWith(`${docsRoot}${sep}`)) {
    return null
  }
  return target
}

async function pathExists(path: string) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function resolveDocsTarget(slug: string[]) {
  if (slug.length === 0) {
    return safeResolve('index.html')
  }

  const candidate = safeResolve(...slug)
  if (!candidate) {
    return null
  }

  const lastSegment = slug[slug.length - 1]
  if (lastSegment.includes('.') && await pathExists(candidate)) {
    return candidate
  }

  const nestedIndex = safeResolve(...slug, 'index.html')
  if (nestedIndex && await pathExists(nestedIndex)) {
    return nestedIndex
  }

  const htmlFile = `${candidate}.html`
  if (await pathExists(htmlFile)) {
    return htmlFile
  }

  if (await pathExists(candidate)) {
    return candidate
  }

  return null
}

function contentTypeFor(path: string) {
  return CONTENT_TYPES[extname(path).toLowerCase()] || 'application/octet-stream'
}

function notBuiltResponse() {
  return new NextResponse(
    [
      '<!doctype html>',
      '<html><head><meta charset="utf-8"><title>Docs not built</title></head>',
      '<body style="font-family: system-ui, sans-serif; padding: 32px; background: #08111b; color: #e7f0f8;">',
      '<h1 style="margin-top: 0;">Local docs are not built yet.</h1>',
      '<p>Run <code>pnpm docs:local</code>, then refresh <code>/docs</code>.</p>',
      '</body></html>',
    ].join(''),
    {
      status: 503,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      },
    },
  )
}

export async function GET(
  request: Request,
  { params }: { params: { slug?: string[] } },
) {
  const slug = params.slug ?? []
  const docsIndex = safeResolve('index.html')

  if (!docsIndex || !await pathExists(docsIndex)) {
    return notBuiltResponse()
  }

  if (slug.length === 0 || (slug.length === 1 && slug[0] === 'index.html')) {
    return NextResponse.redirect(new URL('/docs/getting-started/quickstart', request.url), 307)
  }

  const target = await resolveDocsTarget(slug)
  if (!target) {
    return new NextResponse('Not found', { status: 404 })
  }

  const body = await readFile(target)
  const isHtml = extname(target).toLowerCase() === '.html'

  return new NextResponse(body, {
    headers: {
      'content-type': contentTypeFor(target),
      'cache-control': isHtml ? 'no-store' : 'public, max-age=31536000, immutable',
    },
  })
}
