/**
 * **终局玩法「虫洞」· 洞内战斗与收口**（F 批 · 2026-09-13）。
 *
 * 为什么单开一个模块（而不是继续塞 `wormhole.ts`）：`state.ts` 需要 `wormhole.ts` 的
 * `EMPTY_WORMHOLE_STATE`（C 批起），于是 **`wormhole.ts` 只能依赖"不回头吃 state 顶层值"的模块**；
 * 而本文件要用 `shipyard.loseShip`（丢船）与 `combat.advanceBattleFor`（推进），
 * 那条链会经 `hauling.ts` 回头读 `state.ts` 的顶层常量 ⇒ **循环初始化**（首跑即
 * `Cannot access 'HOME_GALAXY_ID' before initialization`）。依赖方向因此固定为：
 * `state → wormhole → wormholeFoes`、`wormholeBattle → {wormhole, combat, shipyard}`（单向）。
 */
import type { BattleState, GameState } from './state'
import { addLog } from './state'
import type { AnomalyDef, SimContext } from './types'
import { uidDefId } from './labels'
import { addWare } from './inventory'
import { loseShip } from './shipyard'
import { advanceBattleFor, persistFleetHullDamage, refundAmmo, refundRepairKits, repairUsageText, settleDroneLosses, startFleetBattleFor, wormholeDerivedAnomaly } from './combat'
import {
  wormholeAdvanceNode,
  wormholeBagSlots,
  wormholeCardIdFor,
  wormholeFleetCargoM3,
  wormholeGridActivate,
  wormholeGridTravel,
  wormholeTrimBag,
  type WormholeActivateEffect,
  type WormholeRunState,
} from './wormhole'
import type { WormholeFoeKind } from './wormholeFoes'
import { wormholeAnomalyOf } from './wormholeFoes'
import { gridCellAt, gridContentIndex, isExitCell } from './wormholeGrid'
import { wormholeDeliverRelics, wormholeGrantShipSpoils, wormholeSalvageAt } from './wormholeSalvage'

/* ═══════════ 八、F 批：洞内战斗（开战 / 每拍推进 / 收口） ═══════════ */

/**
 * **开一场洞内战斗**（船长 2026-09-13：4 艘同时参战）。
 * - `kind='node'`：打**当前所在地点**（网格层：必须站在"舰船信号"地点上；老档线性层：`pendingNode.kind === 'combat'`）；
 * - `kind='boss'`：层末守卫（网格层：必须站在"下一层入口"上；老档线性层：层内节点走完）；
 * - `kind='extract'`：撤离战（相位已在 `extracting`）。
 * 战斗宿主 = `run.battle`（**不占** `expedition.battle`，故不走远征结算）。
 */
export function wormholeStartBattle(
  state: GameState,
  ctx: SimContext,
  kind: WormholeFoeKind,
  atGameMs: number = state.gameMs,
  /**
   * **校准用覆写**（可选）：只给 `tools/wormhole-econ.ts` 的**整趟模拟**做强度扫描用
   * （与 `startFleetBattleFor` 的 `strengthMul` 同一口径；引擎/实战一律走常量）。
   * ⚠ 首版工具只在"单场阶梯"里传了它、整趟模拟没传 ⇒ 扫描结果全是同一个系数（读数为假的对比）。
   */
  opts?: { strengthMul?: number },
): { ok: boolean; error?: string } {
  const run = state.wormhole.run
  if (!run) return { ok: false, error: '不在虫洞内。' }
  if (run.battle) return { ok: false, error: '战斗还没结束。' }
  const grid = run.grid
  const here = grid ? gridCellAt(grid, grid.pos) : undefined
  if (kind === 'node') {
    if (grid) {
      // 网格层：战斗由**地点**触发（舰船信号 / 遗迹收尾，后者 F3b 接）
      if (here?.place !== 'ship') return { ok: false, error: '这里没有可交火的信号。' }
    } else {
      if (!run.pendingNode) return { ok: false, error: '本层已清空：该打层末守卫了。' }
      if (run.pendingNode.kind !== 'combat') return { ok: false, error: '这个节点不是战斗节点。' }
    }
  } else if (kind === 'boss') {
    // 网格层：层末守卫守在"下一层入口"那一格上——站上去激活它才开打
    if (grid) {
      if (!here || !isExitCell(grid, grid.pos)) return { ok: false, error: '层末守卫守在下一层入口：先找到并抵达入口。' }
    } else if (run.pendingNode) {
      return { ok: false, error: '本层还没走完：先处理完层内节点。' }
    }
    if ((run.bossCleared ?? 0) >= run.depth) return { ok: false, error: '本层守卫已经清掉了。' }
  } else if (kind === 'ruins') {
    // **遗迹收尾战**（F3b）：打捞结束时触发；网格层必须站在遗迹格上、且那格已经捞空
    if (!grid) return { ok: false, error: '遗迹收尾战只在网格层成立。' }
    if (here?.place !== 'ruins') return { ok: false, error: '这里不是遗迹。' }
    if ((here.piles ?? []).length > 0) return { ok: false, error: '遗迹还没打捞完：先捞空再打。' }
  } else if (run.phase !== 'extracting') {
    return { ok: false, error: '还没进入撤离相位。' }
  }
  const waves = kind === 'node' && !grid ? Math.max(1, run.pendingNode?.waves ?? 1) : 1
  // 敌卡轮换序号：网格层按**格坐标**取（同格恒同序、不同格有变化），老档线性层按节点序号
  const cardId = wormholeCardIdFor(run.depth, grid ? gridContentIndex(grid) : run.nodeIndex)
  // **本趟期望交距沿用**（玩家在上一场洞内战里拖过距离条；没拖过 = null ⇒ 走默认口径）
  const battle = startFleetBattleFor(state, ctx, run.fleet, cardId, atGameMs, run.desireM ?? null, {
    depth: run.depth,
    kind,
    waves,
    ...(opts?.strengthMul !== undefined ? { strengthMul: opts.strengthMul } : {}),
  })
  if (!battle) return { ok: false, error: '无法开战（编队或敌卡缺失）。' }
  run.battle = battle
  return { ok: true }
}

