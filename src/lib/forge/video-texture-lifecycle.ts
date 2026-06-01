export const VIDEO_TEXTURE_WARMUP_FRAMES = 4

export type VideoElementReadiness = {
  readyState?: number
  videoWidth?: number
  videoHeight?: number
}

export type VideoTextureUploadTarget = {
  needsUpdate: boolean
}

export function hasDecodedVideoPixels(video: VideoElementReadiness): boolean {
  return typeof video.videoWidth === 'number'
    && typeof video.videoHeight === 'number'
    && Number.isFinite(video.videoWidth)
    && Number.isFinite(video.videoHeight)
    && video.videoWidth > 0
    && video.videoHeight > 0
}

export function shouldCreateVideoTexture(args: {
  video: VideoElementReadiness
  supportsFrameCallback: boolean
  presentedFrameCount: number
}): boolean {
  if (!hasDecodedVideoPixels(args.video)) return false
  return !args.supportsFrameCallback || args.presentedFrameCount > 0
}

export function shouldContinueVideoTextureWarmup(
  presentedFrameCount: number,
  maxFrames = VIDEO_TEXTURE_WARMUP_FRAMES,
): boolean {
  return presentedFrameCount < Math.max(1, maxFrames)
}

export function markVideoTextureNeedsUpload<T extends VideoTextureUploadTarget | null | undefined>(texture: T): T {
  if (texture) texture.needsUpdate = true
  return texture
}
