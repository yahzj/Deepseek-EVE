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
import { gainAiCore, aiCoreName } from './ai'
import { addWare } from './inventory'
import { loseShip } from './shipyard'
import { advanceBattleFor, persistFleetHullDamage, refundAmmo, refundRepairKits, repairUsageText, settleDroneLosses, stampFoeArrivalFx, startFleetBattleFor, wormholeDerivedAnomaly, captureBattleReport } from './combat'
import {
  wormholeAdvanceNode,
  wormholeBagSlots,
  wormholeFleetCargoM3,
  wormholeUnitsPerSlot,
  wormholeGridActivate,
  wormholeGridTravel,
  wormholeTrimBag,
  type WormholeActivateEffect,
  type WormholeRunState,
} from './wormhole'
import type { WormholeFoeKind } from './wormholeFoes'
import { wormholeAnomalyOf, wormholeCardIdForRun } from './wormholeFoes'
import { gridCellAt, gridContentIndex, isExitCell } from './wormholeGrid'
// F3c：谜质格取回装置（哪一台按 (种子, 层, 格) 定死；落地走收货阶梯）
import { wormholeMatterBuffs, wormholeMatterDeviceAt } from './wormholeMatter'
import { wormholeIsShapedItem } from './wormholeHold'
import {
  wormholeDeliverRelics,
  wormholeGrantShipSpoils,
  wormholeHoldUsage,
  wormholeCollectOreAt,
  wormholeEnsureArrivalPiles,
  wormholeLootTierOf,
  wormholeLootValueIsk,
  wormholeActionBlockReason,
  wormholeOverloadBlockReason,
  wormholeSalvageAt,
  wormholeStowOrTemp,
  wormholeCoreTypeOfItemId,
  WORMHOLE_ESSENCE_ITEM_ID,
  WORMHOLE_ESSENCE_PER_DEVICE,
} from './wormholeSalvage'

/* ═══════════ 八、F 批：洞内战斗（开战 / 每拍推进 / 收口） ═══════════ */

/**
 * **开一场洞内战斗**（船长 2026-09-13：4 艘同时参战）。
 * - `kind='node'`：打**当前所在地点**（网格层：必须站在"舰船信号"地点上；老档线性层：`pendingNode.kind === 'combat'`）；
 * - `kind='boss'`：层末守卫（网格层：必须站在"下一层入口"上；老档线性层：层内节点走完）；
 * - `kind='ruins'`：遗迹收尾战（打捞完之后按确认条开打）。
 *
 * ⚠ **`'extract'` 撤离战已于 2026-09-15 退役**（船长「虫洞的撤离战取消吧」）⇒ 本函数**不再接受**它
 * （参数类型用 `Exclude<…, 'extract'>` 卡住）；老档里**已经在打**的撤离战仍由 `settleWormholeBattle`
 * 收口（那里保留 `'extract'` 分支只为兼容旧档）。
 * 战斗宿主 = `run.battle`（**不占** `expedition.battle`，故不走远征结算）。
 */
