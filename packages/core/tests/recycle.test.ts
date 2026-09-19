/**
 * B3 残骸回收开箱（精炼炉回收批）测试（2026-09-05 船长定稿口径）：
 * 回收画像（档/低安）、保底矿物滚动、整批运转（启动→到点开箱→料尽自动停）、
 * 蓝图碎片逆向研究兑换。
 */
import { describe, expect, it } from 'vitest'
import { createInitialState } from '../src/state'
import { advanceRefining, fragmentRedeemRowsOf, redeemFragments, startRecycleRun, stopRefineRun } from '../src/industry'
import { RECYCLE_BATCH_M3, RECYCLE_CYCLE_MS, RECYCLE_POOL_AVG_ISK, RECYCLE_POOLS, RARE_WRECK_VOLUME_M3 } from '../src/salvage'
import { addItem, addWare, countWare, removeWare } from '../src/inventory'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import type { ItemDef, SimContext } from '../src/types'
import { anomaly, blueprint, galaxy, makeTestCtx, moduleDef } from './helpers'
import { FRAGMENT_RECIPES, fragmentPoolOf, rareBoxThemePoolOf, rareWreckItemDefOf, rareWreckItemIdOf, recycleBatchValueIsk, recycleRefiningMultiplier, recycleMineralPoolOf, recyclePoolMeanIsk, recycleProfileOf, rollRecycleGuarantee, wreckItemIdOf } from '../src/salvage'
import { wormholeMk3PoolOf, wormholeRareBoxThemePoolOf } from '../src/wormholeSalvage'

/** 测试矿物（id = 真实矿物 id，价格占位） */
function mineral(id: string, price: number): ItemDef {
  return { id, name: `矿物${id}`, kind: 'mineral', unitM3: 0.01, baseSellPriceIsk: price, description: '测试矿物' }
}

function ctxOf(wreckGroups?: NonNullable<Parameters<typeof makeTestCtx>[0]>['wreckGroups']) {
  return makeTestCtx({
    galaxies: [
      { ...galaxy('galaxy-hub', '母港'), security: 1.0 },
      { ...galaxy('galaxy-kor', '柯尔'), security: 0.5 },
      { ...galaxy('galaxy-grave', '坟场'), security: -1.0 },
    ],
    anomalies: [
      // 2026-09-10：基础密度 = 该星系悬赏「20 次注入」之和（威胁×0.4×(1+0.2×敌数)×20）——
      // 危档需 base ≥642：threat 100 单敌 → 20×48 = 960 ✓（旧口径 sec−1.0 → base 40 即危档）
      anomaly('ano-grave', 'galaxy-grave', { threat: 100, tactic: 'brawl' }),
      // 常档：threat 30 单敌 → 20×14.4 = 288 <428 ✓
      anomaly('ano-kor', 'galaxy-kor', { threat: 30, tactic: 'orbit' }),
    ],
    ...(wreckGroups !== undefined ? { wreckGroups } : {}),
    items: [
      mineral('min-tritanium', 8),
      mineral('min-pyerite', 12),
      mineral('min-mexallon', 20),
      mineral('min-nocxium', 90),
      mineral('min-isotope', 55),
      mineral('min-starcore', 245),
      mineral('min-darkiron', 780),
    ],
    modules: [
      moduleDef('mod-miner-civ', 'miner', 0),
      moduleDef('mod-cargo-civ', 'cargo', 0),
      moduleDef('mod-turret-civ', 'turret', 0),
      moduleDef('mod-miner-2', 'miner', 0),
      moduleDef('mod-cargo-2', 'cargo', 0),
      moduleDef('mod-turret-kin-2', 'turret', 0),
      moduleDef('mod-miner-3', 'miner', 0),
      moduleDef('mod-cargo-3', 'cargo', 0),
      moduleDef('mod-turret-kin-3', 'turret', 0),
    ],
    blueprints: [
      blueprint('bp-miner-2', 'mod-miner-2', []),
      blueprint('bp-cargo-2', 'mod-cargo-2', []),
      blueprint('bp-turret-2', 'mod-turret-kin-2', []),
      blueprint('bp-miner-3', 'mod-miner-3', []),
      blueprint('bp-cargo-3', 'mod-cargo-3', []),
      blueprint('bp-turret-3', 'mod-turret-kin-3', []),
    ],
  })
}

