/**
 * **舰船插件**（**2026-09-26 船长令**，设计稿 `docs/design/ship-plug-20260926.md`）。
 *
 * 船长原话（照抄）：「**舰船插件是一种类似装备的东西，同样装备在舰船上，但是不可拆卸，不可替换。
 * 装有插件的舰船无法放入舰船仓库。玩家打捞自己的舰船残骸时，总能回收舰船插件。**」
 * ＋「**玩家回收按插件数量直接回收成黑匣。**」
 *
 * ⚠ 本文件用**真内容表**（`buildSimContext()`）：随档往返那组必须真表——清洗器会丢掉船型目录里
 * 没有的舰队条目，拿合成船型测往返只会得到"读回来是起始船"的假失败。
 *
 * 本文件钉八件事：
 * 1. **装入**：走装备库扣 1、进 `plugs`（**不占**高/中/低槽）、同型不许重复、槽满不许再装；
 * 2. **无卸下函数**（结构性保证：本模块没有 `removePlug`，"不可拆"不靠界面藏按钮）；
 * 3. **闸门**：装了插件 ⇒ `shipStorable` 与 `shipSellable` **两条路都拒**（判据单点 `plugBlockReasonOf`）；
 * 4. **残骸快照**：船沉时 `plugs` 原样存进残骸（与 `fitted` 两本账）；
 * 5. **打捞换黑匣**：残骸第一次被捞 ⇒ 按件数**整批**换回黑匣（不掷骰、不占本轮产出）；
 * 6. **整船回收时插件跟着船回去**（不换黑匣）；
 * 7. **加固结构插件走插件槽也认**（`reinforceChanceOfFitted` 的第二入口）；
 * 8. **随档往返不丢**（舰队侧与残骸侧两处清洗器都登记了才活得过刷新）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { addModule, countModule } from '../src/equipment'
import { countWare } from '../src/inventory'
import { shipSellable } from '../src/market'
import { loseShip, shipStorable } from '../src/shipyard'
import { pullOneWreck } from '../src/salvaging'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import {
  installPlug,
  isPlugOf,
  PLUG_BLACKBOX_ITEM_ID,
  plugBlockReasonOf,
  plugInfoOf,
  plugModulesOf,
  plugSlotsOf,
  plugsOf,
  plugsToBlackBoxesOf,
} from '../src/plugs'
import { HULL_RECOVERY_MAX, hullRecoveryChanceOf, noteShipWreck, reinforceChanceOfFitted, shipWreckFor, trySalvagePlayerWreckOf } from '../src/shipWrecks'
import { makeTestCtx } from './helpers'
import { createBattleState, createPlayerSpec, pickMyUnitTarget } from '../src/combat'
import type { UnitSpec } from '../src/combat'
import type { GameState } from '../src/state'

const ctx = buildSimContext()

/** 真插件 id（`packages/data/src/plugs.ts`） */
const PLUG_SHIELD = 'plug-shield-plate'
const PLUG_ARMOR = 'plug-armor-plate'
/** 两艘起始 T1 船（插件槽各 5 格） */
const T1 = 'sandcat'
const T1B = 'sh-falconet'
const GAL = 'galaxy-grave'

function world(seed = 5): GameState {
  return createInitialState({ nowWallMs: 0, seed })
}

/** 把某艘船摆成"干净可入仓"的样子（本文件只测插件这一条闸门，别的拒因先清掉） */
function clean(state: GameState, uid: string): void {
  const ship = state.fleet[uid]!
  ship.fitted = { high: [], mid: [], low: [] }
  ship.cargo = {}
  ship.durability = 1
  ship.armorPct = 1
  delete ship.customName
}

/** 选靶用例：连抽 `rounds` 次，数各被抽中几次（两条单位的 tag 必须不同） */
function tallyTargets(
  state: GameState,
  a: UnitSpec,
  b: UnitSpec,
  rounds = 600,
): { aHits: number; bHits: number } {
  const battle = createBattleState(a, [], 0, 1_000, [b])
  let aHits = 0
  let bHits = 0
  for (let i = 0; i < rounds; i++) {
    const picked = pickMyUnitTarget(state, battle, [a, b], 'random')
    if (picked?.tag === a.tag) aHits += 1
    if (picked?.tag === b.tag) bHits += 1
  }
  return { aHits, bHits }
}

