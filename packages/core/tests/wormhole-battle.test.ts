/**
 * **虫洞 · 洞内战斗与收口（F 批 · 2026-09-13）**。
 *
 * 锁住五组口径：
 * ① **敌卡按层派生**：威胁 = 层曲线（普通节点 / BOSS ×1.2 / 撤离战 ×0.8）；舰级绝对值按比例缩放；
 *    波数把同一编成摊成 N 波（**总战力守恒**）；**选靶模式**随用途分流（BOSS = 打最大的）；
 * ② **开战**：`run.battle` 宿主 + `battle.wormhole` 标记（逐拍同源重建）+ 4 舰编队；
 * ③ **收口 · 胜**：节点战 ⇒ 自动结算该节点（扣回合、推进）；层末守卫 ⇒ 记 `bossCleared` 后放行深入/撤离；
 *    撤离战 ⇒ **收益入港**（背包并入仓库）并结束本趟；
 * ④ **收口 · 负**（= 我方全灭，D 批口径）：**全损**——编队全丢、背包清空；
 * ⑤ **门与句柄**：战斗中不许推进/深入/撤离；层末守卫未清不许深入/撤离；
 * ⑥ **后勤尾巴与远征同源**：未打出去的弹药/修理组件退回仓库、**机群战损真扣清单**、
 *    战报带上船体维修装置消耗（2026-09-13 修：首版全漏 ⇒ 洞内无人机打不死、连打第二场全队哑火）。
 *
 * ⚠ 施工期铁律：虫洞**对玩家不可见**（入口走调试开关、数据走 `unreleased` 闸门），拍板权在船长。
 * ⚠ 本文件不产生任何玩家可见文案。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import { addShipToFleet, pilotUnavailableReason } from '../src/shipyard'
import { addWare, countWare } from '../src/inventory'
import { advanceBattleFor, battleOpenM, createFoeSpecs, createPlayerSpec, desiredRangeFor, foeDesiredRange, foeHpOfThreat } from '../src/combat'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import {
  WORMHOLE_FOE_CARD_IDS,
  WORMHOLE_ORE_ITEM_ID,
  wormholeAnomalyOf,
  wormholeBagSlots,
  wormholeBagUsage,
  wormholeCardIdFor,
  wormholeDescend,
  wormholeEnter,
  wormholeExtract,
  wormholeExtractThreat,
  wormholeFleetCargoM3,
  wormholeFoeThreat,
  wormholeLayerThreat,
  wormholeNaturalHp,
} from '../src/wormhole'
import { advanceWormhole, wormholeActivateAt, wormholeBattleViewOf, wormholeStartBattle, wormholeTravelTo } from '../src/wormholeBattle'
import type { WormholeRunState } from '../src/wormhole'
import type { WormholePlace } from '../src/wormholeGrid'
import { gridContentIndex, hexDistance } from '../src/wormholeGrid'
import { rareWreckItemIdOf, wreckItemIdOf } from '../src/salvage'
import {
  wormholeDiscardToFit,
  wormholeHoldOverloaded,
  wormholeHoldStow,
  wormholeOverloadBlockReason,
  wormholeRelicBoxIdOf,
} from '../src/wormholeSalvage'

const ctx = buildSimContext()
const T3 = 'sh-thresher'

function fresh(seed = 21): GameState {
  return createInitialState({ nowWallMs: 0, seed })
}

/** 起一趟（2×T3 = 7,000 质量 ⇒ 42 回合），并返回状态 */
function enterRun(seed = 21): GameState {
  const state = fresh(seed)
  const a = addShipToFleet(state, T3)
  const b = addShipToFleet(state, T3)
  state.shipId = a
  const r = wormholeEnter(state, ctx, [a, b], seed)
  expect(r.ok).toBe(true)
  return state
}

/** 把场上敌人打光并判我方胜（不动我方血量） */
function winBattle(state: GameState): void {
  const battle = state.wormhole.run!.battle!
  for (const u of Object.values(battle.units)) {
    if (u.side === 'foe') u.hp = { s: 0, a: 0, h: 0 }
  }
  battle.ended = 'me'
}

/**
 * **把玩家挪到指定地点的格上**（F3a-2 起：地点效果由**激活**触发，不再是线性节点）。
 * 等价于旧用例里的 `run.pendingNode = { kind: … }`：直接改当前格的真相，省掉"扫/走"的铺垫。
 */
function standOnPlace(run: WormholeRunState, place: WormholePlace): string {
  const g = run.grid!
  const cell = g.cells.find((c) => c.key === `${g.pos.q},${g.pos.r}`)!
  cell.place = place
  g.activated = g.activated.filter((k) => k !== cell.key)
  return cell.key
}

/** 把玩家挪到"下一层入口"那一格（层末守卫守在入口上：站上去激活才开打） */
function standAtExit(run: WormholeRunState): string {
  const g = run.grid!
  g.pos = { q: g.exit.q, r: g.exit.r }
  const key = `${g.exit.q},${g.exit.r}`
  if (!g.visited.includes(key)) g.visited.push(key)
  if (!g.scanned.includes(key)) g.scanned.push(key)
  g.activated = g.activated.filter((k) => k !== key)
  return key
}

/**
 * **收口一场已分胜负的战斗**：跳过「击杀慢镜」窗口（与远征 `bal.killcamMs` 同源）再推进。
 * 引擎在 `ended` 之后**延迟结算**——为的是让战斗界面把最后一击/爆炸演出播完
 * （首版实测：不延迟的话战斗界面会在结束那一瞬间直接卸载，战报窗口没机会播）。
 */
function settleBattle(state: GameState): void {
  const b = state.wormhole.run?.battle
  if (b) state.gameMs = b.lastTickGameMs + 10_000
  advanceWormhole(state, ctx)
}

