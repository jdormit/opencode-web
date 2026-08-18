import { describe, expect, test } from 'bun:test'
import {
  attachmentMime,
  exifOrientation,
  MAX_ATTACHMENT_BYTES,
} from './attachments'

describe('attachmentMime', () => {
  test('accepts images and PDFs', async () => {
    expect(await attachmentMime(new File(['image'], 'photo.png', { type: 'image/png' }))).toBe('image/png')
    expect(await attachmentMime(new File(['pdf'], 'doc.pdf', { type: 'application/pdf' }))).toBe('application/pdf')
  })

  test('normalizes text-like files', async () => {
    expect(await attachmentMime(new File(['{}'], 'data.json', { type: 'application/json' }))).toBe('text/plain')
    expect(await attachmentMime(new File(['const x = 1'], 'code.ts'))).toBe('text/plain')
  })

  test('rejects binary files', async () => {
    const bytes = new Uint8Array([0, 1, 2, 3])
    expect(await attachmentMime(new File([bytes], 'archive.zip', { type: 'application/zip' }))).toBeUndefined()
  })

  test('uses a 10 MB per-file limit', () => {
    expect(MAX_ATTACHMENT_BYTES).toBe(10 * 1024 * 1024)
  })
})

describe('exifOrientation', () => {
  test('reads orientation from a JPEG EXIF segment', () => {
    const jpeg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe1, 0x00, 0x22,
      0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
      0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08,
      0x00, 0x01,
      0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, 0x06, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
    ])
    expect(exifOrientation(jpeg)).toBe(6)
  })

  test('ignores data without JPEG EXIF orientation', () => {
    expect(exifOrientation(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeUndefined()
    expect(exifOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBeUndefined()
  })
})