describe('装入：扣库 · 进 plugs · 不占高/中/低槽', () => {
  it('装上插件 ⇒ 装备库 −1、`plugs` +1、`fitted` 一个字节不动', () => {
    const state = world()
    addModule(state, PLUG_SHIELD, 1)
    const fittedBefore = JSON.stringify(state.fleet[T1]!.fitted)

    const r = installPlug(state, ctx, PLUG_SHIELD, T1)
    expect(r.ok, JSON.stringify(r)).toBe(true)
    expect(countModule(state, PLUG_SHIELD), '装备库应扣 1').toBe(0)
    expect(plugsOf(state, T1)).toEqual([PLUG_SHIELD])
    expect(JSON.stringify(state.fleet[T1]!.fitted), '插件不占普通槽位').toBe(fittedBefore)
    expect(plugSlotsOf(state, ctx, T1)).toBe(5)
    expect(plugModulesOf(state, ctx, T1).map((d) => d.id)).toEqual([PLUG_SHIELD])
    console.log(`  [读数] ${T1} 插件槽 ${plugSlotsOf(state, ctx, T1)} 格 · 已装 ${plugsOf(state, T1).length} 件`)
  })

  it('六道校验：普通装备 / 库里没有 / 同型重复 / 槽满 —— 各拒各的', () => {
    const state = world()
    addModule(state, 'mod-turret-kin-1', 1)
    const notPlug = installPlug(state, ctx, 'mod-turret-kin-1', T1)
    expect(notPlug.ok === false && notPlug.errorId, '普通装备走 fitModule').toBe('core.plug.002')
    const noStock = installPlug(state, ctx, PLUG_SHIELD, T1)
    expect(noStock.ok === false && noStock.errorId, '库里没有').toBe('core.equipment.002')

    addModule(state, PLUG_SHIELD, 2)
    expect(installPlug(state, ctx, PLUG_SHIELD, T1).ok).toBe(true)
    const dup = installPlug(state, ctx, PLUG_SHIELD, T1)
    expect(dup.ok === false && dup.errorId, '同型不许重复').toBe('core.plug.006')
    expect(countModule(state, PLUG_SHIELD), '被拒的那条不该扣库').toBe(1)
    console.log(`  [读数] 拒因：${dup.ok === false ? dup.error : '(意外通过)'}`)
  })

  it('T5 船只有 1 格：装了第一件之后第二件被槽位拒', () => {
    const state = world()
    // 上一条 T5 船（`sh-colossal` 1 格插件槽）——直接给舰队加一条真船条目
    state.fleet['probe-t5'] = {
      defId: 'sh-colossal',
      durability: 1,
      armorPct: 1,
      cargo: {},
      fitted: { high: [], mid: [], low: [] },
    }
    expect(plugSlotsOf(state, ctx, 'probe-t5'), 'T5 = 1 格').toBe(1)
    addModule(state, PLUG_SHIELD, 1)
    expect(installPlug(state, ctx, PLUG_SHIELD, 'probe-t5').ok).toBe(true)
    addModule(state, PLUG_ARMOR, 1)
    const full = installPlug(state, ctx, PLUG_ARMOR, 'probe-t5')
    expect(full.ok === false && full.errorId, 'T5 只有 1 格').toBe('core.plug.005')
  })

  it('`isPlugOf` 是"这是插件"的唯一判据；`plugInfoOf` 供装配页只读区取两份数', () => {
    const state = world()
    const shield = ctx.modules.get(PLUG_SHIELD)
    const gun = ctx.modules.get('mod-turret-kin-1')
    expect(isPlugOf(shield)).toBe(true)
    expect(isPlugOf(gun)).toBe(false)
    addModule(state, PLUG_SHIELD, 1)
    installPlug(state, ctx, PLUG_SHIELD, T1)
    const info = plugInfoOf(state, ctx, T1)
    expect(info.slots).toBe(5)
    expect(info.installed.map((d) => d.id)).toEqual([PLUG_SHIELD])
  })
})