describe('虫洞 · 洞内敌卡按层派生（F 批）', () => {
  it('威胁随用途分流：普通节点 = 层威胁 · BOSS ×1.2 · 撤离战 = **线性**（船长 2026-09-13 改判）', () => {
    expect(wormholeLayerThreat(1)).toBe(45)
    expect(wormholeFoeThreat(1, 'node')).toBe(45)
    expect(wormholeFoeThreat(1, 'boss')).toBe(54) // 45 × 1.2
    expect(wormholeFoeThreat(3, 'node')).toBe(wormholeLayerThreat(3))
    expect(wormholeFoeThreat(3, 'boss')).toBe(Math.round(wormholeLayerThreat(3) * 1.2))
    // **撤离战：线性**（层 2 = 42，每层 +7）——层 2/3 与改判前的读数相同，之后逐层低于等比
    expect(wormholeFoeThreat(2, 'extract')).toBe(42)
    expect(wormholeFoeThreat(3, 'extract')).toBe(49)
    expect(wormholeFoeThreat(4, 'extract')).toBe(56)
    expect(wormholeFoeThreat(8, 'extract')).toBe(84)
    expect(wormholeExtractThreat(12)).toBe(112)
    // 等差（不是等比）：任意相邻两层之差恒为 7
    for (let d = 2; d <= 14; d++) {
      expect(wormholeExtractThreat(d + 1) - wormholeExtractThreat(d)).toBe(7)
    }
    // 且**深层明显低于**等比口径（等比层 8 = 102）：撤离战不该比同层节点战更陡
    expect(wormholeExtractThreat(8)).toBeLessThan(Math.round(wormholeLayerThreat(8) * 0.8))
  })

  it('五张洞内敌卡按 (层, 节点) 确定性轮换，且五族（A/C/D/E/G）都真实存在于目录里', () => {
    const ids = new Set<string>()
    for (let d = 1; d <= 5; d++) {
      for (let i = 0; i < 3; i++) {
        const id = wormholeCardIdFor(d, i)
        ids.add(id)
        expect(wormholeCardIdFor(d, i)).toBe(id) // 确定性
      }
    }
    expect(ids.size).toBe(WORMHOLE_FOE_CARD_IDS.length) // 轮换覆盖全部五张
    expect(WORMHOLE_FOE_CARD_IDS.length).toBe(5) // A/C/D/E/G 各一张（2026-09-13 补 E 族）
    const families = new Set<string>()
    for (const id of WORMHOLE_FOE_CARD_IDS) {
      const card = ctx.anomalies.get(id)
      expect(card, `目录里没有洞内敌卡 ${id}`).toBeTruthy()
      expect(card!.hidden).toBe(true) // 施工期必须隐藏（不进悬赏目录）
      expect((card!.ships ?? []).length).toBeGreaterThan(0) // 舰级路径
      families.add(String(card!.foeFamily))
    }
    // 五族齐 ⇒ 按族掉落池"每族都有来源"（船长 2026-09-13：专属掉落与蓝图都按种族库走）
    expect([...families].sort()).toEqual(['A', 'C', 'D', 'E', 'G'])
  })

  it('派生：威胁换成目标值、**总血压到该层预算**（按卡归一）；**波数摊薄但总战力守恒**', () => {
    const base = ctx.anomalies.get('wh-pirate-scout')!
    const naturalHp = wormholeNaturalHp(base)
    const one = wormholeAnomalyOf(base, 1, 'node', 1, { hpBudget: naturalHp * 2 })
    expect(one.threat).toBe(45)
    // 目标总血 = 预算（**按卡归一**：卡间的坦克/脆皮差异不再影响"威胁 = 战力标尺"）
    expect(wormholeNaturalHp(one)).toBeCloseTo(naturalHp * 2, 3)
    // 波数摊薄：同一预算摊成两波 ⇒ 条数翻倍、每条半血、**总血不变**
    const two = wormholeAnomalyOf(base, 1, 'node', 2, { hpBudget: naturalHp * 2 })
    expect(wormholeNaturalHp(two)).toBeCloseTo(naturalHp * 2, 3)
    expect((two.ships ?? []).length).toBe((one.ships ?? []).length * 2)
    expect(two.waves?.length).toBe(2)
    // 深层：预算由引擎按层算（`foeHpOfThreat(威胁) × 系数`）⇒ 这里给更大预算即代表更深一层
    const deep = wormholeAnomalyOf(base, 4, 'node', 1, { hpBudget: naturalHp * 3 })
    expect(deep.threat).toBe(wormholeLayerThreat(4))
    expect(wormholeNaturalHp(deep)).toBeCloseTo(naturalHp * 3, 3)
    // 不给预算（纯展示/校准口径）：只换威胁字段，条目保持自然值
    const bare = wormholeAnomalyOf(base, 4, 'node', 1)
    expect(bare.threat).toBe(wormholeLayerThreat(4))
    expect(wormholeNaturalHp(bare)).toBeCloseTo(naturalHp, 3)
  })

  it('选靶模式随用途分流：普通节点用卡上模式、**BOSS 一律打最大的**', () => {
    const pirate = ctx.anomalies.get('wh-pirate-scout')!
    const alien = ctx.anomalies.get('wh-alien-swarm')!
    const grave = ctx.anomalies.get('wh-grave-watch')!
    const exile = ctx.anomalies.get('wh-exile-blockade')!
    expect(wormholeAnomalyOf(pirate, 1, 'node', 1).foeTargeting).toBe('noncombat')
    expect(wormholeAnomalyOf(alien, 1, 'node', 1).foeTargeting).toBe('smallest')
    expect(wormholeAnomalyOf(grave, 1, 'node', 1).foeTargeting).toBe('top-output')
    expect(wormholeAnomalyOf(exile, 1, 'node', 1).foeTargeting).toBe('random')
    for (const card of [pirate, alien, grave, exile]) {
      expect(wormholeAnomalyOf(card, 2, 'boss', 1).foeTargeting).toBe('largest')
    }
  })

  it('派生卡能真实建档（舰级路径）：波次数量与槽位分组一致', () => {
    const base = ctx.anomalies.get('wh-grave-watch')!
    const card = wormholeAnomalyOf(base, 3, 'node', 2)
    const w0 = createFoeSpecs(card, ctx.balance.battle, { tagPrefix: '' })
    const w1 = createFoeSpecs(card, ctx.balance.battle, { tagPrefix: 'w1-' })
    expect(w0.length).toBeGreaterThan(0)
    expect(w1.length).toBeGreaterThan(0)
    expect(w0.length).toBe(w1.length) // 同一编成分波 ⇒ 每波条数相同
  })
})

