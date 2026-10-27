/** 功能域职责拆分，保持原计算与顺序。 */
import { type GameState, addLog, type DroneLossReport } from '../../state'
import type { SimContext } from '../../types'
import { plugsToBlackBoxesOf } from '../../plugs'
import { uidDefId } from '../../labels'
import { PLUG_BLACKBOX_ITEM_ID } from '../../blackbox'
import { addWare } from '../../inventory'
import { type WormholeRunState, wormholeAdvanceNode } from '../../wormhole'
import { sunkShipIdsOfBattle, persistFleetHullDamage, refundAmmo, refundRepairKitsAll, settleDroneLosses, captureBattleReport } from '../../combat'
import { wormholeSupplyForBattle, settleWormholeDroneRevives } from '../../wormholeSupplies'
import { wormholeMatterBuffs } from '../../wormholeMatter'
import { matterTechWhBuffs } from '../../matterTech'
import { settleWormholeBattleAmmo } from '../../combatAmmo'
import { loseShip } from '../../shipyard'
import { wormholeHoldUsage, wormholeGrantShipSpoils } from '../../wormholeSalvage'
import { ceilFinalQuantity } from '../../quantity'
import { wormholeBattleReport } from './report'
import { bagValueIsk, deliverExtraction } from './extraction'
import { repairCivilianFittings } from '../../equipment'
import { bumpFirst } from '../../firstTasks'
import { gridCellAt, triggerBeaconEffect } from '../../wormholeGrid'
import { wormholeRaiseAlert, wormholeCancelPatrol, wormholePatrolDefeated } from '../../wormholePatrol'

/** 在本场战斗里被打沉的我方单位（三层血全 0；`player` = 主控）——判据已收口到 `combat.sunkShipIdsOfBattle` */

/**
 * **收口一场洞内战斗**（胜/负两条路）：
 * - 先按 D 批口径把**沉掉的船**从舰队里扣掉（该船真丢）；
 * - **胜**：层末守卫 ⇒ 记 `bossCleared`；节点战 ⇒ 结算该节点（扣回合、推进/进入层末）；
 *   撤离战 ⇒ **结算收益**（背包并入仓库）并结束本趟；
 * - **负**（= 我方全灭，D 批口径）：**全损**——编队全丢、背包清空、本趟结束。
 */
/**
 * **洞内沉船的舰船插件 ⇒ 当场折成黑匣入库**（**2026-09-27 船长令**）。
 *
 * 船长问：「玩家如果有插件的船在虫洞内丢失了要怎么回收插件？」⇒ 裁决**甲：洞内沉船即折黑匣入库** ——
 * 与现成的回收口径同一条（`plugs`：「**玩家回收按插件数量直接回收成黑匣**」，1 件插件 = 1 个黑匣、
 * **无条件、不掷骰**），**不造残骸、不加打捞点**（"虫洞不留残骸"是船长 2026-09-26 的令，本批不动它）。
 *
 * ⚠ **必须在 `loseShip` 之前调用**：它会 `delete state.fleet[shipId]`，删完插件就抓不到了。
 * ⚠ 这条修的是一个真缺口：插件那条令写着「玩家打捞自己的舰船残骸时，**总能**回收舰船插件」，
 * 而虫洞那两处 `loseShip` **不传 `wreckGalaxyId`** ⇒ 压根不生成残骸 ⇒ 插件此前**永久消失、无路可回收**。
 */
export function salvagePlugsOnSink(state: GameState, ctx: SimContext, uid: string): void {
  const plugs = state.fleet[uid]?.plugs ?? []
  const n = plugsToBlackBoxesOf(plugs)
  if (n <= 0) return
  const name = ctx.ships.get(uidDefId(uid))?.name ?? uid
  const boxName = ctx.items.get(PLUG_BLACKBOX_ITEM_ID)?.name ?? PLUG_BLACKBOX_ITEM_ID
  addWare(state, PLUG_BLACKBOX_ITEM_ID, n)
  addLog(
    state,
    'fleet',
    `${name}沉没：舰船插件折成${n}个${boxName}入库，空间内沉船不留残骸。`,
    'core.explorationStatus.007',
    { p1: name, p2: n, p3: boxName },
  )
}

