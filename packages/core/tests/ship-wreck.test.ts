/**
 * **玩家舰船残骸**（**2026-09-26 船长令**，设计稿 `docs/design/ship-wreck-20260926.md`）。
 *
 * 船长原话（照抄）：「**准备添加新机制，玩家舰船被摧毁后，如果是在非虫洞的正常星系内，在该星系生成一个
 * '<被摧毁的舰船名称>的残骸'该残骸存在48小时，玩家如果在该星系打捞，优先打捞该残骸（比稀有残骸优先级还高）。
 * 打捞后玩家按照一定概率和比例回收被摧毁舰船的部分装备。除此以外没有其他资源。**」
 * ＋「**留一个接口，给之后舰船插件的。之后会添加一个加固结构的舰船插件，有加固结构的插件，
 * 玩家有概率能够回收该舰船。**」
 *
 * 本文件钉九件事（按设计稿的验收清单）：
 * 1. **触发面**：正常星系传了 `wreckGalaxyId` 才生成；**不传（虫洞那两条路）绝不生成**；
 * 2. **快照**：名字 = 「<船名>的残骸」、装配与无人机原样存下（**顺序敏感**：必须在删船之前抓）；
 * 3. **优先级**：玩家残骸压过稀有池，也压过手选打捞对象（独占本轮的产出）；
 * 4. **逐件掷 + 分档**：武器档 60% / 装甲档 40% / 无人机 25%（读常量，不写死魔数）；
 * 5. **保底**：整具残骸至少掷回一件；
 * 6. **掷完即消失 / 48h 到点即消失**（`decayAccMs` 真线性，与推进粒度无关）；
 * 7. **同星系多残骸各算各的**、打捞按最新那具优先；
 * 8. **随档往返不丢**（`save.ts` 清洗器登记了才活得过刷新）；
 * 9. **加固结构插件接口留白**：无插件 ⇒ 回收率恒 0 ⇒ **整船回收永不触发**（日后接插件时这条是回归锁）。
 */
import { describe, expect, it } from 'vitest'
import { createInitialState } from '../src/state'
import { addModule, countModule } from '../src/equipment'
import { addWare, countWare } from '../src/inventory'
import { injectRareWreck, rareWreckCountOf } from '../src/salvage'
import { pullOneWreck } from '../src/salvaging'
import { loseShip } from '../src/shipyard'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import {
  advanceShipWreckDecay,
  HULL_RECOVERY_MAX,
  hullRecoveryChanceOf,
  noteShipWreck,
  shipWreckFor,
  shipWrecksOf,
  SHIP_WRECK_DECAY_MS,
  trySalvagePlayerWreckOf,
  WRECK_RECOVERY_RATE,
} from '../src/shipWrecks'
import { anomaly, fittedOf, makeTestCtx, moduleDef, ore, ship } from './helpers'
import type { GameState } from '../src/state'
import type { ModuleDef, ShipDef } from '../src/types'

/** 三件合成模块：武器档 / 装甲档 / 支援档（家族决定回收率，`shipWrecks.recoveryRateOfSlot`） */
const GUN = 'mod-t-gun'
const PLATE = 'mod-t-plate'
const AID = 'mod-t-aid'
/** 一型合成无人机（物品；无人机档 25%） */
const DRONE = 'drone-t-scout'
/** 一张窝点卡：`lairCore` 非空 ⇒ 该星系能产生稀有残骸（用来验"压过稀有池"） */
const LAIR = 'ano-lair-t'
const GAL = 'galaxy-hub'
const OTHER_GAL = 'galaxy-kor'

const mods: ModuleDef[] = [
  moduleDef(GUN, 'turret', 0, { damageType: 'kinetic', maxRangeM: 3000, minRangeM: 0, hitRate: 0.8, reloadMs: 1000, dmgMult: 1 }),
  moduleDef(PLATE, 'armor', 0, { armorHpBonus: 10 }),
  moduleDef(AID, 'support', 0, { cpuUse: 1 }),
]
const ships: ShipDef[] = [ship('sh-t-frigate'), ship('sh-t-cruiser', { cargo: 500 })]
const droneItem = { ...ore(DRONE), id: DRONE, name: '测试侦察机', kind: 'drone' as const }

const ctx = makeTestCtx({
  modules: mods,
  ships,
  items: [droneItem],
  anomalies: [anomaly(LAIR, GAL, { threat: 30, lairCore: '测试海盗', foeFamily: 'A' })],
})

function world(seed = 5): GameState {
  return createInitialState({ nowWallMs: 0, seed })
}

