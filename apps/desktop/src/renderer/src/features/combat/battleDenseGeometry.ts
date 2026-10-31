interface Dims { W: number; H: number; meW: number; foeW: number }
interface Anchor { x: number; y: number }

/** 大编队共享阵形；距离只平移阵列，不挤压同排机位。 */
export function denseBattleLayout(d: Dims, foes: readonly number[], players: readonly number[], visM: number, farM: number, nearM: number) {
  const W = Math.max(360, d.W)
  const pad = 18
  const gap = 48
  const available = (W - pad * 2 - gap) / 2
  const approach = Math.max(0, Math.min(1, (farM - visM) / Math.max(1, farM - nearM)))
  const shift = approach * Math.min(12, available * .04)
  function side(input: readonly number[], left: number, mirror: boolean) {
    const cols = input.length > 8 ? 4 : input.length > 4 ? 3 : input.length > 1 ? 2 : 1
    const rows = Math.max(1, Math.ceil(input.length / cols))
    const cell = available / cols
    const max = Math.max(1, ...input)
    const sizes = input.map(size => Math.max(16, Math.round(Math.min(96, cell - 14) * size / max)))
    const rowH = 104
    const anchors: Anchor[] = input.map((_, index) => {
      const col = Math.floor(index / rows)
      const row = index % rows
      return { x: left + (mirror ? cols - col - .5 : col + .5) * cell, y: 78 + row * rowH }
    })
    return { cols, rows, cell, sizes, rowH, anchors }
  }
  const mine = side(players, pad + shift, true)
  const enemy = side(foes, W / 2 + gap / 2 - shift, false)
  const formation = { rows: enemy.rows, rowH: enemy.rowH, shift: 0, drop: enemy.rowH,
    rowW: available, colW: Array(enemy.cols).fill(enemy.cell),
    slots: foes.map((_, index) => ({ row: index % enemy.rows, col: Math.floor(index / enemy.rows), raise: 0 })) }
  return { dense: true as const, mySizes: mine.sizes, myBarW: Math.min(112, mine.cell - 8),
    meLeft: mine.anchors[0]!.x - mine.sizes[0]! / 2, foeLeft: W / 2 + gap / 2 - shift,
    me: mine.anchors[0]!, my: mine.anchors, foe: enemy.anchors, sizes: enemy.sizes,
    foeBottom: 78 + (enemy.rows - 1) * enemy.rowH + 24, formation, usable: Math.max(1, available - 24) }
}
