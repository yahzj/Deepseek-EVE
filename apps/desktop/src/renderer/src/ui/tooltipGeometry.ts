/** 尺寸与定位共用逻辑空间；手机旋转后不使用物理视口宽高。 */
export function tooltipLayout(bounds: { bw: number; bh: number; rot: boolean }, anchor: { x: number; y: number }, size?: { width: number; height: number }) {
  const pad = 8
  const maxWidth = Math.max(1, Math.min(bounds.rot ? 600 : 560, bounds.bw - pad * 2))
  const maxHeight = Math.max(1, Math.min(bounds.bh * (bounds.rot ? .62 : .8), bounds.bh - pad * 2))
  const width = Math.min(maxWidth, size?.width ?? maxWidth), height = Math.min(maxHeight, size?.height ?? 160)
  let x = anchor.x + 14, y = anchor.y + 16
  if (x + width + pad > bounds.bw) x = anchor.x - width - 12
  if (y + height + pad > bounds.bh) y = anchor.y - height - 10
  return { maxWidth, maxHeight,
    x: Math.round(Math.max(pad, Math.min(bounds.bw - width - pad, x))),
    y: Math.round(Math.max(pad, Math.min(bounds.bh - height - pad, y))),
  }
}