describe('虫洞 · 开战（F 批）', () => {
  it('地点战可开战：宿主在 run.battle、带 wormhole 标记、我方 4 单位路径生效', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    standOnPlace(run, 'ship')
    const r = wormholeStartBattle(state, ctx, 'node', 0)
    expect(r.ok).toBe(true)
    const battle = run.battle!
    // 敌卡按**格坐标**散列的序号轮换（同格恒同序；一层里连打几场不会全用同一张卡）
    expect(battle.wormhole).toEqual({
      cardId: wormholeCardIdFor(1, gridContentIndex(run.grid!)),
      depth: 1,
      kind: 'node',
      waves: 1,
    })
    expect(battle.myFleet?.length).toBe(2) // 两艘都在（主控置首）
    expect(battle.hullEscapeFrac).toBeUndefined() // 副本内无"结构过半自动脱离"
    // 敌卡已按层派生：威胁 45 的卡（网格层的地点战不分波）
    expect(battle.waveIdx ?? 0).toBe(0)
    const foes = Object.values(battle.units).filter((u) => u.side === 'foe')
    expect(foes.length).toBeGreaterThan(0)
    // 同一战斗不能重复开
    expect(wormholeStartBattle(state, ctx, 'node', 0).ok).toBe(false)
  })

  it('非交火地点开不了战（网格层：战斗只由「舰船信号」地点触发）', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    standOnPlace(run, 'vein') // 矿脉：不是交火地点
    expect(wormholeStartBattle(state, ctx, 'node', 0).ok).toBe(false)
    expect(run.battle ?? null).toBeNull()
  })

  it('战斗中：推进 / 深入 / 撤离一律被拒（船长第 8 条）', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    standOnPlace(run, 'ship')
    expect(wormholeStartBattle(state, ctx, 'node', 0).ok).toBe(true)
    expect(wormholeExtract(run).ok).toBe(false)
    expect(wormholeDescend(state, 21).ok).toBe(false)
    expect(run.phase).toBe('inside')
  })

  it('层末守卫守在**下一层入口**上：没站上入口开不了，打完才放行深入/撤离', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    expect(wormholeStartBattle(state, ctx, 'boss', 0).ok).toBe(false) // 没站在入口格上
    expect(wormholeDescend(state, 21).ok).toBe(false) // 守卫没清
    standAtExit(run)
    expect(wormholeStartBattle(state, ctx, 'boss', 0).ok).toBe(true)
    winBattle(state)
    settleBattle(state)
    expect(run.bossCleared).toBe(1)
    expect(run.battle).toBeNull()
    expect(wormholeDescend(state, 21).ok).toBe(true)
    expect(run.depth).toBe(2)
  })
})