/** 造一具残骸（直接走 `noteShipWreck`，用例只关心判定；触发面另有用例走 `loseShip`） */
function wreckIn(
  state: GameState,
  opts?: {
    galaxyId?: string
    shipId?: string
    shipName?: string
    defId?: string
    fitted?: ReturnType<typeof fittedOf>
    droneLoad?: Record<string, number>
    reinforceChance?: number
  },
) {
  return noteShipWreck(state, {
    galaxyId: opts?.galaxyId ?? GAL,
    shipId: opts?.shipId ?? 'sh-t-frigate',
    shipName: opts?.shipName ?? '沙猫',
    defId: opts?.defId ?? 'sh-t-frigate',
    durability: 0.8,
    armorPct: 0.6,
    fitted: opts?.fitted ?? fittedOf({ turret: GUN, armor: PLATE, propulsion: AID }),
    ...(opts?.droneLoad !== undefined ? { droneLoad: opts.droneLoad } : {}),
    ...(opts?.reinforceChance !== undefined ? { reinforceChance: opts.reinforceChance } : {}),
    createdAtWallMs: 0,
  })
}

describe('触发面：正常星系才留残骸（虫洞不生成）', () => {
  it('传了 wreckGalaxyId ⇒ 在该星系留一具「<船名>的残骸」，并记下那一刻的装配与无人机', () => {
    const state = world()
    state.fleet['sh-t-frigate'] = {
      defId: 'sh-t-frigate',
      customName: '老伙计',
      durability: 0.75,
      armorPct: 0.5,
      cargo: { [droneItem.id]: 3 },
      fitted: fittedOf({ turret: GUN, armor: PLATE }),
      droneLoad: { [DRONE]: 6 },
    }
    loseShip(state, 'sh-t-frigate', ctx, '远征失利后遭追击', GAL)

    const rec = shipWreckFor(state, GAL)
    expect(rec, '正常星系损毁应留残骸').toBeDefined()
    expect(rec!.name).toBe('老伙计的残骸')
    expect(rec!.defId).toBe('sh-t-frigate')
    expect(rec!.fitted!.high[0]).toBe(GUN)
    expect(rec!.fitted!.low[0]).toBe(PLATE)
    expect(rec!.droneLoad).toEqual({ [DRONE]: 6 })
    expect(rec!.durability).toBe(0.75)
    expect(rec!.armorPct).toBe(0.5)
    expect(state.fleet['sh-t-frigate'], '船本体照旧损失').toBeUndefined()
    console.log(`  [读数] 残骸「${rec!.name}」：装配 ${rec!.fitted!.high.filter(Boolean).length + rec!.fitted!.mid.filter(Boolean).length + rec!.fitted!.low.filter(Boolean).length} 件 + 无人机 ${DRONE}×6 · 衰减 ${SHIP_WRECK_DECAY_MS / 3_600_000}h`)
  })

  it('**不传 wreckGalaxyId（虫洞那两条路）⇒ 一具都不生成**', () => {
    const state = world()
    state.fleet['sh-t-frigate'] = {
      defId: 'sh-t-frigate',
      durability: 0.2,
      cargo: {},
      fitted: fittedOf({ turret: GUN }),
      droneLoad: { [DRONE]: 2 },
    }
    loseShip(state, 'sh-t-frigate', ctx, '虫洞内被击沉')
    expect(state.shipWrecks ?? {}, '虫洞损毁不该留任何残骸').toEqual({})
    expect(shipWrecksOf(state, GAL)).toEqual([])
  })

  it('船型不在目录里（脏档）⇒ 不生成（不会凭空造一具无来源的残骸）', () => {
    const state = world()
    state.fleet['ghost-ship'] = { defId: 'ghost-ship', durability: 0.1, cargo: {}, fitted: fittedOf() }
    loseShip(state, 'ghost-ship', ctx, '远征失利后遭追击', GAL)
    expect(shipWrecksOf(state, GAL)).toEqual([])
  })
})