/**
 * **激活当前地点**（网格层唯一的"互动"入口 = `wormholeGridActivate` + 需要时立刻开战）。
 *
 * 为什么两件事合成一次调用：激活"舰船信号"/"下一层入口"的**下一步永远是开战**，
 * 界面若分两次调用，中间任何一次失败都会留下"地点已记 `activated`、回合已扣、但战斗没开"
 * 的死格（这格再也打不了、还白扣一回合）——合成一次，界面只处理一个结果；
 * 万一开战失败（敌卡/编队缺失这类），这里**把回合与激活标记一起回滚**，不留半截状态。
 */
export function wormholeActivateAt(
  state: GameState,
  ctx: SimContext,
  atGameMs?: number,
): { ok: boolean; error?: string; spent?: number; effect?: WormholeActivateEffect; started?: WormholeFoeKind; taken?: number } {
  const run = state.wormhole.run
  const turnsBefore = run?.turnsLeft ?? 0
  // **打捞格走打捞入口**（F3b）：墓场/遗迹的"激活"其实是**打捞作业**——要打捞器、
  // 一次回收台数 的堆、遗迹捞空还要掷收尾战；那套逻辑需要 ctx（打捞器台数/背包容量）与目录，
  // 故放在 `wormholeSalvage` 里，这里只做分流（`wormhole.ts` 不许 import 那个模块）。
  const here = run?.grid ? gridCellAt(run.grid, run.grid.pos) : undefined
  if (here && (here.place === 'graveyard' || here.place === 'ruins')) {
    const s = wormholeSalvageAt(state, ctx)
    if (!s.ok) return { ok: false, error: s.error }
    const effect = s.effect
    if (!effect || effect.kind !== 'ruinsBattle') return { ok: true, spent: s.spent, taken: s.taken?.length ?? 0 }
    const b = wormholeStartBattle(state, ctx, 'ruins', atGameMs)
    if (!b.ok) return { ok: false, error: `无法开战：${b.error ?? ''}` }
    return { ok: true, spent: s.spent, taken: s.taken?.length ?? 0, effect, started: 'ruins' }
  }
  const r = wormholeGridActivate(state)
  if (!r.ok) return { ok: false, error: r.error }
  const effect = r.effect
  if (!effect) return { ok: true, spent: r.spent }
  const kind: WormholeFoeKind | null = effect.kind === 'exit' ? 'boss' : effect.kind === 'battle' ? 'node' : null
  if (!kind) return { ok: true, spent: r.spent, effect }
  const s = wormholeStartBattle(state, ctx, kind, atGameMs)
  if (!s.ok) {
    // 回滚：回合退回、激活标记摘掉（该格回到"可再次激活"）
    if (run) {
      run.turnsLeft = turnsBefore
      if (run.grid) run.grid.activated = run.grid.activated.filter((k) => k !== effect.key)
    }
    return { ok: false, error: `无法开战：${s.error ?? ''}` }
  }
  return { ok: true, spent: r.spent, effect, started: kind }
}

