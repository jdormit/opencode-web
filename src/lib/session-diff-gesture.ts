interface DiffGestureInput {
  deltaX: number
  deltaY: number
  scrollLeft: number
  scrollWidth: number
  clientWidth: number
}

export function shouldKeepDiffGesture({
  deltaX,
  deltaY,
  scrollLeft,
  scrollWidth,
  clientWidth,
}: DiffGestureInput) {
  if (Math.abs(deltaY) >= Math.abs(deltaX)) return true

  const maxScroll = Math.max(0, scrollWidth - clientWidth)
  if (deltaX < 0) return scrollLeft < maxScroll - 1
  if (deltaX > 0) return scrollLeft > 1
  return true
}
