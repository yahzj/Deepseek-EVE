/**
 * 虫洞族专属舰船：**槽位基准线** ＋ **鱼雷舰强化批**（船长 2026-09-14「可以」）。
 *
 * 口径（正文 = `packages/data/src/ships.ts` 各条注释 ＋ `tools/content-check.ts` 的同名契约）：
 * ① **槽位基准线**（船长原话）：「默认的舰船，按级别分别是 7/9/11/14/18 个槽位。
 *    种族专属的会在这个基础上 +1 槽位」⇒ **专属 T1 = 8 / T2 = 10 / T3 = 12**（专属目前只有 T1~T3）。
 *    ⚠ 只钉专属舰；官方 23 艘里 19 艘不在线上（船长 2026-09-14 已收到核对表，待另裁）。
 * ② **鱼雷舰强化**：构件 **火力加成 +25 点**（0.25 → 0.50）· 亡军 **+20 点**（0.62 → 0.82）＋
 *    **中槽→高槽**（5/5/3 → 6/4/2，守「专属巡洋 = 12 槽」）；亡军代价 = **命中 −0.10**（0.21 → 0.11）·
 *    **回避 −0.10**（0.105 → 0.005）。
 * ⚠ 火力加成**只喂炮台**（`combat.ts` 的 `dmgScale = …×(1+powerBonus)×…`），不含无人机
 * （无人机走 `droneDmgBonus`，见词典「无人机专属加成」）。
 */
import { describe, expect, it } from 'vitest'
import { MODULES, SHIPS } from '@whale/data'
import type { SimContext } from '../src/types'
import type { GameState } from '../src/state'
import { createInitialState } from '../src/state'
import { addShipToFleet } from '../src/shipyard'
import { createPlayerSpec } from '../src/combat'
import { calcPower } from '../src/expedition'
import { makeTestCtx } from './helpers'

/** 每档默认槽位总数（船长 2026-09-14 给定；专属 = 默认 + 1） */
const TIER_SLOT_BASE: Record<number, number> = { 1: 7, 2: 9, 3: 11, 4: 14, 5: 18 }

const WH_SHIPS = SHIPS.filter((s) => s.id.startsWith('sh-wh-'))
const TORP_E = SHIPS.find((s) => s.id === 'sh-wh-e-frigate')!
const TORP_G = SHIPS.find((s) => s.id === 'sh-wh-g-cruiser')!

const slotsOf = (id: string): { high: number; mid: number; low: number } => SHIPS.find((s) => s.id === id)!.slots!

describe('虫洞族专属舰船：槽位基准线（2026-09-14 船长）', () => {
  it('15 艘专属舰的槽位总数都在「该档默认 +1」线上', () => {
    expect(WH_SHIPS.length).toBe(15)
    for (const s of WH_SHIPS) {
      const base = TIER_SLOT_BASE[s.tier]!
      const total = s.slots!.high + s.slots!.mid + s.slots!.low
      expect(total, `${s.name}（${s.id}）T${s.tier} 槽位总数`).toBe(base + 1)
    }
  })

  it('武装舰仍满足「高槽 ≥ 低槽 + 1」', () => {
    for (const s of WH_SHIPS.filter((x) => x.role === 'armed')) {
      expect(s.slots!.high, `${s.name} 高槽 vs 低槽`).toBeGreaterThanOrEqual(s.slots!.low + 1)
    }
  })

  it('本批实际改动的 5 艘（形状逐一钉住）', () => {
    expect(slotsOf('sh-wh-a-frigate')).toEqual({ high: 3, mid: 4, low: 1 }) // 补回欠的 1 格中槽
    expect(slotsOf('sh-wh-e-destroyer')).toEqual({ high: 4, mid: 3, low: 3 }) // 撤销批次加的中槽
    expect(slotsOf('sh-wh-g-destroyer')).toEqual({ high: 4, mid: 4, low: 2 }) // 撤销批次加的低槽
    expect(slotsOf('sh-wh-e-carrier')).toEqual({ high: 5, mid: 4, low: 3 }) // 撤销批次加的中槽
    expect(slotsOf('sh-wh-g-cruiser')).toEqual({ high: 6, mid: 4, low: 2 }) // 中槽→高槽（鱼雷舰）
  })
})