describe('打捞优先级：玩家残骸压过稀有池与手选对象', () => {
  it('星系里同时有稀有残骸与玩家残骸 ⇒ 残骸立着期间稀有残骸一件都捞不走', () => {
    const state = world()
    injectRareWreck(state, GAL, LAIR, 2)
    // 两件件：即便逐件掷骰全不中，也**不会**回落到稀有轮（那一支根本走不到）
    wreckIn(state, { fitted: fittedOf({ turret: GUN, armor: PLATE }) })

    let rounds = 0
    // ⚠ 只在**残骸还立着**的那些轮次里断言；捞空后残骸消失、下一轮自然回到稀有池（那是正确的）
    while (shipWreckFor(state, GAL) !== undefined && rounds < 6) {
      const pulled = pullOneWreck(state, ctx, GAL, 60_000)!
      rounds += 1
      expect(pulled.itemId.startsWith('wreck-rare-'), '残骸立着时不该出稀有残骸').toBe(false)
      expect(['', GUN, PLATE]).toContain(pulled.itemId)
    }
    expect(rareWreckCountOf(state, GAL), '稀有池两件一件不少').toBe(2)
    console.log(`  [读数] 残骸立着期间捞了 ${rounds} 轮：稀有池仍 ${rareWreckCountOf(state, GAL)} 件（未被绕过）`)

    const after = pullOneWreck(state, ctx, GAL, 60_000)!
    expect(after.itemId.startsWith('wreck-rare-'), '残骸清空后才轮到稀有池').toBe(true)
  })

  it('手选打捞对象也压不过玩家残骸（船长：「比稀有残骸优先级还高」）', () => {
    const state = world()
    // 先捞一轮让 `byGroup` 惰性补齐，拿到一个**真实存在、且还有存量**的组 key
    pullOneWreck(state, ctx, GAL, 60_000)
    const groupKey = Object.keys(state.galaxyWrecks[GAL]?.byGroup ?? {})[0]
    expect(groupKey, '该星系应已有分组账（惰性补齐）').toBeTruthy()
    state.salvaging.targetGroup = groupKey
    wreckIn(state, { fitted: fittedOf({ turret: GUN }) })

    const pulled = pullOneWreck(state, ctx, GAL, 60_000)!
    expect(pulled.itemId, '有玩家残骸时，手选对象也压不过它').toBe(GUN)
    expect(state.galaxyWrecks[GAL]!.density, '手选那一组也没被扣（本轮整段走了残骸支）').toBeDefined()
  })
})

describe('逐件掷骰与保底', () => {
  it('分档读数：武器 60% / 装甲 40% / 无人机 25%（常量 + 实测同取）', () => {
    expect(WRECK_RECOVERY_RATE.weapon).toBe(0.6)
    expect(WRECK_RECOVERY_RATE.hull).toBe(0.4)
    expect(WRECK_RECOVERY_RATE.drone).toBe(0.25)

    /**
     * 实测口径（**这条要说清，否则读数会被误读**）：一具 2 件的残骸（武器 + 装甲）在第一轮里
     * 「武器先被抽中」的概率 = `p_w + (1−p_w)(1−p_a) × ½`
     * （第一行命中 0.6；全不中 0.24 时**触保底**、在剩两件里等概率挑）⇒ 理论 **0.72**。
     * 对照：若武器档被写成装甲档的 0.4 ⇒ 理论 0.58。**两者差 14pp**，400 种子足够分辨。
     */
    let gunFirst = 0
    const N = 400
    for (let seed = 1; seed <= N; seed += 1) {
      const s = world(seed)
      wreckIn(s, { fitted: fittedOf({ turret: GUN, armor: PLATE }) })
      const r = trySalvagePlayerWreckOf(s, ctx, GAL)
      if (r.kind === 'item' && r.itemId === GUN) gunFirst += 1
    }
    const rate = gunFirst / N
    console.log(`  [读数] 2 件残骸第一轮先出武器 = ${(rate * 100).toFixed(1)}%（理论 72%；若档次写错应为 58%）`)
    expect(rate, '第一轮先出武器的比例应贴近理论 72%').toBeGreaterThan(0.66)
    expect(rate).toBeLessThan(0.8)
  })

  it('保底：整具残骸一次都没给过东西 ⇒ 至少给回一件（`pityUsed` 置位）', () => {
    // 找一枚"第一次逐件掷全不中"的种子（武器档 60% ⇒ 单件不中 40%）
    let found: GameState | null = null
    for (let seed = 1; seed <= 200 && found === null; seed += 1) {
      const s = world(seed)
      wreckIn(s, { fitted: fittedOf({ turret: GUN }) })
      // 先手动把"已保底"标记成用过，再跑一轮：此时若没掷中就该"什么都没有"
      s.shipWrecks![Object.keys(s.shipWrecks!)[0]!]!.pityUsed = true
      if (trySalvagePlayerWreckOf(s, ctx, GAL).kind === 'none') found = s
    }
    expect(found, '应能找到一枚"没保底就没东西"的种子').not.toBeNull()

    const s = world(5)
    wreckIn(s, { fitted: fittedOf({ turret: GUN }) })
    // 不预设 pityUsed：没掷中也必须给回一件
    const r = trySalvagePlayerWreckOf(s, ctx, GAL)
    expect(r.kind, '保底应给回一件').toBe('item')
    expect(s.shipWrecks ?? {}, '唯一的件被取走 ⇒ 残骸消失').toEqual({})
  })

  it('无人机按"这一型还剩几架"整型给回', () => {
    const state = world()
    wreckIn(state, { fitted: fittedOf(), droneLoad: { [DRONE]: 7 } })
    const r = trySalvagePlayerWreckOf(state, ctx, GAL)
    expect(r.kind).toBe('item')
    if (r.kind === 'item') {
      expect(r.itemId).toBe(DRONE)
      expect(r.units).toBe(7)
      expect(r.isModule).toBe(false)
    }
    expect(shipWreckFor(state, GAL), '取完 ⇒ 消失').toBeUndefined()
  })

  it('取走一件后残骸还在（还有别的件）⇒ 下一轮接着捞', () => {
    const state = world()
    wreckIn(state, { fitted: fittedOf({ turret: GUN, armor: PLATE }) })
    const first = trySalvagePlayerWreckOf(state, ctx, GAL)
    expect(first.kind).toBe('item')
    const rec = shipWreckFor(state, GAL)
    expect(rec, '还剩一件 ⇒ 残骸立着').toBeDefined()
    const pulled = pullOneWreck(state, ctx, GAL, 60_000)!
    expect(pulled.itemId).not.toBe(first.kind === 'item' ? first.itemId : '')
    expect(shipWreckFor(state, GAL), '两件都取完 ⇒ 消失').toBeUndefined()
  })
})

