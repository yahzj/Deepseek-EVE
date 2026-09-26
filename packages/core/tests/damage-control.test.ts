/**
 * **损伤管制装置**（**2026-09-25 船长令**：「添加新装备，舰船损伤管理MK1~MK3，低槽，效果是大幅增加结构的
 * 全伤害抗性，分别+30/40/50，且当舰船第一次结构低于1时，将结构恢复到1（避免一次死亡）。损管只能装备一件」
 * ＋「全名为**损伤管制装置**」＋「触发损管效果时需要消耗一份（损管修理组件）」＋改判「**1 秒内结构锁定 1**」
 * ＋「**入侵「重复出击」也挂 0.5 撤退保险**」）。
 *
 * 本用例锁五条：
 * 1. **致死那一发被夹到"结构 = 1"**（不是打死、也不是毫发无伤），并**消耗 1 枚损管修理组件**、开 1 秒窗；
 * 2. **窗口内再打不破**（逐段夹伤 ⇒ 同拍/同秒多段都破不了），且**不再扣组件**；
 * 3. **出窗后照常会被打死**（丁案：不强制撤退），且本场**只启动一次**；
 * 4. **没组件 ⇒ 不启动**（原样放行）；
 * 5. **同舰只能装一件**（装配层拒装第二件）＋ **入侵重复出击挂 0.5 撤退保险**。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { applyDcGuard, DC_LOCK_MS, dcUsageText } from '../src/combat'
import { beginBattleAt } from '../src/expedition'
import { fitModule, repairDeprecatedModules, swapModuleAt } from '../src/equipment'
import type { BattleState, GameState } from '../src/state'
import type { UnitSpec } from '../src/combat'
import type { WeekendEventState } from '../src/weekendEvent'

const ctx = buildSimContext()
const TAG = 'player'
/** 夹具：结构 100 的船，`apply` 把原始伤害原样扣结构（便于精确断言"夹到 1 点"） */
const HULL0 = 100
const apply = (r: number): { s: number; a: number; h: number } => ({ s: 0, a: 0, h: Math.max(0, HULL0 - r) })

function world(opts?: { kits?: number }): {
  s: GameState
  b: BattleState
  spec: UnitSpec
  hp: { s: number; a: number; h: number }
} {
  const s = createInitialState({ nowWallMs: 0, seed: 5 })
  s.warehouse.items['repairkit-dc'] = opts?.kits ?? 3
  const b = { lastTickGameMs: 1_000, dc: {}, dcKitsUsed: 0 } as unknown as BattleState
  const spec = {
    hullSaveKit: 'repairkit-dc',
    shipId: s.shipId,
    resists: {},
    hp: { s: 0, a: 0, h: HULL0 },
  } as unknown as UnitSpec
  return { s, b, spec, hp: { s: 0, a: 0, h: HULL0 } }
}

