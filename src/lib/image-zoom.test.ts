import { expect, test } from 'bun:test'
import { FIT_IMAGE, zoomImage } from './image-zoom'

test('limits image zoom to fit through 5x', () => {
  expect(zoomImage(FIT_IMAGE, 10).scale).toBe(5)
  expect(zoomImage({ scale: 2, x: 50, y: 70 }, 0.5)).toEqual(FIT_IMAGE)
})

test('keeps the point under a zoom gesture stationary', () => {
  expect(zoomImage(FIT_IMAGE, 2, { x: 100, y: 50 }))
    .toEqual({ scale: 2, x: -100, y: -50 })
})

test('zooming back to fit clears panning', () => {
  expect(zoomImage({ scale: 3, x: -200, y: 100 }, 1)).toEqual(FIT_IMAGE)
})