describe('回收画像与保底矿物滚动', () => {
  it('残骸按其敌群星系危险度分档；低安标记正确', () => {
    const ctx = ctxOf()
    const grave = recycleProfileOf(ctx, wreckItemIdOf('ano-grave'))!
    expect(grave.tier).toBe('dire') // 坟场：base = 20×(100×0.4×1.2) = 960 ≥642 → 危池
    expect(grave.lowSec).toBe(true)
    expect(grave.threat).toBe(100)
    const kor = recycleProfileOf(ctx, wreckItemIdOf('ano-kor'))!
    expect(kor.tier).toBe('common') // 柯尔：base = 288 <428 → 常池
    expect(kor.lowSec).toBe(false)
  })

  it('B3.1：组特色池覆盖保底抽取（只出特色矿）；note/theme 随画像透传（2026-09-06；2026-09-19 改组画像）', () => {
    const ctx = ctxOf({
      'ano-grave': {
        pool: [['min-darkiron', 100]] as readonly (readonly [string, number])[],
        note: '守墓舰残骸：冥铁合金为主',
        theme: { modules: ['mod-armor-kin-2'] },
      },
    })
    const profile = recycleProfileOf(ctx, wreckItemIdOf('ano-grave'))!
    expect(profile.pool).toEqual([['min-darkiron', 100]])
    expect(profile.note).toContain('冥铁')
    expect(profile.theme?.modules).toEqual(['mod-armor-kin-2'])
    const state = createInitialState({ nowWallMs: 0, seed: 23 })
    for (let i = 0; i < 30; i += 1) {
      const out = rollRecycleGuarantee(state, ctx, profile, 10)
      expect(out.length).toBe(1)
      expect(out[0]!.mineralId).toBe('min-darkiron') // 特色池覆盖：绝不出档池其它矿物
    }
  })

  /**
   * **2026-09-14 船长改判**：「取消随机抽一种矿物的限制。直接按价值比例产出所有矿物。」
   * ⇒ 本用例改写为钉住新口径：① 每批产出**池内全部**矿物（不再是 1 种）；
   * ② 每批**总价值** = 体积 × 档位当量 × 池均价 ×(1+8%×提纯学) × 抖动(±10%)，且与旧口径**逐值等值**；
   * ③ 各矿物单位数 = 该批总价值 × 价值占比 ÷ 单价（含小数累计，见下一条用例）。
   */
  it('保底矿物（2026-09-14 改判后）：每批出池内**全部**矿物，按价值占比分配，总价值 = 体积×当量×池均价×抖动', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 21 })
    const ctx = ctxOf()
    const profile = recycleProfileOf(ctx, wreckItemIdOf('ano-grave'))!
    const pool = RECYCLE_POOLS.dire
    const priceOf = (id: string): number => ctx.items.get(id)?.baseSellPriceIsk ?? 0
    const mean = recyclePoolMeanIsk(pool, priceOf)
    const out = rollRecycleGuarantee(state, ctx, profile, 36) // 批体积 36 m³ 直接按 m³ 计
    // ① 不再是"只出 1 种"：这一批里应有多种矿物，且都来自档位池
    const poolIds = pool.map(([id]) => id)
    expect(out.length).toBeGreaterThan(1)
    for (const r of out) expect(poolIds).toContain(r.mineralId)
    // ② **价值不蒸发**：入库价值 ＋ `state.recycleCarry` 里的余数价值 = 该批保底价值（±10% 抖动带内）
    //    （单价高的矿物这一批可能不足 1 单位，那部分算在余额里、下一批接着攒）
    const delivered = out.reduce((s, r) => s + r.units * priceOf(r.mineralId), 0)
    const carried = Object.entries(state.recycleCarry ?? {}).reduce((s, [id, c]) => s + c * priceOf(id), 0)
    const nominal = recycleBatchValueIsk('dire', mean, 36, recycleRefiningMultiplier(state))
    expect(delivered + carried).toBeGreaterThan(nominal * 0.9)
    expect(delivered + carried).toBeLessThan(nominal * 1.1)
  })

  it('保底矿物：单价高的矿物会"不足 1 单位"——余额进 `state.recycleCarry` 累计，够 1 才入库（不因取整蒸发）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    const ctx = ctxOf()
    const profile = recycleProfileOf(ctx, wreckItemIdOf('ano-grave'))!
    const priceOf = (id: string): number => ctx.items.get(id)?.baseSellPriceIsk ?? 0
    // 单批 10 m³ 危档：冥铁只分到 ~0.02 单位 ⇒ 这一批不该出冥铁，但余额得记下来
    const first = rollRecycleGuarantee(state, ctx, profile, 10)
    expect(first.some((r) => r.mineralId === 'min-darkiron')).toBe(false)
    expect((state.recycleCarry ?? {})['min-darkiron'] ?? 0).toBeGreaterThan(0)
    // 连开 200 批：冥铁必须真的入过库（长期不丢）
    let darkiron = 0
    for (let i = 0; i < 200; i += 1) {
      const out = rollRecycleGuarantee(state, ctx, profile, 10)
      darkiron += out.filter((r) => r.mineralId === 'min-darkiron').reduce((s, r) => s + r.units, 0)
    }
    expect(priceOf('min-darkiron')).toBeGreaterThan(0)
    expect(darkiron).toBeGreaterThan(0)
  })

  it('recycleMineralPoolOf（2026-09-10 界面保底矿物块单点）：组池优先、缺省回落档位基础池', () => {
    const base = ctxOf()
    // 缺省：组画像没写池 → 档位基础池（柯尔 = 常档：钛钢 65 / 银纹 30 / 晶态 5）
    const common = recycleProfileOf(base, wreckItemIdOf('ano-kor'))!
    expect(recycleMineralPoolOf(common)).toEqual([
      ['min-tritanium', 65],
      ['min-pyerite', 30],
      ['min-mexallon', 5],
    ])
    // 组池优先：写了 pool 就绝不给档位池（2026-09-19：池从"卡级"上移到"组级"）
    const flavored = recycleProfileOf(
      ctxOf({ 'ano-kor': { pool: [['min-nocxium', 3], ['min-isotope', 1]] } }),
      wreckItemIdOf('ano-kor'),
    )!
    expect(recycleMineralPoolOf(flavored)).toEqual([['min-nocxium', 3], ['min-isotope', 1]])
    // 与引擎抽取同源：该残骸只出组池里的矿
    const flavCtx = ctxOf({ 'ano-kor': { pool: [['min-nocxium', 3], ['min-isotope', 1]] } })
    const state = createInitialState({ nowWallMs: 0, seed: 77 })
    for (let i = 0; i < 20; i += 1) {
      const out = rollRecycleGuarantee(state, flavCtx, flavored, 10)
      expect(['min-nocxium', 'min-isotope']).toContain(out[0]!.mineralId)
    }
  })

  it('三档基础池都含钛钢合金、占比 ≥40%，且均价 = 档基数（船长 2026-09-14：先补钛钢、再「提高钛钢占比到 40~60」）', () => {
    const ctx = ctxOf()
    const priceOf = (id: string): number => ctx.items.get(id)?.baseSellPriceIsk ?? 0
    const shareOf = (pool: ReadonlyArray<readonly [string, number]>): number => {
      const wSum = pool.reduce((s, [, w]) => s + w, 0)
      return pool.filter(([id]) => id === 'min-tritanium').reduce((s, [, w]) => s + w, 0) / wSum
    }
    // ① 三档基础池逐档硬契约（险档在测试 ctx 里没有对应星系，故直接查常量表；特色池见 content-check B3.1/B3.3）
    for (const tier of ['common', 'risky', 'dire'] as const) {
      const pool = RECYCLE_POOLS[tier]
      // ①-a 必含钛钢（船长口径：不能有"拆了不给钛钢"的残骸）
      expect(pool.map(([id]) => id)).toContain('min-tritanium')
      // ①-b 占比 ≥40%（第二批口径：只提不降、统一取区间下限 40%）
      expect(shareOf(pool)).toBeGreaterThanOrEqual(0.4)
      // ①-c 均价必须等于档基数（改池必同步改 RECYCLE_POOL_AVG_ISK，容差 ±3% 同 content-check）
      const wSum = pool.reduce((s, [, w]) => s + w, 0)
      const avg = pool.reduce((s, [id, w]) => s + (w / wSum) * priceOf(id), 0)
      expect(Math.abs(avg / RECYCLE_POOL_AVG_ISK[tier] - 1)).toBeLessThanOrEqual(0.03)
    }
    // ② 引擎取池单点：残骸 → 档位 → 基础池（柯尔 = 常档、坟场 = 危档）
    for (const [anomalyId, tier] of [
      ['ano-kor', 'common'],
      ['ano-grave', 'dire'],
    ] as const) {
      const profile = recycleProfileOf(ctx, wreckItemIdOf(anomalyId))!
      expect(profile.tier).toBe(tier)
      const pool = recycleMineralPoolOf(profile)
      expect(pool).toEqual(RECYCLE_POOLS[tier])
      expect(shareOf(pool)).toBeGreaterThanOrEqual(0.4)
    }
  })
})

