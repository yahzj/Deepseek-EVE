/**
 * **扩槽插件生效**（**2026-09-27 船长令「修」**）。
 *
 * 背景：船长追问「其他插件呢」⇒ 12 件插件逐字段审计 ⇒ 只有「中层舱段插件 `midSlotsAdd: 1`」与
 * 「下层舱段插件 `lowSlotsAdd: 1`」**core 里零消费**（只有 `shipInfo` 的说明文字写着"中槽 +1"）
 * ⇒ 装上跟没装一样，与同日修的 CPU 上限插件同一个病根。
 *
 * 本作槽位数 = `fitted.mid` / `fitted.low` 的**数组长度** ⇒ 修法两半：
 * ① 槽位单点 `plugs.shipSlotsWithPlugsOf`（船型布局 ＋ 插件扩槽）供装配校验与界面共用；
 * ② `installPlug` 成功后**就地补齐**位数组（插件不可拆 ⇒ 只增不减）。
 */
import { describe, expect, it } from 'vitest'
import type { GameState, SimContext } from '../src/index'
import {
  addModule,
  addShipToFleet,
  applyFitPreset,
  countModule,
  cpuBudgetOf,
  createInitialState,
  fitModule,
  fitPresetDetailOf,
  installPlug,
  normalizePlugSlotExpansions,
  loadSaveFile,
  plugSlotAddsOf,
  repairDeprecatedModules,
  saveFitPreset,
  serializeSaveFile,
  shipSlotsWithPlugsOf,
  unfitAt,
} from '../src/index'
import { makeTestCtx, moduleDef, ship } from './helpers'

/**
 * 船：高/中/低 = 1/1/1，**插件槽 2**；两件扩槽插件（中层 +1 中槽 / 下层 +1 低槽）
 * ＋ 各一件中/低槽装备（用来验"多出来的格子真能装"）。
 */
function world(): { state: GameState; ctx: SimContext; uid: string } {
  const ctx = makeTestCtx({
    quietEvents: true,
    ships: [ship('sh-bay', { cpu: 200, plugSlots: 2, slots: { high: 1, mid: 1, low: 1 } })],
    modules: [
      moduleDef('plug-mid-bay', 'plug', 0, { cpuUse: 0, midSlotsAdd: 1 }),
      moduleDef('plug-low-bay', 'plug', 0, { cpuUse: 0, lowSlotsAdd: 1 }),
      moduleDef('mid-thing', 'shield', 0, { rack: 'mid', cpuUse: 1 }),
      moduleDef('low-thing', 'armor', 0, { rack: 'low', cpuUse: 1 }),
      moduleDef('low-thing-2', 'armor', 0, { rack: 'low', cpuUse: 1, armorHpBonus: 0.5 }),
    ],
  })
  const state = createInitialState({ nowWallMs: 0, seed: 77 })
  const uid = addShipToFleet(state, 'sh-bay')
  state.shipId = uid
  return { state, ctx, uid }
}