describe('闸门：装了插件的船不入仓、不挂卖', () => {
  it('两条路都被拒，且拒因同一句（判据单点）', () => {
    const state = world()
    clean(state, T1B)
    expect(shipStorable(state, T1B).ok, '没插件时照旧可入仓').toBe(true)
    expect(shipSellable(state, T1B).ok, '没插件时照旧可卖').toBe(true)

    addModule(state, PLUG_SHIELD, 1)
    installPlug(state, ctx, PLUG_SHIELD, T1B)

    const storable = shipStorable(state, T1B)
    expect(storable.ok).toBe(false)
    expect(storable.reason).toContain('舰船插件')
    const sellable = shipSellable(state, T1B)
    expect(sellable.ok).toBe(false)
    expect(sellable.reason).toBe(storable.reason)
    expect(plugBlockReasonOf(state, T1B)).toBe(storable.reason)
    expect(plugBlockReasonOf(state, T1), '没插件的船 = 放行').toBeNull()
    console.log(`  [读数] 拒因：${storable.reason}`)
  })
})

describe('残骸：插件快照 → 整批换黑匣', () => {
  it('船沉时 `plugs` 原样进残骸；打捞时第一次就整批换黑匣、清字段、不占本轮产出', () => {
    const state = world()
    addModule(state, 'mod-turret-kin-1', 1)
    state.fleet[T1]!.plugs = [PLUG_SHIELD, PLUG_ARMOR]
    state.fleet[T1]!.cargo = {}
    loseShip(state, T1, ctx, '远征失利后遭追击', GAL)
    const rec = shipWreckFor(state, GAL)
    expect(rec, '正常星系损毁应留残骸').toBeDefined()
    expect(rec!.plugs, '插件快照必须存进残骸').toEqual([PLUG_SHIELD, PLUG_ARMOR])

    // 第一轮：整批换黑匣（`pullOneWreck` 是真正入账的那条路 ⇒ 黑匣进物品仓库）
    expect(pullOneWreck(state, ctx, GAL, 60_000), '这一轮应产出黑匣').not.toBeNull()
    expect(countWare(state, PLUG_BLACKBOX_ITEM_ID), '黑匣应进物品仓库').toBe(2)

    /**
     * 换完即清字段。⚠ **那门炮还在残骸里**，所以残骸会继续立着——逐件掷骰捞走它（有一件保底），
     * 走的是同一具残骸的后续轮次，此时 `plugs` 必须已经空了。
     */
    let guard = 0
    while ((shipWreckFor(state, GAL)?.fitted?.high?.length ?? 0) > 0 && guard < 6) {
      expect(shipWreckFor(state, GAL)?.plugs ?? [], '换过之后不该再冒出插件').toEqual([])
      pullOneWreck(state, ctx, GAL, 60_000)
      guard += 1
    }
    expect(state.shipWrecks?.[rec!.shipId], '炮捞走后残骸消失（空壳不留）').toBeUndefined()
    expect(countWare(state, PLUG_BLACKBOX_ITEM_ID), '黑匣数不该因为后续轮次而变').toBe(2)
    console.log(`  [读数] 2 件插件 → ${PLUG_BLACKBOX_ITEM_ID} ×2（= ${plugsToBlackBoxesOf([PLUG_SHIELD, PLUG_ARMOR])}）`)
  })

  it('只有插件、没有别的件的残骸：换完黑匣即消失（不留空壳）', () => {
    const state = world()
    noteShipWreck(state, {
      galaxyId: GAL,
      shipId: 'wrecked-only-plugs',
      shipName: '沙猫',
      defId: T1,
      plugs: [PLUG_SHIELD],
      createdAtWallMs: 0,
    })
    const r = pullOneWreck(state, ctx, GAL, 60_000)!
    expect(countWare(state, PLUG_BLACKBOX_ITEM_ID)).toBe(1)
    expect(state.shipWrecks ?? {}, '捞空即删记录').toEqual({})
    expect(r.itemId).toBe(PLUG_BLACKBOX_ITEM_ID)
    const lines = state.logs.filter((l) => l.textId === 'core.salvaging.032')
    expect(lines.length, '换黑匣单独一条日志').toBe(1)
    expect(lines[0]!.kind, '与同族两条回收日志同档').toBe('warn')
    console.log(`  [读数] ${lines[0]!.text}`)
  })

  it('整船回收命中时：插件**跟着船回去**（不换黑匣）', () => {
    /**
     * 要钉"回收成功"那一支，就必须让回收率 > 0 且**首掷命中**：真表里没有带 `hullRecoveryChance`
     * 的插件（那条留白是**故意的**，设计稿 §一"加固结构插件接口留口子"），所以这里造一份
     * **只有这一件**的 ctx（该插件副本的回收率改成 1）。
     * ⚠ 两处数值口径：① 残骸快照求和后**夹到 `HULL_RECOVERY_MAX = 0.6`**（所以直接塞 1 没用）；
     * ② 起始状态的 rng 已经把 `count` 推到 4 ⇒ **首掷 = 第 5 个随机数**，逐种子实测：
     * seed 5 首掷 0.9824（不中）、**seed 13 首掷 0.2405（中）** ⇒ 本用例用 seed 13。
     */
    const state = world(13)
    const reinforced = { ...ctx.modules.get(PLUG_SHIELD)!, hullRecoveryChance: 1 }
    const ctx1 = makeTestCtx({ modules: [reinforced] })
    noteShipWreck(state, {
      galaxyId: GAL,
      shipId: 'wrecked-hull-back',
      shipName: '沙猫',
      defId: T1,
      plugs: [PLUG_SHIELD],
      createdAtWallMs: 0,
    })
    // 回收率从**插件槽**里取出来（不是手塞字段）：这正是"第二入口"要钉的东西
    const rec = shipWreckFor(state, GAL)!
    rec.reinforceChance = reinforceChanceOfFitted(undefined, ctx1, [PLUG_SHIELD])
    expect(rec.reinforceChance, '插件槽里的加固件必须被算进回收率（夹到 60% 上限）').toBe(HULL_RECOVERY_MAX)
    const r = trySalvagePlayerWreckOf(state, ctx1, GAL)
    expect(r.kind, '回收率 0.6 且 seed 13 首掷 0.2405 ⇒ 命中').toBe('ship')
    expect(r.kind === 'ship' && r.plugs).toEqual([PLUG_SHIELD])
  })

  it('加固结构插件走插件槽也算回收率（`reinforceChanceOfFitted` 的第二入口）', () => {
    const state = world()
    const rec = noteShipWreck(state, {
      galaxyId: GAL,
      shipId: 'wrecked-reinforce',
      shipName: '沙猫',
      defId: T1,
      plugs: [PLUG_SHIELD],
      reinforceChance: 0.3,
      createdAtWallMs: 0,
    })
    expect(hullRecoveryChanceOf(rec)).toBe(0.3)
  })
})

