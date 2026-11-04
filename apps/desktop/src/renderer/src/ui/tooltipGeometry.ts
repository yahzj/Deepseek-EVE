/** 尺寸与定位共用逻辑空间；手机旋转后不使用物理视口宽高。 */
export function tooltipLayout(
  bounds: { bw: number; bh: number; rot: boolean },
  anchor: { x: number; y: number },
  size?: { width: number; height: number }
) {
  const pad = 8
  const maxWidth = Math.max(1, Math.min(bounds.rot ? 600 : 560, bounds.bw - pad * 2))
  const maxHeight = Math.max(1, Math.min(bounds.bh * (bounds.rot ? 0.62 : 0.8), bounds.bh - pad * 2))
  const width = Math.min(maxWidth, size?.width ?? Math.min(maxWidth, 240))
  const height = Math.min(maxHeight, size?.height ?? Math.min(maxHeight, 90))
  let x = anchor.x + 14
  let y = anchor.y + 16
  if (x + width + pad > bounds.bw) x = anchor.x - width - 12
  if (y + height + pad > bounds.bh) y = anchor.y - height - 10
  const maxAllowedX = Math.max(pad, bounds.bw - width - pad)
  const maxAllowedY = Math.max(pad, bounds.bh - height - pad)
  return {
    maxWidth,
    maxHeight,
    x: Math.round(Math.max(pad, Math.min(maxAllowedX, x))),
    y: Math.round(Math.max(pad, Math.min(maxAllowedY, y))),
  }
}
