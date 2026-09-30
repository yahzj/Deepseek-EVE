/**
 * **突触加速剂**（**2026-09-30 船长令**「技能加速剂」）用例。
 *
 * 口径（船长批「按你推荐」）：**使用后 24 小时内技能训练时长 ×0.5** · **不可叠用**（生效期内再点直接拒绝、
 * **不消耗**）· 时间基准 = 游戏时钟 `state.gameMs` · 效果从**唯一乘区入口** `trainingTimeFactor` 出去
 * （推进/预估/界面显示同源）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { addWare, countItem, countWare } from '../src/inventory'
import {
  SYNAPTIC_ACCELERANT_ITEM_ID,
  consumableStockOf,
  synapticAccelerantRemainMs,
  useSynapticAccelerant,
} from '../src/consumables'
import {
  SYNAPTIC_ACCELERANT_MS,
  SYNAPTIC_ACCELERANT_MUL,
  synapticAccelerantActive,
  trainingTimeFactor,
} from '../src/training'

const ctx = buildSimContext()

function stateWithOne() {
  const s = createInitialState({ nowWallMs: 0, seed: 31 })
  addWare(s, SYNAPTIC_ACCELERANT_ITEM_ID, 1)
  return s
}

describe('突触加速剂 · 使用与效果', () => {
  it('没库存 ⇒ 拒绝（core.consumable.001）', () => {
    const s = createInitialState({ nowWallMs: 0, seed: 31 })
    const r = useSynapticAccelerant(s)
    expect(r.ok).toBe(false)
    expect(r.errorId).toBe('core.consumable.001')
    expect(s.skillBoostUntilMs ?? 0).toBe(0)
  })

  it('用掉一枚 ⇒ 24 小时内训练时长 ×0.5，日志与剩余时间都对得上', () => {
    const s = stateWithOne()
    const base = trainingTimeFactor(s)
    expect(synapticAccelerantActive(s), '用之前不生效').toBe(false)
    const r = useSynapticAccelerant(s)
    expect(r.ok, r.ok ? '' : String(r.error)).toBe(true)
    expect(consumableStockOf(s, SYNAPTIC_ACCELERANT_ITEM_ID), '扣掉一枚').toBe(0)
    expect(s.skillBoostUntilMs).toBe(SYNAPTIC_ACCELERANT_MS)
    expect(synapticAccelerantActive(s)).toBe(true)
    expect(trainingTimeFactor(s), '训练时长乘区 ×0.5').toBeCloseTo(base * SYNAPTIC_ACCELERANT_MUL, 10)
    expect(synapticAccelerantRemainMs(s)).toBe(SYNAPTIC_ACCELERANT_MS)
    expect(s.logs.some((l) => l.textId === 'core.consumable.003'), '生效日志').toBe(true)
  })

  it('不可叠用：生效期内再点被拒、且**不消耗**第二枚（core.consumable.002）', () => {
    const s = stateWithOne()
    expect(useSynapticAccelerant(s).ok).toBe(true)
    addWare(s, SYNAPTIC_ACCELERANT_ITEM_ID, 1)
    const until = s.skillBoostUntilMs
    const r = useSynapticAccelerant(s)
    expect(r.ok).toBe(false)
    expect(r.errorId).toBe('core.consumable.002')
    expect(countWare(s, SYNAPTIC_ACCELERANT_ITEM_ID), '第二枚原封不动').toBe(1)
    expect(s.skillBoostUntilMs, '截止时刻不被延长').toBe(until)
  })

  it('过期即失效：时间走过 24 小时后乘区回到基数', () => {
    const s = stateWithOne()
    const base = trainingTimeFactor(s)
    expect(useSynapticAccelerant(s).ok).toBe(true)
    s.gameMs += SYNAPTIC_ACCELERANT_MS + 1
    expect(synapticAccelerantActive(s)).toBe(false)
    expect(trainingTimeFactor(s)).toBeCloseTo(base, 10)
    expect(synapticAccelerantRemainMs(s)).toBe(0)
  })

  it('货仓里那枚也能用（扣料货仓优先，与精炼/实验室同口径）', () => {
    const s = createInitialState({ nowWallMs: 0, seed: 31 })
    addWare(s, SYNAPTIC_ACCELERANT_ITEM_ID, 1)
    expect(useSynapticAccelerant(s).ok).toBe(true)
    // 再放一枚到**货仓**，等加速剂过期后使用 ⇒ 应从货仓扣
    addWare(s, SYNAPTIC_ACCELERANT_ITEM_ID, 1)
    s.fleet[s.shipId]!.cargo[SYNAPTIC_ACCELERANT_ITEM_ID] = 1
    s.warehouse.items[SYNAPTIC_ACCELERANT_ITEM_ID] = 1
    s.gameMs += SYNAPTIC_ACCELERANT_MS + 1
    expect(useSynapticAccelerant(s).ok).toBe(true)
    expect(countItem(s, SYNAPTIC_ACCELERANT_ITEM_ID), '先扣货仓').toBe(0)
    expect(countWare(s, SYNAPTIC_ACCELERANT_ITEM_ID), '仓库那枚还在').toBe(1)
  })
})

describe('突触加速剂 · 存档与配方闸门', () => {
  it('配方闸门：加速剂已上线（在目录里）；信号发射器仍施工中（被滤掉）', () => {
    expect(ctx.labRecipes.has('jump-fuel'), '燃料照旧').toBe(true)
    expect(ctx.labRecipes.has('synaptic-accelerant'), '加速剂 2026-09-30 上线').toBe(true)
    expect(ctx.labRecipes.has('invasion-beacon'), '信号发射器效果未接完 ⇒ 仍被滤掉').toBe(false)
  })

  it('存档往返：生效截止能存能读，未生效不写键（老档零迁移）', async () => {
    const { serializeSaveFile, loadSaveFile } = await import('../src/save')
    const s = stateWithOne()
    expect(serializeSaveFile(s, 0).includes('skillBoostUntilMs'), '未生效不写键').toBe(false)
    expect(useSynapticAccelerant(s).ok).toBe(true)
    const text = serializeSaveFile(s, 0)
    expect(text.includes('skillBoostUntilMs'), '生效后写键').toBe(true)
    const back = loadSaveFile(text).state
    expect(back.skillBoostUntilMs).toBe(s.skillBoostUntilMs)
    expect(synapticAccelerantActive(back)).toBe(true)
  })
})
