import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createFoeSpecs } from '../src/combat/foes/catalog'
import { denseBattleLayout } from '../../../apps/desktop/src/renderer/src/features/combat/battleDenseGeometry'

function scene(count: number, W: number, distance = 10000, mixed = false) {
  const foes = Array.from({ length: count }, (_, i) => mixed ? [210, 90, 130, 170][i % 4]! : 170)
  const players = [170, 90, 130, 170, 90]
  return denseBattleLayout({ W, H: 430, meW: 170, foeW: 170 }, foes, players, distance, 10000, 200)
}

describe('敌我镜像紧凑梯形布局', () => {
  it.each([5, 7, 9, 12])('%i舰在宽屏收至140像素中心距，第二/第三排各后移24像素', count => {
    const lay = scene(count, 1540)
    const rows = lay.formation.rows
    expect(lay.formation.shift).toBe(24)
    lay.foe.forEach((point, i) => {
      const col = Math.floor(i / rows), row = i % rows
      expect(point.x).toBeCloseTo(lay.foe[0]!.x + col * 140 + row * 24)
      expect(point.y).toBe(78 + row * 104)
    })
  })

  it('舰体尺寸、血条宽度及双方首排最前锚点保持原口径', () => {
    for (const W of [760, 1100, 1540, 1920]) for (const count of [5, 7, 9, 12]) for (const distance of [200, 5000, 10000]) {
      const lay = scene(count, W, distance, true)
      const available = (W - 36 - 48) / 2
      const approach = (10000 - distance) / 9800
      const shift = approach * Math.min(12, available * .04)
      const cols = count > 8 ? 4 : 3
      const originalCell = available / cols
      expect(lay.foe[0]!.x).toBeCloseTo(W / 2 + 24 - shift + originalCell / 2)
      expect(lay.formation.colW).toEqual(Array(cols).fill(originalCell))
      expect(lay.sizes).toEqual(Array.from({ length: count }, (_, i) => Math.max(16,
        Math.round(Math.min(96, originalCell - 14) * [210, 90, 130, 170][i % 4]! / 210))))
      expect(lay.me.x).toBeCloseTo(18 + shift + available - available / 6)
      expect(lay.myBarW).toBe(Math.min(112, available / 3 - 8))
    }
  })

  it('窄窗/增援/减员及远近两端中，舰体和血条不越界，同排保留至少8像素间隔', () => {
    for (const W of [360, 540, 760, 1008, 1100, 1280, 1540, 1920]) {
      for (let count = 1; count <= 12; count++) for (const distance of [200, 10000]) {
        const lay = scene(count, W, distance, true)
        const rows = lay.formation.rows
        const barW = Math.min(112, lay.formation.colW[0]! - 8)
        const footprint = (i: number) => Math.max(lay.sizes[i]!, barW)
        lay.foe.forEach((point, i) => {
          expect(Number.isFinite(point.x)).toBe(true)
          expect(point.x - footprint(i) / 2).toBeGreaterThanOrEqual(W / 2)
          expect(point.x + footprint(i) / 2).toBeLessThanOrEqual(W - 18 + 1e-8)
          expect(point.x + footprint(i) / 2).toBeLessThanOrEqual(lay.foeLeft + lay.formation.rowW + 1e-8)
          if (i + rows < count) {
            const gap = lay.foe[i + rows]!.x - footprint(i + rows) / 2 - (point.x + footprint(i) / 2)
            expect(gap).toBeGreaterThanOrEqual(8 - 1e-8)
            expect(lay.foe[i + rows]!.x - point.x).toBeLessThanOrEqual(140 + 1e-8)
          }
          if (i % rows > 0) expect(point.x - lay.foe[i - 1]!.x).toBeCloseTo(lay.formation.shift)
        })
      }
    }
  })

  it('密集模式的1～4舰保留首舰锚点，小编队同样使用紧凑列距与后移', () => {
    for (let count = 1; count <= 4; count++) for (const W of [760, 1100, 1540, 1920]) {
      const lay = scene(count, W)
      const cell = ((W - 84) / 2) / (count > 1 ? 2 : 1)
      const rows = lay.formation.rows
      const pitch = count > 1 ? Math.min(140, cell) : 0
      const stagger = rows > 1 ? 24 : 0
      expect(lay.formation.shift).toBe(stagger)
      lay.foe.forEach((point, i) => {
        expect(point.x).toBeCloseTo(W / 2 + 24 + cell / 2 + Math.floor(i / rows) * pitch + i % rows * stagger)
        expect(point.y).toBe(78 + i % rows * 104)
      })
    }
  })

  it('距离仅平移敌方阵形，内部列距及逐排错位不抖动', () => {
    const near = scene(12, 1540, 200), far = scene(12, 1540)
    near.foe.forEach((point, i) => {
      expect(point.x - near.foe[0]!.x).toBeCloseTo(far.foe[i]!.x - far.foe[0]!.x)
      expect(point.y).toBe(far.foe[i]!.y)
    })
  })

  it('玩家侧使用紧凑列距并向左后移，主控锚点不变且舰体和血条不越界', () => {
    for (const W of [360, 540, 760, 1008, 1100, 1280, 1540, 1920]) {
      for (let count = 1; count <= 12; count++) for (const distance of [200, 5000, 10000]) {
        const players = Array.from({ length: count }, (_, i) => [110, 140, 170, 205, 240][i % 5]!)
        const lay = denseBattleLayout({ W, H: 430, meW: 170, foeW: 170 }, [240, 170, 140, 110, 170],
          players, distance, 10000, 200)
        const available = (W - 84) / 2, cols = count > 8 ? 4 : count > 4 ? 3 : count > 1 ? 2 : 1
        const rows = Math.ceil(count / cols), cell = available / cols
        const approachShift = (10000 - distance) / 9800 * Math.min(12, available * .04)
        const half = Math.max(...lay.mySizes, lay.myBarW) / 2
        const pitch = cols > 1 ? Math.max(Math.min(cell, half * 2 + 8), Math.min(140, cell,
          (available - cell / 2 - half - (rows - 1) * 24) / (cols - 1))) : cell
        const stagger = count > 1 && rows > 1 ? Math.max(0, Math.min(24,
          (available - cell / 2 - half - (cols - 1) * pitch) / (rows - 1))) : 0
        expect(lay.me).toEqual(lay.my[0])
        expect(lay.me.x).toBeCloseTo(18 + approachShift + available - cell / 2)
        lay.my.forEach((point, i) => {
          const col = Math.floor(i / rows), rank = i % rows
          expect(point.x).toBeCloseTo(lay.me.x - col * pitch - rank * stagger)
          expect(point.y).toBe(78 + rank * 104)
          expect(point.x - Math.max(lay.mySizes[i]!, lay.myBarW) / 2).toBeGreaterThanOrEqual(18 - 1e-8)
          expect(point.x + Math.max(lay.mySizes[i]!, lay.myBarW) / 2).toBeLessThanOrEqual(W / 2 + 1e-8)
          if (rank > 0 && stagger > 0) expect(point.x).toBeLessThan(lay.my[i - 1]!.x)
          if (i + rows < count) {
            const nextWidth = Math.max(lay.mySizes[i + rows]!, lay.myBarW)
            const width = Math.max(lay.mySizes[i]!, lay.myBarW)
            expect(point.x - lay.my[i + rows]!.x).toBeCloseTo(pitch)
            expect(point.x - width / 2 - lay.my[i + rows]!.x - nextWidth / 2).toBeGreaterThanOrEqual(8 - 1e-8)
            expect(pitch).toBeLessThanOrEqual(140)
          }
        })
      }
    }
  })

  it('等数量等尺寸时整阵逐舰严格镜像，包含列距、错位、行距及远近两端', () => {
    for (const W of [360, 540, 760, 1008, 1100, 1280, 1540, 1920]) {
      for (let count = 1; count <= 12; count++) for (const distance of [200, 5000, 10000]) {
        const sizes = Array.from({ length: count }, (_, i) => [240, 110, 170, 205, 140][i % 5]!)
        const lay = denseBattleLayout({ W, H: 430, meW: 170, foeW: 170 }, sizes, sizes, distance, 10000, 200)
        lay.my.forEach((point, i) => {
          expect(point.x + lay.foe[i]!.x).toBeCloseTo(W)
          expect(point.y).toBe(lay.foe[i]!.y)
          expect(lay.mySizes[i]).toBe(lay.sizes[i])
        })
      }
    }
  })

  it('交换敌我不同编成后，列距和边界适配也逐舰镜像，不分玩家/敌方特例', () => {
    for (const W of [760, 1100, 1540, 1920]) for (const distance of [200, 10000]) {
      for (const mine of [1, 4, 5, 7, 9, 12]) for (const foe of [1, 4, 5, 7, 9, 12]) {
        const players = Array.from({ length: mine }, (_, i) => [110, 170, 240][i % 3]!)
        const enemies = Array.from({ length: foe }, (_, i) => [205, 140][i % 2]!)
        const original = denseBattleLayout({ W, H: 430, meW: 170, foeW: 170 }, enemies, players, distance, 10000, 200)
        const swapped = denseBattleLayout({ W, H: 430, meW: 170, foeW: 170 }, players, enemies, distance, 10000, 200)
        original.my.forEach((point, i) => {
          expect(point.x + swapped.foe[i]!.x).toBeCloseTo(W)
          expect(point.y).toBe(swapped.foe[i]!.y)
        })
        original.foe.forEach((point, i) => {
          expect(point.x + swapped.my[i]!.x).toBeCloseTo(W)
          expect(point.y).toBe(swapped.my[i]!.y)
        })
      }
    }
  })

  it('玩家后移方向与敌方镜像，远近两端的内部错列一致', () => {
    const sizes = Array(12).fill(170)
    const make = (W: number, distance: number) => denseBattleLayout({ W, H: 430, meW: 170, foeW: 170 },
      sizes, sizes, distance, 10000, 200)
    const wide = make(1920, 10000)
    expect(wide.my[1]!.x - wide.my[0]!.x).toBe(-24)
    expect(wide.my[2]!.x - wide.my[0]!.x).toBe(-48)
    expect(wide.foe[1]!.x - wide.foe[0]!.x).toBe(24)
    expect(wide.foe[2]!.x - wide.foe[0]!.x).toBe(48)
    for (const W of [760, 1100, 1540, 1920]) {
      const near = make(W, 200), far = make(W, 10000)
      near.my.forEach((point, i) => {
        expect(point.x - near.me.x).toBeCloseTo(far.my[i]!.x - far.me.x)
        expect(point.y).toBe(far.my[i]!.y)
      })
    }
  })

  it('蜃影悬赏的5敌舰不会把我方2～4舰按半个战场宽度拉散', () => {
    const ctx = buildSimContext()
    const card = ctx.anomalies.get('ano-mirage-hijackers')!
    const foes = createFoeSpecs(card, ctx.balance.battle)
    expect(foes).toHaveLength(5)
    for (const count of [2, 3, 4]) for (const W of [760, 1540, 1920, 2560]) for (const distance of [200, 10000]) {
      const players = Array.from({ length: count }, (_, i) => [110, 240, 170, 140][i]!)
      const lay = denseBattleLayout({ W, H: 430, meW: 170, foeW: 170 }, foes.map(() => 170), players, distance, 10000, 200)
      const rows = Math.ceil(count / 2)
      for (let i = 0; i + rows < count; i++) {
        const pitch = lay.my[i]!.x - lay.my[i + rows]!.x
        expect(pitch).toBeGreaterThanOrEqual(lay.myBarW + 8)
        expect(pitch).toBeLessThanOrEqual(140)
      }
      const spread = Math.max(...lay.my.map(point => point.x)) - Math.min(...lay.my.map(point => point.x))
      expect(spread).toBeLessThanOrEqual(140 + (rows - 1) * 24)
    }
  })

  it.each([5, 7, 9, 12])('面对%i艘敌舰时，我方小编队不会随窗口宽度拉散', enemyCount => {
    for (const count of [2, 3, 4]) for (const W of [760, 1540, 1920, 2560]) for (const distance of [200, 10000]) {
      const players = Array.from({ length: count }, (_, i) => [110, 240, 170, 140][i]!)
      const enemies = Array.from({ length: enemyCount }, (_, i) => [205, 140][i % 2]!)
      const lay = denseBattleLayout({ W, H: 430, meW: 170, foeW: 170 }, enemies, players, distance, 10000, 200)
      const rows = Math.ceil(count / 2)
      for (let i = 0; i + rows < count; i++) {
        expect(lay.my[i]!.x - lay.my[i + rows]!.x).toBeLessThanOrEqual(140)
      }
      const spread = Math.max(...lay.my.map(point => point.x)) - Math.min(...lay.my.map(point => point.x))
      expect(spread).toBeLessThanOrEqual(140 + (rows - 1) * 24)
    }
  })
})
