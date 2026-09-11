/**
 * B3 残骸回收开箱（精炼炉回收批）测试（2026-09-05 船长定稿口径）：
 * 回收画像（档/低安）、保底矿物滚动、整批运转（启动→到点开箱→料尽自动停）、
 * 蓝图碎片逆向研究兑换。
 */
import { describe, expect, it } from 'vitest'
import { createInitialState } from '../src/state'
import { advanceRefining, redeemFragments, startRecycleRun, stopRefineRun } from '../src/industry'
import { RECYCLE_BATCH_M3, RECYCLE_CYCLE_MS, RARE_WRECK_VOLUME_M3 } from '../src/salvage'
import { addWare, countWare, removeWare } from '../src/inventory'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import type { ItemDef, SimContext } from '../src/types'
import { anomaly, blueprint, galaxy, makeTestCtx, moduleDef } from './helpers'
import { FRAGMENT_RECIPES, fragmentPoolOf, rareWreckItemDefOf, rareWreckItemIdOf, recycleMineralPoolOf, recycleProfileOf, rollRecycleGuarantee, wreckItemIdOf } from '../src/salvage'

/** 测试矿物（id = 真实矿物 id，价格占位） */
function mineral(id: string, price: number): ItemDef {
  return { id, name: `矿物${id}`, kind: 'mineral', unitM3: 0.01, baseSellPriceIsk: price, description: '测试矿物' }
}