describe('残骸回收批（精炼炉运转）', () => {
  it('启动→到点开箱（保底矿物入库）→料尽自动停炉', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 31 })
    const ctx = ctxOf()
    const wreckId = wreckItemIdOf('ano-grave')
    addWare(state, wreckId, 10) // 正好一批
    const r0 = startRecycleRun(state, wreckId, 'pilot', ctx)
    expect(r0.ok).toBe(true)
    expect(state.refineRuns[0]!.recipe).toBe('recycle')
    expect(state.refineRuns[0]!.batchUnits).toBe(10)
    expect(countMinerals(state, ctx)).toBe(0)
    state.gameMs = 25_000 // 一批到点
    advanceRefining(state, ctx)
    /* **2026-09-15 改判**（船长报障「拆解完毕后，货柜为 0 时还是会进行一次拆解」，口径推广到全部产线）：
       本批吃完就**当场收工**，不再空转一个批周期（旧行为：这一拍仍然 active、要等下一个到点才见底）。 */
    expect(state.refineRuns).toHaveLength(0)
    expect(state.logs.some((l) => l.text.includes('原料耗尽'))).toBe(true)
    expect(countMinerals(state, ctx)).toBeGreaterThan(0)
    state.gameMs = 50_000
    advanceRefining(state, ctx) // 再推一拍：没有额外的批、也没有第二台炉
    expect(state.refineRuns).toHaveLength(0)
    // 2026-09-06（玩家上报）：结束日志必须带回收所得明细（保底产出）
    // 2026-09-12 术语修正（船长定）：`mineral` 的展示名由「矿物」改为「原材料」
    const fin = state.logs.filter((l) => l.text.includes('原料耗尽'))
    expect(fin.length).toBeGreaterThan(0)
    expect(fin[0]!.text).toContain('回收所得：保底原材料')
  })

  it('运行中余量不足一批：到批点即停工、余料保留（不再吃小批，2026-09-06 船长拍板）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 34 })
    const ctx = ctxOf()
    const wreckId = wreckItemIdOf('ano-grave')
    addWare(state, wreckId, 30) // 3 批
    expect(startRecycleRun(state, wreckId, 'pilot', ctx).ok).toBe(true)
    state.gameMs = 25_000
    advanceRefining(state, ctx) // 批 1 → 余 20
    state.gameMs = 50_000
    advanceRefining(state, ctx) // 批 2 → 余 10
    removeWare(state, wreckId, 6) // 卖掉/他用掉 6 → 余 4，不足一批
    state.gameMs = 75_000
    advanceRefining(state, ctx) // 下一批到点：不足一批 → 停工，余料保留
    expect(state.refineRuns).toHaveLength(0)
    expect(countWare(state, wreckId)).toBe(4)
    expect(state.logs.some((l) => l.text.includes('余量不足一批'))).toBe(true)
    expect(state.logs.some((l) => l.text.includes('余料保留'))).toBe(true)
  })

  it('中途停炉日志同样带回收所得明细；回收累计随存档往返保留', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 32 })
    const ctx = ctxOf()
    const wreckId = wreckItemIdOf('ano-grave')
    addWare(state, wreckId, 40) // 4 批
    expect(startRecycleRun(state, wreckId, 'pilot', ctx).ok).toBe(true)
    state.gameMs = 25_000
    advanceRefining(state, ctx) // 第 1 批
    expect(state.refineRuns).toHaveLength(1)
    expect(Object.values(state.refineRuns[0]!.recAcc?.min ?? {}).length).toBeGreaterThan(0)
    // 往返存档：累计不丢
    const loaded = loadSaveFile(serializeSaveFile(state, 1)).state
    const acc = loaded.refineRuns[0]?.recAcc
    expect(acc !== undefined && Object.keys(acc.min).length > 0).toBe(true)
    // 停炉日志带明细
    expect(stopRefineRun(loaded, ctx, loaded.refineRuns[0]!.id).ok).toBe(true)
    const stopLog = loaded.logs.filter((l) => l.text.includes('残骸回收炉已停'))
    expect(stopLog.length).toBeGreaterThan(0)
    expect(stopLog[0]!.text).toContain('回收所得')
  })

  it('非残骸物品 / 无残骸 / 不足一批 / 非母港不能启动回收', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 33 })
    const ctx = ctxOf()
    const notWreck = ctx.items.has('min-tritanium') ? 'min-tritanium' : 'ore-a'
    expect(startRecycleRun(state, notWreck, 'pilot', ctx).ok).toBe(false) // 不是残骸
    expect(startRecycleRun(state, wreckItemIdOf('ano-grave'), 'pilot', ctx).ok).toBe(false) // 仓库没有残骸
    // 不足一批不能开工（2026-09-06 船长反馈：数量不足仍能开工）
    addWare(state, wreckItemIdOf('ano-grave'), 5)
    const tiny = startRecycleRun(state, wreckItemIdOf('ano-grave'), 'pilot', ctx)
    expect(tiny.ok).toBe(false)
    expect(tiny.error ?? '').toContain('不足一批')
  })

  it('残骸回收学：批周期每级 −4%（Lv5 = ×0.6，手动与 AI 同享）', () => {
    const mk = (lv: number) => {
      const state = createInitialState({ nowWallMs: 0, seed: 35 })
      const ctx = ctxOf()
      if (lv > 0) state.skills.trained['salvage-recycling'] = lv
      const wreckId = wreckItemIdOf('ano-grave')
      addWare(state, wreckId, 40)
      expect(startRecycleRun(state, wreckId, 'pilot', ctx).ok).toBe(true)
      return state.refineRuns[0]!.cycleMs
    }
    expect(mk(0)).toBe(25_000)
    expect(mk(5)).toBe(20_000) // 每级 −4%：Lv5 = −20%（下限 60% 为长线保护）
  })

  it('残骸提纯学：保底矿物每级 +8%（Lv5 = ×1.4；同种子同抽取序列仅总量放大）', () => {
    const run = (lv: number): number => {
      const state = createInitialState({ nowWallMs: 0, seed: 37 })
      const ctx = ctxOf()
      if (lv > 0) state.skills.trained['salvage-refining'] = lv
      const profile = recycleProfileOf(ctx, wreckItemIdOf('ano-grave'))!
      const out = rollRecycleGuarantee(state, ctx, profile, 36)
      return out.length > 0 ? out[0]!.units : 0
    }
    const u0 = run(0)
    const u5 = run(5)
    expect(u0).toBeGreaterThan(0)
    // 同种子同抽取、只放大总量；单方产量上调后 floor 使精确 1.4 不再可整除——给取整带差容限
    expect(u5 / u0).toBeGreaterThan(1.25)
    expect(u5 / u0).toBeLessThan(1.55)
  })
})