describe('选靶权重：靶标 ×2 / 隐匿 ×0.4（只改选靶，不改命中与回避）', () => {
  it('两艘同型船：装靶标的那艘被抽中的比例明显更高，装隐匿的明显更低', () => {
    /**
     * 口径（船长）：「**增加被选中的权重**」×2 · 「**减少被攻击的权重**」×0.4 —— **不是"更容易被打中"**
     * ⇒ 只动 `pickMyUnitTarget` 的抽取，不动命中率 / 回避率（`evasion` 断言钉住这一点）。
     * 两艘**同型 T1 `sandcat`**（同档、同定位、同输出、同基础属性）⇒ 唯一变量就是插件权重；
     * 权重 2 : 0.4 = 5 : 1 ⇒ 靶标那艘理论上约 83%。
     */
    const state = world()
    // 第二艘同型船（uid 与船型分开：`uidDefId` 按 `#` 前缀推船型，故 uid 直接用船型名即可）
    state.fleet['sandcat#2'] = {
      defId: T1,
      durability: 1,
      armorPct: 1,
      cargo: {},
      fitted: { high: [], mid: [], low: [] },
    }
    addModule(state, 'plug-target-beacon', 1)
    addModule(state, 'plug-concealment', 1)
    expect(installPlug(state, ctx, 'plug-target-beacon', T1).ok).toBe(true)
    expect(installPlug(state, ctx, 'plug-concealment', 'sandcat#2').ok).toBe(true)

    const beacon = createPlayerSpec(state, ctx, T1)!
    const conceal = createPlayerSpec(state, ctx, 'sandcat#2')!
    beacon.tag = 'beacon'
    conceal.tag = 'conceal'
    expect(beacon.targetWeightMul, '靶标插件 ×2').toBe(2)
    expect(conceal.targetWeightMul, '隐匿插件 ×0.4').toBeCloseTo(0.4, 10)
    expect(beacon.evasion, '两艘同型船的基础回避一致').toBe(conceal.evasion)

    // **插件不改回避**：给同一艘船装上隐匿插件前后对比（否则"同型船基础回避一致"证明不了这条）
    const state2 = world()
    const before = createPlayerSpec(state2, ctx, T1)!
    addModule(state2, 'plug-concealment', 1)
    expect(installPlug(state2, ctx, 'plug-concealment', T1).ok).toBe(true)
    const after = createPlayerSpec(state2, ctx, T1)!
    expect(after.targetWeightMul).toBeCloseTo(0.4, 10)
    expect(after.evasion, '隐匿插件改的是选靶权重，不是回避率').toBe(before.evasion)

    const { aHits, bHits } = tallyTargets(state, beacon, conceal)
    expect(aHits + bHits).toBe(600)
    expect(aHits / (aHits + bHits), '靶标那一艘应占明显多数').toBeGreaterThan(0.7)
    console.log(`  [读数] 靶标 ${aHits} : 隐匿 ${bHits}（权重 2 : 0.4 = 5 : 1 ⇒ 理论 83.3%）`)
  })

  it('对照组：两艘都没插件 ⇒ 各约一半（等权随机没被本批改写）', () => {
    const state = world(3)
    state.fleet['sandcat#2'] = {
      defId: T1,
      durability: 1,
      armorPct: 1,
      cargo: {},
      fitted: { high: [], mid: [], low: [] },
    }
    const a = createPlayerSpec(state, ctx, T1)!
    const b = createPlayerSpec(state, ctx, 'sandcat#2')!
    a.tag = 'a'
    b.tag = 'b'
    expect(a.targetWeightMul, '没插件 = 不写字段').toBeUndefined()
    expect(b.targetWeightMul).toBeUndefined()
    const { aHits, bHits } = tallyTargets(state, a, b)
    expect(aHits + bHits).toBe(600)
    expect(Math.abs(aHits - 300), '等权 ⇒ 各约一半').toBeLessThan(90)
    console.log(`  [读数] 无插件对照：${aHits} : ${bHits}`)
  })
})

