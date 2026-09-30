/**
 * **燃料上限 ＋ 实验室技能批**（**2026-09-30 船长令**）用例。
 *
 * 船长原话：「发现目前燃料生产并不受上限的影响，且估算约能跑多少趟没有实际意义，只需要显示上限多少
 * （比如本地存档现在是5,200单位，那就显示5,200/6000单位），下方实验室按钮边上显示现在燃料大概的生产速度/h。
 * 打算添加2个增加燃料上限的技能，并添加1个燃料生产速度和1个燃料产量的技能」＋「只算仓库，就是只算仓库，
 * 不算任何舰船库存。还有，每单位燃料体积为1m³，但是普通舰船的货仓无法装入」。
 *
 * 覆盖：上限（基准 **60,000** / 两条技能乘算 **135,000** / 只算仓库）· 放不下下一批就停线与拒起线 ·
 * 在产速率读数（7,200 → 15,600 单位/时）· 节拍与收率**只对燃料配方生效** · 燃料装不进货仓 ＋ 老档归仓。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext, LAB_RECIPES } from '@whale/data'
import type { LabRecipeDef } from '../src/types'
import { advanceGame, createInitialState } from '../src/index'
import {
  JUMP_FUEL_CAP_BASE,
  JUMP_FUEL_ITEM_ID,
  JUMP_FUEL_SPEED_MUL,
  beginJumpFuelLeg,
  jumpFuelCapOf,
  jumpFuelStockOf,
  jumpFuelWareOf,
} from '../src/jumpFuel'
import { labOutputPerHourOf, startLabRun } from '../src/lab'
import { jumpFuelSupplyOf } from '../src/fuelSupply'
import {
  addWare,
  cargoHoldForbidden,
  countWare,
  loadWarehouseToCargoFit,
  repairHoldForbiddenCargo,
} from '../src/inventory'

const ctx = buildSimContext()
const recipe = LAB_RECIPES[0]!

/** 已解锁实验室的档：给所有站点的档位交满（跳过交付流程，与 `jump-fuel-20260929` 同款） */
function stationState(): ReturnType<typeof createInitialState> {
  const s = createInitialState({ nowWallMs: 0, seed: 5 })
  for (const site of ctx.stations.values()) s.stationSites[site.id] = { stage: site.tiers.length, delivered: {} }
  s.debugQuick = false
  return s
}

/** 备料（默认 20 批） */
function withMaterials(s: ReturnType<typeof createInitialState>, batches = 20): ReturnType<typeof createInitialState> {
  for (const m of recipe.materials) addWare(s, m.itemId, m.units * batches)
  return s
}

function trainAll(s: ReturnType<typeof createInitialState>, ids: readonly string[]): void {
  for (const id of ids) s.skills.trained[id] = 5
}

const CAP_SKILLS = ['fuel-tank-structure', 'orbital-fuel-depot'] as const
const LAB_SKILLS = ['industrial-automation', 'fuel-catalytic-cracking', 'fuel-yield-engineering'] as const