describe('虫洞 · 战斗收口（F 批）', () => {
  it('**胜 · 地点战**：回合在"激活地点"那一步已扣；收口不再重复扣、地点留在已处理', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    const key = standOnPlace(run, 'ship')
    const turnsBefore = run.turnsLeft
    const act = wormholeActivateAt(state, ctx)
    expect(act.ok).toBe(true)
    expect(act.started).toBe('node') // 激活"舰船信号" ⇒ 立刻开战（不用界面再点一次）
    expect(run.turnsLeft).toBe(turnsBefore - 1) // 激活那一步就扣了回合
    expect(run.battle).not.toBeNull()
    winBattle(state)
    settleBattle(state)
    expect(run.battle).toBeNull()
    expect(run.turnsLeft).toBe(turnsBefore - 1) // 收口不重复扣费
    expect(run.grid!.activated).toContain(key)
  })

  it('**到达即开打**（船长 2026-09-13）：走到舰船信号那一格就地交火，只花「前往」那 1 回合', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    const g = run.grid!
    const target = g.cells.find((c) => c.key !== `${g.pos.q},${g.pos.r}` && hexDistance(c, g.pos) === 1)!
    target.place = 'ship'
    g.scanned.push(target.key)
    const turnsBefore = run.turnsLeft
    const r = wormholeTravelTo(state, ctx, { q: target.q, r: target.r })
    expect(r.ok).toBe(true)
    expect(r.autoBattle).toBe(true)
    expect(run.battle).not.toBeNull()
    expect(run.battle!.wormhole?.kind).toBe('node')
    expect(run.turnsLeft).toBe(turnsBefore - 1) // 到达即开打 ⇒ 没有第二次「激活」扣费
    winBattle(state)
    settleBattle(state)
    expect(run.battle).toBeNull()
    expect(run.turnsLeft).toBe(turnsBefore - 1) // 收口也不重复扣
  })

  it('开战起不来（编队被掏空）⇒ **整趟移动回滚**：人留在原格、回合不丢、地点没被记成已处理', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    const g = run.grid!
    const target = g.cells.find((c) => c.key !== `${g.pos.q},${g.pos.r}` && hexDistance(c, g.pos) === 1)!
    target.place = 'ship'
    g.scanned.push(target.key)
    const posBefore = { ...g.pos }
    const turnsBefore = run.turnsLeft
    run.fleet = [] // `startFleetBattleFor` 建不出战斗
    const r = wormholeTravelTo(state, ctx, { q: target.q, r: target.r })
    expect(r.ok).toBe(false)
    expect(g.pos).toEqual(posBefore)
    expect(run.turnsLeft).toBe(turnsBefore)
    expect(g.visited).not.toContain(target.key)
    expect(g.activated).not.toContain(target.key)
    expect(run.battle ?? null).toBeNull()
  })

  it('**激活入口格 ⇒ 层末守卫战**（网格层的"打完才放行"落点）', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    standAtExit(run)
    const act = wormholeActivateAt(state, ctx)
    expect(act.ok).toBe(true)
    expect(act.effect?.kind).toBe('exit')
    expect(act.started).toBe('boss')
    expect(run.battle!.wormhole?.kind).toBe('boss')
    winBattle(state)
    settleBattle(state)
    expect(run.bossCleared).toBe(1)
    expect(wormholeDescend(state, 21).ok).toBe(true)
  })

  it('**胜 · 撤离战**：背包并入仓库、本趟结束（第 2 层起才有撤离战）', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    run.depth = 2 // 船长 2026-09-13：「撤离战只从第二层开始生效」⇒ 要打撤离战就得站到第 2 层
    run.bossCleared = run.depth
    run.bag = [{ itemId: WORMHOLE_ORE_ITEM_ID, units: 500 }]
    const before = countWare(state, WORMHOLE_ORE_ITEM_ID)
    expect(wormholeExtract(run).ok).toBe(true)
    expect(run.phase).toBe('extracting')
    // 撤离战由 `advanceWormhole` 自动开打
    advanceWormhole(state, ctx)
    expect(run.battle).not.toBeNull()
    expect(run.battle!.wormhole?.kind).toBe('extract')
    winBattle(state)
    settleBattle(state)
    expect(countWare(state, WORMHOLE_ORE_ITEM_ID)).toBe(before + 500) // 收益入港
    expect(state.wormhole.run).toBeNull() // 本趟结束
    // **结算单**（界面弹层用）：收益写进来、没有损失
    const st = state.wormhole.lastSettle!
    expect(st.kind).toBe('extract')
    expect(st.depth).toBe(2)
    expect(st.oreUnits).toBe(500)
    expect(st.oreIsk).toBe(500 * (ctx.items.get(WORMHOLE_ORE_ITEM_ID)?.baseSellPriceIsk ?? 0))
    expect(st.shipsLost).toEqual([])
    expect(st.lostIsk).toBe(0)
  })

  it('**第 1 层免撤离战**（船长 2026-09-13）：撤了就直接入港，结算单标记 skippedExtractBattle', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    expect(run.depth).toBe(1)
    run.bag = [{ itemId: WORMHOLE_ORE_ITEM_ID, units: 300 }]
    const before = countWare(state, WORMHOLE_ORE_ITEM_ID)
    expect(wormholeExtract(run).ok).toBe(true)
    advanceWormhole(state, ctx)
    expect(state.wormhole.run).toBeNull() // 一趟结束（没有战斗要打）
    expect(countWare(state, WORMHOLE_ORE_ITEM_ID)).toBe(before + 300) // 收益照常入港
    const st = state.wormhole.lastSettle!
    expect(st.kind).toBe('extract')
    expect(st.depth).toBe(1)
    expect(st.skippedExtractBattle).toBe(true)
  })

  /**
   * **形状件（遗迹安全货柜）随趟带回**——⚠ 这条是 2026-09-13 修掉的**真 BUG**：
   * 货柜走 `run.hold.placements`（不在 `run.bag`），而撤离结算只扫 `run.bag` 与 `run.relics`
   * ⇒ 打捞到的货柜会在"撤离成功"那一刻**静默消失**，"带回后精炼炉拆解"永远发生不了。
   */
  it('**胜 · 撤离战**：货仓里的货柜也进仓库（不是只有散货入港）', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    run.depth = 2 // 第 2 层起才有撤离战（第 1 层免战那条另有用例）
    run.bossCleared = run.depth
    // 直接用「装舱」入位（等价从格上拾取：占 2×2 = 4 格）
    const family = String(ctx.anomalies.get(wormholeCardIdFor(run.depth, 0))?.foeFamily ?? 'A')
    const boxId = wormholeRelicBoxIdOf(family)
    expect(wormholeHoldStow(state, ctx, boxId).ok).toBe(true)
    expect(countWare(state, boxId)).toBe(0)
    expect(wormholeExtract(run).ok).toBe(true)
    advanceWormhole(state, ctx)
    winBattle(state)
    settleBattle(state)
    expect(countWare(state, boxId)).toBe(1) // **货柜真的到港了**
    expect(state.wormhole.run).toBeNull()
    expect(state.wormhole.lastSettle!.boxes).toEqual([boxId]) // 结算单里也报出这件货柜
  })

  it('**负 · 全灭**：全损——货柜一起丢（不带走）', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    run.bossCleared = run.depth
    const family = String(ctx.anomalies.get(wormholeCardIdFor(run.depth, 0))?.foeFamily ?? 'A')
    const boxId = wormholeRelicBoxIdOf(family)
    expect(wormholeHoldStow(state, ctx, boxId).ok).toBe(true)
    run.fleet = [] // 掏空编队记录 ⇒ 撤离战建不出来（与「无船撤离」那条同款造法）
    expect(wormholeExtract(run).ok).toBe(true)
    advanceWormhole(state, ctx)
    expect(state.wormhole.run).toBeNull()
    expect(countWare(state, boxId)).toBe(0) // 全损 ⇒ 货柜随趟一起丢
    expect(state.wormhole.lastSettle!.kind).toBe('lost')
  })

  it('**负 · 全灭**：全损——编队全丢、背包清空、本趟结束', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    const fleetBefore = Object.keys(state.fleet).length
    const runFleet = [...run.fleet]
    standOnPlace(run, 'ship') // F3a-2：洞内战由**地点**触发（等价旧「当前节点是战斗节点」）
    run.bag = [{ itemId: WORMHOLE_ORE_ITEM_ID, units: 300 }]
    const oreBefore = countWare(state, WORMHOLE_ORE_ITEM_ID)
    expect(wormholeStartBattle(state, ctx, 'node', 0).ok).toBe(true)
    const battle = run.battle!
    for (const u of Object.values(battle.units)) {
      if (u.side === 'me') u.hp = { s: 0, a: 0, h: 0 }
    }
    battle.ended = 'foe'
    settleBattle(state)
    expect(state.wormhole.run).toBeNull()
    expect(state.wormhole.lastFleetLost).toBe(runFleet.length)
    expect(Object.keys(state.fleet).length).toBe(fleetBefore - runFleet.length) // 船真丢了
    expect(countWare(state, WORMHOLE_ORE_ITEM_ID)).toBe(oreBefore) // 背包内容没入港
    // **结算单**（界面弹层用）：全损也要有单子，且把"损失了哪几艘 / 本来能带走多少"写清楚
    const st = state.wormhole.lastSettle!
    expect(st.kind).toBe('lost')
    expect(st.shipsLost.length).toBe(runFleet.length)
    expect(st.oreIsk).toBe(0)
    expect(st.lostIsk).toBeGreaterThan(0) // 300 单位母矿本来能带走
    // **绝不软锁**：主控也在这批损失里 ⇒ 弃船补驾驶必须已经补上（全损是终局玩法，不能停在"没船可开"）
    expect(state.fleet[state.shipId], '全损后没有可驾驶船').toBeTruthy()
    expect(pilotUnavailableReason(state)).toBeNull()
  })

  it('单舰入洞打全损（连保底船都没有了）⇒ 协会补发保底舰船，不会软锁', () => {
    const state = fresh()
    const only = state.shipId
    expect(wormholeEnter(state, ctx, [only], 21).ok).toBe(true)
    const run = state.wormhole.run!
    expect(run.fleet).toEqual([only])
    standOnPlace(run, 'ship') // F3a-2：洞内战由**地点**触发（等价旧「当前节点是战斗节点」）
    expect(wormholeStartBattle(state, ctx, 'node', 0).ok).toBe(true)
    for (const u of Object.values(run.battle!.units)) {
      if (u.side === 'me') u.hp = { s: 0, a: 0, h: 0 }
    }
    run.battle!.ended = 'foe'
    settleBattle(state)
    expect(state.wormhole.run).toBeNull()
    expect(state.fleet[only]).toBeUndefined() // 唯一那艘真丢了
    expect(Object.keys(state.fleet).length).toBeGreaterThanOrEqual(1) // 协会补发保底舰船
    expect(state.fleet[state.shipId]).toBeTruthy()
    expect(pilotUnavailableReason(state)).toBeNull()
  })

  it('**沉船后格数缩水 ⇒ 超载（不自动丢货）**：船长 F4 裁定「要求玩家手动抛弃货物」', () => {
    const state = fresh()
    const ids = [addShipToFleet(state, T3), addShipToFleet(state, T3), addShipToFleet(state, T3), addShipToFleet(state, T3)]
    state.shipId = ids[0]!
    expect(wormholeEnter(state, ctx, ids, 21).ok).toBe(true)
    const run = state.wormhole.run!
    const cheap = 'ore-veldspar'
    const dear = WORMHOLE_ORE_ITEM_ID
    const capBefore = wormholeBagSlots(wormholeFleetCargoM3(state, ctx, run.fleet))
    expect(capBefore).toBeGreaterThanOrEqual(6)
    run.bag = [
      { itemId: cheap, units: (capBefore - 2) * 500 },
      { itemId: dear, units: 2 * 500 },
    ]
    const bagBefore = JSON.stringify(run.bag)
    standOnPlace(run, 'ship')
    expect(wormholeStartBattle(state, ctx, 'node', 0).ok).toBe(true)
    run.battle!.units['ally-1']!.hp = { s: 0, a: 0, h: 0 }
    run.battle!.units['ally-2']!.hp = { s: 0, a: 0, h: 0 }
    winBattle(state)
    settleBattle(state)
    const back = state.wormhole.run!
    expect(wormholeBagSlots(wormholeFleetCargoM3(state, ctx, back.fleet))).toBeLessThan(capBefore)
    // **一件都没自动丢**（新口径）；超载由玩家自己解
    expect(JSON.stringify(back.bag), '旧口径在自动丢货').toBe(bagBefore)
    expect(wormholeHoldOverloaded(state, ctx), '沉船后应当超载').toBe(true)
    expect(state.logs.map((l) => l.text).some((t) => t.includes('超载'))).toBe(true)
    expect(state.logs.map((l) => l.text).some((t) => t.includes('手动抛弃货物'))).toBe(true)
    // 超载期间不许再装东西
    expect(wormholeOverloadBlockReason(state, ctx) ?? '').toContain('超载')
    // 玩家抛货（先便宜的）⇒ 恢复
    const fit = wormholeDiscardToFit(state, ctx)
    expect(fit.ok).toBe(true)
    expect(wormholeHoldOverloaded(state, ctx)).toBe(false)
    const dearLeft = back.bag.find((s) => s.itemId === dear)?.units ?? 0
    expect(dearLeft, '贵货被丢了（应先丢便宜的）').toBe(1000)
  })

  it('**一键抛货的顺序**（玩家点按钮，仍按价值）：普通残骸先丢、原矿其次、**稀有残骸最后丢**', () => {
    const state = fresh()
    const ids = [addShipToFleet(state, T3), addShipToFleet(state, T3), addShipToFleet(state, T3), addShipToFleet(state, T3)]
    state.shipId = ids[0]!
    expect(wormholeEnter(state, ctx, ids, 21).ok).toBe(true)
    const run = state.wormhole.run!
    const card = 'wh-pirate-scout'
    const common = wreckItemIdOf(card)
    const rare = rareWreckItemIdOf(card)
    const capBefore = wormholeBagSlots(wormholeFleetCargoM3(state, ctx, run.fleet))
    expect(capBefore).toBe(20) // 4×T3 合计货仓 10,400 m³ ÷ 500
    // 12 格普通残骸 + 3 格虚空母矿 + 1 格稀有残骸 = 16 格 > 缩容后的 10 格
    run.bag = [
      { itemId: common, units: 12 * 500 },
      { itemId: WORMHOLE_ORE_ITEM_ID, units: 3 * 500 },
      { itemId: rare, units: 30 },
    ]
    standOnPlace(run, 'ship')
    expect(wormholeStartBattle(state, ctx, 'node', 0).ok).toBe(true)
    run.battle!.units['ally-1']!.hp = { s: 0, a: 0, h: 0 }
    run.battle!.units['ally-2']!.hp = { s: 0, a: 0, h: 0 }
    winBattle(state)
    settleBattle(state)
    const back = state.wormhole.run!
    expect(wormholeBagSlots(wormholeFleetCargoM3(state, ctx, back.fleet))).toBe(10)
    expect(wormholeHoldOverloaded(state, ctx)).toBe(true)
    // 玩家点「抛到容量内」⇒ 只动最便宜的（普通残骸），原矿与稀有残骸留着
    const fit = wormholeDiscardToFit(state, ctx)
    expect(fit.ok).toBe(true)
    expect(wormholeHoldOverloaded(state, ctx)).toBe(false)
    expect(back.bag.find((s) => s.itemId === rare)?.units, '稀有残骸被丢了').toBe(30)
    expect(back.bag.find((s) => s.itemId === WORMHOLE_ORE_ITEM_ID)?.units, '虚空母矿被丢了').toBe(1500)
    expect(back.bag.find((s) => s.itemId === common)?.units ?? 0, '普通残骸没被扣').toBeLessThan(12 * 500)
  })

  it('某个僚舰被打沉（战斗仍胜）：该船从编队与舰队里一起消失，其余船继续', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    standOnPlace(run, 'ship') // F3a-2：洞内战由**地点**触发（等价旧「当前节点是战斗节点」）
    const fleetBefore = Object.keys(state.fleet).length
    expect(wormholeStartBattle(state, ctx, 'node', 0).ok).toBe(true)
    const battle = run.battle!
    battle.units['ally-1']!.hp = { s: 0, a: 0, h: 0 } // 僚舰沉
    winBattle(state)
    settleBattle(state)
    expect(run.fleet.length).toBe(1) // 编队只剩主控
    expect(Object.keys(state.fleet).length).toBe(fleetBefore - 1)
    expect(state.wormhole.run).not.toBeNull() // 还有船 ⇒ 本趟继续
    expect(run.battle).toBeNull()
  })

  it('撤离战开不起来（编队没了之类的硬故障）⇒ 按全损收场，不卡在撤离相位', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    run.bossCleared = run.depth
    run.bag = []
    // 掏空编队记录 ⇒ `startFleetBattleFor` 建不出战斗
    run.fleet = []
    expect(wormholeExtract(run).ok).toBe(true)
    advanceWormhole(state, ctx)
    expect(state.wormhole.run).toBeNull()
  })
})