describe('扩槽插件（中层舱段 / 下层舱段 · 2026-09-27 船长令「修」）', () => {
  it('装上「中层舱段插件」⇒ 中槽 1 → 2：位数组就地变长，槽位单点跟着走', () => {
    const { state, ctx, uid } = world()
    expect(state.fleet[uid]!.fitted.mid.length).toBe(1)
    expect(shipSlotsWithPlugsOf(state, ctx, uid).mid).toBe(1)
    addModule(state, 'plug-mid-bay')
    expect(installPlug(state, ctx, 'plug-mid-bay', uid).ok).toBe(true)
    expect(plugSlotAddsOf(state, ctx, uid)).toEqual({ mid: 1, low: 0 })
    expect(shipSlotsWithPlugsOf(state, ctx, uid)).toEqual({ high: 1, mid: 2, low: 1 })
    // 关键：数组真的变长了（装配页按它画格子）
    expect(state.fleet[uid]!.fitted.mid.length).toBe(2)
    expect(state.fleet[uid]!.fitted.mid).toEqual([null, null])
  })

  it('**多出来的格子真能装**：中槽原本 1 格已占满 ⇒ 装扩槽插件后第 2 件放行', () => {
    const { state, ctx, uid } = world()
    addModule(state, 'mid-thing')
    addModule(state, 'mid-thing')
    expect(fitModule(state, 'mid-thing', ctx, { shipId: uid }).ok).toBe(true)
    // 1 格已满：再装一件被拒
    expect(fitModule(state, 'mid-thing', ctx, { shipId: uid }).ok).toBe(false)
    // 扩槽 ⇒ 第 2 格出现 ⇒ 放行
    addModule(state, 'plug-mid-bay')
    expect(installPlug(state, ctx, 'plug-mid-bay', uid).ok).toBe(true)
    expect(fitModule(state, 'mid-thing', ctx, { shipId: uid }).ok).toBe(true)
    expect(state.fleet[uid]!.fitted.mid.filter((x) => x !== null).length).toBe(2)
  })

  it('两件扩槽插件各管一路，互不串（中槽 +1 / 低槽 +1）', () => {
    const { state, ctx, uid } = world()
    addModule(state, 'plug-mid-bay')
    addModule(state, 'plug-low-bay')
    expect(installPlug(state, ctx, 'plug-mid-bay', uid).ok).toBe(true)
    expect(installPlug(state, ctx, 'plug-low-bay', uid).ok).toBe(true)
    expect(shipSlotsWithPlugsOf(state, ctx, uid)).toEqual({ high: 1, mid: 2, low: 2 })
    expect(state.fleet[uid]!.fitted.mid.length).toBe(2)
    expect(state.fleet[uid]!.fitted.low.length).toBe(2)
  })

  it('**没有扩槽插件时一切照旧**：槽位与数组长度都还是船型的 1/1/1', () => {
    const { state, ctx, uid } = world()
    expect(shipSlotsWithPlugsOf(state, ctx, uid)).toEqual({ high: 1, mid: 1, low: 1 })
    expect(plugSlotAddsOf(state, ctx, uid)).toEqual({ mid: 0, low: 0 })
    addModule(state, 'low-thing')
    expect(fitModule(state, 'low-thing', ctx, { shipId: uid }).ok).toBe(true)
    // 低槽 1 格已满 ⇒ 第 2 件被拒（回归护栏：修扩槽不许把原有上限放松）
    addModule(state, 'low-thing-2')
    expect(fitModule(state, 'low-thing-2', ctx, { shipId: uid }).ok).toBe(false)
  })

  it('**老档对齐**：已装插件但数组还是旧长度 ⇒ 下一次装配动作幂等补齐', () => {
    const { state, ctx, uid } = world()
    addModule(state, 'plug-mid-bay')
    expect(installPlug(state, ctx, 'plug-mid-bay', uid).ok).toBe(true)
    // 模拟老档：把数组硬裁回旧长度（插件仍在 plugs 里）
    state.fleet[uid]!.fitted.mid.length = 1
    expect(shipSlotsWithPlugsOf(state, ctx, uid).mid).toBe(2) // 单点照样算得出 2
    addModule(state, 'mid-thing')
    expect(fitModule(state, 'mid-thing', ctx, { shipId: uid }).ok).toBe(true)
    expect(state.fleet[uid]!.fitted.mid.length).toBe(2) // 装配动作把它补回来了
  })

  it('扩槽插件不占 CPU、也不改 CPU 预算（它是 slot 字段，不是 cpuBonus）', () => {
    const { state, ctx, uid } = world()
    const before = cpuBudgetOf(state, ctx, uid)
    addModule(state, 'plug-mid-bay')
    expect(installPlug(state, ctx, 'plug-mid-bay', uid).ok).toBe(true)
    expect(cpuBudgetOf(state, ctx, uid)).toBe(before)
  })

  it('同类型扩槽插件只能装一件；中槽与低槽扩展可以并存', () => {
    const { state, ctx, uid } = world()
    addModule(state, 'plug-mid-bay', 2)
    expect(installPlug(state, ctx, 'plug-mid-bay', uid).ok).toBe(true)
    expect(installPlug(state, ctx, 'plug-mid-bay', uid)).toMatchObject({ ok: false, errorId: 'core.plug.014' })
    expect(state.moduleBay['plug-mid-bay']).toBe(1)
    addModule(state, 'plug-low-bay')
    expect(installPlug(state, ctx, 'plug-low-bay', uid).ok).toBe(true)
    expect(state.fleet[uid]!.plugs).toEqual(['plug-mid-bay', 'plug-low-bay'])
  })

  it('旧档同类型重复扩槽插件自动免费退回，普通重复插件不受影响且幂等', () => {
    const { state, ctx, uid } = world()
    state.fleet[uid]!.plugs = ['plug-mid-bay', 'plug-mid-bay', 'plug-low-bay', 'plug-low-bay', 'plug-cpu-core', 'plug-cpu-core']
    const before = state.moduleBay['plug-mid-bay'] ?? 0
    expect(normalizePlugSlotExpansions(state, ctx)).toEqual([uid])
    expect(state.fleet[uid]!.plugs).toEqual(['plug-mid-bay', 'plug-low-bay', 'plug-cpu-core', 'plug-cpu-core'])
    expect(state.moduleBay['plug-mid-bay']).toBe(before + 1)
    expect(state.moduleBay['plug-low-bay']).toBe(1)
    expect(normalizePlugSlotExpansions(state, ctx)).toEqual([])
  })

  it('卸装不受影响：扩槽后第 2 格的件照常卸下，槽位不回缩（插件不可拆）', () => {
    const { state, ctx, uid } = world()
    addModule(state, 'plug-mid-bay')
    expect(installPlug(state, ctx, 'plug-mid-bay', uid).ok).toBe(true)
    addModule(state, 'mid-thing')
    expect(fitModule(state, 'mid-thing', ctx, { shipId: uid }).ok).toBe(true)
    const idx = state.fleet[uid]!.fitted.mid.indexOf('mid-thing')
    expect(unfitAt(state, 'mid', idx, uid, ctx)).toBe(true)
    expect(shipSlotsWithPlugsOf(state, ctx, uid).mid).toBe(2) // 槽位不缩
  })
})

