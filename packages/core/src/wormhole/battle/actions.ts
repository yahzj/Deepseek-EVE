/** 功能域职责拆分，保持原计算与顺序。 */
import { type GameState, addLog } from '../../state'
import type { SimContext } from '../../types'
import { type WormholeActivateEffect, wormholePendingBattleReason, wormholeGridActivate, wormholeGridTravel } from '../../wormhole'
import type { WormholeFoeKind } from '../../wormholeFoes'
import { withBattleRangeCheck } from '../../battleRangeMemory'
import { wormholeActionBlockReason, wormholeSalvageAt, wormholeCollectOreAt, wormholeStowOrTemp, wormholeEnsureArrivalPiles } from '../../wormholeSalvage'
import { gridCellAt, hasLiveFoe, isExitCell } from '../../wormholeGrid'
import { wormholeStartBattle } from './start'
import { wormholeMatterDeviceAt } from '../../wormholeMatter'

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
  errorId?: string
  errorParams?: Readonly<Record<string, string | number>>
  spent?: number
  effect?: WormholeActivateEffect
  started?: WormholeFoeKind
  /** 已结算但**等确认**的战斗（目前只有 `'ruins'`） */
  pendingBattle?: 'ruins'
  taken?: number
  code?: 'unsupported-rules'
} {
  return withBattleRangeCheck(state, { kind: 'wormhole-activate', atGameMs, options: opts }, staged => wormholeActivateAtMutable(staged, ctx, atGameMs, opts))
}