describe('虫洞 · 开战距离与派生一致性（船长 2026-09-13 两条口径）', () => {
  it('**开战距离特殊规则**：非近战敌人开局就站在**自己的目标距离**（不是"最远射程 + 缓冲"）', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    standOnPlace(run, 'ship') // F3a-2：洞内战由**地点**触发（等价旧「当前节点是战斗节点」）
    expect(wormholeStartBattle(state, ctx, 'node', 0).ok).toBe(true)
    const battle = run.battle!
    const card = ctx.anomalies.get(battle.wormhole!.cardId)!
    const me = createPlayerSpec(state, ctx, run.fleet[0]!)!
    const foes = createFoeSpecs(
      wormholeAnomalyOf(card, 1, 'node', 1, {
        hpBudget: foeHpOfThreat(wormholeLayerThreat(1), ctx.balance.battle) * 10,
      }),
      ctx.balance.battle,
    )
    const anyBrawl = foes.some((f) => f.foeTactic === 'brawl')
    const expected = anyBrawl
      ? desiredRangeFor(me, 'mid', ctx.balance.battle)
      : foeDesiredRange(me, foes, ctx.balance.battle)
    const openM = battleOpenM(me, foes, ctx.balance.battle)
    // 常规口径是"最远射程 + 缓冲"（= openM）；洞内口径落在**目标距离**上（被 openM 钳制的场合取钳制值）
    expect(battle.distanceM).toBe(
      Math.max(ctx.balance.battle.minDistanceM, Math.min(openM, Math.round(expected))),
    )
    expect(battle.distanceM).toBeLessThanOrEqual(openM)
  })

  it('**逐拍重建与开战同源**：敌人真能打疼你（首版就错在这里——血强化了、炮还是自然值）', () => {
    const state = enterRun(7)
    const run = state.wormhole.run!
    standOnPlace(run, 'ship') // F3a-2：洞内战由**地点**触发（等价旧「当前节点是战斗节点」）
    expect(wormholeStartBattle(state, ctx, 'node', 0).ok).toBe(true)
    const battle = run.battle!
    const meTags = (battle.myFleet ?? []).map((e) => e.tag)
    const hpSum = (): number =>
      meTags.reduce((n, t) => {
        const u = battle.units[t]
        return n + (u ? u.hp.s + u.hp.a + u.hp.h : 0)
      }, 0)
    const before = hpSum()
    let guard = 0
    while (!battle.ended && guard < 180) {
      state.gameMs += 1_000
      advanceBattleFor(state, ctx, battle, run.fleet[0]!, battle.wormhole!.cardId)
      guard++
    }
    const lost = before - hpSum()
    expect(battle.stats.foeShots, '敌人整场没开火（开战距离或派生口径又错了）').toBeGreaterThan(0)
    expect(lost, '敌人开火了却打不掉血（开战 / 逐拍两处派生不同源）').toBeGreaterThan(0)
    // 强度系数 10 的口径下，这一场应当打出**成规模**的战损（不是挠痒痒）
    expect(lost / before).toBeGreaterThan(0.05)
  })
  it('**战报**：每场洞内战斗结束都留一条同源战报（交火时长 / 双方开火命中 / 编队残血）', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    standOnPlace(run, 'ship') // F3a-2：洞内战由**地点**触发（等价旧「当前节点是战斗节点」）
    expect(wormholeStartBattle(state, ctx, 'node', 0).ok).toBe(true)
    winBattle(state)
    settleBattle(state)
    const line = state.logs.map((l) => l.text).filter((t) => t.includes('交火结束')).pop()
    expect(line, '地点战胜利没有战报').toBeTruthy()
    expect(line!).toContain('第 1 层地点')
    expect(line!).toContain('编队残血')
    // 撤离战同样有战报（且与"撤离成功"分开两条）——第 2 层起才有撤离战
    const run2 = state.wormhole.run!
    run2.depth = 2
    run2.bossCleared = run2.depth
    run2.bag = [{ itemId: WORMHOLE_ORE_ITEM_ID, units: 500 }]
    expect(wormholeExtract(run2).ok).toBe(true)
    advanceWormhole(state, ctx) // 自动开撤离战
    winBattle(state)
    settleBattle(state)
    expect(state.logs.map((l) => l.text).some((t) => t.includes('撤离拦截交火结束'))).toBe(true)
    expect(state.logs.map((l) => l.text).some((t) => t.includes('撤离成功'))).toBe(true)
  })
  it('**机群照吃战损**（与远征/遭遇同款）：洞内首舰的无人机被打下来要**真扣清单**，不是白嫖', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    const leader = run.fleet[0]!
    // 首舰装机库甲板 + 带上侦察无人机（真走 `buildMyUnitSpecs` ⇒ 机群生存池）
    state.fleet[leader]!.fitted = { high: ['mod-drone-rack-3'], mid: [], low: [] }
    state.fleet[leader]!.droneLoad = { 'drone-scout': 4 }
    standOnPlace(run, 'ship') // F3a-2：洞内战由**地点**触发（等价旧「当前节点是战斗节点」）
    expect(wormholeStartBattle(state, ctx, 'node', 0).ok).toBe(true)
    const battle = run.battle!
    // D 批边界：僚舰无人机不参战，**主控机群参战**（池按主控武器槽建）
    expect(battle.dronePools, '洞内没建机群生存池').toBeTruthy()
    expect(Object.keys(battle.dronePools!).length).toBe(4)
    expect(battle.droneLoadAtStart?.['drone-scout']).toBe(4)
    // 模拟"被打下来 4 架"（点防/敌机群击落的落账口径），再收口
    battle.droneLost = { 'drone-scout': 4 }
    winBattle(state)
    settleBattle(state)
    // **净损失已从清单扣除**：回收率 20%~50% ⇒ 4 架里回收 1~2 架，但**不可能一架不少**
    const left = state.fleet[leader]?.droneLoad?.['drone-scout'] ?? 0
    expect(left).toBeLessThan(4)
    expect(left).toBeGreaterThanOrEqual(1)
    expect(state.logs.map((l) => l.text).some((t) => t.includes('机群战损'))).toBe(true)
    // 账本已清（幂等：重复结算不会二次扣）
    expect(state.wormhole.run?.battle).toBeNull()
  })
  it('**战报带后勤尾巴**：船体维修装置消耗写进洞内战报（与远征同口径）', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    standOnPlace(run, 'ship') // F3a-2：洞内战由**地点**触发（等价旧「当前节点是战斗节点」）
    expect(wormholeStartBattle(state, ctx, 'node', 0).ok).toBe(true)
    const battle = run.battle!
    const repair = battle.repair ?? { units: [], kits: {}, pulses: 0, kitsUsed: 0 }
    repair.kitsUsed = 2
    repair.kitsUsedByType = { 'repairkit-mil': 2 }
    battle.repair = repair
    winBattle(state)
    settleBattle(state)
    const line = state.logs.map((l) => l.text).filter((t) => t.includes('交火结束')).pop()
    expect(line).toContain('船体维修装置')
    expect(line).toContain('×2')
  })
  it('**战后弹药退款**（与远征同款）：仓库只损失**真打出去**的那些 ⇒ 连打第二场不会哑火', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    // 让编队真带上炮与弹（默认档里两艘 T3 没装配）
    for (const uid of run.fleet) {
      state.fleet[uid]!.fitted = { high: ['mod-turret-kin-1'], mid: [], low: [] }
    }
    addWare(state, 'ammo-kinetic-l', 5_000)
    standOnPlace(run, 'ship') // F3a-2：洞内战由**地点**触发（等价旧「当前节点是战斗节点」）
    const before = countWare(state, 'ammo-kinetic-l')
    expect(wormholeStartBattle(state, ctx, 'node', 0).ok).toBe(true)
    const battle = run.battle!
    const loaded = battle.ammo.kin
    expect(loaded).toBeGreaterThan(0) // 开战装载了两艘船各自的弹
    // 真打一会儿（会消耗弹药）
    let guard = 0
    while (!battle.ended && guard++ < 90) {
      state.gameMs += 1_000
      advanceBattleFor(state, ctx, battle, run.fleet[0]!, battle.wormhole!.cardId)
    }
    const left = battle.ammo.kin
    const fired = loaded - left
    if (!battle.ended) {
      for (const u of Object.values(battle.units)) if (u.side === 'foe') u.hp = { s: 0, a: 0, h: 0 }
      battle.ended = 'me'
    }
    settleBattle(state)
    // **退款 = 未打出去的那部分**（首版漏退款 ⇒ 每场把整批预载吞掉，第二场起全队哑火）
    expect(countWare(state, 'ammo-kinetic-l')).toBe(before - fired)
    // 第二场照样有弹
    const run2 = state.wormhole.run
    if (run2) {
      standOnPlace(run2, 'ship') // 第二场：把所在地点改成舰船信号再开打
      expect(wormholeStartBattle(state, ctx, 'node', 0).ok).toBe(true)
      expect(state.wormhole.run!.battle!.ammo.kin).toBeGreaterThan(0)
    }
  })
})