export function wormholeStartBattle(
  state: GameState,
  ctx: SimContext,
  kind: Exclude<WormholeFoeKind, 'extract'>,
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
  }
  const waves = kind === 'node' && !grid ? Math.max(1, run.pendingNode?.waves ?? 1) : 1
  /**
   * 敌卡 = **本趟锁定的族**（船长 2026-09-14 定案 · 丁：一处虫洞一族、整趟同族）
   * × **该层的档位池**（船长 2026-09-15：层 1 只浅 / 层 2~3 中 2 : 浅 1 / 层 4+ 深 2 : 中 1 : 浅 1；
   * **层末守卫取该层最深已解锁档**）。
   *
   * 节点序号：网格层取**该格的内容序号**（`gridContentIndex` ⇒ 同格恒同卡、不同格有变化），
   * 线性老档取 `run.nodeIndex`；`run.family` 缺省（老档 / 调试入口）按 `run.seed` 现算 ⇒ 零迁移。
   */
  const cardId = wormholeCardIdForRun({
    family: run.family,
    seed: run.seed,
    depth: run.depth,
    kind,
    nodeIndex: grid ? gridContentIndex(grid, grid.pos) : run.nodeIndex,
  })
  // **本趟期望交距沿用**（玩家在上一场洞内战里拖过距离条；没拖过 = null ⇒ 走默认口径）
  const battle = startFleetBattleFor(state, ctx, run.fleet, cardId, atGameMs, run.desireM ?? null, {
    depth: run.depth,
    kind,
    waves,
    ...(opts?.strengthMul !== undefined ? { strengthMul: opts.strengthMul } : {}),
  })
  if (!battle) return { ok: false, error: '无法开战（编队或敌卡缺失）。' }
  // **洞内开战 = 敌方跃迁入场**（船长 2026-09-13「虫洞内为敌方」）：给首波敌舰盖入场时刻
  // ⇒ 入场窗口内我方打不到它们（船长 2026-09-14「动画没结束不开火」）。
  // 洞外那一场是我方飞入、敌方没有入场动画 ⇒ **不盖**（有动画才有窗口）。
  stampFoeArrivalFx(battle)
  run.battle = battle
  // 开战成功 ⇒ 清「待迎战」标记（遗迹收尾战那条确认链到此闭合）
  if (run.pendingRuinsBattle === true) run.pendingRuinsBattle = false
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
  /**
   * **遗迹收尾战要不要"等玩家确认"**（船长 2026-09-13）：界面传 `{ deferRuinsBattle: true }`
   * ⇒ 打捞照常结算，但**不直接开战**，只留 `run.pendingRuinsBattle` 标记并回 `pendingBattle: 'ruins'`，
   * 由界面弹确认条、玩家点「迎战」后再调 `wormholeStartBattle(state, ctx, 'ruins')`。
   * 不传（旧调用方/工具/用例）= **原行为**（打捞完立刻开战）。
   */
  opts?: { deferRuinsBattle?: boolean },
): {
  ok: boolean
  error?: string
  spent?: number
  effect?: WormholeActivateEffect
  started?: WormholeFoeKind
  /** 已结算但**等确认**的战斗（目前只有 `'ruins'`） */
  pendingBattle?: 'ruins'
  taken?: number
} {
  const run = state.wormhole.run
  const turnsBefore = run?.turnsLeft ?? 0
  // **超载闸**（F4 · 船长裁定 8）：货仓装不下时不许再做任何"会装货"的动作（打捞/挖矿/开战都算）。
  const overloaded = wormholeActionBlockReason(state, ctx)
  if (overloaded) return { ok: false, error: overloaded }

  // **打捞格**（墓场/遗迹 · F5 起不用激活）：打捞一批 + 遗迹捞空时的收尾战 —— 合成一次调用
  const hereCell = run?.grid ? gridCellAt(run.grid, run.grid.pos) : undefined
  if (hereCell && (hereCell.place === 'graveyard' || hereCell.place === 'ruins')) {
    const s = wormholeSalvageAt(state, ctx)
    if (!s.ok) return { ok: false, error: s.error }
    const effect = s.effect
    if (!effect || effect.kind !== 'ruinsBattle') return { ok: true, spent: s.spent, taken: s.taken?.length ?? 0 }
    /**
     * **遗迹收尾战：先提示、玩家确认后再开打**（船长 2026-09-13：「打捞遗迹触发战斗时……战斗突然发生
     * 没有任何提示，应该提示玩家惊扰守卫等，**玩家确认后跳转**」）。
     *
     * `opts.deferRuinsBattle = true`（界面走这条）⇒ **这里不直接开战**：打捞已结算（回合已扣、货已入包），
     * 只在 `run` 上留 `pendingRuinsBattle` 标记；界面据此弹确认条，玩家点「迎战」再调
     * `wormholeStartBattle(state, ctx, 'ruins')`。标记没清之前 **别的动作一律被拦**（`gridActionBlocked`）
     * ⇒ 既不会"跳过这一场"，也不会留下"回合扣了、东西拿了、却什么都没发生"的半截状态。
     */
    if (opts?.deferRuinsBattle === true) {
      return { ok: true, spent: s.spent, taken: s.taken?.length ?? 0, effect, pendingBattle: 'ruins' }
    }
    const b = wormholeStartBattle(state, ctx, 'ruins', atGameMs)
    if (!b.ok) return { ok: false, error: `无法开战：${b.error ?? ''}` }
    return { ok: true, spent: s.spent, taken: s.taken?.length ?? 0, effect, started: 'ruins' }
  }
  // **矿脉**（F5：要采集器；规则同打捞）——也走"激活"这个入口，界面一个按钮就够
  if (hereCell?.place === 'vein') {
    const c = wormholeCollectOreAt(state, ctx)
    if (!c.ok) return { ok: false, error: c.error }
    return { ok: true, spent: c.spent, taken: c.taken?.length ?? 0 }
  }
  const r = wormholeGridActivate(state)
  if (!r.ok) return { ok: false, error: r.error }
  const effect = r.effect
  if (!effect) return { ok: true, spent: r.spent }
  const kind: WormholeFoeKind | null = effect.kind === 'exit' ? 'boss' : effect.kind === 'battle' ? 'node' : null
  if (!kind) {
    /**
     * **谜质格 ⇒ 取回一台谜质储存器**（F3c · 船长 2026-09-13：「谜质玩家采集后，在货仓内显示为
     * 4格的『谜质储存器』，在本次虫洞探索中提供临时增益」）。
     *
     * 三条口径：
     * - **是哪一台 = 按 (种子, 层, 格 key) 定死**（`wormholeMatterDeviceAt`）⇒ 不写存档、读档后还是同一台；
     * - 落地走**收货阶梯**（货仓 2×2 → 临时空间 → 两边都满才算失败），与安全货柜同一入口；
     * - 失败 ⇒ **回合与激活标记一起回滚**（与开战失败同款）——不留"白扣一回合、东西没拿到"的死格。
     * 成功时的回合加成由 `wormholeStowOrTemp → wormholeSyncMatterTurns` 实时结清。
     */
    if (effect.kind === 'matter' && run) {
      const device = wormholeMatterDeviceAt(run.seed ?? 0, run.depth, effect.key)
      const landed = wormholeStowOrTemp(state, ctx, device.id, 1)
      if (!landed.ok) {
        run.turnsLeft = turnsBefore
        if (run.grid) run.grid.activated = run.grid.activated.filter((k) => k !== effect.key)
        return {
          ok: false,
          error: `取不回「${device.name}」：${landed.error ?? '货仓放不下'}（它占 2×2 = 4 格，先腾地方或抛货）`,
        }
      }
      addLog(
        state,
        'info',
        `🕳 取回谜质：${device.name}（${device.text}）——` +
          `${landed.where === 'temp' ? '货仓腾不出 2×2，已先进临时空间' : '占货仓 2×2 格'}，离开虫洞即失效。`,
      )
      return { ok: true, spent: r.spent, effect, taken: 1 }
    }
    return { ok: true, spent: r.spent, effect }
  }
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
  const overloaded = wormholeActionBlockReason(state, ctx)
  if (overloaded) return { ok: false, error: overloaded }
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
  // **到达即铺堆**（船长 F5：「资源点和墓场遗迹改为不用激活」）——只铺产出，不扣回合、不进回滚路径
  wormholeEnsureArrivalPiles(state, ctx)
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
      ? // ⚠ 仅老档（撤离战 2026-09-15 退役）：文案避开已退役的机制名「撤离战」，写「撤离」
        '撤离'
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
    /* **沉船拖走货舱 ⇒ 格数缩水**（船长 2026-09-13 两版口径，后版为准）：
     * 旧版（B/C 批）：当场按"每格价值从低到高"自动丢掉溢出部分；
     * **新版（F4 · 船长裁定 8）：「沉船后要求玩家手动抛弃货物」** ⇒ 这里**不再自动丢**，
     * 只把"超载"这件事说清楚（`wormholeHoldUsage` 现算），玩家到货仓页自己抛。
     * ⚠ 超载**不软锁**：抛货永远可用（`wormholeDiscardToFit` / 逐件抛弃）。 */
    const usage = wormholeHoldUsage(state, ctx)
    if (usage.overload) {
      addLog(
        state,
        'warn',
        `🕳 沉船拖走了货舱：货仓缩到 ${usage.capacity} 格，当前装了 ${usage.used} 格（超载）——` +
          `请到货仓页手动抛弃货物；超载期间不能再拾取/打捞，撤离与深入也要先抛到容量内。`,
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
  /**
   * **谜质 B2：战后收口三件**（F3c · 船长 2026-09-13）。
   * 一律**现算**（从货仓的装置派生）⇒ 打完这一场立刻按"这一场带了什么"结算，不留状态。
   *
   * ① **弹药回收装置**：按**本场打出去**的那部分退回 `round(已耗 × 比例)` ——
   *    已耗 = 开战预载 − 战后余额（`battle.ammoLoaded`，老档/旧战斗缺该字段 ⇒ 这一项自动跳过）；
   * ② **机群回收网**：回收率加成本（在 `settleDroneLosses` 里夹在 100% 以内）；
   * ③ **战地维修单元**：每场交火后自动修补**装甲与结构**（船长：「同时修复护甲」），不耗货仓组件。
   */
  const matterBuffs = wormholeMatterBuffs(run.hold)
  if (matterBuffs.ammoRefundPct > 0 && battle.ammoLoaded) {
    const fired = {
      kin: Math.max(0, battle.ammoLoaded.kin - battle.ammo.kin),
      exp: Math.max(0, battle.ammoLoaded.exp - battle.ammo.exp),
      pla: Math.max(0, battle.ammoLoaded.pla - battle.ammo.pla),
    }
    const back = {
      kin: Math.round(fired.kin * matterBuffs.ammoRefundPct),
      exp: Math.round(fired.exp * matterBuffs.ammoRefundPct),
      pla: Math.round(fired.pla * matterBuffs.ammoRefundPct),
    }
    const n = back.kin + back.exp + back.pla
    if (n > 0) {
      refundAmmo(state, back, battle.ammoIds)
      addLog(state, 'info', `🕳 弹药回收装置：这一场打出去的弹药回收了 ${n} 发（${Math.round(matterBuffs.ammoRefundPct * 100)}%）。`)
    }
  }
  // **机群战损**（与远征 `resolveBattleOutcome` / 遭遇战同款 · 2026-09-13 修）：洞内的无人机照样会被
  // 点防打下来（`battle.droneLost` 在涨），首版漏了这一步 ⇒ 洞内无人机**打不死**（清单不减、也没有
  // 战损日志），是最便宜的一种白嫖。**2026-09-14 船长「逐舰机群」**：改为**逐舰结算**——每艘编队舰
  // 各自扣各自的机舱清单、各写一条战损日志；老档/旧战斗只有合计账本 ⇒ 回落到主控那一份。
  const fleetForDrones = battle.myFleet
  if (fleetForDrones && fleetForDrones.length > 0) {
    for (const e of fleetForDrones) {
      settleDroneLosses(state, ctx, e.shipId, battle, matterBuffs.droneRecoveryPct, e.tag)
    }
  } else if (droneOwner) {
    settleDroneLosses(state, ctx, droneOwner, battle, matterBuffs.droneRecoveryPct)
  }
  if (matterBuffs.fieldRepairPct > 0) {
    const pct = matterBuffs.fieldRepairPct
    let touched = 0
    for (const uid of run.fleet) {
      const ship = state.fleet[uid]
      if (!ship) continue
      const before = (ship.armorPct ?? 1) + (ship.durability ?? 1)
      ship.armorPct = Math.min(1, (ship.armorPct ?? 1) + pct)
      ship.durability = Math.min(1, (ship.durability ?? 1) + pct)
      if ((ship.armorPct ?? 1) + (ship.durability ?? 1) > before) touched += 1
    }
    if (touched > 0) {
      addLog(state, 'info', `🕳 战地维修单元：编队装甲与结构各回复 ${Math.round(pct * 100)}%（不耗货仓组件）。`)
    }
  }
  const won = battle.ended === 'me'
  const report = won ? wormholeBattleReport(run, battle, kind, ctx) : null
  run.battle = null
  // ── 负（全灭）：全损收场 ──
  if (!won || run.fleet.length === 0) {
    /**
     * ⚠ **损失名单 = 本场被击沉的（`sunk`）+ 还留在编队里的**：
     * 沉船在上面就已经从 `run.fleet` 里摘掉了（`run.fleet.filter(...)`）⇒ 只看 `run.fleet`
     * 会把"这一场沉掉的船"整批漏掉（全灭时更是一条名字都没有 —— 探针实测踩到）。
     */
    const lost = [...sunk, ...run.fleet]
    const lostNames: string[] = []
    for (const uid of lost) {
      const name = ctx.ships.get(uidDefId(uid))?.name ?? uid
      lostNames.push(name)
      // 本场沉掉的已经在上面 `loseShip` 过了：这里只补"还活着但整趟判负"的那几艘
      if (!sunk.includes(uid)) loseShip(state, uid, ctx, `虫洞内失联（${name}）`)
    }
    state.wormhole.lastFleetLost += run.fleet.length
    const lostText = `🕳 虫洞探险失败：编队失联、货仓内容全部丢失（损失 ${lost.length} 艘）。`
    addLog(state, 'warn', lostText)
    /**
     * **结构化战报**（2026-09-14 船长定）：洞内全损 = 我方全灭那一档 ⇒ `lose`，
     * 沉船名单用**整趟丢掉的这批**（含"这一场沉掉的 + 还活着但整趟判负的"）。
     * ⚠ 老档的撤离战（`extract`）**不弹战报弹层**（那一场由虫洞结算单说话）⇒ 这份记录只在
     * 节点/守卫/遗迹那几种用途上会被读到；写它只是为了各类战斗同源。**新趟已无撤离战**（2026-09-15 退役）。
     */
    captureBattleReport(state, battle, { source: 'wormhole', outcome: 'lose', summary: lostText, shipsLost: lostNames })
    /**
     * **结算单（全损）**：把"本来能带走多少"如实算出来 —— 玩家要看到自己赌掉了什么
     * （船长 2026-09-13：「结算界面表示玩家的收益和损失」）。
     */
    state.wormhole.lastSettle = {
      kind: 'lost',
      depth: run.depth,
      oreUnits: 0,
      oreIsk: 0,
      wreckIsk: 0,
      boxes: [],
      relics: [],
      shipsLost: lostNames,
      lostIsk: bagValueIsk(ctx, run),
    }
    state.wormhole.run = null
    return
  }
  // 胜：先出战报（与结算同源），再按战斗用途分流
  if (report) {
    addLog(state, 'info', report)
    /**
     * **结构化战报**（2026-09-14 船长定 · 战报改造）：洞内这一支原先写的是「🕳 第 N 层…交火结束：…」
     * ——**不含「战报」二字** ⇒ 弹层永远取不到正文（船长看到的"过于简陋"就是这个）。
     * 沉船名单走**船长口径的显示名**（`sunk` 那批已有自定义船名），不从 `units` 推导。
     */
    captureBattleReport(state, battle, {
      source: 'wormhole',
      outcome: 'win',
      summary: report,
      shipsLost: sunk.map((uid) => ctx.ships.get(uidDefId(uid))?.name ?? uid),
    })
  }
  // ── 胜：按战斗用途分流 ──
  if (kind === 'extract') {
    // ⚠ **仅老档**（2026-09-15 撤离战退役）：存档里已经在打的撤离战打赢 ⇒ 照旧入港收口。
    // 新趟不会再产生 `kind='extract'` 的战斗（`wormholeStartBattle` 已不接受该用途）。
    deliverExtraction(state, ctx, run)
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
 * **本场战斗的敌卡**（2026-09-14 修船长报障「虫洞内的战斗，敌方舰船动画不对 / **敌方的战斗动画图形
 * 和敌族对不上** / 战斗开始位置似乎不对」）——视图侧取敌卡的**唯一点**：
 * - 洞内交火 = `run.battle` 的**按层派生卡**（`wormholeDerivedAnomaly`，与推进/射程弧/血条同一张）；
 * - 洞外 = 远征/窝点卡（`expedition.anomalyId`，**逐字保持旧口径**）。
 *
 * 为什么必须由 core 出这一个点：洞内战斗的宿主是 `run.battle`（**不占** `expedition.battle`、敌卡也不落
 * 在 `expedition.anomalyId`）⇒ 界面凡"只认远征"的读法在洞里会**静默取到 `undefined`**，而照样渲染：
 * 敌舰族形落到兜底族（A 海盗 ⇒ 洞里 C/D/E/G 族全画成海盗舰体与动画）、舰种体积回落 170/90，
 * 而体积又喂给 `layout()` 的机位/米制跨度 ⇒ 动画、图形、开局机位一起错。界面一律读本函数，
 * **不许再各自猜宿主**（`content:check`「战斗宿主双口径契约」会扫 BattleScreen 的直读）。
 */
export function battleFoeAnomaly(state: GameState, ctx: SimContext): AnomalyDef | undefined {
  const whBattle = state.wormhole.run?.battle
  if (whBattle?.wormhole) {
    const base = ctx.anomalies.get(whBattle.wormhole.cardId)
    if (base) return wormholeDerivedAnomaly(ctx, base, whBattle.wormhole)
  }
  return state.expedition.anomalyId ? ctx.anomalies.get(state.expedition.anomalyId) : undefined
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
  /** 顶部标题用：`虫洞 · 第 N 层` / `虫洞 · 第 N 层守卫` / `虫洞 · 撤离战` */
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
    /**
     * ⚠ **阵亡的敌舰也要留在 `foeHp` 里**（**同一处缺陷两人先后各修了一次**，两条记录都留着：
     * 船长 2026-09-13 报障「战斗中，敌方没有爆炸动画」→ 一号修；船长同日裁定「**②和洞外一致**」→ 二号修）。
     *
     * **成因（口径层）**：战斗界面判定"这一拍刚被击毁"的口径是——**迭代 `foeHp` 的键**、看某个 tag
     * 的血量总和从 >0 掉到 0（`BattleScreen` 的 `foeTags = Object.keys(combat.foeHp)` → `prevHpRef`）。
     * 洞外那条（`expeditionStatus`）**只按 `side` 收**（阵亡者照样给、血量 0），这里原先把"血量已归零"
     * 的敌舰**过滤掉了** ⇒ tag 从 `foeHp` 里消失、迭代根本走不到它 ⇒ **爆炸演出永远不触发**
     * （所以只有洞内没爆炸；实测：节点战 2 次击杀、界面 0 次出现过 0 血单位）。
     * **修法**：**按 `side` 收，不按血量收**（血量归零的条目照样给出去，界面自己会用 `deadRef`
     * 把尸骸登记成"演出中"）——与洞外同口径。
     */
    if (u.side !== 'foe') continue
    foeHp[tag] = { s: u.hp.s, a: u.hp.a, h: u.hp.h, name: u.name }
  }
  const kindLabel =
    spec.kind === 'boss'
      ? '层末守卫'
      : spec.kind === 'extract'
        ? // ⚠ 仅老档（撤离战 2026-09-15 退役）：标题避开已退役的机制名
          '撤离'
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
/** **背包估值**（母矿按基础卖价 + 残骸按回收炉拆解口径；货柜不计 ISK —— 内容物待拆解） */
function bagValueIsk(ctx: SimContext, run: WormholeRunState): number {
  let v = 0
  for (const slot of run.bag) {
    const units = Math.max(0, Math.floor(slot.units))
    if (units <= 0) continue
    if (slot.itemId.startsWith('wreck-')) v += wormholeLootValueIsk(ctx, slot.itemId, units)
    else v += units * (ctx.items.get(slot.itemId)?.baseSellPriceIsk ?? 0)
  }
  return v
}

/**
 * **把带回的 AI 核心接入核心库**（2026-09-14 船长：「AI 核心单独占 1 格」＋ 落地答
 * 「撤离成功自动入核心库，不进仓库」）。
 *
 * 为什么抽成导出函数：这条语义（**入核心账本、仓库里没有**）是船长明确裁定的口径，
 * 但它原本埋在 `deliverExtraction` 里 —— 要验它就得跑完一整趟撤离战。抽出来之后用例可以直接钉住
 * （见 `tests/wormhole-core-drop.test.ts`），也保证"撤离带回"与"自动探索带回"两条路同源。
 *
 * 非核心 id 一律**原样跳过**（货柜/谜质仍走各自那条入库路径）。
 * @returns 各档枚数（本批没有核心 = 空对象）
 */
export function deliverWormholeCores(
  state: GameState,
  ids: readonly string[],
): Partial<Record<'gamma' | 'beta' | 'alpha', number>> {
  const cores: Partial<Record<'gamma' | 'beta' | 'alpha', number>> = {}
  for (const id of ids) {
    const type = wormholeCoreTypeOfItemId(id)
    if (!type) continue
    gainAiCore(state, type)
    cores[type] = (cores[type] ?? 0) + 1
  }
  if (Object.keys(cores).length > 0) {
    const text = (['alpha', 'beta', 'gamma'] as const)
      .filter((t) => (cores[t] ?? 0) > 0)
      .map((t) => `${aiCoreName(t)}×${cores[t]}`)
      .join('、')
    addLog(state, 'info', `🕳 带回 ${text}：已直接接入核心库（不占货仓、不入仓库）。`)
  }
  return cores
}

/**
 * **撤离成功的收口**（船长 2026-09-13 的收口点之一）：
 * ① **发起撤离后的下一拍**（`advanceWormhole` 的 `extracting` 分支 —— 2026-09-15 起撤离不再有战斗）；
 * ② 老档里**已经在打的撤离战打赢**（`settleWormholeBattle` 的 `'extract'` 分支，仅兼容旧档）。
 * ⇒ 抽成一个函数，免得两条路各写一遍（历史上这种"收口少抄一步"在本文件踩过三次：弹药退款 / 机群战损 / 货柜入库）。
 *
 * 做四件事：散货入港 → 随行战利品入库 → **货柜（形状件）入港** → 写**结算单** + 写日志。
 */
function deliverExtraction(state: GameState, ctx: SimContext, run: WormholeRunState): void {
  let isk = 0
  let recycle = 0
  let oreUnits = 0
  for (const slot of run.bag) {
    const units = Math.floor(slot.units)
    const isWreck = slot.itemId.startsWith('wreck-')
    const price = ctx.items.get(slot.itemId)?.baseSellPriceIsk ?? 0
    // **残骸的报账走拆解口径**（基础价只有 1 ISK/单位，写出来等于没写）
    isk += isWreck ? 0 : units * price
    if (!isWreck) oreUnits += units
    if (isWreck) recycle += wormholeLootValueIsk(ctx, slot.itemId, units)
    if (units > 0) addWare(state, slot.itemId, units)
  }
  addLog(
    state,
    'info',
    `🕳 撤离成功：货仓 ${run.bag.length} 类物资入港` +
      (isk > 0 ? `（按基础价约 ${Math.round(isk).toLocaleString('zh-CN')} 信用点）` : '') +
      (recycle > 0 ? `（残骸拆解估值约 ${Math.round(recycle).toLocaleString('zh-CN')} 信用点）` : '') +
      `，第 ${run.depth} 层撤离。`,
  )
  // **随行战利品入库**（遗迹专属掉落：图纸进蓝图书架、装备进装备库）——只有撤离成功才到手
  const relics = [...(run.relics ?? [])]
  if (relics.length > 0) wormholeDeliverRelics(state, ctx, relics)
  /**
   * **货柜（形状件）随趟带回**（船长 §12.2-3：「撤离成功 ⇒ 货柜进仓库；失败 ⇒ 随趟一起丢」）。
   *
   * ⚠ 2026-09-13 修：形状件**不在 `run.bag`**（它们走 `run.hold.placements`），"背包入港"
   * 的循环因此看不到它们 ⇒ F4 起打捞到的「遗迹安全货柜」会在撤离成功那一刻**静默消失**。
   *
   * ⚠ 2026-09-14 修（一号核验查出的缺陷）：**谜质储存器与货柜共用同一套形状件账本**（都记
   * `kind: 'box'`），原来按 `p.kind === 'box'` 取件 ⇒ 装置被当货柜交去入库，与物品说明
   * 「本趟结束随趟消失（不进仓库、不拆解）· 离开虫洞即失效」相反 ⇒ 现在**按物品 kind 排除 `matter`**。
   */
  const boxes = (run.hold?.placements ?? [])
    .filter((p) => p.kind === 'box')
    .map((p) => p.itemId)
    .filter((id) => ctx.items.get(id)?.kind !== 'matter')
  /**
   * **临时空间里的东西也随趟带回**（船长 2026-09-13：「大件货先进临时空间，让玩家协调」）：
   * 临时空间是"船上的缓冲"，不是船外的地方 ⇒ 撤离成功一并入港（失败随趟丢，与背包同一条风险线）。
   * 形状件（货柜）仍走 `wormholeDeliverRelics` 的物品分支；散货按单位数入仓。
   *
   * ⚠ 2026-09-14 修（一号核验查出的缺陷）：账本 2026-09-14 已从**老档只读字段** `run.temp`
   * （一种物品一条的列表）迁到 **`run.tempGrid`**（4×8 格子账本）⇒ 原来读 `run.temp` 恒读空，
   * 临时空间里的件会在"撤离成功"那一刻**凭空消失**（当时被界面规则「撤离前必须清空临时空间」
   * 挡成不可达，所以没炸）。现在按 `tempGrid` 现算：散货按单位数累加、形状件仍按"件"走。
   */
  const tempPlacements = run.tempGrid?.placements ?? []
  const tempItems = tempPlacements.map((p) => p.itemId)
  /** 临时空间里的散货按物品合并单位数（一件一格 ⇒ 同一物品可能有多件） */
  const tempUnits = new Map<string, number>()
  for (const p of tempPlacements) {
    tempUnits.set(p.itemId, (tempUnits.get(p.itemId) ?? 0) + Math.max(0, Math.floor(p.units ?? 0)))
  }
  /**
   * **AI 核心单独走一条**（2026-09-14 船长定：「AI 核心单独占 1 格」＋ 落地答「撤离成功自动入核心库，
   * 不进仓库」）：它们是**形状件**（1×1），撤离成功那一刻按枚数 `gainAiCore` 直接入核心账，
   * **绝不能进 `wormholeDeliverRelics`**（那条会 `addWare` 进仓库 ⇒ 变成"仓库里有 3 个核心却不能用"
   * 的两本账）。半路全损根本走不到这里 ⇒ 核心随背包一起丢（现成口径）。
   */
  const coreIds = [...boxes, ...tempItems].filter((id) => wormholeCoreTypeOfItemId(id) !== null)
  const cores = deliverWormholeCores(state, coreIds)
  /** 行价参考估值（唯一出处 = 市场卡；核心账本那本 key 是 `core-<type>`） */
  const coresIsk = (['gamma', 'beta', 'alpha'] as const).reduce(
    (s, t) => s + (cores[t] ?? 0) * (ctx.marketGoods.get(`core-${t}`)?.basePrice ?? 0),
    0,
  )
  /**
   * **谜质装置 ⇒ 虫洞谜质**（2026-09-15 船长定：「谜质在虫洞结束时不再删除，而是转化成虫洞谜质
   * 存入仓库。……该物品只收不卖。且具备较高价值，目前纯粹作为虫洞的金钱收益」）。
   *
   * 口径：**只有撤离成功才折算**（本函数 = 撤离成功的收口点）⇒ 半路全损走的是"随趟丢"那条路，
   * 谜质一枚都拿不到；装置给的增益本趟照旧生效（折算是结算动作，不改 `run` 里的任何账目）。
   * 台数按**件**算（形状件一件一格，`p.units` 缺省即 1），临时空间里的也一样折。
   * 折算完的两条投递路径仍按 `kind` 排除 `matter` ⇒ 装置本身不会二次进仓库、也不会进拆解池。
   */
  const matterDevices =
    (run.hold?.placements ?? []).reduce(
      (n, p) => n + (ctx.items.get(p.itemId)?.kind === 'matter' ? Math.max(1, Math.floor(p.units ?? 1)) : 0),
      0,
    ) +
    tempPlacements.reduce(
      (n, p) => n + (ctx.items.get(p.itemId)?.kind === 'matter' ? Math.max(1, Math.floor(p.units ?? 1)) : 0),
      0,
    )
  const essences = matterDevices * WORMHOLE_ESSENCE_PER_DEVICE
  if (essences > 0) {
    addWare(state, WORMHOLE_ESSENCE_ITEM_ID, essences)
    const essenceName = ctx.items.get(WORMHOLE_ESSENCE_ITEM_ID)?.name ?? '虫洞谜质'
    addLog(
      state,
      'info',
      `🕳 谜质装置 ×${matterDevices} 析出 ${essenceName} ×${essences}（已入仓库 · 只收不卖）。`,
    )
  }
  /** 谜质行价参考估值（与核心同一口径：唯一出处 = 市场卡；**不计入「到手合计」**） */
  const essenceIsk = essences * (ctx.marketGoods.get(WORMHOLE_ESSENCE_ITEM_ID)?.basePrice ?? 0)
  const boxesAll = [...boxes, ...tempItems.filter((id) => wormholeIsShapedItem(id))]
    .filter((id) => wormholeCoreTypeOfItemId(id) === null)
    .filter((id) => ctx.items.get(id)?.kind !== 'matter') // 谜质装置：上面已折成谜质入库，不再走"入库/拆解"这条路
  if (boxesAll.length > 0) wormholeDeliverRelics(state, ctx, boxesAll)
  for (const [itemId, units] of tempUnits) {
    if (wormholeIsShapedItem(itemId)) continue // 上面已按"件"入过（核心同理，已入核心账）
    if (ctx.items.get(itemId)?.kind === 'matter') continue // 谜质装置同理：已折成谜质
    if (units > 0) addWare(state, itemId, units)
  }
  if (tempPlacements.length > 0) {
    addLog(state, 'info', `🕳 临时空间里的 ${tempUnits.size} 类物资一并入港（未整理的也带回来了）。`)
  }
  // **结算单**（界面弹层用；玩家确认后清掉）
  state.wormhole.lastSettle = {
    kind: 'extract',
    depth: run.depth,
    oreUnits,
    oreIsk: isk,
    wreckIsk: recycle,
    boxes: boxesAll,
    relics,
    ...(coreIds.length > 0 ? { cores, coresIsk } : {}),
    ...(essences > 0 ? { essences, ...(essenceIsk > 0 ? { essenceIsk } : {}) } : {}),
    shipsLost: [],
    lostIsk: 0,
  }
}

export function advanceWormhole(
  state: GameState,
  ctx: SimContext,
  freezeBattle = false,
): void {
  const run = state.wormhole.run
  if (!run) return
  // **临时离开 = 活动停止 ⇒ 洞内一切冻结**（船长 2026-09-13 批准 · 议案 A 第 4 条）：战斗不推进
  // （不掉血）、撤离不落地、收口不落地——回来接着打，进度原样在。
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
  // 撤离相位：**直接结算入港**（2026-09-15 船长「虫洞的撤离战取消吧」⇒ 零战斗零风险，不再有拦截舰队）
  if (run.phase === 'extracting' && !freezeBattle) {
    /**
     * 现行口径（2026-09-15 · 船长「**虫洞的撤离战取消吧**」）：**撤离一律不触发战斗** ——
     * 任意层、任意时候点「撤离」，下一拍直接把货仓与货柜入港。
     *
     * 旧口径（**已作废**）：第 1 层免战（`WORMHOLE_EXTRACT_BATTLE_MIN_DEPTH = 2`）、第 2 层起开一场
     * 撤离战（威胁 = 当层 ×0.8，线性曲线：层 2 = 42、每层 +7），**打赢才把货带回去、打输 = 全损**。
     *
     * ⚠ 老档兼容（"照打完"）：存档里**已经在打的撤离战**走上面的 `run.battle` 分支 —— 照打完，
     * 打完由 `settleWormholeBattle` 按新口径收口（赢 = `deliverExtraction`、输 = 全损），此后不再有下一场。
     */
    deliverExtraction(state, ctx, run)
    state.wormhole.run = null
    return
  }
}