describe('损伤管制装置 · 免死窗口（船长令）', () => {
  it('致死那一发被夹到结构 1 ⇒ 扣 1 枚组件、开 1 秒窗', () => {
    const { s, b, spec, hp } = world()
    const out = applyDcGuard(s, b, TAG, spec, hp, 999, 'kinetic', apply)
    expect(out).toBeLessThan(999)
    expect(apply(out).h, '夹到结构 1（二分保守取值 ⇒ 允许浮点余量）').toBeGreaterThanOrEqual(1)
    expect(apply(out).h).toBeLessThan(1.001)
    expect(s.warehouse.items['repairkit-dc'], '消耗 1 枚损管修理组件').toBe(2)
    expect(b.dcKitsUsed).toBe(1)
    expect(b.dc?.[TAG]?.used).toBe(true)
    expect(b.dc?.[TAG]?.lockUntilMs).toBe(1_000 + DC_LOCK_MS)
    console.log(`  [读数] 致死发 ${999} → 夹到 ${out}（结构 ${apply(out).h}）· 组件 3 → ${s.warehouse.items['repairkit-dc']} · 窗口 ${DC_LOCK_MS} ms`)
  })

  it('窗口内再打同一艘：仍夹到结构 1、不再扣组件（同拍/同秒多段破不了）', () => {
    const { s, b, spec, hp } = world()
    applyDcGuard(s, b, TAG, spec, hp, 999, 'kinetic', apply)
    const hpNow = apply(99) // 已经被打到结构 1
    const out2 = applyDcGuard(s, b, TAG, spec, hpNow, 999, 'kinetic', apply)
    expect(apply(out2).h, '窗口内结构仍被锁在 1').toBeGreaterThanOrEqual(1)
    expect(apply(out2).h).toBeLessThan(1.001)
    expect(s.warehouse.items['repairkit-dc'], '窗口内不再扣组件').toBe(2)
    expect(b.dcKitsUsed).toBe(1)
    console.log(`  [读数] 窗口内第二发：999 → ${out2}（结构 ${apply(out2).h}）· 组件仍 ${s.warehouse.items['repairkit-dc']}`)
  })

  it('出窗后照常会被打死（丁案不强制撤退）；每场只启动一次', () => {
    const { s, b, spec, hp } = world()
    applyDcGuard(s, b, TAG, spec, hp, 999, 'kinetic', apply)
    const hpNow = apply(99)
    b.lastTickGameMs = 1_000 + DC_LOCK_MS + 1 // 出窗
    const out3 = applyDcGuard(s, b, TAG, spec, hpNow, 999, 'kinetic', apply)
    expect(out3, '出窗后原样放行').toBe(999)
    expect(apply(out3).h).toBe(0)
    expect(s.warehouse.items['repairkit-dc'], '已用过的场次不再扣组件').toBe(2)
    expect(b.dcKitsUsed, '每场一次').toBe(1)
    console.log('  [读数] 出窗后：原样放行 999（结构归零）· 组件不动 · 本场启动次数仍 1')
  })

  it('没组件 ⇒ 不启动（原样放行，也不记账）', () => {
    const { s, b, spec, hp } = world({ kits: 0 })
    const out = applyDcGuard(s, b, TAG, spec, hp, 999, 'kinetic', apply)
    expect(out).toBe(999)
    expect(b.dcKitsUsed ?? 0).toBe(0)
    expect(b.dc?.[TAG], '没启动 ⇒ 不写状态').toBeUndefined()
    console.log('  [读数] 组件 0：原样放行 999 · 未开窗 · 未记账')
  })

  it('战报尾巴：启动过才添，形如"损伤管制装置启动 ×1（消耗损管修理组件 ×1）"', () => {
    expect(dcUsageText({ dcKitsUsed: 0 }, ctx)).toBe('')
    const t = dcUsageText({ dcKitsUsed: 1 }, ctx)
    expect(t).toContain('损伤管制装置启动 ×1')
    expect(t).toContain('损管修理组件 ×1')
    console.log(`  [读数] 战报尾巴 = ${t}`)
  })
})