describe('虫洞 · 战场视图（F2 · 2026-09-13）', () => {
  it('视图上下文：给出按层派生的敌卡 / 主控锚 / 场景名；**分胜负后仍要给 combat**（击杀慢镜窗口）', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    expect(wormholeBattleViewOf(state, ctx)).toBeNull() // 没开战时没有视图
    standOnPlace(run, 'ship') // F3a-2：洞内战由**地点**触发（等价旧「当前节点是战斗节点」）
    expect(wormholeStartBattle(state, ctx, 'node', 0).ok).toBe(true)
    const v = wormholeBattleViewOf(state, ctx)!
    expect(v.name).toBe('虫洞 · 第 1 层')
    expect(v.leaderShipId).toBe(run.fleet[0])
    expect(v.anomaly.threat).toBe(wormholeLayerThreat(1)) // 已按层派生
    expect(v.combat).not.toBeNull()
    expect(Object.keys(v.combat!.foeHp).length).toBeGreaterThan(0)
    // **分出胜负后 combat 仍在**：战斗界面靠它把最后一击/战报窗口播完（提前置 null ⇒ 界面直接卸载）
    winBattle(state)
    const v2 = wormholeBattleViewOf(state, ctx)!
    expect(v2.combat).not.toBeNull()
    // 结算之后（战斗宿主清掉）视图才消失
    settleBattle(state)
    expect(state.wormhole.run!.battle).toBeNull()
    expect(wormholeBattleViewOf(state, ctx)).toBeNull()
  })

  it('**阵亡的敌舰仍留在 `combat.foeHp` 里**（否则战斗界面看不到"血量归零那一拍"⇒ 敌方没有爆炸动画）', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    standOnPlace(run, 'ship')
    expect(wormholeStartBattle(state, ctx, 'node', 0).ok).toBe(true)
    const battle = run.battle!
    const foeTag = Object.keys(battle.units).find((t) => battle.units[t]!.side === 'foe')!
    // 先把这一艘打空（= 引擎里刚被击毁的那一拍）
    battle.units[foeTag]!.hp = { s: 0, a: 0, h: 0 }
    const v = wormholeBattleViewOf(state, ctx)!
    // 口径：**按 side 收、不按血量收** —— 条目还在（血量 0），界面才能靠 `prevHpRef` 的 >0 → 0 触发爆炸
    expect(v.combat!.foeHp[foeTag], '阵亡敌舰的条目不该从 foeHp 里消失').toBeTruthy()
    expect(v.combat!.foeHp[foeTag]!.s + v.combat!.foeHp[foeTag]!.a + v.combat!.foeHp[foeTag]!.h).toBe(0)
  })

  it('击杀慢镜：分出胜负后要等 `killcamMs` 才结算（否则战斗界面一结束就卸载）', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    standOnPlace(run, 'ship') // F3a-2：洞内战由**地点**触发（等价旧「当前节点是战斗节点」）
    expect(wormholeStartBattle(state, ctx, 'node', 0).ok).toBe(true)
    winBattle(state)
    // 未满窗口：不结算、战斗还在
    state.gameMs = run.battle!.lastTickGameMs + 100
    advanceWormhole(state, ctx)
    expect(run.battle).not.toBeNull()
    // 满窗口：结算落地
    state.gameMs = run.battle!.lastTickGameMs + ctx.balance.battle.killcamMs + 100
    advanceWormhole(state, ctx)
    expect(run.battle).toBeNull()
  })
})