/**
 * **2026-09-28 玩家报障**（照抄）：「**船插增加的中槽和低槽上的装备无法保存进配置，重启游戏后会丢失**」。
 *
 * 病根 = 2026-09-27 那次"扩槽生效"**只改了两处**（装配校验 `wantedBaysOf` ＋ 装配页格数），**漏了两处**：
 * ① 读档修复链 `repairDeprecatedModules` 的「V18 槽位数对齐」仍按**船型基础布局**裁数组
 *    ⇒ 每次读档都把扩出来的那一格连同里面的装备**退回装备库**（= "重启就丢"）；
 * ② 套用方案 `applyFitPreset` 仍按基础布局 `Math.min(src.length, slots[rack])`
 *    ⇒ 方案里落在扩出来那几位的装备**一件都装不上**（= "存不进配置"）；
 * ③ 附带：方案明细原先按基础布局铺 ⇒ 把扩出来的那一格当 `overflow` 报出去。
 * 修法 = ①②③ 全部改走**槽位单点** `shipSlotsWithPlugsOf`。
 */
describe('扩槽插件上的装备"存不住"（2026-09-28 玩家报障）', () => {
  /** 装两件扩槽插件 ＋ 在**扩出来的那一格**（中/低各第 2 位）各装一件装备 */
  function withExtraSlotsFilled(): { state: GameState; ctx: SimContext; uid: string } {
    const w = world()
    addModule(w.state, 'plug-mid-bay')
    addModule(w.state, 'plug-low-bay')
    expect(installPlug(w.state, w.ctx, 'plug-mid-bay', w.uid).ok).toBe(true)
    expect(installPlug(w.state, w.ctx, 'plug-low-bay', w.uid).ok).toBe(true)
    expect(shipSlotsWithPlugsOf(w.state, w.ctx, w.uid)).toEqual({ high: 1, mid: 2, low: 2 })
    addModule(w.state, 'mid-thing')
    addModule(w.state, 'low-thing')
    /** 明确装到**第 2 位**（= 插件扩出来的那一格） */
    expect(fitModule(w.state, 'mid-thing', w.ctx, { rack: 'mid', index: 1, shipId: w.uid }).ok).toBe(true)
    expect(fitModule(w.state, 'low-thing', w.ctx, { rack: 'low', index: 1, shipId: w.uid }).ok).toBe(true)
    return w
  }

  it('① **读档修复链不再砍掉扩槽位**：跑 `repairDeprecatedModules` 后装备还在那一格（回归）', () => {
    const { state, ctx, uid } = withExtraSlotsFilled()
    expect(state.fleet[uid]!.fitted.mid).toEqual([null, 'mid-thing'])
    /** 装完之后装备库里是 0（件都在船上）——修好后的修复链不该把它退回库 */
    const bayMid = countModule(state, 'mid-thing')
    const bayLow = countModule(state, 'low-thing')
    expect(bayMid).toBe(0)
    repairDeprecatedModules(state, ctx)
    expect(state.fleet[uid]!.fitted.mid, '扩出来的中槽那一格没被裁掉').toEqual([null, 'mid-thing'])
    expect(state.fleet[uid]!.fitted.low, '扩出来的低槽那一格也没被裁掉').toEqual([null, 'low-thing'])
    expect(state.fleet[uid]!.fitted.mid.length, '数组长度仍是实际槽位数 2').toBe(2)
    expect(state.fleet[uid]!.fitted.low.length).toBe(2)
    expect(countModule(state, 'mid-thing'), '装备库没有凭空多出一件（原先会退库）').toBe(bayMid)
    expect(countModule(state, 'low-thing')).toBe(bayLow)
    /** 幂等：再跑一次（每次启动都会跑）结果不变 */
    repairDeprecatedModules(state, ctx)
    expect(state.fleet[uid]!.fitted.mid).toEqual([null, 'mid-thing'])
  })

  it('② **存档往返（端到端复现报障）**：存 → 读 → 跑修复链 ⇒ 装备仍在扩槽位上', () => {
    const { state, ctx, uid } = withExtraSlotsFilled()
    const text = serializeSaveFile(state, 1_000)
    const back = loadSaveFile(text).state
    expect(back.fleet[uid]!.fitted.mid, '读档时逐位照抄').toEqual([null, 'mid-thing'])
    /** 引擎读档后必跑的那一步（这也是玩家"重启游戏后"发生的事） */
    repairDeprecatedModules(back, ctx)
    expect(back.fleet[uid]!.fitted.mid, '重启后装备还在').toEqual([null, 'mid-thing'])
    expect(back.fleet[uid]!.fitted.low, '重启后装备还在').toEqual([null, 'low-thing'])
    expect(countModule(back, 'mid-thing'), '没有被退回装备库').toBe(0)
  })

  it('③ **套用方案时扩槽位照装**：方案里第 2 位的装备能装回扩出来的那一格', () => {
    const { state, ctx, uid } = withExtraSlotsFilled()
    expect(saveFitPreset(state, ctx, uid, '扩槽方案').ok, '存方案').toBe(true)
    const saved = state.fitPresets?.['sh-bay']?.[0]
    expect(saved?.fitted.mid, '方案里如实记着扩槽那一格').toEqual([null, 'mid-thing'])
    expect(saved?.fitted.low).toEqual([null, 'low-thing'])
    const r = applyFitPreset(state, ctx, uid, 0)
    expect(r.ok, `套用方案要成功：${r.error ?? ''}`).toBe(true)
    expect(state.fleet[uid]!.fitted.mid, '第 2 位装回来了（原先被 Math.min 丢掉）').toEqual([null, 'mid-thing'])
    expect(state.fleet[uid]!.fitted.low).toEqual([null, 'low-thing'])
    /** 小结如实报"装上 2 件"、**不报缺件也不报未装**（旧口径下这两件会被静默丢弃） */
    expect(r.summary, '小结里"装上 2 件"').toContain('装上 2 件')
    expect(r.summary, '不该报"装备库缺"').not.toContain('装备库缺')
    expect(r.summary, '不该报"未装"').not.toContain('件未装')
  })

  it('④ 方案明细按**实际槽位**铺：扩出来的那一格列出来、不算 overflow', () => {
    const { state, ctx, uid } = withExtraSlotsFilled()
    expect(saveFitPreset(state, ctx, uid, '扩槽方案').ok).toBe(true)
    const preset = state.fitPresets!['sh-bay']![0]!
    const shipDef = ctx.ships.get('sh-bay')!
    const eff = shipSlotsWithPlugsOf(state, ctx, uid)
    const detail = fitPresetDetailOf(preset, ctx, shipDef, eff)
    expect(detail.overflow, '不再把扩出来的那一格当超位').toBe(0)
    expect(detail.slots.filter((s) => s.rack === 'mid').length, '中槽列出 2 行（含扩出来的）').toBe(2)
    expect(detail.slots.find((s) => s.rack === 'mid' && s.index === 2)?.id, '第 2 行 = 装的那件').toBe('mid-thing')
  })
})
