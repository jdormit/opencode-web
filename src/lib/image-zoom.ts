export const FIT_IMAGE = { scale: 1, x: 0, y: 0 }

export function zoomImage(
  view: typeof FIT_IMAGE,
  scale: number,
  anchor = { x: 0, y: 0 },
) {
  scale = Math.min(5, Math.max(1, scale))
  if (scale === 1) return FIT_IMAGE
  const ratio = scale / view.scale
  return {
    scale,
    x: anchor.x - (anchor.x - view.x) * ratio,
    y: anchor.y - (anchor.y - view.y) * ratio,
  }
}
