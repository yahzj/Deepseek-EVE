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
import { advanceBattleFor, persistFleetHullDamage, refundAmmo, refundRepairKits, startFleetBattleFor } from './combat'
import {
  wormholeAdvanceNode,
  wormholeCardIdFor,
  type WormholeRunState,
} from './wormhole'
import type { WormholeFoeKind } from './wormholeFoes'
import { wormholeAnomalyOf } from './wormholeFoes'

/* ═══════════ 八、F 批：洞内战斗（开战 / 每拍推进 / 收口） ═══════════ */

/**
 * **开一场洞内战斗**（船长 2026-09-13：4 艘同时参战）。
 * - `kind='node'`：打当前待处理节点（必须先有 `pendingNode.kind === 'combat'`）；
 * - `kind='boss'`：层末守卫（层内节点走完、且本层 BOSS 未清时才能开）；
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
  if (kind === 'node') {
    if (!run.pendingNode) return { ok: false, error: '本层已清空：该打层末守卫了。' }
    if (run.pendingNode.kind !== 'combat') return { ok: false, error: '这个节点不是战斗节点。' }
  } else if (kind === 'boss') {
    if (run.pendingNode) return { ok: false, error: '本层还没走完：先处理完层内节点。' }
    if ((run.bossCleared ?? 0) >= run.depth) return { ok: false, error: '本层守卫已经清掉了。' }
  } else if (run.phase !== 'extracting') {
    return { ok: false, error: '还没进入撤离相位。' }
  }
  const waves = kind === 'node' ? Math.max(1, run.pendingNode?.waves ?? 1) : 1
  const cardId = wormholeCardIdFor(run.depth, run.nodeIndex)
  const battle = startFleetBattleFor(state, ctx, run.fleet, cardId, atGameMs, null, {
    depth: run.depth,
    kind,
    waves,
    ...(opts?.strengthMul !== undefined ? { strengthMul: opts.strengthMul } : {}),
  })
  if (!battle) return { ok: false, error: '无法开战（编队或敌卡缺失）。' }
  run.battle = battle
  return { ok: true }
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
function wormholeBattleReport(run: WormholeRunState, battle: BattleState, kind: WormholeFoeKind): string {
  const sec = Math.max(0, Math.round((battle.lastTickGameMs - battle.startedAtGameMs) / 1000))
  const s = battle.stats
  const frac = Math.round(fleetHpFrac(run, battle) * 100)
  const what = kind === 'boss' ? `第 ${run.depth} 层守卫` : kind === 'extract' ? '撤离拦截' : `第 ${run.depth} 层节点`
  return (
    `🕳 ${what}交火结束：${sec}s · 我方开火 ${s.meShots}/命中 ${s.meHits} · 敌方开火 ${s.foeShots}/命中 ${s.foeHits} · ` +
    `编队残血 ${frac}%。`
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
  const sunk = sunkShipIds(run, battle)
  for (const uid of sunk) {
    const name = ctx.ships.get(uidDefId(uid))?.name ?? uid
    loseShip(state, uid, ctx, `虫洞内被击沉（${name}）`)
  }
  if (sunk.length > 0) {
    run.fleet = run.fleet.filter((uid) => !sunk.includes(uid))
    state.wormhole.lastFleetLost += sunk.length
  }
  // P0 承伤持久化（船长「副本内承伤持久」）：逐船把装甲/结构残余写回
  for (const uid of run.fleet) persistFleetHullDamage(state, ctx, uid, battle)
  // **弹药与修理组件退款**（与远征 `resolveBattleOutcome` 同款 · 2026-09-13 修）：
  // 开战时按"每艘船各自装载"抽过的弹药/组件，**余额必须退回仓库** —— 首版漏了这一步，
  // 后果是**连打第二场起全队哑火**（仓库被上一场抽干）：整趟模拟里表现为"节点战轻松赢、
  // 撤离战却 74 秒全灭、我开火 61/命中 17"（探针实测），把小费当成了难度。
  refundAmmo(state, battle.ammo, battle.ammoIds)
  refundRepairKits(state, battle.repair)
  const won = battle.ended === 'me'
  const report = won ? wormholeBattleReport(run, battle, kind) : null
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
    state.wormhole.run = null
    return
  }
  if (kind === 'boss') {
    run.bossCleared = run.depth
    addLog(state, 'info', `🕳 第 ${run.depth} 层守卫已清：可以「继续深入」或「撤离」。`)
    return
  }
  // 节点战：结算该节点（扣回合、推进；回合不够 ⇒ 转撤离相位＝只能撤离）
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
  const anomaly = wormholeAnomalyOf(base, spec.depth, spec.kind, spec.waves)
  const leaderShipId = battle.myFleet?.[0]?.shipId ?? state.shipId
  const leaderRt = battle.units[battle.myFleet?.[0]?.tag ?? 'player']
  const foeHp: Record<string, { s: number; a: number; h: number; name: string }> = {}
  for (const [tag, u] of Object.entries(battle.units)) {
    if (u.side !== 'foe' || u.hp.s + u.hp.a + u.hp.h <= 0) continue
    foeHp[tag] = { s: u.hp.s, a: u.hp.a, h: u.hp.h, name: u.name }
  }
  const kindLabel = spec.kind === 'boss' ? '层末守卫' : spec.kind === 'extract' ? '撤离拦截' : `第 ${spec.depth} 层`
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

