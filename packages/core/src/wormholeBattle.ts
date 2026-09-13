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
import type { SimContext } from './types'
import { uidDefId } from './labels'
import { addWare } from './inventory'
import { loseShip } from './shipyard'
import { advanceBattleFor, persistFleetHullDamage, startFleetBattleFor } from './combat'
import {
  wormholeAdvanceNode,
  wormholeCardIdFor,
  type WormholeRunState,
} from './wormhole'
import type { WormholeFoeKind } from './wormholeFoes'

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
  })
  if (!battle) return { ok: false, error: '无法开战（编队或敌卡缺失）。' }
  run.battle = battle
  return { ok: true }
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
  const won = battle.ended === 'me'
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
    if (run.battle.ended) settleWormholeBattle(state, ctx, run)
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