describe('官方 T3 槽位对齐（船长 2026-09-14：「2.鹦鹉螺+1槽位，牛鲨-1槽位。」）', () => {
  it('两艘都收到 T3 默认线 11，且满足武装舰契约「高槽 ≥ 低槽 + 1」', () => {
    const nautilus = SHIPS.find((s) => s.id === 'sh-nautilus')!
    const bullshark = SHIPS.find((s) => s.id === 'sh-bullshark')!
    expect(nautilus.slots).toEqual({ high: 4, mid: 4, low: 3 }) // 中槽 +1（原 4/3/3 = 10）
    expect(bullshark.slots).toEqual({ high: 5, mid: 2, low: 4 }) // 中槽 −1（原 5/3/4 = 12）
    for (const s of [nautilus, bullshark]) {
      const slots = s.slots!
      expect(slots.high + slots.mid + slots.low, `${s.name} 槽位总数`).toBe(TIER_SLOT_BASE[s.tier])
      expect(slots.high, `${s.name} 武装舰契约`).toBeGreaterThanOrEqual(slots.low + 1)
    }
  })
})

describe('鱼雷舰强化批：数值落地 + 真进战斗公式', () => {
  it('两艘鱼雷舰的数值（火力/命中/回避/槽位）', () => {
    expect(TORP_E.powerBonus).toBe(0.5) // 0.25 + 0.25
    expect(TORP_E.hitBonus).toBe(0.17) // 不动
    expect(TORP_E.evasion).toBe(0.105) // 不动
    expect(TORP_E.slots).toEqual({ high: 4, mid: 2, low: 2 }) // 已在线上，不动

    expect(TORP_G.powerBonus).toBe(0.82) // 0.62 + 0.20
    expect(TORP_G.hitBonus).toBe(0.11) // 0.21 − 0.10（代价）
    expect(TORP_G.evasion).toBe(0.005) // 0.105 − 0.10（代价：界面显示 1%）
    expect(TORP_G.slots).toEqual({ high: 6, mid: 4, low: 2 })
  })

  it('火力加成真进炮台单发（基础舰炮 = round(8 ×(1+火力))），且不喂无人机', () => {
    const state: GameState = createInitialState({ nowWallMs: 0, seed: 3 })
    const ctx: SimContext = makeTestCtx({ ships: [TORP_E, TORP_G] })
    const eUid = addShipToFleet(state, 'sh-wh-e-frigate')
    const gUid = addShipToFleet(state, 'sh-wh-g-cruiser')

    const baseShot = (uid: string): number => {
      const spec = createPlayerSpec(state, ctx, uid)!
      const base = spec.weapons.find((w) => w.src === 'base')!
      return base.shotDmg ?? -1 // WeaponSpec.shotDmg 为可选字段；本路径（炮台）必填，-1 让缺失时断言直接红
    }
    // 零技能、零装配 ⇒ dmgScale = (1+火力) ⇒ 基础舰炮基数 8
    expect(baseShot(eUid)).toBe(Math.round(8 * 1.5)) // 12
    expect(baseShot(gUid)).toBe(Math.round(8 * 1.82)) // 15
  })

  it('亡军的命中/回避代价真进战斗规格', () => {
    const state: GameState = createInitialState({ nowWallMs: 0, seed: 3 })
    const ctx: SimContext = makeTestCtx({ ships: [TORP_G] })
    const uid = addShipToFleet(state, 'sh-wh-g-cruiser')
    const spec = createPlayerSpec(state, ctx, uid)!
    expect(spec.hitBonus).toBe(0.11) // 静态舰船值（2026-09-14 起索敌统合不再放大它）
    expect(spec.evasion).toBeCloseTo(0.005, 6) // gapCombine([], 0.005) = 0.005
  })

  it('火力指数（calcPower）含新加成', () => {
    const state: GameState = createInitialState({ nowWallMs: 0, seed: 3 })
    const ctx: SimContext = makeTestCtx({ ships: [TORP_E, TORP_G] })
    const bal = ctx.balance.combat
    const base = bal.basePower + bal.powerPerLevel * 0 // 零技能
    const eUid = addShipToFleet(state, 'sh-wh-e-frigate')
    const gUid = addShipToFleet(state, 'sh-wh-g-cruiser')
    expect(calcPower(state, ctx, eUid)).toBe(Math.round(base * 1.5))
    expect(calcPower(state, ctx, gUid)).toBe(Math.round(base * 1.82))
  })
})

