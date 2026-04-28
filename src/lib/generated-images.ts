import type { GeneratedImage } from './conjure/types'

export function isLocalGeneratedImageUrl(url: string): boolean {
  return url.startsWith('/generated-images/') && !url.includes('..')
}

export async function localGeneratedImageExists(url: string, basePath = ''): Promise<boolean> {
  if (!isLocalGeneratedImageUrl(url)) return true

  const requestUrl = `${basePath}${url}`
  try {
    const response = await fetch(requestUrl, { method: 'HEAD', cache: 'no-store' })
    if (response.ok) return true
    if (response.status !== 405) return false

    const fallbackResponse = await fetch(requestUrl, { method: 'GET', cache: 'no-store' })
    return fallbackResponse.ok
  } catch {
    return true
  }
}

export async function findMissingLocalGeneratedImageIds(
  images: GeneratedImage[],
  exists: (url: string) => Promise<boolean>,
): Promise<string[]> {
  const missingIds: string[] = []

  for (const image of images) {
    if (!isLocalGeneratedImageUrl(image.url)) continue
    if (await exists(image.url)) continue
    missingIds.push(image.id)
  }

  return missingIds
}