describe('损伤管制装置 · 同舰唯一 ＋ 入侵循环撤退保险（船长令）', () => {
  it('同舰只能装一件：装好 MK1 再装 MK2 ⇒ 拒装并指出已装的那件', () => {
    const s = createInitialState({ nowWallMs: 0, seed: 5 })
    s.moduleBay['mod-dc-1'] = 1
    s.moduleBay['mod-dc-2'] = 1
    const first = fitModule(s, 'mod-dc-1', ctx)
    expect(first.ok, `第一件应装上（${first.error ?? ''}）`).toBe(true)
    const second = fitModule(s, 'mod-dc-2', ctx)
    expect(second.ok).toBe(false)
    expect(second.errorId).toBe('core.equipment.028')
    expect(second.error ?? '', '提示里点名已装的那件').toContain('损伤管制装置 MK1')
    console.log(`  [读数] 第二件被拒：${second.error}`)
  })

  it('**2026-09-26 报障回归**：换装路径（`swapModuleAt`）也必须拦住第二件损管', () => {
    const s = createInitialState({ nowWallMs: 0, seed: 5 })
    /**
     * 开局两艘（沙猫 2/1/1 · 鲣鱼 3/2/1）低槽都只有 1 格 ⇒ 造一艘**低槽 4 格**的船来复现报障现场
     * （玩家那艘战列舰的低槽有多格，才塞得进第二件损管）。
     */
    s.fleet['test-big'] = {
      defId: 'sh-bullshark', // 5/2/4
      customName: null,
      durability: 1,
      armorPct: 1,
      cargo: {},
      fitted: { high: [null, null, null, null, null], mid: [null, null], low: [null, null, null, null] },
    } as never
    s.shipId = 'test-big'
    s.moduleBay['mod-dc-1'] = 1
    s.moduleBay['mod-dc-2'] = 1
    s.moduleBay['mod-dc-3'] = 1
    const first = fitModule(s, 'mod-dc-1', ctx)
    expect(first.ok, `第一件应装上（${first.error ?? ''}）`).toBe(true)
    const low = s.fleet['test-big']!.fitted!.low!
    const at = low.findIndex((x) => x === 'mod-dc-1')
    expect(at, 'MK1 应在低槽里').toBeGreaterThanOrEqual(0)
    /**
     * 报障主路径：装配页的「换装」= `swapModuleAt`（**直接写 `bays[index]`**）——
     * 修复前它不查 `unique` ⇒ 玩家能把第二件损管塞进**另一个**低槽。
     */
    const other = low.findIndex((x, i) => i !== at && x === null)
    expect(other, '应还有空低槽可换').toBeGreaterThanOrEqual(0)
    const swapped = swapModuleAt(s, 'mod-dc-2', ctx, { rack: 'low', index: other })
    expect(swapped.ok, '换装第二件损管应被拒').toBe(false)
    expect(swapped.errorId).toBe('core.equipment.028')
    expect(s.fleet['test-big']!.fitted!.low!.filter((x) => x?.startsWith('mod-dc-')).length, '低槽里仍只有一件损管').toBe(1)
    console.log(`  [读数] 换装被拒：${swapped.error}`)
    // 同槽换装（损管 → 另一款损管）仍然合法：这不是"多装一件"
    const inPlace = swapModuleAt(s, 'mod-dc-3', ctx, { rack: 'low', index: at })
    expect(inPlace.ok, `同槽换款应放行（${inPlace.error ?? ''}）`).toBe(true)
    expect(s.fleet['test-big']!.fitted!.low!.filter((x) => x?.startsWith('mod-dc-')).length).toBe(1)
  })

  it('**存档归正**：已有档里躺着两件损管 ⇒ 载入修复链只留靠前那件、其余退回装备库', () => {
    const s = createInitialState({ nowWallMs: 0, seed: 5 })
    s.fleet['test-big'] = {
      defId: 'sh-bullshark',
      customName: null,
      durability: 1,
      armorPct: 1,
      cargo: {},
      fitted: { high: [null, null, null, null, null], mid: [null, null], low: [null, null, null, null] },
    } as never
    // 白盒：手工造出"报障期间的存档"——低槽同时挂两件损管
    const fitted = s.fleet['test-big']!.fitted!
    fitted.low![0] = 'mod-dc-1'
    fitted.low![1] = 'mod-dc-2'
    const before = s.moduleBay['mod-dc-2'] ?? 0
    repairDeprecatedModules(s, ctx)
    const left = fitted.low!.filter((x) => x?.startsWith('mod-dc-'))
    expect(left.length, '只留一件').toBe(1)
    expect(left[0], '留靠前的那件（MK1）').toBe('mod-dc-1')
    expect((s.moduleBay['mod-dc-2'] ?? 0) - before, '多出来的那件退回装备库').toBe(1)
    expect(s.logs.some((l) => l.textId === 'core.equipment.029'), '写一条归正日志').toBe(true)
    console.log('  [读数] 存档归正：两件损管 → 1 装 + 1 回库')
  })

  it('入侵「重复出击」的场次也挂 0.5 撤退保险；循环没开则不挂', () => {
    const mk = (loop: boolean): number | undefined => {
      const s = createInitialState({ nowWallMs: 0, seed: 5 })
      const gid = 'galaxy-redring'
      const ev: WeekendEventState = {
        seq: 1,
        startedAtWallMs: Date.now(),
        coreId: 'galaxy-abyss',
        peripheryIds: [gid],
        family: 'H',
        contributed: {},
        ...(loop ? { autoLoopGalaxyId: gid } : {}),
      }
      s.weekendEvent = ev
      s.exploredGalaxies.push(gid, 'galaxy-abyss')
      /** 出征时引擎落的"本场打的是哪个星系"（`startExpedition` 的 foeGalaxyId）——入侵循环那条判据读它 */
      s.expedition.foeGalaxyId = gid
      expect(beginBattleAt(s, ctx, 'ink-harass', s.shipId, 0), '开战成功').toBe(true)
      return s.expedition.battle?.hullEscapeFrac
    }
    expect(mk(true), '入侵循环开着 ⇒ 挂 0.5').toBe(0.5)
    expect(mk(false), '循环没开 ⇒ 不挂（手动出击照旧）').toBeUndefined()
    console.log('  [读数] 入侵循环：hullEscapeFrac = 0.5 · 未开循环 = undefined')
  })

  it('随档往返：窗口与"本场已启动"不许丢（`hullEscapeFrac` 当年的同类坑）', () => {
    const s = createInitialState({ nowWallMs: 0, seed: 5 })
    s.exploredGalaxies.push('galaxy-redring')
    expect(beginBattleAt(s, ctx, 'ink-harass', s.shipId, 0), '开战成功').toBe(true)
    const b = s.expedition.battle!
    b.dc = { player: { lockUntilMs: 4_242, used: true } }
    b.dcKitsUsed = 2
    const back = loadSaveFile(serializeSaveFile(s, 0)).state.expedition.battle
    expect(back?.dc?.player, '窗口随档（丢了 ⇒ 战中重载后同一秒内不再受保护）').toEqual({
      lockUntilMs: 4_242,
      used: true,
    })
    expect(back?.dcKitsUsed, '"本场已启动"随档（丢了 ⇒ 每场一次被重载绕过）').toBe(2)
    console.log(`  [读数] 往返后 dc = ${JSON.stringify(back?.dc)} · dcKitsUsed = ${back?.dcKitsUsed}`)
  })
})
