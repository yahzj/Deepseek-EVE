
export type Pt = [number, number]

export function line(...pts: Pt[]): string {
  return `M${pts.map(([x, y]) => `${x} ${y}`).join(' L')}`
}

export function poly(...pts: Pt[]): string {
  return `${line(...pts)} Z`
}

export function s(...parts: (string | Pt | Pt[])[]): string {
  return parts.reduce<string>((acc, it) => {
    if (typeof it === 'string') return acc ? `${acc} ${it}` : it
    const pts: Pt[] = typeof it[0] === 'number' ? [it as Pt] : (it as Pt[])
    const seg = pts.length >= 2 ? line(...pts) : ''
    if (!seg) return acc
    return acc ? `${acc} ${seg}` : seg
  }, '')
}

export function nozzle(x: number, y: number, w: number, h: number): string {
  return s(poly([x, y], [x + w, y], [x + w, y + h], [x, y + h]), [[x + 1, y + 1], [x + 1, y + h - 1]], [[x + 3, y + 1], [x + 3, y + h - 1]])
}

export function turret(x: number, y: number, bw: number, bh: number, bl: number, cy: number): string {
  return s(poly([x, y], [x + bw, y], [x + bw, y + bh], [x, y + bh]), poly([x + bw, cy - 2], [x + bw + bl, cy - 2], [x + bw + bl, cy + 2], [x + bw, cy + 2]))
}

export function box(x: number, y: number, w: number, h: number): string {
  return poly([x, y], [x + w, y], [x + w, y + h], [x, y + h])
}

export function cyl(x0: number, x1: number, y0: number, y1: number, ribs: number[]): string {
  return s(box(x0, y0, x1 - x0, y1 - y0), ...ribs.map((rx): Pt[] => [[rx, y0], [rx, y1]]))
}

export function bridge(x0: number, x1: number, y0: number, tiers: { h: number; i: number }[]): string {
  const out: string[] = []
  let a = x0
  let b = x1
  let y = y0
  for (const t of tiers) {
    out.push(box(a, y - t.h, b - a, t.h))
    y -= t.h
    a += t.i
    b -= t.i
  }
  return out.join(' ')
}

export function hex(cx: number, cy: number, r: number): string {
  const w = r * 0.866
  return poly([cx - w, cy - r], [cx + w, cy - r], [cx + w * 2, cy], [cx + w, cy + r], [cx - w, cy + r], [cx - w * 2, cy])
}

export function pod(cx: number, cy: number, rx: number, ry: number): string {
  return `M${cx - rx} ${cy} Q${cx - rx} ${cy - ry} ${cx} ${cy - ry} Q${cx + rx} ${cy - ry} ${cx + rx} ${cy} Q${cx + rx} ${cy + ry} ${cx} ${cy + ry} Q${cx - rx} ${cy + ry} ${cx - rx} ${cy} Z`
}

export function edge(a: Pt, b: Pt, k: number, side: number): string {
  if (!k) return line(a, b)
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len = Math.hypot(dx, dy) || 1
  const nx = -dy / len
  const ny = dx / len
  const kk = Math.min(k, len * 0.35)
  const mx = (a[0] + b[0]) / 2 + nx * kk * side
  const my = (a[1] + b[1]) / 2 + ny * kk * side
  return `Q${mx} ${my} ${b[0]} ${b[1]}`
}

export function blob(pts: Pt[], k = 4): string {
  const n = pts.length
  let cx = 0
  let cy = 0
  for (const [x, y] of pts) {
    cx += x
    cy += y
  }
  cx /= n
  cy /= n
  const first = pts[0]!
  const out: string[] = [`M${first[0]} ${first[1]}`]
  for (let i = 0; i < n; i++) {
    const a = pts[i]!
    const b = pts[(i + 1) % n]!
    const mx = (a[0] + b[0]) / 2
    const my = (a[1] + b[1]) / 2
    const side = (mx - cx) * (b[1] - a[1]) - (my - cy) * (b[0] - a[0]) >= 0 ? 1 : -1
    out.push(edge(a, b, k, side))
  }
  return `${out.join(' ')} Z`
}