/**
 * **前往某一格**（网格层的"移动"入口 = `wormholeGridTravel` + 到达即开打时的立刻开战）。
 *
 * 船长 2026-09-13 追加：「**战斗节点到达即开打**」⇒ 走到"舰船信号"那一格就地交火（不再需要点激活）。
 * 为什么合成一次调用（与 `wormholeActivateAt` 同款理由）：界面若分两步，中间失败会留下
 * "人已经站到那里、回合已扣、但战斗没开"的半截状态——这里**开战失败会把整趟移动回滚**
 * （回合 / 位置 / 已到达 / 已扫描 / 已激活 / 信标标出的入口全部还原），玩家留在原格、回合不丢。
 */
export function wormholeTravelTo(
  state: GameState,
  ctx: SimContext,
  target: { q: number; r: number },
  opts?: { confirmUnknown?: boolean },
  atGameMs?: number,
): { ok: boolean; error?: string; code?: 'unknown-target'; spent?: number; autoBattle?: boolean; beacon?: boolean } {
  const run = state.wormhole.run
  const g = run?.grid
  const snap =
    run && g
      ? {
          turnsLeft: run.turnsLeft,
          pos: { ...g.pos },
          visited: [...g.visited],
          scanned: [...g.scanned],
          activated: [...g.activated],
          exitKnown: g.exitKnown === true,
        }
      : null
  const r = wormholeGridTravel(state, target, opts)
  if (!r.ok) return { ok: false, error: r.error, ...(r.code ? { code: r.code } : {}) }
  const arrived = r.arrived
  if (!arrived?.autoBattle) {
    return {
      ok: true,
      spent: r.spent,
      ...(arrived?.beacon ? { beacon: true } : {}),
    }
  }
  const s = wormholeStartBattle(state, ctx, 'node', atGameMs)
  if (!s.ok) {
    if (run && g && snap) {
      run.turnsLeft = snap.turnsLeft
      g.pos = snap.pos
      g.visited = snap.visited
      g.scanned = snap.scanned
      g.activated = snap.activated
      g.exitKnown = snap.exitKnown
    }
    return { ok: false, error: `无法开战：${s.error ?? ''}` }
  }
  return { ok: true, spent: r.spent, autoBattle: true }
}

/** 本场战斗的**编队残血比例**（我方三层血合计 ÷ 满值合计；用于战报与结算读数） */
function fleetHpFrac(run: WormholeRunState, battle: BattleState): number {
  let cur = 0
  let max = 0
  for (const entry of battle.myFleet ?? []) {
    const u = battle.units[entry.tag]
    if (!u) continue
    cur += u.hp.s + u.hp.a + u.hp.h
    max += (u.hpMax?.s ?? 0) + (u.hpMax?.a ?? 0) + (u.hpMax?.h ?? 0)
  }
  return max > 0 ? cur / max : 0
}

/**
 * **洞内战报**（一句话，与结算同源）：交火时长 / 双方开火与命中 / 编队残血。
 * 只在洞内推（远征有自己的战报链），纯日志、不影响任何数值。
 */
function wormholeBattleReport(
  run: WormholeRunState,
  battle: BattleState,
  kind: WormholeFoeKind,
  ctx: SimContext,
): string {
  const sec = Math.max(0, Math.round((battle.lastTickGameMs - battle.startedAtGameMs) / 1000))
  const s = battle.stats
  const frac = Math.round(fleetHpFrac(run, battle) * 100)
  const what = kind === 'boss'
    ? `第 ${run.depth} 层守卫`
    : kind === 'extract'
      ? '撤离拦截'
      : kind === 'ruins'
        ? `第 ${run.depth} 层遗迹守军`
        : run.grid
          ? `第 ${run.depth} 层地点`
          : `第 ${run.depth} 层节点`
  // 尾巴（与远征/遭遇同款口径）：船体维修装置消耗——洞内同样吃这套后勤，不写就等于白用
  const repair = repairUsageText(battle, ctx)
  const tail = repair.length > 0 ? ` · 船体维修装置${repair}` : ''
  return (
    `🕳 ${what}交火结束：${sec}s · 我方开火 ${s.meShots}/命中 ${s.meHits} · 敌方开火 ${s.foeShots}/命中 ${s.foeHits} · ` +
    `编队残血 ${frac}%${tail}。`
  )
}