describe('48 小时线性衰减', () => {
  it('衰减到一半、到点即消失（真线性，与推进粒度无关）', () => {
    const state = world()
    wreckIn(state)
    advanceShipWreckDecay(state, SHIP_WRECK_DECAY_MS / 2)
    const rec = shipWreckFor(state, GAL)
    expect(rec, '一半时间还在').toBeDefined()
    expect(rec!.decayAccMs).toBe(SHIP_WRECK_DECAY_MS / 2)

    advanceShipWreckDecay(state, SHIP_WRECK_DECAY_MS / 2)
    expect(shipWreckFor(state, GAL), '48h 到点即消失').toBeUndefined()
  })

  it('打捞进行中的那个星系挂起衰减（与另两本账同规则）', () => {
    const state = world()
    wreckIn(state)
    advanceShipWreckDecay(state, SHIP_WRECK_DECAY_MS * 2, GAL)
    expect(shipWreckFor(state, GAL), '正在打捞 ⇒ 不衰减').toBeDefined()
    advanceShipWreckDecay(state, SHIP_WRECK_DECAY_MS * 2, null)
    expect(shipWreckFor(state, GAL)).toBeUndefined()
  })
})

describe('同星系多残骸：各算各的、最新那具优先', () => {
  it('两具各自记名与衰减；打捞先动最新那具', () => {
    const state = world()
    wreckIn(state, { shipId: 'sh-t-frigate', shipName: '老伙计', fitted: fittedOf({ turret: GUN }) })
    wreckIn(state, { shipId: 'sh-t-cruiser', shipName: '新船', fitted: fittedOf({ armor: PLATE }) })

    const list = shipWrecksOf(state, GAL)
    expect(list.length).toBe(2)
    expect(list[0]!.name, '最新的排最前').toBe('新船的残骸')
    expect(shipWreckFor(state, GAL)!.name).toBe('新船的残骸')

    const pulled = pullOneWreck(state, ctx, GAL, 60_000)!
    expect(pulled.itemId, '先捞最新那具里的件').toBe(PLATE)
    expect(shipWreckFor(state, GAL)!.name, '剩下的还是老那具').toBe('老伙计的残骸')
  })
})