describe('蓝图碎片逆向研究', () => {
  it('集齐 25 片 → 永久解锁蓝图（learnedRecipes）；重复/不足被拒', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 41 })
    const ctx = ctxOf()
    const fragId = 'frag-mod-miner-2'
    expect(ctx.items.get(fragId)).toBeDefined() // 上下文已生成碎片物品
    // 门槛 25 片（2026-09-10 船长定：MK2 100 → 25）
    expect(FRAGMENT_RECIPES['mod-miner-2']!.need).toBe(25)
    // 不足
    addWare(state, fragId, 24)
    expect(redeemFragments(state, ctx, 'mod-miner-2').ok).toBe(false)
    // 集齐
    addWare(state, fragId, 1)
    const r = redeemFragments(state, ctx, 'mod-miner-2')
    expect(r.ok).toBe(true)
    expect(state.learnedRecipes).toContain('bp-miner-2')
    expect(countWareItem(state, fragId)).toBe(0)
    // 已掌握 → 拒绝（防碎片空转）
    expect(redeemFragments(state, ctx, 'mod-miner-2').ok).toBe(false)
  })

  it('档位是显式字段（tier），不再由片数反推：MK2 25 片 / MK3 250 片', () => {
    const t2 = Object.entries(FRAGMENT_RECIPES).filter(([, r]) => r.tier === 2)
    const t3 = Object.entries(FRAGMENT_RECIPES).filter(([, r]) => r.tier === 3)
    expect(t2.map(([, r]) => r.need)).toEqual([25, 25, 25])
    expect(t3.map(([, r]) => r.need)).toEqual([250, 250, 250])
    expect(t2.map(([m]) => m).sort()).toEqual(['mod-cargo-2', 'mod-miner-2', 'mod-turret-kin-2'])
    expect(t3.map(([m]) => m).sort()).toEqual(['mod-cargo-3', 'mod-miner-3', 'mod-turret-kin-3'])
  })

  /**
   * **界面读数单点** `fragmentRedeemRowsOf`（2026-09-19 玩家报障修「集齐了 25 个蓝图碎片，
   * 但是找不到在哪换成蓝图」）——物品页「蓝图碎片」那一行的按钮状态全部读它，
   * 口径必须与 `redeemFragments` 完全一致（否则会出现"按钮亮着、一点就报碎片不足"）。
   */
  it('逆向解锁读数：6 条配方逐条给出 现有/门槛/已掌握/可兑，且与兑命令同一口径', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 43 })
    const ctx = ctxOf()
    const rows = fragmentRedeemRowsOf(state, ctx)
    expect(rows).toHaveLength(6)
    expect(rows.map((r) => r.need)).toEqual([25, 25, 25, 250, 250, 250]) // 配方表原序：MK2 三张 → MK3 三张
    for (const r of rows) {
      expect(r.fragmentItemId).toBe(`frag-${r.moduleId}`)
      expect(r.fragmentName).toContain('蓝图碎片')
      expect(r.have).toBe(0)
      expect(r.learned).toBe(false)
      expect(r.ready).toBe(false) // 0 片 ⇒ 不可兑
    }
    // 片数够 + 在空间站 ⇒ 可兑；且兑一次后读数变"已掌握"
    const target = rows.find((r) => r.moduleId === 'mod-turret-kin-2')!
    addWare(state, target.fragmentItemId, 25)
    const after = fragmentRedeemRowsOf(state, ctx).find((r) => r.moduleId === 'mod-turret-kin-2')!
    expect(after.have).toBe(25)
    expect(after.ready).toBe(true)
    expect(redeemFragments(state, ctx, 'mod-turret-kin-2').ok).toBe(true)
    const learned = fragmentRedeemRowsOf(state, ctx).find((r) => r.moduleId === 'mod-turret-kin-2')!
    expect(learned.learned).toBe(true)
    expect(learned.ready).toBe(false) // 已掌握 ⇒ 按钮该显示"已解锁配方"
    // 货仓里的碎片同样计入（货仓 + 仓库一本账）
    addItem(state, 'frag-mod-miner-2', 25)
    const inCargo = fragmentRedeemRowsOf(state, ctx).find((r) => r.moduleId === 'mod-miner-2')!
    expect(inCargo.have).toBe(25)
    expect(inCargo.ready).toBe(true)
  })

  it('碎片说明点名真实入口（2026-09-19 报障：旧文案写"母港逆向"，而界面里没有这个入口）', () => {
    const ctx = ctxOf()
    for (const moduleId of Object.keys(FRAGMENT_RECIPES)) {
      const desc = ctx.items.get(`frag-${moduleId}`)?.description ?? ''
      expect(desc, `${moduleId} 的碎片说明`).toContain('逆向解锁')
      expect(desc, `${moduleId} 的碎片说明`).not.toContain('母港逆向')
    }
  })
})