/** 在本场战斗里被打沉的我方单位（三层血全 0；`player` = 主控） */
function sunkShipIds(run: WormholeRunState, battle: BattleState): string[] {
  const out: string[] = []
  for (const entry of battle.myFleet ?? []) {
    const u = battle.units[entry.tag]
    if (!u) continue
    if (u.hp.s + u.hp.a + u.hp.h <= 0) out.push(entry.shipId)
  }
  return out
}

/**
 * **收口一场洞内战斗**（胜/负两条路）：
 * - 先按 D 批口径把**沉掉的船**从舰队里扣掉（该船真丢）；
 * - **胜**：层末守卫 ⇒ 记 `bossCleared`；节点战 ⇒ 结算该节点（扣回合、推进/进入层末）；
 *   撤离战 ⇒ **结算收益**（背包并入仓库）并结束本趟；
 * - **负**（= 我方全灭，D 批口径）：**全损**——编队全丢、背包清空、本趟结束。
 */
function settleWormholeBattle(state: GameState, ctx: SimContext, run: WormholeRunState): void {
  const battle = run.battle
  if (!battle) return
  const kind = battle.wormhole?.kind ?? 'node'
  // 机群归属：多舰路径的无人机集火池是按**编队首舰**（`fleet[0]`）建的（D 批边界：
  // 僚舰无人机不参战，见 `startFleetBattleFor`）——这里必须在**扣沉船之前**取到它，
  // 否则首舰一沉就找不到归属、机群战损会全部漏结。
  const droneOwner = run.fleet[0]
  const sunk = sunkShipIds(run, battle)
  for (const uid of sunk) {
    const name = ctx.ships.get(uidDefId(uid))?.name ?? uid
    loseShip(state, uid, ctx, `虫洞内被击沉（${name}）`)
  }
  if (sunk.length > 0) {
    run.fleet = run.fleet.filter((uid) => !sunk.includes(uid))
    state.wormhole.lastFleetLost += sunk.length
    // **沉船拖走货舱 ⇒ 背包格上限跟着缩水，装不下的当场丢**（船长 2026-09-13：「扣背包格，
    // 不足时丢弃货物」）。格数 = 「剩余编队合计货仓 ÷ 500」现算 ⇒ 这里只需把溢出部分裁掉。
    const cap = wormholeBagSlots(wormholeFleetCargoM3(state, ctx, run.fleet))
    const trimmed = wormholeTrimBag(ctx, run.bag, cap)
    if (trimmed.dropped.length > 0) {
      const names = trimmed.dropped
        .map((s) => `${ctx.items.get(s.itemId)?.name ?? s.itemId}×${Math.floor(s.units).toLocaleString('zh-CN')}`)
        .join('、')
      run.bag = trimmed.bag
      addLog(
        state,
        'warn',
        `🕳 沉船拖走了货舱：背包缩到 ${cap} 格，装不下的部分当场丢弃（${names}）——按每格价值从低到高丢。`,
      )
    }
  }
  // P0 承伤持久化（船长「副本内承伤持久」）：逐船把装甲/结构残余写回
  for (const uid of run.fleet) persistFleetHullDamage(state, ctx, uid, battle)
  // **弹药与修理组件退款**（与远征 `resolveBattleOutcome` 同款 · 2026-09-13 修）：
  // 开战时按"每艘船各自装载"抽过的弹药/组件，**余额必须退回仓库** —— 首版漏了这一步，
  // 后果是**连打第二场起全队哑火**（仓库被上一场抽干）：整趟模拟里表现为"节点战轻松赢、
  // 撤离战却 74 秒全灭、我开火 61/命中 17"（探针实测），把小费当成了难度。
  refundAmmo(state, battle.ammo, battle.ammoIds)
  refundRepairKits(state, battle.repair)
  // **机群战损**（与远征 `resolveBattleOutcome` / 遭遇战同款 · 2026-09-13 修）：洞内首舰的
  // 无人机照样会被点防打下来（`battle.droneLost` 在涨），首版漏了这一步 ⇒ 洞内无人机
  // **打不死**（清单不减、也没有战损日志），是最便宜的一种白嫖。
  if (droneOwner) settleDroneLosses(state, ctx, droneOwner, battle)
  const won = battle.ended === 'me'
  const report = won ? wormholeBattleReport(run, battle, kind, ctx) : null
  run.battle = null
  // ── 负（全灭）：全损收场 ──
  if (!won || run.fleet.length === 0) {
    const lost = run.fleet.length > 0 ? run.fleet : []
    for (const uid of lost) {
      const name = ctx.ships.get(uidDefId(uid))?.name ?? uid
      loseShip(state, uid, ctx, `虫洞内失联（${name}）`)
    }
    state.wormhole.lastFleetLost += lost.length
    addLog(state, 'warn', `🕳 虫洞探险失败：编队失联、背包内容全部丢失（损失 ${sunk.length + lost.length} 艘）。`)
    state.wormhole.run = null
    return
  }
  // 胜：先出战报（与结算同源），再按战斗用途分流
  if (report) addLog(state, 'info', report)
  // ── 胜：按战斗用途分流 ──
  if (kind === 'extract') {
    let isk = 0
    for (const slot of run.bag) {
      const units = Math.floor(slot.units)
      const price = ctx.items.get(slot.itemId)?.baseSellPriceIsk ?? 0
      isk += units * price
      if (units > 0) addWare(state, slot.itemId, units)
    }
    addLog(
      state,
      'info',
      `🕳 撤离成功：背包 ${run.bag.length} 类物资入港` +
        (isk > 0 ? `（按基础价约 ${isk.toLocaleString('zh-CN')} ISK）` : '') +
        `，第 ${run.depth} 层撤离。`,
    )
    // **随行战利品入库**（遗迹专属掉落：图纸进蓝图书架、装备进装备库）——只有撤离成功才到手
    if ((run.relics ?? []).length > 0) wormholeDeliverRelics(state, ctx, run.relics ?? [])
    state.wormhole.run = null
    return
  }
  if (kind === 'boss') {
    run.bossCleared = run.depth
    addLog(state, 'info', `🕳 第 ${run.depth} 层守卫已清：可以「继续深入」或「撤离」。`)
    return
  }
  // 网格层的地点战：回合已在"激活地点"那一步扣掉、地点也已记进 `activated` ⇒ 这里只报账
  // （地点收益——墓场/遗迹的打捞、矿脉的母矿、谜质的增强——在 F3b/F3c 接）
  if (run.grid) {
    // 舰船信号的战果：打赢**固定**给残骸 2 堆 + 稀有残骸 1 堆（船长口径；放不下的留在格上）
    if (kind === 'node') wormholeGrantShipSpoils(state, ctx)
    if (run.turnsLeft <= 0) addLog(state, 'warn', `🕳 回合已耗尽：只能撤离。`)
    return
  }
  // 老档线性节点：结算该节点（扣回合、推进；回合不够 ⇒ 转撤离相位＝只能撤离）
  const r = wormholeAdvanceNode(ctx, run, state.rng.seed)
  if (!r.ok) {
    run.phase = 'extracting'
    addLog(state, 'warn', `🕳 回合不足以继续推进：只能撤离（${r.error ?? ''}）。`)
    return
  }
  if (r.mustExtract) {
    addLog(state, 'warn', `🕳 回合已耗尽：只能撤离。`)
  }
}