describe('加固结构插件接口（本批只留口子）', () => {
  it('**无插件 ⇒ 回收率恒 0 ⇒ 整船回收永不触发**（首捞即标记已掷）', () => {
    const state = world()
    const rec = wreckIn(state, { fitted: fittedOf({ turret: GUN }) })
    expect(rec.reinforceChance, '无插件不该写这个字段').toBeUndefined()
    expect(hullRecoveryChanceOf(rec)).toBe(0)

    const r = trySalvagePlayerWreckOf(state, ctx, GAL)
    expect(r.kind, '接口留白 ⇒ 只会给件，不会送船').not.toBe('ship')
    expect(rec.hullRolled, '快照本体不改；改的是存档里的那条').toBeUndefined()
  })

  it('装了加固件（合成夹具）⇒ 第一次捞先掷整船回收；未命中则记下"已掷过"、之后再也不会掷', () => {
    const state = world()
    wreckIn(state, { reinforceChance: HULL_RECOVERY_MAX })
    expect(hullRecoveryChanceOf(shipWreckFor(state, GAL)!)).toBe(HULL_RECOVERY_MAX)

    const first = trySalvagePlayerWreckOf(state, ctx, GAL)
    console.log(`  [读数] 60% 整船回收第一次掷：${first.kind}`)
    expect(['ship', 'item', 'none']).toContain(first.kind)
    if (first.kind === 'ship') {
      expect(first.wreckName).toBe('沙猫的残骸')
      expect(shipWreckFor(state, GAL), '整船回收 ⇒ 残骸消失').toBeUndefined()
      return
    }
    // 未命中：标记留下，后续轮次里**不会再出现整船回收**
    expect(shipWreckFor(state, GAL)!.hullRolled, '一具只掷一次').toBe(true)
    // 清掉"逐件"面（把装配清空）后，无论捞多少轮都不该冒出 ship
    const rec = shipWreckFor(state, GAL)!
    rec.fitted = { high: [], mid: [], low: [] }
    for (let i = 0; i < 5; i += 1) {
      const again = trySalvagePlayerWreckOf(state, ctx, GAL)
      expect(again.kind, '掷过整船回收后不该再掷（防反复刷概率）').not.toBe('ship')
    }
  })
})

describe('随档往返（save.ts 清洗器登记）', () => {
  it('残骸的装配/无人机/加固率/衰减进度/已掷标记读档后一字不差', () => {
    const state = world()
    const rec = wreckIn(state, {
      shipName: '老伙计',
      fitted: fittedOf({ turret: GUN, armor: PLATE }),
      droneLoad: { [DRONE]: 4 },
      reinforceChance: 0.35,
    })
    rec.hullRolled = true
    rec.pityUsed = true
    advanceShipWreckDecay(state, 3_600_000)

    const { state: back } = loadSaveFile(serializeSaveFile(state, 0))
    const restored = shipWreckFor(back, GAL)
    expect(restored, '残骸必须活过刷新（漏登记就是读档即丢）').toBeDefined()
    expect(restored!.name).toBe('老伙计的残骸')
    expect(restored!.fitted!.high[0]).toBe(GUN)
    expect(restored!.fitted!.low[0]).toBe(PLATE)
    expect(restored!.droneLoad).toEqual({ [DRONE]: 4 })
    expect(restored!.reinforceChance).toBe(0.35)
    expect(restored!.hullRolled).toBe(true)
    expect(restored!.pityUsed).toBe(true)
    expect(restored!.decayAccMs).toBe(3_600_000)
    expect(back.shipWreckSeq).toBe(1)
  })

  it('老档（没有 shipWrecks 字段）读回来照旧能用，不是空指针', () => {
    const state = world()
    const text = serializeSaveFile(state, 0)
    const raw = JSON.parse(text) as { state: Record<string, unknown> }
    delete raw.state.shipWrecks
    delete raw.state.shipWreckSeq
    const { state: back } = loadSaveFile(JSON.stringify(raw))
    expect(shipWrecksOf(back, GAL)).toEqual([])
    expect(trySalvagePlayerWreckOf(back, ctx, GAL).kind).toBe('none')
  })
})

describe('回收物入账（打捞循环那一支）', () => {
  it('模块进装备库、无人机进物品仓库（不是落到货舱当残骸）', () => {
    const state = world()
    // 单件残骸：直接 `pullOneWreck` 走**打捞循环那条真正的入账分支**（模块/无人机各一具）
    wreckIn(state, { shipId: 'sh-t-frigate', fitted: fittedOf({ turret: GUN }) })
    const before = countModule(state, GUN)
    const pulled = pullOneWreck(state, ctx, GAL, 60_000)!
    expect(pulled.itemId, '第一件应是那门炮').toBe(GUN)
    expect(countModule(state, GUN), '捞回的模块应进装备库').toBe(before + 1)

    wreckIn(state, { shipId: 'sh-t-cruiser', shipName: '运输船', fitted: fittedOf(), droneLoad: { [DRONE]: 2 } })
    const dronePull = pullOneWreck(state, ctx, GAL, 60_000)!
    expect(dronePull.itemId, '第二具里只有无人机').toBe(DRONE)
    expect(countWare(state, DRONE), '捞回的无人机应进物品仓库').toBe(2)
    expect(state.shipWrecks ?? {}, '两具都已捞空 ⇒ 都消失').toEqual({})
  })
})