export function settleWormholeBattle(state: GameState, ctx: SimContext, run: WormholeRunState): void {
  const battle = run.battle
  if (!battle) return
  const kind = battle.wormhole?.kind ?? 'node'
  // 机群归属：多舰路径的无人机集火池是按**编队首舰**（`fleet[0]`）建的（D 批边界：
  // 僚舰无人机不参战，见 `startFleetBattleFor`）——这里必须在**扣沉船之前**取到它，
  // 否则首舰一沉就找不到归属、机群战损会全部漏结。
  const droneOwner = run.fleet[0]
  const sunk = sunkShipIdsOfBattle(battle)
  const supply = wormholeSupplyForBattle(state, battle)
  if (supply) settleWormholeDroneRevives(state, battle)
  const matterBuffs = wormholeMatterBuffs(run.hold, matterTechWhBuffs(state, ctx))
  if (supply && battle.ended === 'me') settleWormholeBattleAmmo(state, battle, matterBuffs.ammoRefundPct)
  for (const uid of sunk) {
    const name = ctx.ships.get(uidDefId(uid))?.name ?? uid
    // **插件先折黑匣、再沉船**（顺序敏感：`loseShip` 会删掉 fleet 条目）
    salvagePlugsOnSink(state, ctx, uid)
    loseShip(state, uid, ctx, `${run.expeditionRules === 2 ? '虫洞' : '信号空间'}内被击沉（${name}）`, undefined, {
      cause: 'wormhole-sunk',
      wormholeDepth: run.depth,
      reasonId: 'ui.WreckLog.018',
    })
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
  if (!supply) {
    refundAmmo(state, battle.ammo, battle.ammoIds)
    refundRepairKitsAll(state, battle)
  }
  /**
   * **谜质 B2：战后收口三件**（F3c · 船长 2026-09-13）。
   * 一律**现算**（从货仓的装置派生）⇒ 打完这一场立刻按"这一场带了什么"结算，不留状态。
   *
   * ① **弹药回收装置**：按**本场打出去**的那部分退回 `round(已耗 × 比例)` ——
   *    已耗 = 开战预载 − 战后余额（`battle.ammoLoaded`，老档/旧战斗缺该字段 ⇒ 这一项自动跳过）；
   * ② **机群回收网**：回收率加成本（在 `settleDroneLosses` 里夹在 100% 以内）；
   * ③ **战地维修单元**：每场交火后自动修补**装甲与结构**（船长：「同时修复护甲」），不耗货仓组件。
   */
  if (!supply && matterBuffs.ammoRefundPct > 0 && battle.ammoLoaded) {
    const fired = {
      kin: Math.max(0, battle.ammoLoaded.kin - battle.ammo.kin),
      exp: Math.max(0, battle.ammoLoaded.exp - battle.ammo.exp),
      pla: Math.max(0, battle.ammoLoaded.pla - battle.ammo.pla),
    }
    const back = {
      kin: ceilFinalQuantity(fired.kin * matterBuffs.ammoRefundPct),
      exp: ceilFinalQuantity(fired.exp * matterBuffs.ammoRefundPct),
      pla: ceilFinalQuantity(fired.pla * matterBuffs.ammoRefundPct),
    }
    const n = back.kin + back.exp + back.pla
    if (n > 0) {
      refundAmmo(state, back, battle.ammoIds)
      addLog(
        state,
        'combat',
        `🕳 弹药回收装置：这一场打出去的弹药回收了 ${n} 发（${Math.round(matterBuffs.ammoRefundPct * 100)}%）。`,
        'core.wormholeBattle.016',
        { p1: n, p2: Math.round(matterBuffs.ammoRefundPct * 100) },
      )
    }
  }
  // **机群战损**（与远征 `resolveBattleOutcome` / 遭遇战同款 · 2026-09-13 修）：洞内的无人机照样会被
  // 点防打下来（`battle.droneLost` 在涨），首版漏了这一步 ⇒ 洞内无人机**打不死**（清单不减、也没有
  // 战损日志），是最便宜的一种白嫖。**2026-09-14 船长「逐舰机群」**：改为**逐舰结算**——每艘编队舰
  // 各自扣各自的机舱清单、各写一条战损日志；老档/旧战斗只有合计账本 ⇒ 回落到主控那一份。
  const fleetForDrones = battle.myFleet
  // 只汇总本次真实逐舰结算结果，回收取整仍在各舰原路径完成。
  const droneReports: DroneLossReport[] = []
  const collectDroneReport = (report: DroneLossReport): void => { droneReports.push(report) }
  state.droneLossReport = null
  if ((!supply || battle.ended === 'me') && fleetForDrones && fleetForDrones.length > 0) {
    for (const e of fleetForDrones) {
      settleDroneLosses(state, ctx, e.shipId, battle, matterBuffs.droneRecoveryPct, e.tag, collectDroneReport)
    }
  } else if ((!supply || battle.ended === 'me') && droneOwner) {
    settleDroneLosses(state, ctx, droneOwner, battle, matterBuffs.droneRecoveryPct, 'player', collectDroneReport)
  }
  if (droneReports.length > 0) {
    const summary: DroneLossReport = {
      battleStartedAtGameMs: battle.startedAtGameMs,
      rate: droneReports[0]!.rate,
      total: 0, recovered: 0, gone: 0, survivors: 0, revived: 0, returnedToSupply: {}, rows: [],
    }
    const rowsById = new Map<string, DroneLossReport['rows'][number]>()
    for (const report of droneReports) {
      summary.total += report.total
      summary.recovered += report.recovered
      summary.gone += report.gone
      summary.survivors! += report.survivors ?? 0
      summary.revived! += report.revived ?? 0
      for (const [id, n] of Object.entries(report.returnedToSupply ?? {})) {
        summary.returnedToSupply![id] = (summary.returnedToSupply![id] ?? 0) + n
      }
      for (const row of report.rows) {
        const existing = rowsById.get(row.id)
        if (existing) {
          existing.lost += row.lost
          existing.back += row.back
          existing.gone += row.gone
        } else rowsById.set(row.id, { ...row })
      }
    }
    summary.rows = [...rowsById.values()].sort((a, b) => b.value - a.value || a.id.localeCompare(b.id))
    state.droneLossReport = summary
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
      addLog(
        state,
        'combat',
        `🕳 战地维修单元：编队装甲与结构各回复 ${Math.round(pct * 100)}%（不耗货仓组件）。`,
        'core.wormholeBattle.017',
        { p1: Math.round(pct * 100) },
      )
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
      if (!sunk.includes(uid)) {
        // **同样是沉船 ⇒ 插件先折黑匣**（顺序敏感：`loseShip` 会删掉 fleet 条目）
        salvagePlugsOnSink(state, ctx, uid)
        loseShip(state, uid, ctx, `${run.expeditionRules === 2 ? '虫洞' : '信号空间'}内失联（${name}）`, undefined, { reasonId: 'ui.WreckLog.019' })
      }
    }
    state.wormhole.lastFleetLost += run.fleet.length
    // ⟪文案调整 2026-10-06⟫ 新生成失败记录按本趟规则命名，旧存档历史不追改。
    const lostText = `🕳 ${run.expeditionRules === 2 ? '虫洞探险' : '信号空间探索'}失败：编队失联、货仓内容全部丢失（损失 ${lost.length} 艘）。`
    const lostTextId = run.expeditionRules === 2 ? 'core.explorationStatus.009' : 'core.explorationStatus.008'
    const lostParams = { p1: lost.length }
    addLog(state, 'combat', lostText, lostTextId, lostParams)
    /**
     * **结构化战报**（2026-09-14 船长定）：洞内全损 = 我方全灭那一档 ⇒ `lose`，
     * 沉船名单用**整趟丢掉的这批**（含"这一场沉掉的 + 还活着但整趟判负的"）。
     * ⚠ 老档的撤离战（`extract`）**不弹战报弹层**（那一场由虫洞结算单说话）⇒ 这份记录只在
     * 节点/守卫/遗迹那几种用途上会被读到；写它只是为了各类战斗同源。**新趟已无撤离战**（2026-09-15 退役）。
     */
    captureBattleReport(state, battle, { source: 'wormhole', outcome: 'lose', summary: lostText, summaryId: lostTextId, summaryParams: lostParams, shipsLost: lostNames })
    /**
     * **结算单（全损）**：把"本来能带走多少"如实算出来 —— 玩家要看到自己赌掉了什么
     * （船长 2026-09-13：「结算界面表示玩家的收益和损失」）。
     */
    state.wormhole.lastSettle = {
      kind: 'lost',
      ...(run.expeditionRules === 2 ? { expeditionGoal: run.expeditionGoal, expeditionProgress: run.expeditionProgress } : {}),
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
    repairCivilianFittings(state, ctx)
    return
  }
  // 胜：先出战报（与结算同源），再按战斗用途分流
  if (report) {
    addLog(state, 'combat', report.text, report.textId, report.textParams)
    /**
     * **结构化战报**（2026-09-14 船长定 · 战报改造）：洞内这一支原先写的是「🕳 第 N 层…交火结束：…」
     * ——**不含「战报」二字** ⇒ 弹层永远取不到正文（船长看到的"过于简陋"就是这个）。
     * 沉船名单走**船长口径的显示名**（`sunk` 那批已有自定义船名），不从 `units` 推导。
     */
    captureBattleReport(state, battle, {
      source: 'wormhole',
      outcome: 'win',
      summary: report.text,
      summaryId: report.textId,
      summaryParams: report.textParams,
      shipsLost: sunk.map((uid) => ctx.ships.get(uidDefId(uid))?.name ?? uid),
    })
  }
  // ── 胜：按战斗用途分流 ──
  if (kind === 'extract') {
    // ⚠ **仅老档**（2026-09-15 撤离战退役）：存档里已经在打的撤离战打赢 ⇒ 照旧入港收口。
    // 新趟不会再产生 `kind='extract'` 的战斗（`wormholeStartBattle` 已不接受该用途）。
    deliverExtraction(state, ctx, run)
    state.wormhole.run = null
    repairCivilianFittings(state, ctx)
    return
  }
  if (kind === 'boss') {
    run.bossCleared = run.depth
    if (run.expeditionProgress) run.expeditionProgress.guards += 1
    /**
     * **里程碑「层末守卫」的计数点**（成就系统第二批 · 船长 2026-09-20）。
     * 口径 = **累计**打掉的守卫数（`bumpFirst`）——每层守卫一条命、一趟内不会重复；
     * 记在**打赢那一刻**（`kind === 'boss'` 的胜场分支），与上面的 `bossCleared` 同一处，不会漏也不会重。
     */
    bumpFirst(state, 'whBossClears')
    addLog(
      state,
      'combat',
      `🕳 第 ${run.depth} 层守卫已清：可以「继续深入」或「撤离」。`,
      'core.wormholeBattle.018',
      { p1: run.depth },
    )
    /**
     * **层末守卫的战果**（**2026-09-23 船长令**：「**上调洞内战斗的价值，包括层末守卫**」）：
     * 守卫此前一分不给，现按 `'boss'` 形状发（3 堆普通残骸 ＋ 3 件稀有残骸 ＋ 一次货柜掷骰）。
     */
    if (run.grid) wormholeGrantShipSpoils(state, ctx, 'boss')
    return
  }
  // 网格层的地点战：回合已在"激活地点"那一步扣掉、地点也已记进 `activated` ⇒ 这里只报账
  // （地点收益——墓场/遗迹的打捞、矿脉的母矿、谜质的增强——在 F3b/F3c 接）
  if (run.grid) {
    const here = gridCellAt(run.grid, run.grid.pos)
    if (battle.wormhole?.expeditionRole === 'event' && here?.event?.battle === 'pending') {
      here.event.battle = 'won'
      here.eventResolved = true
      if (run.expeditionProgress) run.expeditionProgress.events += 1
      if (here.eventKey === 'relay') {
        const cancelled = run.patrols?.filter(p => p.status === 'cancelled').length ?? 0
        wormholeRaiseAlert(state, -2)
        if ((run.patrols?.filter(p => p.status === 'cancelled').length ?? 0) === cancelled) wormholeCancelPatrol(run)
        run.guardSupportDisabled = true
      } else if (here.eventKey === 'controller') {
        const ruins = run.grid.cells.find(c => c.key === here.event?.ruinsKey && c.place === 'ruins')
        if (ruins) ruins.alarmDisabled = true
        run.guardSupportDisabled = true
      }
      return
    }
    // 舰船信号的战果：形状由用途决定（2026-09-23 船长令：普通节点 2 堆 + 2 件稀有；遗迹 2+2；围剿 1+0）
    if (kind === 'node') {
      if (run.expeditionRules === 2 && here) {
        here.combatCleared = true
        if (!run.grid.activated.includes(here.key)) run.grid.activated.push(here.key)
      }
      if (battle.wormhole?.expeditionRole === 'elite') {
        if (run.expeditionProgress) run.expeditionProgress.elites += 1
        wormholeGrantShipSpoils(state, ctx, 'elite')
      } else wormholeGrantShipSpoils(state, ctx, 'node')
    }
    else if (kind === 'ruins') wormholeGrantShipSpoils(state, ctx, 'ruins')
    else if (kind === 'spawn') {
      /** 打掉围剿者 ⇒ **覆盖解除、原格内容照旧**（船长：「打掉后进入原内容」）：只清 `foe`，不碰 `place`/`piles` */
      const cell = gridCellAt(run.grid, run.grid.pos)
      if (cell?.foe) cell.foe = { ...cell.foe, cleared: true }
      if (cell?.foe?.patrolId !== undefined) wormholePatrolDefeated(run, cell.foe.patrolId)
      if (cell?.place === 'beacon') triggerBeaconEffect(run.grid, cell)
      wormholeGrantShipSpoils(state, ctx, 'spawn')
    }
    if (run.turnsLeft <= 0) addLog(state, 'combat', `🕳 回合已耗尽：只能撤离。`, 'core.wormholeBattle.019')
    return
  }
  // 老档线性节点：结算该节点（扣回合、推进；回合不够 ⇒ 转撤离相位＝只能撤离）
  const r = wormholeAdvanceNode(ctx, run, state.rng.seed)
  if (!r.ok) {
    run.phase = 'extracting'
    addLog(
      state,
      'combat',
      `🕳 回合不足以继续推进：只能撤离（${r.error ?? ''}）。`,
      'core.wormholeBattle.020',
      { p1: r.error ?? '' },
    )
    return
  }
  if (r.mustExtract) {
    addLog(state, 'combat', `🕳 回合已耗尽：只能撤离。`, 'core.wormholeBattle.019')
  }
}
