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
    const halfWidth = Math.max(...sizes, Math.min(112, cell - 8)) / 2
    // 对侧超过4舰也会启用本布局，不能让本侧2～4舰继续按半边窗口均分。
    const compact = input.length > 1
    // 两侧共用列距和后排错位，只镜像方向；首排最前锚点不变。
    const minPitch = Math.min(cell, halfWidth * 2 + 8)
    const pitch = compact && cols > 1 ? Math.max(minPitch, Math.min(140, cell,
      (available - cell / 2 - halfWidth - (rows - 1) * 24) / (cols - 1))) : cell
    const stagger = compact && rows > 1 ? Math.max(0, Math.min(24,
      (available - cell / 2 - halfWidth - (cols - 1) * pitch) / (rows - 1))) : 0
    const anchors: Anchor[] = input.map((_, index) => {
      const col = Math.floor(index / rows)
      const row = index % rows
      const offset = cell / 2 + col * pitch + row * stagger
      return { x: left + (mirror ? available - offset : offset), y: 78 + row * rowH }
    })
    return { cols, rows, cell, sizes, rowH, anchors, stagger, halfWidth }
  }
  const mine = side(players, pad + shift, true)
  const enemyLeft = W / 2 + gap / 2 - shift
  const enemy = side(foes, enemyLeft, false)
  const formation = { rows: enemy.rows, rowH: enemy.rowH, shift: enemy.stagger, drop: enemy.rowH,
    rowW: foes.length > 4 ? Math.max(0, ...enemy.anchors.map(anchor => anchor.x - enemyLeft + enemy.halfWidth)) : available,
    colW: Array(enemy.cols).fill(enemy.cell),
    slots: foes.map((_, index) => ({ row: index % enemy.rows, col: Math.floor(index / enemy.rows), raise: 0 })) }
  return { dense: true as const, mySizes: mine.sizes, myBarW: Math.min(112, mine.cell - 8),
    meLeft: mine.anchors[0]!.x - mine.sizes[0]! / 2, foeLeft: enemyLeft,
    me: mine.anchors[0]!, my: mine.anchors, foe: enemy.anchors, sizes: enemy.sizes,
    foeBottom: 78 + (enemy.rows - 1) * enemy.rowH + 24, formation, usable: Math.max(1, available - 24) }
}