/**
 * **电子舰 CPU +100**（2026-09-16 船长：「**提高电子舰的CPU，提高100**」）。
 *
 * 「电子舰」= 子分类 `subClass: '电子舰'`，全仓恰好 **2 艘**（A 族掠袭电子舰 / D 族哨戒电子舰）——
 * 两艘 `cpu` 由 **165 → 265**，**只动这一个字段**（槽位 / 三层血 / 命中 / 回避 / 分辨率 / 速度 /
 * 机动 / 货舱 / 价格一律不动）。为什么不用"改一处就算完"：CPU 是装配的唯一约束，
 * 少了钉子日后调平衡或重跑 `wh-ship-tune` 很容易把它顺手冲掉（该工具已按 `subClass` 自锁，
 * 但手工改值没有任何护栏）。
 */
describe('电子舰 CPU +100（船长 2026-09-16）', () => {
  const cpuOf = (id: string): number | undefined => SHIPS.find((s) => s.id === id)?.cpu
  it('两艘电子舰 cpu = 265（165 + 100），且全仓"电子舰"子分类恰好这 2 艘', () => {
    const ew = SHIPS.filter((s) => s.subClass === '电子舰')
    expect(ew.map((s) => s.id).sort()).toEqual(['sh-wh-a-frigate', 'sh-wh-d-frigate'])
    for (const s of ew) expect(s.cpu, `${s.name} cpu`).toBe(265)
    expect(cpuOf('sh-wh-a-frigate')).toBe(265)
    expect(cpuOf('sh-wh-d-frigate')).toBe(265)
  })
  it('只动 CPU：两艘的槽位与三层血与改前一致（防"顺手补偿"）', () => {
    const a = SHIPS.find((s) => s.id === 'sh-wh-a-frigate')!
    expect(a.slots).toEqual({ high: 3, mid: 4, low: 1 })
    expect([a.shieldHp, a.armorHp, a.hullHp]).toEqual([130, 60, 55])
    const d = SHIPS.find((s) => s.id === 'sh-wh-d-frigate')!
    expect(d.slots).toEqual({ high: 2, mid: 3, low: 3 })
    expect([d.shieldHp, d.armorHp, d.hullHp]).toEqual([170, 35, 55])
  })
  it('装配面生效：+100 后"三门炮 + 一件高耗设备"能装下（这是本次改动的目的）', () => {
    // 用**真数据**核装配账（本文件的测试替身 ctx 不含正式装备表 ⇒ 直接读 MODULES 的 cpuUse）
    const cpuOf = (id: string): number => MODULES.find((m) => m.id === id)?.cpuUse ?? 0
    const used = 3 * cpuOf('mod-turret-kin-3') + cpuOf('mod-stealth-3') // 52×3 + 80
    expect(cpuOf('mod-turret-kin-3')).toBe(52)
    expect(cpuOf('mod-stealth-3')).toBe(80)
    expect(used).toBe(236)
    const cpu = SHIPS.find((s) => s.id === 'sh-wh-a-frigate')!.cpu!
    expect(used, '三门炮 + 隐秘 MK3 应装得下').toBeLessThanOrEqual(cpu)
    expect(used, '并确认改前的 165 确实装不下（这正是本次改动的意义）').toBeGreaterThan(165)
  })
})