describe('碎片池「集齐前不重复」（2026-09-10 船长定）', () => {
  it('空档：该档三张书全在池里', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 61 })
    const ctx = ctxOf()
    expect(fragmentPoolOf(state, ctx, 2).sort()).toEqual(['mod-cargo-2', 'mod-miner-2', 'mod-turret-kin-2'])
    expect(fragmentPoolOf(state, ctx, 3).sort()).toEqual(['mod-cargo-3', 'mod-miner-3', 'mod-turret-kin-3'])
  })

  it('碎片集齐门槛（≥ need）→ 该书移出池子；差一片仍在池里', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 62 })
    const ctx = ctxOf()
    addWare(state, 'frag-mod-miner-2', 24)
    expect(fragmentPoolOf(state, ctx, 2)).toContain('mod-miner-2') // 还差 1 片
    addWare(state, 'frag-mod-miner-2', 1)
    expect(fragmentPoolOf(state, ctx, 2)).not.toContain('mod-miner-2') // 已集齐 → 不再给重复片
    expect(fragmentPoolOf(state, ctx, 2).sort()).toEqual(['mod-cargo-2', 'mod-turret-kin-2'])
  })

  it('已学会蓝图（含从市场买书学会）→ 该书移出池子，碎片不再空转', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 63 })
    const ctx = ctxOf()
    state.learnedRecipes.push('bp-cargo-2')
    expect(fragmentPoolOf(state, ctx, 2)).not.toContain('mod-cargo-2')
    expect(fragmentPoolOf(state, ctx, 2).sort()).toEqual(['mod-miner-2', 'mod-turret-kin-2'])
  })

  it('三张全都到手 → 池空（该档不再出碎片，不报错）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 64 })
    const ctx = ctxOf()
    state.learnedRecipes.push('bp-miner-2', 'bp-cargo-2', 'bp-turret-2')
    expect(fragmentPoolOf(state, ctx, 2)).toEqual([])
    expect(fragmentPoolOf(state, ctx, 3)).toHaveLength(3) // 另一档不受影响
  })
})

