import type { RouteImage } from '../model/schema'

export const MAX_IMAGE_EDGE = 2400
export const MAX_UPLOAD_BYTES = 40 * 1024 * 1024

function decode(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('The browser could not decode this image. Try a JPEG or PNG (HEIC is not supported in most browsers).'))
    img.src = src
  })
}

/**
 * Load a user photo, downscale it to at most MAX_IMAGE_EDGE px on the long
 * edge, and re-encode it. Re-encoding bakes in EXIF orientation and strips
 * metadata such as GPS location before the image is embedded in route files.
 * Hold coordinates are normalized, so the downscale never affects them.
 */
export async function readImageFile(file: File): Promise<RouteImage> {
  if (!file.type.startsWith('image/')) {
    throw new Error(`"${file.name}" is not an image.`)
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`"${file.name}" is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`)
  }
  const url = URL.createObjectURL(file)
  try {
    const img = await decode(url)
    const w0 = img.naturalWidth
    const h0 = img.naturalHeight
    if (!w0 || !h0) throw new Error('Image has no pixels.')
    const k = Math.min(1, MAX_IMAGE_EDGE / Math.max(w0, h0))
    const width = Math.max(1, Math.round(w0 * k))
    const height = Math.max(1, Math.round(h0 * k))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D is unavailable in this browser.')
    ctx.drawImage(img, 0, 0, width, height)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9)
    return { name: file.name, width, height, dataUrl }
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function downloadText(filename: string, text: string, mime = 'application/json') {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