describe('随档往返（两处清洗器都要登记）', () => {
  it('舰队侧的 `plugs` 与残骸侧的 `plugs` 都活得过刷新', () => {
    const state = world()
    addModule(state, PLUG_SHIELD, 1)
    installPlug(state, ctx, PLUG_SHIELD, T1)
    noteShipWreck(state, {
      galaxyId: GAL,
      shipId: 'wrecked-1-sandcat',
      shipName: '沙猫',
      defId: T1,
      plugs: [PLUG_ARMOR],
      createdAtWallMs: 0,
    })

    const { state: back } = loadSaveFile(serializeSaveFile(state, 0))
    expect(plugsOf(back, T1), '舰队侧漏登记 = 读档即丢插件').toEqual([PLUG_SHIELD])
    expect(shipWreckFor(back, GAL)?.plugs, '残骸侧漏登记 = 插件白装了').toEqual([PLUG_ARMOR])
    console.log(`  [读数] 读档后：舰队 ${plugsOf(back, T1).join('/')} · 残骸 ${(shipWreckFor(back, GAL)?.plugs ?? []).join('/')}`)
  })

  it('第 8 格不被清洗器裁掉（槽位上限由 7 抬到 8）', () => {
    const state = world()
    const ids = Array.from({ length: 8 }, (_, i) => `plug-t-x${i}`)
    state.fleet[T1]!.plugs = ids
    const { state: back } = loadSaveFile(serializeSaveFile(state, 0))
    expect(plugsOf(back, T1).length, '8 格必须全活（T1 的 5 格 + 中层/下层舱段插件各 +1 = 实际上限 7，清洗器留到 8）').toBe(8)
  })
})