describe('燃料上限 · 只算物品仓库', () => {
  it('配方契约：BOM 每一样材料与产物都能在物品目录里解析（P0 幽灵 id 的回归）', () => {
    // 2026-09-30 P0：`labRecipes.ts` 原先写 `min-jumpplasma`（双 p，表里没有）⇒ 实验室永远"材料不足一批"。
    // 这条用例照**目录**核对，不照配方自己的 id 灌料（那正是当年漏掉它的原因）。
    expect(ctx.items.get(recipe.outputItemId), `产物 ${recipe.outputItemId}`).toBeDefined()
    for (const m of recipe.materials) {
      expect(ctx.items.get(m.itemId), `材料 ${m.itemId} 必须在物品目录里`).toBeDefined()
    }
    // 幽灵 id 不得再出现（写死一次，防止有人"修"回去）
    expect(ctx.items.get('min-jumpplasma'), '双 p 的幽灵 id 不存在').toBeUndefined()
  })

  it('物品数据：燃料 1 m³/单位 ＋ 普通货仓装不进去', () => {
    const def = ctx.items.get(JUMP_FUEL_ITEM_ID)!
    expect(def.unitM3, '每单位 1 m³（船长令）').toBe(1)
    expect(def.holdForbidden, '普通舰船货仓无法装入（船长令）').toBe(true)
    expect(cargoHoldForbidden(ctx, JUMP_FUEL_ITEM_ID)).toBe(true)
    expect(cargoHoldForbidden(ctx, 'min-voidcrystal'), '别的物品不受影响').toBe(false)
  })

  it('上限基准 60,000；两条技能满级乘算 ⇒ 135,000（2026-09-30 船长令：基准 6,000 → 6 万）', () => {
    const s = stationState()
    expect(jumpFuelCapOf(s)).toBe(JUMP_FUEL_CAP_BASE)
    expect(JUMP_FUEL_CAP_BASE).toBe(60_000)
    s.skills.trained['fuel-tank-structure'] = 5
    expect(jumpFuelCapOf(s), '储罐结构学满级 +50%').toBe(90_000)
    s.skills.trained['orbital-fuel-depot'] = 5
    expect(jumpFuelCapOf(s), '轨道储备库学满级再 +50%（乘算）').toBe(135_000)
    trainAll(s, CAP_SKILLS)
    expect(jumpFuelCapOf(s)).toBe(135_000)
  })

  it('上限与库存都只算物品仓库：老档货仓里那份不参与', () => {
    const s = stationState()
    addWare(s, JUMP_FUEL_ITEM_ID, 100)
    s.fleet[s.shipId]!.cargo[JUMP_FUEL_ITEM_ID] = 5_000
    expect(jumpFuelWareOf(s), '仓库量').toBe(100)
    expect(jumpFuelStockOf(s), '不含任何舰船库存（船长令）').toBe(100)
    expect(jumpFuelCapOf(s), '上限不被货仓抬高').toBe(60_000)
  })

  it('扣料只从仓库扣（货仓残留不动）', () => {
    const s = stationState()
    s.jumpFuel = { mine: true }
    addWare(s, JUMP_FUEL_ITEM_ID, 300)
    s.fleet[s.shipId]!.cargo[JUMP_FUEL_ITEM_ID] = 200
    expect(beginJumpFuelLeg(s, 'mine', 120_000), '够 ⇒ ×10').toBe(JUMP_FUEL_SPEED_MUL)
    expect(countWare(s, JUMP_FUEL_ITEM_ID), '仓库扣 120（= 原返航秒）').toBe(180)
    expect(s.fleet[s.shipId]!.cargo[JUMP_FUEL_ITEM_ID], '货仓那份没被动').toBe(200)
  })
})

describe('燃料上限 · 生产受上限约束', () => {
  it('仓库放不下下一批 ⇒ 起线被拒（core.lab.018）', () => {
    const s = withMaterials(stationState())
    addWare(s, JUMP_FUEL_ITEM_ID, 59_700) // +600 会越过 60,000
    const r = startLabRun(s, ctx, recipe.id, 'pilot')
    expect(r.ok).toBe(false)
    expect(r.errorId).toBe('core.lab.018')
  })

  it('恰好装满：59,400 + 600 = 60,000 能跑满；跑满后停线且留 core.lab.017 日志', () => {
    const s = withMaterials(stationState())
    addWare(s, JUMP_FUEL_ITEM_ID, 59_400)
    expect(startLabRun(s, ctx, recipe.id, 'pilot').ok, '放得下 ⇒ 能起线').toBe(true)
    advanceGame(s, recipe.cycleMs + 1, ctx)
    expect(countWare(s, JUMP_FUEL_ITEM_ID), '第一批刚好装满').toBe(60_000)
    expect(jumpFuelWareOf(s), '绝不越过上限').toBeLessThanOrEqual(jumpFuelCapOf(s))
    advanceGame(s, recipe.cycleMs * 2 + 1, ctx)
    expect(countWare(s, JUMP_FUEL_ITEM_ID), '不再生产').toBe(60_000)
    expect(s.labRuns?.length ?? 0, '线被摘掉（满仓自停）').toBe(0)
    expect(s.logs.some((l) => l.textId === 'core.lab.017'), '停线日志').toBe(true)
  })

  it('抬高上限后可以继续生产（技能同时决定"满"在哪）', () => {
    const s = withMaterials(stationState())
    trainAll(s, CAP_SKILLS)
    addWare(s, JUMP_FUEL_ITEM_ID, 59_700) // 双满上限 135,000 ⇒ 放得下
    expect(jumpFuelCapOf(s)).toBe(135_000)
    expect(startLabRun(s, ctx, recipe.id, 'pilot').ok, '上限抬到 135,000 ⇒ 能起线').toBe(true)
  })
})