function countMinerals(state: ReturnType<typeof createInitialState>, ctx: ReturnType<typeof ctxOf>): number {
  let n = 0
  for (const id of [
    'min-tritanium',
    'min-pyerite',
    'min-mexallon',
    'min-nocxium',
    'min-isotope',
    'min-starcore',
    'min-darkiron',
  ]) {
    n += countWareItem(state, id)
  }
  void ctx
  return n
}

function countWareItem(state: ReturnType<typeof createInitialState>, id: string): number {
  return state.warehouse.items[id] ?? 0
}
/* ═══════════ 稀有残骸回收（2026-09-11 船长最终口径）═══
 * 口径：**照普通残骸回收的机制走**——不预占、不分"件/单元"、不写炉内料账；
 * 只改两件事：① 每累计烧掉 30 m³（RARE_UNIT_M3）**必给**一次彩头（概率 100%）；
 *            ② 抽奖池含该敌族**专属装备**（rollRareBoxExtra 的 poolOnly 档）。
 * "3 批"只是旧文档把"一件 = 30 m³"与"一批 = 10 m³"写在一起的产物，现已取消。 */
describe('稀有残骸回收：普通机制 + 每 30 m³ 必给彩头', () => {
  const RARE_ANOMALY = 'ano-grave'
  const RARE_ID = rareWreckItemIdOf(RARE_ANOMALY)

  function rareCtx() {
    return makeTestCtx({
      galaxies: [
        { ...galaxy('galaxy-hub', '母港'), security: 1.0 },
        { ...galaxy('galaxy-grave', '坟场'), security: -1.0 },
      ],
      anomalies: [
        anomaly(RARE_ANOMALY, 'galaxy-grave', { threat: 100, tactic: 'brawl', lairCore: '守墓核心' }),
      ],
      items: [
        mineral('min-tritanium', 8),
        rareWreckItemDefOf({
          key: RARE_ANOMALY,
          family: 'D',
          region: 'lo',
          name: `目标${RARE_ANOMALY}残骸`,
          rareName: `稀有残骸（目标${RARE_ANOMALY}）`,
          tier: 'dire',
          pool: [['min-tritanium', 100]],
          note: '',
          threat: 100,
          theme: {},
          members: [RARE_ANOMALY],
        }),
      ],
    })
  }
  const boxes = (state: ReturnType<typeof createInitialState>): number =>
    state.logs.filter((l) => l.text.includes('额外战利品')).length

  it('稀有残骸与普通残骸同一条路径：起炉**不预占**、不写炉内料账（lockUnits/claimedUnits 均缺省）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    const ctx = rareCtx()
    addWare(state, RARE_ID, 60)
    expect(startRecycleRun(state, RARE_ID, 'pilot', ctx).ok).toBe(true)
    const run = state.refineRuns[0]!
    expect(run.lockUnits).toBeUndefined()
    expect(run.claimedUnits).toBeUndefined()
    expect(run.rareUnits).toBeUndefined()
  })

  it('每累计 30 m³ 必给一次彩头：30 → 1 箱、60 → 2 箱、90 → 3 箱（同一炉连续烧，无需重开）', () => {
    for (const [m3, want] of [
      [30, 1],
      [60, 2],
      [90, 3],
    ] as const) {
      const state = createInitialState({ nowWallMs: 0, seed: 7 })
      const ctx = rareCtx()
      addWare(state, RARE_ID, m3)
      expect(startRecycleRun(state, RARE_ID, 'pilot', ctx).ok).toBe(true)
      state.gameMs = RECYCLE_CYCLE_MS * (m3 / RECYCLE_BATCH_M3) + RECYCLE_CYCLE_MS
      advanceRefining(state, ctx)
      expect(boxes(state), `${m3} m³ 应给 ${want} 次彩头`).toBe(want)
      expect(state.refineRuns).toHaveLength(0) // 料尽自动停炉（普通机制）
      expect(countWare(state, RARE_ID)).toBe(0) // 料烧光，无"每次剩 30"的残留
    }
  })

  it('不足 30 m³ 不给彩头（普通回收照常出矿物）；凑够 30 m³ 时补上一次', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    const ctx = rareCtx()
    addWare(state, RARE_ID, 20)
    expect(startRecycleRun(state, RARE_ID, 'pilot', ctx).ok).toBe(true)
    state.gameMs = RECYCLE_CYCLE_MS * 5
    advanceRefining(state, ctx)
    expect(boxes(state)).toBe(0) // 累计只到 20 m³
    expect(state.rareBurnUnits[RARE_ID]).toBe(20) // 账本记着，下次接着累计
    // 再补 10 m³ → 累计跨过 30 → 必给一次
    addWare(state, RARE_ID, 10)
    expect(startRecycleRun(state, RARE_ID, 'pilot', ctx).ok).toBe(true)
    state.gameMs = RECYCLE_CYCLE_MS * 12
    advanceRefining(state, ctx)
    expect(boxes(state)).toBe(1)
    expect(state.rareBurnUnits[RARE_ID]).toBe(30)
  })

  it('累计账本随存档往返保留：读档不会重置累计（否则"存档→重开"能反复白拿彩头）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    const ctx = rareCtx()
    addWare(state, RARE_ID, 20)
    expect(startRecycleRun(state, RARE_ID, 'pilot', ctx).ok).toBe(true)
    state.gameMs = RECYCLE_CYCLE_MS * 3
    advanceRefining(state, ctx)
    expect(boxes(state)).toBe(0)
    const loaded = loadSaveFile(serializeSaveFile(state, 1)).state
    expect(loaded.rareBurnUnits[RARE_ID]).toBe(20) // 修前：账本没落盘 ⇒ 读档后从 0 重新累计
    // 读档后补 10 m³：累计应从 20 接着走到 30，只给一次彩头
    addWare(loaded, RARE_ID, 10)
    expect(startRecycleRun(loaded, RARE_ID, 'pilot', ctx).ok).toBe(true)
    loaded.gameMs += RECYCLE_CYCLE_MS * 6
    advanceRefining(loaded, ctx)
    expect(loaded.logs.filter((l) => l.text.includes('额外战利品')).length).toBe(1)
  })
})