export function wormholeActivateAtMutable(state: GameState, ctx: SimContext, atGameMs?: number, opts?: { deferRuinsBattle?: boolean }): ReturnType<typeof wormholeActivateAt> {
  const run = state.wormhole.run
  if (run?.expeditionRules !== undefined && run.expeditionRules !== 2) return { ok: false, code: 'unsupported-rules' }
  const turnsBefore = run?.turnsLeft ?? 0
  /**
   * **欠着一场战斗 ⇒ 这一口也不许做**（**2026-09-20 玩家报障修复**）：旧实现只拦"超载/临时空间"，
   * 而「迎战/开战」的挂起态（`pendingRuinsBattle` / `pendingNodeBattle`）只在 `wormhole.ts` 的
   * `gridActionBlocked` 里拦着 —— 扫描/前往/深入都过那道闸，**可打捞这一口（本函数）没过** ⇒
   * 待迎战期间玩家可以一直点「打捞」（界面的按钮也没置灰，因为动作闸没报这条）。
   * 现在两条都读同一份拒因（`wormholePendingBattleReason`）⇒ 界面与 core 一致。
   */
  const pendingBattle = wormholePendingBattleReason(state)
  if (pendingBattle) {
    return { ok: false, error: pendingBattle.error, errorId: pendingBattle.errorId, errorParams: pendingBattle.errorParams }
  }
  // **超载闸**（F4 · 船长裁定 8）：货仓装不下时不许再做任何"会装货"的动作（打捞/挖矿/开战都算）。
  const overloaded = wormholeActionBlockReason(state, ctx)
  const battleCell = run?.grid ? gridCellAt(run.grid, run.grid.pos) : undefined
  const mustBattle = run?.supplyVersion === 1 && battleCell && (battleCell.place === 'ship' || hasLiveFoe(battleCell) || isExitCell(run.grid!, run.grid!.pos))
  if (overloaded && !mustBattle) return { ok: false, error: overloaded }

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
    if (!b.ok) {
      return {
        ok: false,
        error: `无法开战：${b.error ?? ''}`,
        errorId: 'core.wormholeBattle.013',
        errorParams: { p1: b.error ?? '' },
      }
    }
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
          errorId: 'core.wormholeBattle.014',
          errorParams: {
            p1: device.name,
            p2: landed.error ?? '货仓放不下',
            ...(landed.error === undefined ? { p2Id: 'core.wormholeBattle.015' } : {}),
          },
        }
      }
      addLog(
        state,
        'combat',
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
    return {
      ok: false,
      error: `无法开战：${s.error ?? ''}`,
      errorId: 'core.wormholeBattle.013',
      errorParams: { p1: s.error ?? '' },
    }
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
 *
 * **路径拦截**（船长 2026-09-16）：直线路径上挡着没清掉的舰船信号格时，`wormholeGridTravel`
 * 把这次移动**截断在拦截点**并回报 `arrived.intercepted`；本函数照旧走"到达即开打"那条开战
 * （`pos` 已落在拦截格 ⇒ 敌卡就是那一格的），并把 `intercepted` 透传给界面做提示。
 * 未确认的拦截由核心直接拒（`code='path-blocked'`）⇒ 界面先弹确认、再带 `confirmIntercept` 重来。
 */
export function wormholeTravelTo(
  state: GameState,
  ctx: SimContext,
  target: { q: number; r: number },
  opts?: { confirmUnknown?: boolean; confirmIntercept?: boolean; deferAmbush?: boolean; confirmLeaveCargo?: boolean },
  atGameMs?: number,
): ReturnType<typeof wormholeTravelToMutable> {
  return withBattleRangeCheck(state, { kind: 'wormhole-travel', target, options: opts, atGameMs }, original => {
    if (original.wormhole.run?.expeditionRules !== 2) return wormholeTravelToMutable(original, ctx, target, opts, atGameMs)
    const staged = structuredClone(original)
    const result = wormholeTravelToMutable(staged, ctx, target, opts, atGameMs)
    if (result.ok) Object.assign(original, staged)
    return result
  })
}

export function wormholeTravelToMutable(
  state: GameState,
  ctx: SimContext,
  target: { q: number; r: number },
  opts?: { confirmUnknown?: boolean; confirmIntercept?: boolean; deferAmbush?: boolean; confirmLeaveCargo?: boolean },
  atGameMs?: number,
): {
  ok: boolean
  error?: string
  errorId?: string
  errorParams?: Readonly<Record<string, string | number>>
  code?: 'unknown-target' | 'path-blocked' | 'cargo-pending' | 'unsupported-rules'
  spent?: number
  autoBattle?: boolean
  beacon?: boolean
  /** 本次移动被**路径拦截**截断（到达的是拦截点；`known` = 拦之前该格是否已知，见 `arrived.intercepted`） */
  intercepted?: { target: string; known: boolean }
  /** **踩中埋伏**（到达的格出发前未知、里面是敌人）：为真时这一场已挂起，等玩家确认 */
  ambush?: boolean
  /** 已结算但**等确认**的战斗：`'node'` = 踩中埋伏（船长 2026-09-16）· `'ruins'` = 遗迹守备（2026-09-13） */
  pendingBattle?: 'node' | 'ruins'
} {
  const run = state.wormhole.run
  const overloaded = wormholeActionBlockReason(state, ctx)
  if (overloaded && run?.supplyVersion !== 1) return { ok: false, error: overloaded }
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
  const intercepted = arrived?.intercepted
  if (!arrived?.autoBattle) {
    return {
      ok: true,
      spent: r.spent,
      ...(arrived?.beacon ? { beacon: true } : {}),
      ...(intercepted ? { intercepted } : {}),
    }
  }
  /**
   * **踩中埋伏 ⇒ 先发事件提醒、等玩家确认再开战**（船长 2026-09-16：「移动途中被敌方拦截或者
   * **进入未扫描地点踩到怪**了，都要弹窗提示，玩家确认后进入战斗」）。
   *
   * 与遗迹守备（`deferRuinsBattle`）**同一套做法**：移动已结算（回合已扣、位置已落、该格已记
   * `activated`），只在 `run` 上留 `pendingNodeBattle` 标记 ⇒ 界面弹提醒条，玩家点「开战」再调
   * `wormholeStartBattle(state, ctx, 'node')`。标记没清之前**别的动作一律被拦**（`gridActionBlocked`）。
   * ⚠ **只在界面传 `deferAmbush: true` 时生效**：不传（工具 / 老调用方 / 用例）= **原行为**（到达即开打）。
   */
  if (arrived.ambush === true && opts?.deferAmbush === true) {
    if (run) run.pendingNodeBattle = true
    return { ok: true, spent: r.spent, autoBattle: true, ambush: true, pendingBattle: 'node' }
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
    return {
      ok: false,
      error: `无法开战：${s.error ?? ''}`,
      errorId: 'core.wormholeBattle.013',
      errorParams: { p1: s.error ?? '' },
    }
  }
  return {
    ok: true,
    spent: r.spent,
    autoBattle: true,
    ...(arrived.ambush === true ? { ambush: true } : {}),
    ...(intercepted ? { intercepted } : {}),
  }
}