describe('燃料在产速率读数', () => {
  it('没开工 ⇒ 0（idle）；未解锁 ⇒ locked', () => {
    const locked = createInitialState({ nowWallMs: 0, seed: 5 })
    expect(jumpFuelSupplyOf(locked, ctx).status, '首座站未建成').toBe('locked')
    const s = withMaterials(stationState())
    const sup = jumpFuelSupplyOf(s, ctx)
    expect(sup.perHour).toBe(0)
    expect(sup.status).toBe('idle')
    expect(sup.ware).toBe(0)
    expect(sup.cap).toBe(60_000)
    expect(sup.headroom).toBe(60_000)
  })

  it('一条线在跑 ⇒ 7,200 单位/时；点满节拍与收率 ⇒ 15,600 单位/时', () => {
    const s = withMaterials(stationState())
    expect(startLabRun(s, ctx, recipe.id, 'pilot').ok).toBe(true)
    const base = jumpFuelSupplyOf(s, ctx)
    expect(base.perHour, '600 单位 / 5 分 = 7,200/时').toBe(7_200)
    expect(base.status).toBe('flowing')

    /** 技能：产线节拍学 −25% × 催化裂解学 −20% ⇒ 周期 3 分；收率工艺学 +30% ⇒ 每批 780 ⇒ 15,600/时 */
    const t = withMaterials(stationState())
    trainAll(t, LAB_SKILLS)
    expect(startLabRun(t, ctx, recipe.id, 'pilot').ok).toBe(true)
    expect(t.labRuns![0]!.cycleMs, '5 分 × 0.75 × 0.8 = 3 分').toBe(180_000)
    expect(t.labRuns![0]!.batchUnits, '600 × 1.3 = 780').toBe(780)
    expect(labOutputPerHourOf(t, ctx, recipe.id)).toBe(15_600)
    expect(jumpFuelSupplyOf(t, ctx).perHour).toBe(15_600)
  })

  it('满仓（放不下下一批）⇒ 状态 full', () => {
    const s = withMaterials(stationState())
    addWare(s, JUMP_FUEL_ITEM_ID, 59_700)
    const sup = jumpFuelSupplyOf(s, ctx)
    expect(sup.status).toBe('full')
    expect(sup.ware).toBe(59_700)
    expect(sup.headroom).toBe(300)
  })
})

describe('实验室技能的乘区与作用域', () => {
  it('节拍/收率只对燃料配方生效（旁证：另一张配方只吃产线节拍学）', () => {
    const two: LabRecipeDef = {
      id: 'dummy-other',
      name: '测试件',
      outputItemId: 'min-voidcrystal',
      outputUnits: 100,
      cycleMs: 600_000,
      materials: [{ itemId: 'min-voidcrystal', units: 1 }],
    }
    const ctx2 = { ...ctx, labRecipes: new Map([...ctx.labRecipes, [two.id, two] as const]) }
    const s = stationState()
    trainAll(s, LAB_SKILLS)
    addWare(s, 'min-voidcrystal', 50)
    expect(startLabRun(s, ctx2, two.id, 'pilot').ok).toBe(true)
    const run = s.labRuns!.find((r) => r.recipeId === two.id)!
    expect(run.cycleMs, '只吃产线节拍学：10 分 × 0.75 = 7.5 分').toBe(450_000)
    expect(run.batchUnits, '收率工艺学不作用于非燃料配方').toBe(100)
  })

  it('两条上限技能是燃料专属效果：不改变实验室周期与产出', () => {
    const s = withMaterials(stationState())
    trainAll(s, CAP_SKILLS)
    expect(startLabRun(s, ctx, recipe.id, 'pilot').ok).toBe(true)
    expect(s.labRuns![0]!.cycleMs).toBe(recipe.cycleMs)
    expect(s.labRuns![0]!.batchUnits).toBe(600)
  })
})

describe('货仓禁装与老档归仓', () => {
  it('燃料装船返回 0（仓库不动）；别的物品照旧能装', () => {
    const s = stationState()
    addWare(s, JUMP_FUEL_ITEM_ID, 300)
    expect(loadWarehouseToCargoFit(s, JUMP_FUEL_ITEM_ID, ctx)).toBe(0)
    expect(countWare(s, JUMP_FUEL_ITEM_ID), '拒绝装船不扣仓库').toBe(300)
    addWare(s, 'min-voidcrystal', 10)
    expect(loadWarehouseToCargoFit(s, 'min-voidcrystal', ctx)).toBeGreaterThan(0)
  })

  it('读档迁移：货仓里的燃料归仓（幂等、不销毁）', () => {
    const s = stationState()
    addWare(s, JUMP_FUEL_ITEM_ID, 300)
    s.fleet[s.shipId]!.cargo[JUMP_FUEL_ITEM_ID] = 42
    expect(repairHoldForbiddenCargo(s, ctx), '搬回 42 单位').toBe(42)
    expect(countWare(s, JUMP_FUEL_ITEM_ID)).toBe(342)
    expect(s.fleet[s.shipId]!.cargo[JUMP_FUEL_ITEM_ID], '货仓清空').toBeUndefined()
    expect(repairHoldForbiddenCargo(s, ctx), '再跑一次 = 0（幂等）').toBe(0)
  })
})