/**
 * **洞内战斗的视图上下文**（F2 · 2026-09-13）：战斗窗口拿它渲染洞内战斗
 * （战斗宿主在 `run.battle`、敌卡按层派生、我方编队逐舰）。
 * 无洞内战斗返回 `null`（界面照旧走远征口径）。
 */
export function wormholeBattleViewOf(
  state: GameState,
  ctx: SimContext,
): {
  battle: BattleState
  anomaly: AnomalyDef
  /** 视图锚 = 主控（`myFleet` 首条的船型 uid；缺省退 `state.shipId`） */
  leaderShipId: string
  /** 顶部标题用：`虫洞 · 第 N 层` / `虫洞 · 第 N 层守卫` / `虫洞 · 撤离拦截` */
  name: string
  /** 与 `expeditionStatus().combat` 同形（战斗窗口两套来源共用一套渲染） */
  combat: {
    distanceM: number
    myDesireM: number
    meHp: { s: number; a: number; h: number }
    foeHp: Record<string, { s: number; a: number; h: number; name: string }>
    shots: number
    hits: number
    lockTag: string | null
  } | null
} | null {
  const run = state.wormhole.run
  const battle = run?.battle
  if (!run || !battle) return null
  const spec = battle.wormhole
  const base = spec ? ctx.anomalies.get(spec.cardId) : undefined
  if (!spec || !base) return null
  // 走**引擎同源**那一处（wormholeDerivedAnomaly）：既保证视图与推进同口径，也吃到它的一层记忆
  //（本函数每次重渲染都会被调一次；拖动距离条时高频重渲染 ⇒ 重建整张敌卡会顶出顿挫）
  const anomaly = wormholeDerivedAnomaly(ctx, base, spec)
  const leaderShipId = battle.myFleet?.[0]?.shipId ?? state.shipId
  const leaderRt = battle.units[battle.myFleet?.[0]?.tag ?? 'player']
  const foeHp: Record<string, { s: number; a: number; h: number; name: string }> = {}
  for (const [tag, u] of Object.entries(battle.units)) {
    if (u.side !== 'foe' || u.hp.s + u.hp.a + u.hp.h <= 0) continue
    foeHp[tag] = { s: u.hp.s, a: u.hp.a, h: u.hp.h, name: u.name }
  }
  const kindLabel =
    spec.kind === 'boss'
      ? '层末守卫'
      : spec.kind === 'extract'
        ? '撤离拦截'
        : spec.kind === 'ruins'
          ? `第 ${spec.depth} 层遗迹守军`
          : `第 ${spec.depth} 层`
  return {
    battle,
    anomaly,
    leaderShipId,
    name: `虫洞 · ${kindLabel}`,
    // ⚠ **`ended` 之后仍要给 `combat`**：与远征同款——分胜负那一刻要留"击杀慢镜/战报演出"窗口，
    // 提前返回 null 会让战斗界面**直接卸载**（首版实测：战斗一结束画面就没了、战报没机会播）。
    combat: {
      distanceM: battle.distanceM,
      myDesireM: battle.myDesireM,
      meHp: leaderRt ? { ...leaderRt.hp } : { s: 0, a: 0, h: 0 },
      foeHp,
      shots: battle.stats.meShots,
      hits: battle.stats.meHits,
      // 锁定装置的集火目标：洞内沿用同一读法（主控装了锁定件才非空）
      lockTag: null,
    },
  }
}

