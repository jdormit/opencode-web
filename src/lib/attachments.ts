export interface MessageAttachment {
  id: string
  filename: string
  mime: string
  url: string
}

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024

export const ACCEPTED_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]

export const ACCEPTED_FILE_TYPES = [
  ...ACCEPTED_IMAGE_TYPES,
  'application/pdf',
  'text/*',
  'application/json',
  'application/ld+json',
  'application/toml',
  'application/x-toml',
  'application/x-yaml',
  'application/xml',
  'application/yaml',
  '.c',
  '.cc',
  '.cjs',
  '.conf',
  '.cpp',
  '.css',
  '.csv',
  '.cts',
  '.env',
  '.go',
  '.gql',
  '.graphql',
  '.h',
  '.hh',
  '.hpp',
  '.htm',
  '.html',
  '.ini',
  '.java',
  '.js',
  '.json',
  '.jsx',
  '.log',
  '.md',
  '.mdx',
  '.mjs',
  '.mts',
  '.py',
  '.rb',
  '.rs',
  '.sass',
  '.scss',
  '.sh',
  '.sql',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.xml',
  '.yaml',
  '.yml',
  '.zsh',
]

const IMAGE_EXTENSIONS: Record<string, string> = {
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

const TEXT_MIMES = new Set([
  'application/json',
  'application/ld+json',
  'application/toml',
  'application/x-toml',
  'application/x-yaml',
  'application/xml',
  'application/yaml',
])

function extension(filename: string) {
  const dot = filename.lastIndexOf('.')
  return dot === -1 ? '' : filename.slice(dot + 1).toLowerCase()
}

function isTextMime(mime: string) {
  return (
    mime.startsWith('text/') ||
    TEXT_MIMES.has(mime) ||
    mime.endsWith('+json') ||
    mime.endsWith('+xml')
  )
}

function looksLikeText(bytes: Uint8Array) {
  if (bytes.length === 0) return true
  let controlBytes = 0
  for (const byte of bytes) {
    if (byte === 0) return false
    if (byte < 9 || (byte > 13 && byte < 32)) controlBytes += 1
  }
  return controlBytes / bytes.length <= 0.3
}

export async function attachmentMime(file: File): Promise<string | undefined> {
  const declared = file.type.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  if (ACCEPTED_IMAGE_TYPES.includes(declared)) return declared
  if (declared === 'application/pdf') return declared

  const ext = extension(file.name)
  const inferred = IMAGE_EXTENSIONS[ext] ?? (ext === 'pdf' ? 'application/pdf' : undefined)
  if ((!declared || declared === 'application/octet-stream') && inferred) {
    return inferred
  }
  if (isTextMime(declared)) return 'text/plain'

  const sample = new Uint8Array(await file.slice(0, 4096).arrayBuffer())
  return looksLikeText(sample) ? 'text/plain' : undefined
}

function readDataUrl(file: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => resolve(String(reader.result)))
    reader.addEventListener('error', () => reject(reader.error ?? new Error('Could not read file')))
    reader.readAsDataURL(file)
  })
}

export function exifOrientation(bytes: Uint8Array): number | undefined {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 2

  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return
    const marker = bytes[offset + 1]
    if (marker === 0xda || marker === 0xd9) return
    const length = view.getUint16(offset + 2)
    if (length < 2 || offset + 2 + length > bytes.length) return

    if (
      marker === 0xe1 &&
      length >= 16 &&
      bytes[offset + 4] === 0x45 &&
      bytes[offset + 5] === 0x78 &&
      bytes[offset + 6] === 0x69 &&
      bytes[offset + 7] === 0x66 &&
      bytes[offset + 8] === 0 &&
      bytes[offset + 9] === 0
    ) {
      const tiff = offset + 10
      const byteOrder = view.getUint16(tiff)
      const littleEndian = byteOrder === 0x4949
      if (!littleEndian && byteOrder !== 0x4d4d) return
      if (view.getUint16(tiff + 2, littleEndian) !== 0x2a) return

      const directory = tiff + view.getUint32(tiff + 4, littleEndian)
      if (directory + 2 > bytes.length) return
      const entries = view.getUint16(directory, littleEndian)
      for (let index = 0; index < entries; index += 1) {
        const entry = directory + 2 + index * 12
        if (entry + 12 > bytes.length) return
        if (view.getUint16(entry, littleEndian) !== 0x0112) continue
        const orientation = view.getUint16(entry + 8, littleEndian)
        return orientation >= 1 && orientation <= 8 ? orientation : undefined
      }
      return
    }

    offset += 2 + length
  }
}

async function normalizeJpegOrientation(file: File): Promise<Blob> {
  const header = new Uint8Array(await file.slice(0, 64 * 1024).arrayBuffer())
  const orientation = exifOrientation(header)
  if (!orientation || orientation === 1 || typeof createImageBitmap !== 'function') {
    return file
  }

  let bitmap: ImageBitmap | undefined
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d')
    if (!context) return file
    context.drawImage(bitmap, 0, 0)
    return await new Promise<Blob>((resolve) => {
      canvas.toBlob((blob) => resolve(blob ?? file), 'image/jpeg', 0.92)
    })
  } catch {
    return file
  } finally {
    bitmap?.close()
  }
}

function attachmentId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `attachment-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export async function createAttachment(file: File): Promise<MessageAttachment> {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`${file.name} is larger than 10 MB`)
  }
  const mime = await attachmentMime(file)
  if (!mime) throw new Error(`${file.name} is not a supported file type`)
  const content = mime === 'image/jpeg' ? await normalizeJpegOrientation(file) : file

  return {
    id: attachmentId(),
    filename: file.name || 'attachment',
    mime,
    url: await readDataUrl(content),
  }
}
