export function catalogFallbackThumbnail(category: string | null | undefined): string | undefined {
  switch (category) {
    case 'stylized-nature':
      return '/thumbs/catalog-fallbacks/stylized-nature.svg'
    case 'fantasy-props':
      return '/thumbs/catalog-fallbacks/fantasy-props.svg'
    case 'scifi-megakit':
      return '/thumbs/catalog-fallbacks/scifi-megakit.svg'
    default:
      return undefined
  }
}

export const FUNCTIONAL_THUMBNAIL_URL = '/thumbs/functional/functional-control.svg'