/* ═══════════ 洞内稀有残骸的高级箱：主题件回落（2026-09-16 船长甲1案）═══
 * 玩家报障「**稀有残骸拆解只拆除了 300 钛钢合金**」⇒ 根因：**洞内 15 张卡从没配 `recycleLoot`**
 * ⇒ 高级箱第②支恒空、只剩那批矿物（常档 300 单位 · 基础池钛钢 65%）。
 * 裁定甲1：洞内卡回落「军用备货柜」同款 MK3 池抽 **1 件**；**洞外一行不动**。 */
describe('洞内稀有残骸高级箱：主题件回落 MK3 池（船长 2026-09-16 甲1）', () => {
  const WH_ANOMALY = 'wh-alien-brood'
  const WH_ID = rareWreckItemIdOf(WH_ANOMALY)
  const OUT_ANOMALY = 'ano-grave'
  const OUT_ID = rareWreckItemIdOf(OUT_ANOMALY)

  function groupOf(key: string, region: 'wh' | 'lo'): Parameters<typeof rareWreckItemDefOf>[0] {
    return {
      key,
      // B 族专属池为空（武装拾荒者随窝点取消）⇒ 高级箱第①支必不中，本组用例只考"第②支主题件"
      family: 'B',
      region,
      name: `目标${key}残骸`,
      rareName: `稀有残骸（目标${key}）`,
      tier: 'common',
      pool: [['min-tritanium', 100]],
      note: '',
      threat: 45,
      theme: {},
      members: [key],
    }
  }

  function ctxWithMk3() {
    return makeTestCtx({
      galaxies: [{ ...galaxy('galaxy-hub', '母港'), security: 1.0 }],
      anomalies: [
        // 洞内卡：id 以 `wh-` 开头（⇒ 组地区 = 虫洞）、B 族专属池为空（⇒ 高级箱第①支必不中）、组画像无主题件
        anomaly(WH_ANOMALY, 'galaxy-hub', { threat: 45, tactic: 'brawl', foeFamily: 'B' }),
        // 洞外对照卡：同样没有主题件，但**不该**吃到回落
        anomaly(OUT_ANOMALY, 'galaxy-hub', { threat: 45, tactic: 'brawl', foeFamily: 'B' }),
      ],
      items: [
        mineral('min-tritanium', 8),
        rareWreckItemDefOf(groupOf(WH_ANOMALY, 'wh')),
        rareWreckItemDefOf(groupOf(OUT_ANOMALY, 'lo')),
      ],
      modules: [moduleDef('mod-turret-kin-3', 'turret', 3), moduleDef('mod-armor-plate-2', 'armor', 2)],
    })
  }

  /** 把一件稀有残骸整炉烧完，返回这一炉的产出（装备库增量 + 日志） */
  function burnOne(ctx: SimContext, wreckId: string): { mods: Record<string, number>; logs: string[] } {
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    addWare(state, wreckId, RARE_WRECK_VOLUME_M3)
    const before = { ...state.moduleBay }
    const from = state.logs.length
    expect(startRecycleRun(state, wreckId, 'pilot', ctx).ok).toBe(true)
    state.gameMs = RECYCLE_CYCLE_MS * 4
    advanceRefining(state, ctx)
    const mods: Record<string, number> = {}
    for (const [id, n] of Object.entries(state.moduleBay)) {
      const d = (n ?? 0) - (before[id] ?? 0)
      if (d > 0) mods[id] = d
    }
    return { mods, logs: state.logs.slice(from).map((l) => l.text) }
  }

  it('回落池：**虫洞组**取「军用备货柜」同款 MK3 池，洞外组一律空（回落不外溢）', () => {
    const ctx = ctxWithMk3()
    expect(wormholeMk3PoolOf(ctx)).toEqual(['mod-turret-kin-3'])
    expect(wormholeRareBoxThemePoolOf(ctx, 'wh')).toEqual(['mod-turret-kin-3'])
    expect(wormholeRareBoxThemePoolOf(ctx, 'hi')).toEqual([])
    expect(wormholeRareBoxThemePoolOf(ctx, 'lo')).toEqual([])
  })

  it('洞内稀有残骸：未中族专属时**必给一件装备**（改前只剩一批矿物）', () => {
    const ctx = ctxWithMk3()
    const { mods, logs } = burnOne(ctx, WH_ID)
    expect(mods['mod-turret-kin-3'], `应出一件 MK3 主题件，实际 ${JSON.stringify(mods)}`).toBe(1)
    expect(logs.some((t) => t.includes('额外战利品') && t.includes('主题装备'))).toBe(true)
  })

  it('洞外稀有残骸：组画像没有主题件 ⇒ **不**吃回落（行为逐字不变，只出矿物）', () => {
    const ctx = ctxWithMk3()
    const { mods, logs } = burnOne(ctx, OUT_ID)
    expect(Object.keys(mods), `不该出任何主题件，实际 ${JSON.stringify(mods)}`).toEqual([])
    expect(logs.some((t) => t.includes('额外战利品') && t.includes('主题装备'))).toBe(false)
    expect(logs.some((t) => t.includes('额外战利品'))).toBe(true) // 箱照开（只是只有矿物那一支）
  })
})