describe('虫洞 · 随档（F 批）', () => {
  it('战斗宿主与升级标记随档往返：`run.battle` + `battle.wormhole` + `bossCleared` 都不丢', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    standOnPlace(run, 'ship')
    expect(wormholeStartBattle(state, ctx, 'node', 0).ok).toBe(true)
    run.bossCleared = 1
    // 战斗中掉一点血，便于断言"动态量也带过去了"
    run.battle!.units['player']!.hp = { s: 1, a: 2, h: 3 }
    const back = loadSaveFile(serializeSaveFile(state, 1)).state.wormhole.run!
    expect(back.battle, '战中重载丢了战斗宿主').toBeTruthy()
    expect(back.battle!.wormhole).toEqual(run.battle!.wormhole)
    expect(back.battle!.myFleet).toEqual(run.battle!.myFleet)
    expect(back.battle!.units['player']!.hp).toEqual({ s: 1, a: 2, h: 3 })
    expect(back.bossCleared).toBe(1)
    // 归一化容错：坏掉的战斗标记 ⇒ 丢弃（退回原卡强度）而不是整档弃置
    const raw = JSON.parse(serializeSaveFile(state, 1)) as {
      state: { wormhole: { run: { battle: { wormhole: unknown } } } }
    }
    raw.state.wormhole.run.battle.wormhole = { cardId: '', kind: 'nope', depth: -1 }
    const broken = loadSaveFile(JSON.stringify(raw)).state.wormhole.run!.battle
    expect(broken).toBeTruthy()
    expect(broken!.wormhole).toBeUndefined()
  })

  it('**战中重载后收口照旧**：沉掉的僚舰照样真丢、机群战损照样扣（`myFleet`/`droneLost` 必须随档）', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    const leader = run.fleet[0]!
    const ally = run.fleet[1]!
    standOnPlace(run, 'ship') // F3a-2：洞内战由**地点**触发（等价旧「当前节点是战斗节点」）
    expect(wormholeStartBattle(state, ctx, 'node', 0).ok).toBe(true)
    // 战斗中：僚舰沉 + 机群被打下来 3 架（都还没收口）——此刻存档
    run.battle!.units['ally-1']!.hp = { s: 0, a: 0, h: 0 }
    run.battle!.droneLost = { 'drone-scout': 3 }
    state.fleet[leader]!.droneLoad = { 'drone-scout': 4 }
    const back = loadSaveFile(serializeSaveFile(state, 1)).state
    // 重载后打赢并收口：沉船判定靠 `myFleet`（运行时不算），机群账本靠 `droneLost`
    winBattle(back)
    settleBattle(back)
    expect(back.fleet[ally], '重载后沉掉的僚舰又活过来了（`myFleet` 没随档）').toBeUndefined()
    expect(back.wormhole.run!.fleet).not.toContain(ally)
    expect(back.wormhole.run!.fleet).toContain(leader)
    const left = back.fleet[leader]?.droneLoad?.['drone-scout'] ?? 0
    expect(left, '重载后机群战损没落账（`droneLost` 没随档）').toBeLessThan(4)
  })
})