function ctxOf() {
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

  it('B3.1：敌群特色池覆盖保底抽取（只出特色矿）；note/loot 随画像透传（2026-09-06）', () => {
    const base = ctxOf()
    const flavMap = new Map(base.anomalies)
    const baseDef = base.anomalies.get('ano-grave')!
    flavMap.set('ano-grave', {
      ...baseDef,
      recyclePool: [['min-darkiron', 100]] as readonly (readonly [string, number])[],
      recycleNote: '守墓舰残骸：冥铁合金为主',
      recycleLoot: { modules: ['mod-armor-kin-2'] },
    })
    const ctx: SimContext = { ...base, anomalies: flavMap }
    const profile = recycleProfileOf(ctx, wreckItemIdOf('ano-grave'))!
    expect(profile.pool).toEqual([['min-darkiron', 100]])
    expect(profile.note).toContain('冥铁')
    expect(profile.loot?.modules).toEqual(['mod-armor-kin-2'])
    const state = createInitialState({ nowWallMs: 0, seed: 23 })
    for (let i = 0; i < 30; i += 1) {
      const out = rollRecycleGuarantee(state, ctx, profile, 10)
      expect(out.length).toBe(1)
      expect(out[0]!.mineralId).toBe('min-darkiron') // 特色池覆盖：绝不出档池其它矿物
    }
  })

  it('保底矿物：总量 = 体积×档位单方产量×抖动，品种按档位池抽取（走 rng 确定性）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 21 })
    const ctx = ctxOf()
    const profile = recycleProfileOf(ctx, wreckItemIdOf('ano-grave'))!
    const out = rollRecycleGuarantee(state, ctx, profile, 36) // 批体积 36 m³ 直接按 m³ 计
    expect(out.length).toBe(1)
    const row = out[0]!
    const poolIds = ['min-mexallon', 'min-nocxium', 'min-isotope', 'min-starcore', 'min-darkiron']
    expect(poolIds).toContain(row.mineralId)
    expect(row.units).toBeGreaterThanOrEqual(18) // 36×0.62≈22.3 基准 ±10% → 20~24（2026-09-06 锚 82k 后 Y 上调）
    expect(row.units).toBeLessThanOrEqual(26)
  })

  it('recycleMineralPoolOf（2026-09-10 界面保底矿物块单点）：特色池优先、缺省回落档位基础池', () => {
    const base = ctxOf()
    // 缺省：无特色池 → 回落该档基础池（柯尔 = 常档：三钛 65 / 类银 30 / 类胶 5）
    const common = recycleProfileOf(base, wreckItemIdOf('ano-kor'))!
    expect(recycleMineralPoolOf(common)).toEqual([
      ['min-tritanium', 65],
      ['min-pyerite', 30],
      ['min-mexallon', 5],
    ])
    // 特色池优先：写了 recyclePool 就绝不给档位池
    const flavMap = new Map(base.anomalies)
    flavMap.set('ano-kor', { ...base.anomalies.get('ano-kor')!, recyclePool: [['min-nocxium', 3], ['min-isotope', 1]] })
    const flavored = recycleProfileOf({ ...base, anomalies: flavMap }, wreckItemIdOf('ano-kor'))!
    expect(recycleMineralPoolOf(flavored)).toEqual([['min-nocxium', 3], ['min-isotope', 1]])
    // 与引擎抽取同源：该残骸只出特色池里的矿
    const state = createInitialState({ nowWallMs: 0, seed: 77 })
    for (let i = 0; i < 20; i += 1) {
      const out = rollRecycleGuarantee(state, { ...base, anomalies: flavMap }, flavored, 10)
      expect(['min-nocxium', 'min-isotope']).toContain(out[0]!.mineralId)
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
    expect(state.refineRuns).toHaveLength(1) // 跑完一批后下一批到点才见底
    state.gameMs = 50_000
    advanceRefining(state, ctx) // 库存已空 → 自动停炉
    expect(state.refineRuns).toHaveLength(0)
    expect(countMinerals(state, ctx)).toBeGreaterThan(0)
    expect(state.logs.some((l) => l.text.includes('原料耗尽'))).toBe(true)
    // 2026-09-06（玩家上报）：结束日志必须带回收所得明细（保底矿物）
    const fin = state.logs.filter((l) => l.text.includes('原料耗尽'))
    expect(fin.length).toBeGreaterThan(0)
    expect(fin[0]!.text).toContain('回收所得：保底矿物')
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

/* ═══════════ 稀有残骸「一件 = 一箱」（2026-09-11 船长定，修复"一件可被多台炉/多轮各开一箱"）═══
 * 复现口径（真实引擎）：一件稀有残骸 = 30 m³ = 3 批；高级箱在"本炉第一批"开出。
 * 修前：并行 N 台炉各吃 1 批 → N 个箱（1 件最多 3 箱）；单炉"跑一批就停再起"同样 3 箱。
 * 修后两道锁：①起炉即预占整件（并行台拿不到同一件）②开箱资格按"未开箱存量 ≥ 一件"，
 * 开箱后本件记入 `rareOpenedUnits`（退还的余料再炼不产箱）。 */
describe('稀有残骸：一件 = 一箱（2026-09-11 船长定）', () => {
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
      items: [mineral('min-tritanium', 8), rareWreckItemDefOf(RARE_ANOMALY, '稀有残骸')],
    })
  }
  const boxes = (state: ReturnType<typeof createInitialState>): number =>
    state.logs.filter((l) => l.text.includes('高级箱')).length

  it('一件残骸：无论开几台炉，高级箱恒为 1（并行台起炉即被拦下）', () => {
    for (const furnaces of [1, 2, 3]) {
      const state = createInitialState({ nowWallMs: 0, seed: 7 })
      const ctx = rareCtx()
      addWare(state, RARE_ID, 30)
      let started = 0
      for (let i = 0; i < furnaces; i++) if (startRecycleRun(state, RARE_ID, 'pilot', ctx).ok) started += 1
      // 起炉即预占：第一台把整件扣走，后续台**因无料起不来**（不会白占 AI 核心）
      expect(started).toBe(1)
      state.gameMs = 300_000
      advanceRefining(state, ctx)
      expect(boxes(state)).toBe(1)
    }
  })

  it('两个单元（两件残骸 60 m³）：一炉吃掉两个单元 → 2 箱，不必手动重开炉（2026-09-11 船长定）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    const ctx = rareCtx()
    addWare(state, RARE_ID, 60)
    expect(startRecycleRun(state, RARE_ID, 'pilot', ctx).ok).toBe(true)
    // 第二台起不来：60 m³ 已被第一台全部预占（私有料账不受公共库存影响）
    expect(startRecycleRun(state, RARE_ID, 'pilot', ctx).ok).toBe(false)
    // 一口气烧完 6 批 = 2 个回收单元 → 2 箱
    state.gameMs = 600_000
    advanceRefining(state, ctx)
    expect(boxes(state)).toBe(2)
    expect(state.refineRuns).toHaveLength(0)
  })

  it('单炉"跑一批就停、再起"刷不动：累计到 3 批才出 1 箱，此后怎么起停都只有 1 箱', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    const ctx = rareCtx()
    addWare(state, RARE_ID, 30) // 一个回收单元
    // 2026-09-11 改口径后：箱子按**累计已烧体积**结算（每满 30 m³ 一箱），不再"跑一批就出箱"
    for (let round = 1; round <= 4; round++) {
      const res = startRecycleRun(state, RARE_ID, 'pilot', ctx)
      if (!res.ok) break // 料不足以起炉（正常：已开箱的余料不足一个单元时起不来）
      state.gameMs += 30_000
      advanceRefining(state, ctx) // 只跑 1 批
      const runId = state.refineRuns[0]?.id
      if (runId !== undefined) stopRefineRun(state, ctx, runId)
      // 前两轮累计 20 m³ → 还没到一箱；第三轮累计 30 m³ → 恰好 1 箱；此后再起停也不再出箱
      expect(boxes(state)).toBe(round >= 3 ? 1 : 0)
    }
    expect(boxes(state)).toBe(1)
    // 停炉退还未用完的余料（进物品仓库，日志写明），仍可继续精炼出矿物
    expect(state.logs.some((l) => l.text.includes('已退回物品仓库'))).toBe(true)
  })

  it('新捡到的料不算"已结算"：补一个单元后可再开一箱；开箱账本随存档往返保留（2026-09-11 改口径）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    const ctx = rareCtx()
    addWare(state, RARE_ID, 30)
    expect(startRecycleRun(state, RARE_ID, 'pilot', ctx).ok).toBe(true)
    state.gameMs = 90_000 // 烧满一个回收单元（3 批 × 10 m³）
    advanceRefining(state, ctx)
    expect(boxes(state)).toBe(1)
    expect(state.refineRuns).toHaveLength(0) // 料账烧完自动收工
    const opened = state.rareOpenedUnits[RARE_ID] ?? 0
    expect(opened).toBeGreaterThan(0) // 这个单元的料已结算
    const loaded = loadSaveFile(serializeSaveFile(state, 1))
    expect(loaded.state.rareOpenedUnits[RARE_ID]).toBe(opened) // 账本不丢
    // 再捡一个单元（+30）→ 新料可再凑一箱
    addWare(loaded.state, RARE_ID, 30)
    expect(startRecycleRun(loaded.state, RARE_ID, 'pilot', ctx).ok).toBe(true)
    loaded.state.gameMs = 600_000
    advanceRefining(loaded.state, ctx)
    expect(boxes(loaded.state)).toBe(2)
  })

  it('料账吃完的最后一批当场收工：不再空转一个批周期（2026-09-11 玩家反馈「稀有残骸空了精炼炉还在运转」）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    const ctx = rareCtx()
    addWare(state, RARE_ID, RARE_WRECK_VOLUME_M3) // 1 件 = 3 批
    expect(startRecycleRun(state, RARE_ID, 'pilot', ctx).ok).toBe(true)
    // 修前：第 3 批结算完，炉子还要挂满一个批周期（等到第 4 个批点才收工）——玩家看到"残骸空了、炉子还在转"
    state.gameMs = RECYCLE_CYCLE_MS * 3
    advanceRefining(state, ctx)
    expect(state.refineRuns).toHaveLength(0)
    expect(state.logs.some((l) => l.text.includes('本炉料账已烧完') && l.text.includes('共 3 批'))).toBe(true)
  })

  it('私有料账不受存档往返影响：归零的料账读档后不会转而吃货仓/仓库里的同类残骸', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    const ctx = rareCtx()
    // 造出"料账恰好归零、炉子尚未收工"这一刻（真引擎下这一瞬已被上面那条用例压掉，但丢字段的后果与时机无关）：
    state.refineRuns.push({
      active: true,
      id: state.refineSeq++,
      worker: 'pilot',
      recipe: 'recycle',
      itemId: RARE_ID,
      batchUnits: RECYCLE_BATCH_M3,
      cycleMs: RECYCLE_CYCLE_MS,
      finishAtGameMs: RECYCLE_CYCLE_MS,
      batchesDone: RARE_WRECK_VOLUME_M3 / RECYCLE_BATCH_M3,
      lockUnits: 0,
      claimedUnits: 0,
      rareUnits: 0,
      recAcc: { min: {}, mod: {}, frag: {}, drone: {} },
    })
    addWare(state, RARE_ID, RARE_WRECK_VOLUME_M3) // 玩家刚打捞回的新一件：不该被这台旧炉默默烧掉
    const loaded = loadSaveFile(serializeSaveFile(state, 1)).state
    const run = loaded.refineRuns[0]
    expect(run?.claimedUnits).toBe(0) // 修前：字段被丢掉（undefined）⇒ 炉子改吃公共库存
    expect(run?.rareUnits).toBe(0) // 修前：可开箱数也丢 ⇒ 第一批会照旧开箱
    loaded.gameMs = RECYCLE_CYCLE_MS * 2
    advanceRefining(loaded, ctx)
    expect(countWare(loaded, RARE_ID)).toBe(RARE_WRECK_VOLUME_M3) // 公共库存原样未动
    expect(loaded.refineRuns).toHaveLength(0) // 料账空 → 本炉定额完成、收工
  })

  it('用"已开箱的余料"起的炉子：存档往返后仍不开箱（一个回收单元 = 一箱不被读档绕开）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    const ctx = rareCtx()
    addWare(state, RARE_ID, RARE_WRECK_VOLUME_M3)
    expect(startRecycleRun(state, RARE_ID, 'pilot', ctx).ok).toBe(true)
    state.gameMs = RECYCLE_CYCLE_MS * 3
    advanceRefining(state, ctx) // 烧满一个回收单元 → 开箱一次
    const boxLogs0 = (): number => state.logs.filter((l) => l.text.includes('高级箱')).length
    expect(boxLogs0()).toBe(1)
    // 第二个单元只烧 1 批就停炉：剩下 20 m³ 退回（这 20 m³ 属于已结算的那一炉账）
    addWare(state, RARE_ID, RARE_WRECK_VOLUME_M3)
    expect(startRecycleRun(state, RARE_ID, 'pilot', ctx).ok).toBe(true)
    state.gameMs += RECYCLE_CYCLE_MS
    advanceRefining(state, ctx)
    stopRefineRun(state, ctx, state.refineRuns[0]!.id)
    // 起炉 → 第一批到点前存档重开：全局账本（累计已烧 / 已开箱）都要落盘，否则读档会重置累计、白送一箱
    expect(startRecycleRun(state, RARE_ID, 'pilot', ctx).ok).toBe(true)
    const loaded = loadSaveFile(serializeSaveFile(state, 1)).state
    expect(loaded.rareBoxesOpened[RARE_ID]).toBeDefined() // 修前：账本没落盘 ⇒ 读档后按"可开箱"处理
    const boxLogs = (): number => loaded.logs.filter((l) => l.text.includes('高级箱')).length
    expect(boxLogs()).toBe(1) // 读档前只开过那一箱
    loaded.gameMs += RECYCLE_CYCLE_MS * 5
    advanceRefining(loaded, ctx)
    // 累计只到 40 m³（一个单元），⌊40/30⌋ = 1 ⇒ 不会再开第二箱（修前这里会变成 2）
    expect(boxLogs()).toBe(1)
  })

  it('玩家反馈回归：仓库里堆着多个回收单元时，一炉连续烧完、每单元一箱（不再每次 30 m³ 就停）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    const ctx = rareCtx()
    addWare(state, RARE_ID, RARE_WRECK_VOLUME_M3 * 3) // 3 个回收单元 = 90 m³
    expect(startRecycleRun(state, RARE_ID, 'pilot', ctx).ok).toBe(true)
    expect(state.refineRuns[0]!.lockUnits).toBe(RARE_WRECK_VOLUME_M3 * 3) // 整批预占，不是只吃 30
    state.gameMs = RECYCLE_CYCLE_MS * 9
    advanceRefining(state, ctx)
    expect(state.refineRuns).toHaveLength(0) // 一口气烧完 9 批
    expect(state.logs.filter((l) => l.text.includes('高级箱')).length).toBe(3) // 3 个单元 = 3 箱
    expect(countWare(state, RARE_ID)).toBe(0) // 料账烧光，没有"每次剩 30"的残留
  })
})