/**
 * **洞内推进（每拍调用一次）**：战斗步进 + 战斗收口 + 撤离战自动开打。
 * 放在 `advanceGame` 管线里（`engine.ts`），与远征/AI/遭遇同款"每拍一次"节奏。
 * `freezeBattle`（调试快进）时**不推进战斗**，与既有口径一致。
 */
export function advanceWormhole(
  state: GameState,
  ctx: SimContext,
  freezeBattle = false,
): void {
  const run = state.wormhole.run
  if (!run) return
  // **临时离开 = 活动停止 ⇒ 洞内一切冻结**（船长 2026-09-13 批准 · 议案 A 第 4 条）：战斗不推进
  // （不掉血）、撤离战不开打、收口不落地——回来接着打，进度原样在。
  if (run.attending !== true) return
  if (run.battle) {
    if (freezeBattle) return
    advanceBattleFor(state, ctx, run.battle, run.fleet[0] ?? state.shipId, run.battle.wormhole?.cardId ?? null)
    if (run.battle.ended) {
      // **击杀慢镜**（与远征 `expedition.ts` 同源 · `bal.killcamMs`）：分出胜负后**延迟结算**，
      // 让最后一击动画/爆炸演出播完；否则战斗界面会在结束那一瞬间直接卸载（首版实测踩到）。
      const waitMs = ctx.balance.battle.killcamMs
      if (state.gameMs - run.battle.lastTickGameMs < waitMs) return
      settleWormholeBattle(state, ctx, run)
    }
    return
  }
  // 撤离相位：自动开撤离战（打完才算撤离成功；打不完 = 全损）
  if (run.phase === 'extracting' && !freezeBattle) {
    const r = wormholeStartBattle(state, ctx, 'extract')
    if (!r.ok) {
      // 编队/敌卡缺失这类硬故障：直接全损收场，避免卡在撤离相位里出不来
      addLog(state, 'warn', `🕳 撤离战无法开始（${r.error ?? '未知原因'}）：本趟按全损处理。`)
      for (const uid of run.fleet) {
        const name = ctx.ships.get(uidDefId(uid))?.name ?? uid
        loseShip(state, uid, ctx, `虫洞内失联（${name}）`)
      }
      state.wormhole.lastFleetLost += run.fleet.length
      state.wormhole.run = null
    }
  }
}

