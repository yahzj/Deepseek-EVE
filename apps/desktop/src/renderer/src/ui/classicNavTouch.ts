/** 旧版触屏导航：只管单指滚动，尺寸/排列仍使用网页版规则。 */
export function bindClassicNavTouchScroll(scroll: HTMLElement): () => void {
  const host = scroll.ownerDocument.defaultView!
  const pointers = new Set<number>()
  let drag: { id: number; x: number; y: number; top: number; b: number; d: number; scale: number; moved: boolean } | null = null
  let suppressClick = false
  let timer = 0
  const clearSuppression = () => { host.clearTimeout(timer); suppressClick = false }
  const release = () => {
    if (drag && scroll.hasPointerCapture(drag.id)) scroll.releasePointerCapture(drag.id)
    drag = null
  }
  const suppress = () => {
    suppressClick = true
    host.clearTimeout(timer)
    timer = host.setTimeout(clearSuppression, 600)
  }
  const down = (event: PointerEvent) => {
    if (event.pointerType !== 'touch') return
    if (!drag && pointers.size === 0 && !scroll.contains(event.target as Node)) return
    pointers.add(event.pointerId)
    if (pointers.size > 1) { if (drag?.moved) suppress(); release(); return }
    clearSuppression()
    if (scroll.scrollHeight <= scroll.clientHeight) return
    const root = scroll.closest('.app-root')
    const transform = root ? host.getComputedStyle(root).transform : 'none'
    const matrix = new DOMMatrix(transform === 'none' ? undefined : transform)
    const inverse = matrix.inverse()
    const scale = Math.hypot(matrix.a, matrix.b)
    if (![inverse.b, inverse.d, scale].every(Number.isFinite) || scale <= 0) return
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, top: scroll.scrollTop,
      b: inverse.b, d: inverse.d, scale, moved: false }
  }
  const move = (event: PointerEvent) => {
    if (!drag || drag.id !== event.pointerId || pointers.size !== 1) return
    // 逆矩阵只换算位移，不受旋转层对齐偏移影响；阈值使用物理像素。
    const delta = drag.b * (event.clientX - drag.x) + drag.d * (event.clientY - drag.y)
    if (!drag.moved && Math.abs(delta) * drag.scale < 8) return
    if (!drag.moved) { drag.moved = true; scroll.setPointerCapture(event.pointerId) }
    if (event.cancelable) event.preventDefault()
    scroll.scrollTop = Math.max(0, Math.min(scroll.scrollHeight - scroll.clientHeight, drag.top - delta))
  }
  const end = (event: PointerEvent) => {
    pointers.delete(event.pointerId)
    if (drag?.id !== event.pointerId) return
    if (drag.moved) suppress()
    release()
  }
  const click = (event: MouseEvent) => {
    if (!suppressClick) return
    event.preventDefault()
    event.stopImmediatePropagation()
    clearSuppression()
  }
  scroll.classList.add('is-touch-scroll')
  host.addEventListener('pointerdown', down)
  host.addEventListener('pointermove', move, { passive: false })
  host.addEventListener('pointerup', end)
  host.addEventListener('pointercancel', end)
  scroll.addEventListener('click', click, true)
  return () => {
    release(); pointers.clear(); clearSuppression()
    scroll.classList.remove('is-touch-scroll')
    host.removeEventListener('pointerdown', down)
    host.removeEventListener('pointermove', move)
    host.removeEventListener('pointerup', end)
    host.removeEventListener('pointercancel', end)
    scroll.removeEventListener('click', click, true)
  }
}
