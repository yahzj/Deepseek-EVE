/**
 * 终局玩法「虫洞」· 施工期界面（E 批 2026-09-13 起 · F3a-2 层内网格 2026-09-13）。
 *
 * ⚠ **可见性铁律（船长 2026-09-13）**：虫洞完成前**对玩家不可见** —— 入口只在**调试模式**下出现
 * （`debugEnabled()`，与调试面板同一开关），数据侧走 `MarketGoodDef.unreleased` 闸门，
 * **拍板前不得出现在玩家可及路径上**。见 `docs/design/wormhole-extraction-endgame-20260912.md`
 * §「可见性与拍板」与 §十（分批落码）。
 *
 * 界面构成：准备页（编队检索 + 三联读数）· **探索页（F3a-2：圆盘六边形网格 + 扫描/前往；F5 起
 * 墓场/遗迹/矿脉走到就铺好产出 ⇒ 按钮是「打捞 / 采集」而不是「激活」）** · 货仓页（F4b 背包式格管理；
 * F5 起散货也是网格里的真摆放件、可拖拽）。层内动作各花 1 回合，未扫描的地点要先警告再确认（船长口径）；
 * 未扫描的格子在图上用**蓝灰虚线边框**区分，且不按信号上色（免得漏真相）。
 */
import { useEffect, useState } from 'react'
import {
  WORMHOLE_ADMISSION_TEXT,
  WORMHOLE_EXTRACT_BATTLE_MIN_DEPTH,
  WORMHOLE_MAX_SHIPS,
  WORMHOLE_PLACE_TEXT,
  wormholeIsShapedItem,
  WORMHOLE_SLOT_M3,
  WORMHOLE_TOTAL_MASS_CAP,
  cargoCapacityM3Of,
  isExitCell,
  shipBusyLabel,
  shipDisplayName,
  shipSizeLabel,
  wormholeAdmission,
  wormholeBagSlots,
  wormholeBagUsage,
  wormholeFleetCargoM3,
  wormholeFoeThreat,
  wormholeLayerThreat,
  WORMHOLE_HOLD_COLS,
  durabilityOf,
  holdRows,
  placementCells,
  signalOfPlace,
  wormholeOutOfTurns,
  wormholeShipAllowed,
  wormholeSalvagersOf,
  wormholeMinersOf,
  wormholeShipMass,
  wormholeUnitsPerSlot,
} from '@whale/core'
import type { WormholeGridState, WormholePlace, WormholeSignal } from '@whale/core'
import type { GameEngine } from '../game/engine'
import { ShipSprite, ShipSpriteShape } from '../ui/ShipSprite'
import type { ToastFn } from '../pages/common'
import { SHIP_SUBS, SHIP_TIER_SUBS, SUB_ALL } from '../ui/itemSubs'

type WhTab = 'prep' | 'map' | 'bag'

const TAB_LABEL: Record<WhTab, string> = { prep: '准备', map: '探索', bag: '背包' }

/** 千分位 */
function n(v: number): string {
  return Math.round(v).toLocaleString('zh-CN')
}

export function WormholePanel({
  engine,
  onToast,
  onClose,
}: {
  engine: GameEngine
  onToast: ToastFn
  onClose: () => void
}) {
  const state = engine.state
  const ctx = engine.ctx
  const run = state.wormhole.run
  const [tab, setTab] = useState<WhTab>(run ? 'map' : 'prep')
  /** 编队选择（准备页；进洞前才用得上） */
  const [picked, setPicked] = useState<string[]>(state.shipId ? [state.shipId] : [])
  /**
   * 待确认的"前往未知地点"目标（船长 2026-09-13：前往未扫描的地方**需要警告**）。
   * 口径：点未扫描的格 **不直接走**（也不扣回合），先把警告摆出来，等玩家点「确认前往」。
   */
  const [pendingCell, setPendingCell] = useState<{ q: number; r: number } | null>(null)

  const admission = wormholeAdmission(ctx, picked)
  const cargoM3 = wormholeFleetCargoM3(state, ctx, picked)
  const bagSlots = wormholeBagSlots(cargoM3)
  const usage = run ? wormholeBagUsage(ctx, run.bag, wormholeBagSlots(wormholeFleetCargoM3(state, ctx, run.fleet))) : null
  /** 回合走不动了（耗尽 / 付不起当前节点）⇒ 只能撤离（逃生门；与 core `wormholeOutOfTurns` 同一把尺） */
  const outOfTurns = run ? wormholeOutOfTurns(run) : false
  /** 本层网格（F3a-2；老档该层没有网格 ⇒ 退回旧口径提示） */
  const grid = run?.grid
  const hereKey = grid ? `${grid.pos.q},${grid.pos.r}` : ''
  const hereCell = grid ? grid.cells.find((c) => c.key === hereKey) : undefined
  const atExit = grid ? isExitCell(grid, grid.pos) : false
  const bossDone = !!run && (run.bossCleared ?? 0) >= run.depth
  /** **打捞现场**（F3b：墓场/遗迹）——它的"激活"是打捞作业（要打捞器、按台数回收） */
  const salvageCell = !!hereCell && (hereCell.place === 'graveyard' || hereCell.place === 'ruins')
  /**
   * **矿脉**（F5 · 船长 2026-09-13：「资源点和墓场遗迹改为不用激活」「虚空母矿要求玩家携带采集器。
   * 规则同虫洞打捞」）：走到就铺好母矿堆，打捞/采集各按"台数 × 回合"回收 ⇒ 与墓场同一套交互。
   */
  const veinCell = hereCell?.place === 'vein'
  /** 编队打捞器台数（0 ⇒ 打捞格干不了活；界面据此给出拒因而不是让按钮白按） */
  const salvagers = run ? wormholeSalvagersOf(state, ctx) : 0
  /** 编队采集器台数（0 ⇒ 母矿一堆也挖不动：与打捞器同一把尺） */
  const miners = run ? wormholeMinersOf(state, ctx) : 0
  /** 当前格上还剩几堆（打捞/采集共用；按钮上显示"本次能回收几堆"） */
  const herePiles = hereCell?.piles ?? []
  /**
   * **堆分两类**（2026-09-13 修好货柜拾取后）：
   * - **形状件**（遗迹安全货柜）= 要玩家**自己拾取装舱**（2×2 = 4 格、放不下整件拒收）；
   * - 其余 = 残骸 / 母矿，走「打捞」「采集」的成批回收。
   * 按钮可用性只看**可成批回收的那部分**（只剩货柜时「打捞」不该亮着）。
   */
  const shapedPiles = herePiles.filter((p) => wormholeIsShapedItem(p.itemId))
  const bulkPiles = herePiles.length - shapedPiles.length
  /**
   * **编队第一艘船的 defId**（地图上"当前格"用它的舰影表示 —— 船长 2026-09-13）。
   * 取不到（老档 uid 悬空）就退化成一个小箭头，不让地图空着。
   */
  const leadShipDefId = (() => {
    const uid = run?.fleet[0]
    if (!uid) return undefined
    return ctx.ships.get(state.fleet[uid]?.defId ?? uid)?.id
  })()
  /** 当前地点能不能激活：空信息地点/信标没作业、处理过的不重复、入口格守卫清掉后不再触发 */
  const canActivate = !!grid && !!hereCell && !grid.activated.includes(hereKey) && (atExit ? !bossDone : hereCell.place !== 'empty')
  /** 打捞格：没打捞器就打不了；有打捞器但堆已空 ⇒ 也打不了 */
  const canSalvage = salvageCell && salvagers > 0 && bulkPiles > 0 && (run?.turnsLeft ?? 0) >= 1
  /** 矿脉：没采集器就挖不动；有采集器但堆已空 ⇒ 也采不了 */
  const canCollect = veinCell && miners > 0 && bulkPiles > 0 && (run?.turnsLeft ?? 0) >= 1
  /** **免激活的两个作业格**（打捞 / 采集）：界面按钮走同一个引擎入口，标签与拒因按地点分流 */
  const workCell = salvageCell || veinCell
  const canWork = salvageCell ? canSalvage : veinCell ? canCollect : false
  const rigs = salvageCell ? salvagers : miners
  const rigName = veinCell ? '采集器' : '打捞器'
  /** 主控忙态（船长 2026-09-13：「进洞要求洞外主控处于闲置状态」）——非空即不许进洞 */
  const pilotBusy = run ? null : shipBusyLabel(state, ctx, state.shipId)
  /**
   * **货仓超载**（F4 · 船长裁定 8：沉船后要求玩家手动抛弃货物）：
   * 超载期间不能再装货（拾取/打捞/战果），撤离与深入也要先抛到容量内 ⇒ 界面据此置灰并给提示。
   */
  /** **本趟结算单**（有它 ⇒ 整页只显示结算界面，见船长 2026-09-13） */
  const settle = state.wormhole.lastSettle
  const holdInfo = run ? engine.wormholeHoldInfo() : null
  const overloaded = holdInfo?.overload ?? false

  /* ── 选舰检索（船长 2026-09-13「缺少一个类似我的舰队里的舰船筛选和搜索」）──
     复刻「我的舰队」那套：搜索词（舰名/船型名，忽略大小写）+ 两行筛选（类别 / 级别，各维取「与」）；
     类别与级别复用同一张单点表（`SHIP_SUBS` / `SHIP_TIER_SUBS`），与市场/手册/组装机同口径。
     （2026-09-13 船长：「状态的筛选可以删除」⇒ 原「状态」那一行整行退场。） */
  const [whQ, setWhQ] = useState('')
  const [whRole, setWhRole] = useState<string>(SUB_ALL)
  const [whTier, setWhTier] = useState<string>(SUB_ALL)
  const whEntries = Object.keys(state.fleet).map((uid) => {
    const def = ctx.ships.get(state.fleet[uid]!.defId ?? uid)
    const busy = shipBusyLabel(state, ctx, uid)
    const ok = def ? wormholeShipAllowed(def) : false
    return {
      uid,
      def,
      name: shipDisplayName(state, ctx, uid),
      tier: def?.tier ?? 0,
      ok,
      busy,
      on: picked.includes(uid),
      // **损伤**（与舰队页「待维修」同一把尺）：装甲/结构未满 = 带伤；护盾每场满值重建、不持久、不计
      armor: state.fleet[uid]!.armorPct ?? 1,
      dur: durabilityOf(state, uid),
    }
  })
  const whFiltered = whQ.trim().length > 0 || whRole !== SUB_ALL || whTier !== SUB_ALL
  const whShown = whEntries.filter((e) => {
    const q = whQ.trim().toLowerCase()
    if (q.length > 0) {
      const hay = `${e.name} ${e.def?.name ?? ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    if (whRole !== SUB_ALL && (e.def?.role ?? 'industrial') !== whRole) return false
    if (whTier !== SUB_ALL && `t${e.tier}` !== whTier) return false
    return true
  })

  function togglePick(uid: string): void {
    setPicked((prev) => {
      if (prev.includes(uid)) return prev.filter((x) => x !== uid)
      if (prev.length >= WORMHOLE_MAX_SHIPS) {
        onToast(`最多只能带 ${WORMHOLE_MAX_SHIPS} 艘船。`, true)
        return prev
      }
      return [...prev, uid]
    })
  }

  function handleEnter(): void {
    const r = engine.wormholeEnter(picked)
    if (!r.ok) onToast(r.error ?? '无法跃入。', true)
    else {
      onToast('已跃入虫洞。')
      setTab('map')
    }
  }

  /* ── 层内网格动作（F3a-2）：扫描 / 前往 / 激活，各 1 回合 ──
     口径（船长 2026-09-13）：「玩家可以到达任意位置，包括未扫描，但是前往未扫描的地方需要
     警告玩家即将前往未知地点」⇒ 点未扫描的格**只摆警告**（不移动、不扣回合），
     等玩家点「确认前往」才真的走。核心侧同样有这道闸（`code === 'unknown-target'`），
     界面不依赖"记得拦"——两边同一把尺。 */

  /** 点格：已扫描/已到达 ⇒ 直接走；未扫描 ⇒ 先警告 */
  function pickCell(q: number, r: number): void {
    if (!grid || !run) return
    if (run.battle) {
      onToast('交火中：先打完这一场。', true)
      return
    }
    const cell = grid.cells.find((c) => c.key === `${q},${r}`)
    if (!cell) return
    if (cell.key === hereKey) {
      onToast('已经在这个地点了。')
      return
    }
    if (!grid.scanned.includes(cell.key) && !grid.visited.includes(cell.key)) {
      setPendingCell({ q, r })
      return
    }
    travelTo(q, r, false)
  }

  function travelTo(q: number, r: number, confirmUnknown: boolean): void {
    const res = engine.wormholeTravel(q, r, confirmUnknown)
    if (!res.ok) {
      onToast(res.error ?? '无法前往。', true)
      return
    }
    setPendingCell(null)
    // 到达即触发的两件事（船长 2026-09-13）：信标指路 / 舰船信号就地开打（战斗界面接手，不提示）
    if (res.beacon) onToast('漂浮信标：下一层入口已标在地图上。')
  }

  function doScan(): void {
    const res = engine.wormholeScan()
    if (!res.ok) {
      onToast(res.error ?? '无法扫描。', true)
      return
    }
    onToast('扫描完成（1 回合）。')
  }

  /**
   * 当前地点的作业入口（F5 起**墓场/遗迹/矿脉都不用先"激活"**，走到就铺好产出）：
   * 舰船信号 / 下一层入口会**就地开战**；**墓场/遗迹 = 打捞一批**、**矿脉 = 采集一批**
   * （两者都在 core 侧按台数分流）；谜质的增强待定（F3c）。
   */
  function doActivate(): void {
    const place = hereCell?.place
    const exitNow = atExit
    const res = engine.wormholeActivate()
    if (!res.ok) {
      onToast(res.error ?? '无法激活。', true)
      return
    }
    if (exitNow || place === 'ship') return // 已开战：交给战斗界面
    if (place === 'graveyard' || place === 'ruins') {
      onToast(`打捞作业：这一批回收了 ${res.taken ?? 0} 堆。`)
      return
    }
    if (place === 'vein') onToast(`采集作业：这一批回收了 ${res.taken ?? 0} 堆虚空母矿。`)
    else if (place === 'matter') onToast('谜质的增强效果待定（F3c）。')
  }

  function doDescend(): void {
    const r = engine.wormholeDescend()
    if (!r.ok) onToast(r.error ?? '无法深入。', true)
  }

  function doExtract(): void {
    const r = engine.wormholeExtract()
    if (!r.ok) {
      onToast(r.error ?? '无法撤离。', true)
      return
    }
    /**
     * **撤离提醒**（船长 2026-09-13：「玩家撤离时提醒玩家需要进行撤离战（有敌人开始围堵你之类的）」）。
     * 第 1 层按船长口径**没有拦截舰队** ⇒ 提示语换成"直接脱离"，别让玩家白紧张一场。
     */
    const depth = state.wormhole.run?.depth ?? 1
    onToast(
      depth < WORMHOLE_EXTRACT_BATTLE_MIN_DEPTH
        ? '脱离航道：第 1 层没有拦截舰队，货物直接入港。'
        : '⚠ 敌人开始围堵你：撤离战马上开打——打赢才把背包与货柜带回去。',
    )
  }

  /** 打捞/采集按钮的悬浮说明（只在真能用时才渲染按钮，故这里只讲"这一批能回收多少"） */
  const workTitle = veinCell
    ? `采集一批：${rigs} 台采集器一次回收 ${Math.min(rigs, herePiles.length)} 堆虚空母矿`
    : `打捞一批：${rigs} 台打捞器一次回收 ${Math.min(rigs, herePiles.length)} 堆（优先稀有）`

  /**
   * **当前地点的信息卡**（船长 2026-09-13：扫描按钮放大后**与它平级**摆在左侧）——
   * 内容与原样一致（地点名 / 坐标 / 已处理标记 / 堆清单或地点说明）。
   */
  function renderHereNode(): React.ReactNode {
    if (!grid || !hereCell) return null
    return (
      <>
        <div className="app-wh-node-title">
          {atExit ? '下一层入口' : WORMHOLE_PLACE_TEXT[hereCell.place]}
          <span className="app-dim">
            {' '}· 坐标 Q{grid.pos.q} · R{grid.pos.r}
            {grid.activated.includes(hereKey) ? ' · 已处理' : ''}
          </span>
        </div>
        {herePiles.length > 0 ? (
          <>
            {workCell && bulkPiles > 0 ? (
              <div className="app-dim app-note">
                {veinCell ? '虚空母矿' : '残骸'}堆 {bulkPiles} 堆{veinCell ? '' : '（稀有在前）'} · 编队
                {rigName} <b>{rigs}</b> 台 ⇒ 每回合回收 {Math.min(Math.max(rigs, 0), bulkPiles)} 堆、共{' '}
                {rigs > 0 ? Math.ceil(bulkPiles / rigs) : '—'} 回合
                {rigs <= 0 ? `（没有${rigName}：先给编队装上${rigName}）` : ''} · 走到这一格就铺好了，**不用激活**
              </div>
            ) : null}
            {shapedPiles.length > 0 ? (
              <div className="app-dim app-note">
                另有 <b>{shapedPiles.length}</b> 件「遗迹安全货柜」：**打捞器搬不动它** ——
                点下面「拾取装舱」自己搬（占货仓 2×2 = 4 格；放不下会**整件拒收**，先腾地方）。
              </div>
            ) : null}
            <ul className="app-inv-list">
              {herePiles.map((p, i) => {
                const def = ctx.items.get(p.itemId)
                const shaped = wormholeIsShapedItem(p.itemId)
                const slotUse = wormholeUnitsPerSlot(def?.unitM3 ?? 0)
                return (
                  <li key={`${p.itemId}-${i}`} className="app-inv-row">
                    <div className="app-inv-main">
                      <span className="app-inv-name">
                        {def?.name ?? p.itemId} ×{n(p.units)}
                      </span>
                      <span className="app-inv-count">
                        {n(p.units * (def?.unitM3 ?? 0))} m³
                        {shaped ? ' · 整件占 2×2 = 4 格（放不下整件拒收）' : ` · 每格 ${n(slotUse)} 单位`}
                      </span>
                    </div>
                    <div className="app-inv-btns">
                      {shaped ? (
                        /* **形状件（货柜）**：唯一入口就是这个拾取装舱（打捞/采集都不搬它） */
                        <button
                          className="app-btn is-small is-primary"
                          disabled={!!run.battle || overloaded}
                          onClick={() => {
                            const r = engine.wormholeTakePile(i)
                            if (!r.ok) onToast(r.error ?? '拾取失败。', true)
                            else onToast('已装上货柜（占 2×2 = 4 格）。')
                          }}
                          title="拾取装舱：占货仓 2×2 = 4 格；放不下会整件拒收（先腾地方）"
                        >
                          拾取装舱（2×2 格）
                        </button>
                      ) : (
                        /* 母矿与残骸都靠**台数 × 回合**成批回收（船长 F5：规则同打捞）⇒ 不逐堆拾取 */
                        <span className="app-dim">{veinCell ? '待采集' : '待打捞'}</span>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          </>
        ) : (
          <div className="app-dim app-note">{PLACE_NOTE[hereCell.place]}</div>
        )}
      </>
    )
  }

  /**
   * **临时离开 = 活动停止**（船长 2026-09-13 批准 · 议案 A 第 2 条）：关掉面板就 `wormholeLeave()`
   * ⇒ 主控立刻释放（可以去做别的），**虫洞进度原样保存**、洞内一切冻结（含战斗）。
   */
  function handleClose(): void {
    if (state.wormhole.run) engine.wormholeLeave()
    onClose()
  }

  // **返回虫洞**（打开面板即占住活动位）：要求主控空闲——忙着则留在"已离开"态并提示先收工（第 3 条）。
  const [resumeNote, setResumeNote] = useState<string | null>(null)
  useEffect(() => {
    if (!state.wormhole.run || state.wormhole.run.attending === true) return
    const r = engine.wormholeResume()
    if (!r.ok) setResumeNote(r.error ?? '暂时回不到虫洞。')
    else setResumeNote(null)
    // 只在"刚打开/刚离开"这两种时刻触发；`attending` 变 true 后本效果自动空转
  }, [engine, state.wormhole.run?.attending])

  return (
    <div className="app-modal-mask" onClick={handleClose}>
      <div className="app-modal app-wh-modal" onClick={(e) => e.stopPropagation()}>
        <div className="app-modal-head">
          <span className="app-report-title">{settle ? '本趟结算' : '虫洞'}</span>
          <span className="app-dim app-wh-devnote">
            {settle
              ? settle.kind === 'extract'
                ? '货物入港完毕 · 确认后关闭'
                : '编队失联 · 确认后关闭'
              : run
                ? run.attending
                  ? '人在洞里 · 离开即暂停（进度保存）'
                  : '已离开 · 进度已保存'
                : '调试入口 · 施工中（拍板后对玩家开放）'}
          </span>
          <div className="app-wh-tabs">{settle ? null : (
            (Object.keys(TAB_LABEL) as WhTab[]).map((k) => {
              /**
               * **进洞后不许回「准备」页**（船长 2026-09-13 报的 UI BUG）：
               * 编队一进洞就锁定了（人也进洞了），再回准备页既能改编队又能重复「进入虫洞」，
               * 语义上是"人已经下去了还能重选队伍"。⇒ `run` 存在时「准备」置灰，
               * 要改编队必须先撤离/结算本趟（回合制，页签状态不影响引擎）。
               */
              const blocked = k === 'prep' ? !!run : !run
              return (
                <button
                  key={k}
                  className={`app-btn is-small${tab === k ? ' is-primary' : ''}`}
                  onClick={() => setTab(k)}
                  disabled={blocked}
                  title={k === 'prep' && run ? '已在洞里：先撤离或结算本趟，才能重新编队' : !run && k !== 'prep' ? '还没进洞' : undefined}
                >
                  {TAB_LABEL[k]}
                </button>
              )
            })
          )}</div>
          <button className="app-btn is-small" onClick={handleClose}>
            ✕ 关闭（离开虫洞）
          </button>
        </div>

        <div className="app-modal-body">
          {/**
           * **本趟结算界面**（船长 2026-09-13：「玩家撤离后弹出一个结算界面，表示玩家的收益和损失。
           * 然后关闭虫洞界面」）：有结算单时**整页只显示它**（页签隐去），
           * 点「确认」= 清掉结算单 + **关闭虫洞面板**（`onClose`）。
           */}
          {settle ? (
            <div className="app-wh-settle">
              <div className="app-wh-settle-head">
                <span className={`app-wh-settle-kind${settle.kind === 'extract' ? ' is-good' : ' is-bad'}`}>
                  {settle.kind === 'extract' ? '撤离成功' : '本趟全损'}
                </span>
                <span className="app-dim">
                  第 {settle.depth} 层 ·{' '}
                  {settle.kind === 'lost'
                    ? '编队失联，货全丢了'
                    : settle.skippedExtractBattle === true
                      ? '第 1 层没有拦截舰队（直接脱离）'
                      : '打赢了撤离拦截战'}
                </span>
              </div>
              <div className="app-wh-settle-grid">
                <div className="app-wh-settle-cell">
                  <span className="app-dim">虚空母矿</span>
                  <b>{n(settle.oreUnits)}</b>
                  <span className="app-dim">单位 ⇒ {n(settle.oreIsk)} ISK</span>
                </div>
                <div className="app-wh-settle-cell">
                  <span className="app-dim">残骸（回收炉拆解估值）</span>
                  <b>{n(settle.wreckIsk)}</b>
                  <span className="app-dim">ISK</span>
                </div>
                <div className="app-wh-settle-cell">
                  <span className="app-dim">遗迹安全货柜</span>
                  <b>{settle.boxes.length}</b>
                  <span className="app-dim">件（内容物待拆解）</span>
                </div>
                <div className="app-wh-settle-cell">
                  <span className="app-dim">随行战利品</span>
                  <b>{settle.relics.length}</b>
                  <span className="app-dim">件（装备 / 图纸）</span>
                </div>
              </div>
              <div className="app-wh-settle-total">
                本趟到手合计 <b>{n(settle.oreIsk + settle.wreckIsk)}</b> ISK
                {settle.boxes.length > 0 ? ` · 货柜 ${settle.boxes.length} 件` : ''}
              </div>
              {settle.shipsLost.length > 0 ? (
                <div className="app-wh-settle-loss">
                  损失：{settle.shipsLost.join('、')}（共 {settle.shipsLost.length} 艘，船上装备一并遗失）
                </div>
              ) : null}
              {settle.lostIsk > 0 ? (
                <div className="app-wh-settle-loss">
                  没带回来的货：约 {n(settle.lostIsk)} ISK（随编队一起丢了）
                </div>
              ) : null}
              <div className="app-wh-actions">
                <button
                  className="app-btn is-primary app-wh-enter"
                  onClick={() => {
                    engine.wormholeAckSettle()
                    onClose() // 船长：结算完关掉虫洞界面
                  }}
                >
                  确认并返回
                </button>
              </div>
            </div>
          ) : null}
          {/* 回不到虫洞（主控在忙）：把拒因摆出来，别让玩家对着不能点的界面猜（议案 A 第 3 条） */}
          {!settle && resumeNote ? <div className="app-warn app-wh-gate">{resumeNote}</div> : null}
          {/* 本趟已结束（撤离成功 / 全损）⇒ 回到准备页并说明结果（否则"探索/背包"两页会是空白） */}
          {!settle && !run && tab !== 'prep' ? (
            <div className="app-dim app-inv-empty">
              本趟已结束（最近一次损失 {state.wormhole.lastFleetLost} 艘）：在「准备」页可再次编队入洞。
            </div>
          ) : null}
          {!settle && tab === 'prep' ? (
            <div className="app-wh-prep">
              <div className="app-bay-title">准备 · 选编队（最多 {WORMHOLE_MAX_SHIPS} 艘）</div>
              <div className="app-dim app-note">
                带入舰船按「级别折算质量」压塌虫洞入口：旗舰（T5）进不去，总质量超过 {n(WORMHOLE_TOTAL_MASS_CAP)} 也进不去；
                总质量越高、可探索回合越短；背包格数按编队「合计货仓」折算（每 {n(WORMHOLE_SLOT_M3)} m³ = 1 格，含技能与货舱件加成）。
              </div>
              {/* **选舰卡片**（船长 2026-09-13：「虫洞入口选取舰船采用卡片形式，卡片内含有舰船名称、
                  舰船级别、折算质量、货仓、舰船 SVG 外形，且当编入时，卡片边框会变色」）——
                  结构/类名沿用装配页候选卡（`.app-fit-pick-item`）与舰队卡（`.app-inv-row.is-picked`）那一族：
                  整卡可点、选中态给边框+底色；舰影走统一资产 `ShipSprite`（细描边线稿，非 CSS 拼形）。
                  ⚠ `ShipSprite` **不要传 `name`**：它自带一个绝对定位的舰名标签（`.app-sprite-name`，
                  贴在舰影下缘），会压住卡片自己的舰名（2026-09-13 船长报「名称与 SVG 下方文本重叠」）。
                  检索控件（搜索 + 状态/类别/级别三行筛选）复刻「我的舰队」那套类名与口径。 */}
              <div className="app-bay-title app-wh-sub">选择舰船（点卡片编入 / 再点撤下）</div>
              {/**
               * **检索区 + 进入按钮平级**（船长 2026-09-13：「进入虫洞的按钮放大（参考导航栏的出击），
               * 移动到搜索和筛选按钮相同容器内的最右侧」）：左边 = 搜索框 + 类别/级别两行筛选，
               * 右边 = 放大的「进入虫洞」主按钮（`.app-wh-enter`）+ 编队计数。 */}
              <div className="app-wh-prephead">
                <div className="app-wh-prephead-main">
                  <span className="app-head-search-wrap app-wh-search">
                    <input
                      className="app-head-search"
                      type="text"
                      placeholder="搜索舰船…"
                      value={whQ}
                      onChange={(e) => setWhQ(e.target.value)}
                      spellCheck={false}
                    />
                    <span className="app-dim">
                      {whFiltered ? `匹配 ${whShown.length} / 共 ${whEntries.length} 艘` : `${whEntries.length} 艘`}
                    </span>
                  </span>
                  <div className="app-fleet-toolbar app-wh-filters">
                <div className="app-fleet-row">
                  <span className="app-dim">类别：</span>
                  <div className="app-task-tabs app-fleet-tabs" role="tablist">
                    <button
                      role="tab"
                      aria-selected={whRole === SUB_ALL}
                      className={`app-tasktab${whRole === SUB_ALL ? ' is-active' : ''}`}
                      onClick={() => setWhRole(SUB_ALL)}
                    >
                      全部
                    </button>
                    {SHIP_SUBS.map((s) => (
                      <button
                        key={s.key}
                        role="tab"
                        aria-selected={whRole === s.key}
                        className={`app-tasktab${whRole === s.key ? ' is-active' : ''}`}
                        onClick={() => setWhRole(s.key)}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="app-fleet-row">
                  <span className="app-dim">级别：</span>
                  <div className="app-task-tabs app-fleet-tabs" role="tablist">
                    <button
                      role="tab"
                      aria-selected={whTier === SUB_ALL}
                      className={`app-tasktab${whTier === SUB_ALL ? ' is-active' : ''}`}
                      onClick={() => setWhTier(SUB_ALL)}
                    >
                      全部
                    </button>
                    {SHIP_TIER_SUBS.map((s) => (
                      <button
                        key={s.key}
                        role="tab"
                        aria-selected={whTier === s.key}
                        className={`app-tasktab${whTier === s.key ? ' is-active' : ''}`}
                        onClick={() => setWhTier(s.key)}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
                </div>
                {/* **进入虫洞（放大 · 检索区最右）**：主按钮档位与导航栏「出击」同款观感（`.app-wh-enter`） */}
                <div className="app-wh-prephead-go">
                  <button
                    className="app-btn is-primary app-wh-enter"
                    disabled={!admission.ok || !!run || !!pilotBusy}
                    onClick={handleEnter}
                    title={run ? '已经在虫洞里了' : pilotBusy ? `主控正在${pilotBusy}：先收工` : undefined}
                  >
                    进入虫洞
                  </button>
                  <span className="app-dim">编队 {picked.length} / {WORMHOLE_MAX_SHIPS} 艘</span>
                </div>
              </div>
              <ul className="app-wh-cards">
                {whShown.map(({ uid, name, tier, ok, on, busy, armor, dur }) => {
                  const damaged = armor < 1 || dur < 1
                  const def = ctx.ships.get(state.fleet[uid]!.defId ?? uid)
                  const canPick = ok && !busy
                  const title = !ok
                    ? '该舰过重，会压塌虫洞入口（最多带到 T4）'
                    : busy
                      ? `${busy}：先收工/取消派工，才能编入虫洞`
                      : on
                        ? '再点一下撤下'
                        : '点一下编入'
                  return (
                    <li key={uid}>
                      <button
                        type="button"
                        className={`app-wh-card${on ? ' is-picked' : ''}${canPick ? '' : ' is-locked'}`}
                        disabled={!canPick}
                        onClick={() => togglePick(uid)}
                        title={title}
                      >
                        <span className="app-wh-card-art" aria-hidden>
                          {/* ⚠ 不传 name（见上：会把舰名压在卡片文本上） */}
                          <ShipSprite shipId={state.fleet[uid]!.defId ?? uid} size={132} />
                        </span>
                        <span className="app-wh-card-name">{shipDisplayName(state, ctx, uid)}</span>
                        <span className="app-wh-card-sub">
                          {shipSizeLabel(tier)} · T{tier}
                          {busy ? <span className="app-chip is-dim"> {busy}</span> : null}
                        </span>
                        <span className="app-wh-card-sub">
                          折算质量 {def ? n(wormholeShipMass(def)) : '—'} · 货仓 {n(cargoCapacityM3Of(state, ctx, uid))} m³
                        </span>
                        <span className="app-wh-card-tags">
                          <span className={`app-wh-card-tag${on ? ' is-on' : ''}`}>
                            {on ? '已编入' : !ok ? '过重' : busy ? '占用中' : '编入'}
                          </span>
                          {/* **损伤提示标签**（船长 2026-09-13：「如果舰船有损伤，那么在编入的标签旁新增一个标签
                              提示玩家，防止不小心损坏的船带入虫洞」）：判据与舰队页「待维修」同一把尺
                              （`armorPct < 1 || durability < 1`；护盾不持久、不计损伤）。 */}
                          {damaged ? (
                            <span
                              className="app-wh-card-tag is-warn"
                              title={`该舰带伤（承伤在虫洞内**跨节点保留**）：${armor < 1 ? `装甲 ${Math.round(armor * 100)}%` : ''}${
                                armor < 1 && dur < 1 ? ' · ' : ''
                              }${dur < 1 ? `结构 ${Math.round(dur * 100)}%` : ''}——建议先回站维修或换一艘。`}
                            >
                              带伤{armor < 1 ? ` 甲${Math.round(armor * 100)}%` : ''}
                              {dur < 1 ? ` 构${Math.round(dur * 100)}%` : ''}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>

              <div className="app-bay-title app-wh-sub">三联读数</div>
              <div className="app-wh-triad">
                <span className="app-wh-cell">
                  合计货仓 <b>{n(cargoM3)}</b> m³ ⇒ 背包 <b>{bagSlots}</b> 格
                </span>
                <span className="app-wh-cell">
                  折算总质量 <b>{n(admission.totalMass)}</b> / {n(WORMHOLE_TOTAL_MASS_CAP)}
                </span>
                <span className="app-wh-cell">
                  回合预算 <b>{admission.turnBudget}</b>
                </span>
              </div>
              {!admission.ok ? (
                <div className="app-warn app-wh-gate">{WORMHOLE_ADMISSION_TEXT[admission.code]}</div>
              ) : null}
              {pilotBusy ? (
                <div className="app-warn app-wh-gate">
                  主控正在{pilotBusy}：先把手上的活收工，才能指挥虫洞探索。
                </div>
              ) : null}
              {/* 进入按钮已上移到检索区右侧（船长 2026-09-13），此处不再重复放一个 */}
            </div>
          ) : null}

          {!settle && tab === 'map' && run ? (
            <div className="app-wh-run">
              <div className="app-wh-head">
                <span className="app-wh-cell">第 <b>{run.depth}</b> 层</span>
                <span className="app-wh-cell">
                  已探明 <b>{grid ? grid.visited.length : 0}</b> / {grid ? grid.cells.length : 0} 格
                </span>
                <span className="app-wh-cell">
                  已扫描 <b>{grid ? grid.scanned.length : 0}</b> 格
                </span>
                <span className="app-wh-cell">
                  打捞器 <b>{salvagers}</b> 台
                </span>
                <span className="app-wh-cell">
                  采集器 <b>{miners}</b> 台
                </span>
                <span className="app-wh-cell">回合 <b>{run.turnsLeft}</b> / {run.turnsTotal}</span>
                <span className="app-wh-cell">背包 <b>{usage?.used ?? 0}</b> / {usage?.capacity ?? 0} 格</span>
                <span className="app-wh-cell">本层威胁 <b>{wormholeLayerThreat(run.depth)}</b></span>
              </div>
              {grid && hereCell ? (
                <>
                  <div className="app-wh-mapbox">
                    <WhGridMap
                      grid={grid}
                      onPickCell={pickCell}
                      shipDefId={leadShipDefId}
                      layerKey={`${run.seed ?? 0}-${run.depth}`}
                    />
                  </div>
                  <div className="app-wh-legend">
                    {GRID_LEGEND.map((l) => (
                      <span key={l.key} className="app-wh-legend-item">
                        <svg
                          className={`app-wh-legend-glyph is-${l.done === true ? 'visited' : l.none ? 'unknown' : (l.signal ?? 'blank')}`}
                          viewBox="-13 -13 26 26"
                          aria-hidden="true"
                        >
                          {l.none ? <polygon points="0,-12 10.39,-6 10.39,6 0,12 -10.39,6 -10.39,-6" /> : <WhGlyph signal={l.signal} />}
                          {/* 「去过」那一档把右上角小点也画上（与地图上的标记同源） */}
                          {l.done === true ? <circle className="app-wh-hex-done" cx={6.5} cy={-6.5} r={2.2} /> : null}
                        </svg>
                        {l.text}
                      </span>
                    ))}
                  </div>
                  {pendingCell ? (
                    <div className="app-wh-ask">
                      <span>
                        即将前往<b>未扫描</b>的地点（Q{pendingCell.q} · R{pendingCell.r}）：那里是什么、会不会撞上交火，
                        现在都还不知道。
                      </span>
                      <span className="app-wh-actions">
                        <button
                          className="app-btn is-small is-warn"
                          disabled={!!run.battle || run.turnsLeft < 1}
                          onClick={() => travelTo(pendingCell.q, pendingCell.r, true)}
                        >
                          确认前往（1 回合）
                        </button>
                        <button className="app-btn is-small" onClick={() => setPendingCell(null)}>
                          取消
                        </button>
                      </span>
                    </div>
                  ) : null}
                  {/**
                   * **扫描按钮（放大）在地点信息窗左侧、平级摆放**（船长 2026-09-13）；
                   * 其余动作按钮留在下面那一行，且**只在真能用的时候才出现**
                   * （船长：「有可以采集或者激活的情况时，才显示对应按钮」）——
                   * 不能用时由信息窗里的说明给出原因（比如"编队里没有打捞器"），不再摆一排灰按钮。
                   */}
                  <div className="app-wh-workspace">
                    <button
                      className="app-btn is-primary app-wh-scan-big"
                      disabled={!!run.battle || overloaded || run.turnsLeft < 1}
                      onClick={doScan}
                      title="扫描当前地点及周围一圈：只揭开还没扫过的格（1 回合）"
                    >
                      扫描
                      <span className="app-wh-scan-sub">1 回合 · 揭开周围一圈</span>
                    </button>
                    <div className="app-wh-node">{renderHereNode()}</div>
                  </div>
                  <div className="app-wh-actions">
                    {workCell && canWork ? (
                      <button className="app-btn is-small is-primary" onClick={doActivate} title={workTitle}>
                        {`${veinCell ? '采集' : '打捞'}（1 回合 · 回收 ${Math.min(Math.max(rigs, 0), herePiles.length)} 堆）`}
                      </button>
                    ) : null}
                    {!workCell && canActivate ? (
                      <button
                        className="app-btn is-small is-primary"
                        disabled={!!run.battle || overloaded || run.turnsLeft < 1}
                        onClick={doActivate}
                        title={
                          atExit
                            ? '激活下一层入口：迎战本层守卫（打完才能深入）'
                            : '激活当前地点：按地点类型开战 / 取回谜质（1 回合）'
                        }
                      >
                        {atExit ? '迎战层末守卫（1 回合）' : '激活此地（1 回合）'}
                      </button>
                    ) : null}
                    {bossDone ? (
                      <button
                        className="app-btn is-small is-primary"
                        disabled={!!run.battle || overloaded || run.turnsLeft <= 0}
                        onClick={doDescend}
                        title="带着当前进度深入下一层（更深、更值钱、更硬）"
                      >
                        继续深入（第 {run.depth + 1} 层 · 威胁 {wormholeLayerThreat(run.depth + 1)}）
                      </button>
                    ) : null}
                    <button
                      className="app-btn is-small"
                      disabled={!!run.battle || overloaded}
                      onClick={doExtract}
                      title={
                        run.depth < WORMHOLE_EXTRACT_BATTLE_MIN_DEPTH
                          ? '第 1 层没有拦截舰队：直接脱离、货物入港'
                          : '进入撤离战：拦截舰队会围堵你——打赢才把背包与货柜带回港'
                      }
                    >
                      撤离
                    </button>
                    <span className="app-dim">点格子前往（不限距离 · 1 回合）</span>
                  </div>
                  {run.phase === 'extracting' && !run.battle ? (
                    <div className="app-wh-ask">
                      ⚠ 撤离战：拦截舰队正在围堵你——战斗马上开始，**打赢才把背包与货柜带回去**
                      （打输 = 本趟全损）。
                    </div>
                  ) : null}
                  {overloaded ? (
                    <div className="app-wh-hold-overload">
                      <span>
                        货仓超载（{holdInfo?.used}/{holdInfo?.capacity} 格）：**先抛货**——超载期间不能拾取/打捞，
                        撤离与深入也要先抛到容量内。
                      </span>
                      <button className="app-btn is-small" onClick={() => setTab('bag')}>
                        去货仓页抛货
                      </button>
                    </div>
                  ) : null}
                  {run.phase === 'extracting' && !run.battle ? (
                    <div className="app-wh-ask">
                      ⚠ 撤离战：拦截舰队正在围堵你——战斗马上开始，**打赢才把背包与货柜带回去**
                      （打输 = 本趟全损）。
                    </div>
                  ) : null}
                  {(run.relics ?? []).length > 0 ? (
                    <div className="app-dim app-note">
                      随行战利品（撤离成功后入库）：
                      {(run.relics ?? [])
                        .map(
                          (id) =>
                            ctx.modules.get(id)?.name ??
                            ctx.blueprints.get(id)?.name ??
                            ctx.shipBlueprints.get(id)?.name ??
                            id,
                        )
                        .join('、')}
                    </div>
                  ) : null}
                  {bossDone ? (
                    <div className="app-dim app-note">
                      本层守卫已清：可以「继续深入」（更深、更值钱、更硬），也可以把剩下的地点再扫一遍，或直接撤离。
                    </div>
                  ) : null}
                  {outOfTurns ? (
                    <div className="app-wh-ask">回合已走不动：只能撤离（撤离拦截照打——打赢才算把背包带回去）。</div>
                  ) : null}
                </>
              ) : (
                <div className="app-wh-node">
                  <div className="app-wh-node-title">本层没有网格</div>
                  <div className="app-dim app-note">
                    这一层是旧口径（线性节点）的存档：可以照旧撤离或深入，重新进洞后会拿到网格地图。
                  </div>
                  <div className="app-wh-actions">
                    <button
                      className="app-btn is-small"
                      disabled={!!run.battle || overloaded}
                      onClick={doExtract}
                    >
                      撤离
                    </button>
                    <button
                      className="app-btn is-small is-primary"
                      disabled={!!run.battle || run.turnsLeft <= 0 || !bossDone}
                      onClick={doDescend}
                    >
                      继续深入
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : null}

          {!settle && tab === 'bag' && run ? (
            <WhHold engine={engine} onToast={onToast} />
          ) : null}
        </div>
      </div>
    </div>
  )
}

/**
 * **层内网格地图**（F3a-2 · 船长 2026-09-13：「探索采用网格地图的形式。整体网格地图呈现圆型」）。
 *
 * 画法：尖顶六边形（pointy-top）铺成半径为 `grid.radius` 的**圆盘**；一格 = 一个地点。
 * 三档揭示（`revealOf` 同源）：
 * - **未扫描** = **蓝灰虚线边框**的空hex（船长 F5：「目前未扫描的地点可以通过边框颜色判断」），
 *   点了先弹「前往未知地点」的警告；**未扫描的格不按信号上色**（否则边框颜色就把真相漏了）；
 * - **已扫描** = 只给信号符号（残骸/舰船/资源/雷达；**空信息地点给一个小圆点**）；
 * - **已到达** = 真相（地点名看下方卡片；入口格额外画箭头）。
 *
 * 玩家所在格（船长 2026-09-13 两改）：
 * - **用编队第一艘船的舰影表示**（`ShipSpriteShape`：与舰船资产同源的 SVG 线稿，不再用虚线圈）；
 * - **进入本层淡入**（`is-enter` 动画）、**移动时平移过去**（CSS transform 过渡）——船长：
 *   「玩家的图标用一个淡入的过程表示玩家的进入过程」「移动时候同样需要一个动画表示玩家的移动过程」。
 *
 * ⚠ 视觉纪律：图形一律 SVG 线稿（约定 §九），不用 CSS 拼形状；颜色只给信号类别分色。
 */
function WhGridMap({
  grid,
  onPickCell,
  shipDefId,
  layerKey,
}: {
  grid: WormholeGridState
  onPickCell: (q: number, r: number) => void
  /** 编队第一艘船的 defId（画玩家舰影用；取不到就退化成一个小箭头） */
  shipDefId?: string
  /** 层标识（换了它 = 换了新盘 ⇒ 舰影重挂动画、重新淡入） */
  layerKey: string
}) {
  const size = 30
  const R = Math.max(1, Math.floor(grid.radius))
  // 画布留白按半径算（六边形顶点正好落在边界上会显得挤）；容器高随圈数长一点但有上限
  // ⇒ 每格在屏幕上的边长尽量稳定（R=2 约 60px / R=4 约 46px），避免深层的格子小到点不准。
  const w = Math.sqrt(3) * size * (2 * R + 1.3)
  const h = size * (3 * R + 2.4)
  const mapH = Math.min(420, 150 + 30 * (2 * R + 1))
  const cx = w / 2
  const cy = h / 2
  // 六边形顶点（尖顶：上下各一个顶点、左右是平边）
  const corners = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 180) * (60 * i - 30)
    return { dx: Math.cos(a) * size, dy: Math.sin(a) * size }
  })
  const hereKey = `${grid.pos.q},${grid.pos.r}`
  const exitKey = `${grid.exit.q},${grid.exit.r}`
  /** 玩家舰影的落点（与格子同一套换算；单独算一份给地图最上层那个 `<g>` 用） */
  const hereX = cx + Math.sqrt(3) * size * (grid.pos.q + grid.pos.r / 2)
  const hereY = cy + 1.5 * size * grid.pos.r
  return (
    <svg
      className="app-wh-map"
      style={{ height: `${mapH}px` }}
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={`第 ${grid.radius} 圈网格地图`}
    >
      {grid.cells.map((c) => {
        const x = cx + Math.sqrt(3) * size * (c.q + c.r / 2)
        const y = cy + 1.5 * size * c.r
        const visited = grid.visited.includes(c.key)
        const scanned = grid.scanned.includes(c.key)
        const known = visited || scanned
        const signal = signalOfPlace(c.place)
        // 入口：**到达过**或**被漂浮信标标出来**（船长 2026-09-13 新增信标）⇒ 地图上一直标着
        const isExit = c.key === exitKey && (visited || grid.exitKnown === true)
        /**
         * **清空 / 已激活的地点：删掉地点图标；还有残留东西的：变暗**（船长 2026-09-13）。
         *
         * 判定：
         * - `activated` = 这一格的事已经做完了（舰船信号打完 / 信标读过 / 打捞·采集捞空 / 入口守卫清掉）；
         * - 去过且**堆已空**也算做完（可能没打标：比如只走过一遭的空地点）；
         * - `hasLeftover`（堆非空）= 还有东西没拿 ⇒ **图标留着**，但整格压暗（提示"来过、没拿完"）。
         * ⚠ **下一层入口（`isExit`）不吃这条**：它是导航标记不是地点图标，玩家还要靠它认路。
         */
        const activated = grid.activated.includes(c.key)
        const hasLeftover = (c.piles ?? []).length > 0
        const cleared = activated || (visited && !hasLeftover)
        const iconGone = cleared && !isExit
        const dim = visited && (cleared || hasLeftover)
        const cls = [
          'app-wh-hex',
          visited ? 'is-known' : scanned ? 'is-scanned' : 'is-unknown',
          visited ? 'is-visited' : '',
          dim ? 'is-visited-dim' : '',
          iconGone ? 'is-cleared' : '',
          hasLeftover ? 'is-leftover' : '',
          /**
           * ⚠ **信号分色只给"已扫描/已到达"的格**（船长 F5：「目前未扫描的地点可以通过边框颜色判断」）：
           * 未扫描的格一律走 `.is-unknown` 的**蓝灰虚线边框**；若照旧按 `c.place` 上色，
           * 边框颜色本身就把地点真相漏出去了（"这格是橙色 ⇒ 里面有舰船"）。
           */
          known ? (signal ? `is-${signal}` : 'is-blank') : '',
          c.key === hereKey ? 'is-here' : '',
          isExit ? 'is-exit' : '',
        ]
          .filter((s) => s.length > 0)
          .join(' ')
        const title = !known
          ? '未扫描（蓝灰虚线边框）：不知道这里有什么'
          : isExit
            ? `下一层入口${cleared ? '（守卫已清）' : '（层末守卫守在这里）'}`
            : visited
              ? `${WORMHOLE_PLACE_TEXT[c.place]}（去过${cleared ? ' · 已清空' : ''}）` +
                `${hasLeftover ? ` · 还有 ${(c.piles ?? []).length} 堆没拿` : ''}`
              : signal
                ? `${SIGNAL_TEXT[signal]}（还没到达，详情未知）`
                : '没有信号：空信息地点'
        return (
          <g key={c.key} className={cls} onClick={() => onPickCell(c.q, c.r)}>
            <polygon points={corners.map((p) => `${(x + p.dx).toFixed(2)},${(y + p.dy).toFixed(2)}`).join(' ')} />
            {known && !iconGone ? (
              <g className="app-wh-hex-glyph" transform={`translate(${x.toFixed(2)},${y.toFixed(2)})`}>
                <WhGlyph signal={signal} exit={isExit} />
              </g>
            ) : null}
            {/* **去过标记**：右上角一个小实心点（SVG 线稿；与图例同源） */}
            {visited ? <circle className="app-wh-hex-done" cx={x + size * 0.52} cy={y - size * 0.5} r={2.2} /> : null}
            <title>{title}</title>
          </g>
        )
      })}
      {/**
       * **玩家舰影**（船长 2026-09-13：「当前玩家停留的格子，用玩家舰船队伍里第一艘船的 SVG 图形覆盖表示」）：
       * 单独挂在格子之上（不进上面那圈 `<g>`，免得被格子的透明度/点击态牵连）；
       * `transform` 用**内联 style** 写 ⇒ 换格时由 CSS 过渡**平移过去**（移动动画）；
       * 换层时 `key` 变 ⇒ 重新挂载，重播一次**淡入**（进入动画）。
       */}
      <g
        key={`player-${layerKey}`}
        className="app-wh-ship-here"
        style={{ transform: `translate(${hereX.toFixed(2)}px, ${hereY.toFixed(2)}px)` }}
      >
        {shipDefId ? (
          <ShipSpriteShape shipId={shipDefId} size={size * 1.15} />
        ) : (
          <path className="app-wh-ship-fallback" d="M-6,-4 L7,0 L-6,4 Z" />
        )}
      </g>
    </svg>
  )
}

/**
 * 格内符号（**一律 SVG 线稿**，以格心为原点、半径约 7~8）。
 * `exit` = 下一层入口（箭头）；`signal === null` = 空信息地点（一个小空心点）；
 * `beacon` = 漂浮信标（灯塔塔身 + 两道扫描光）。
 */
function WhGlyph({ signal, exit }: { signal: WormholeSignal | null; exit?: boolean }) {
  if (exit) return <path d="M-7,0 L6,0 M1,-5 L7,0 L1,5" />
  if (signal === 'wreck') return <path d="M-8,3 L-4,-3 L0,2 L4,-4 L8,3" />
  if (signal === 'ship') return <path d="M-7,-5 L8,0 L-7,5 Z" />
  if (signal === 'resource') return <path d="M0,-7 L7,0 L0,7 L-7,0 Z" />
  if (signal === 'radar')
    return (
      <>
        <path d="M-7,4 A7,7 0 0 1 7,4" />
        <path d="M-3.4,4 A3.4,3.4 0 0 1 3.4,4" />
        <circle cx={0} cy={4} r={1.4} />
      </>
    )
  if (signal === 'beacon')
    return (
      <>
        <path d="M-3.6,7 L-1.8,-2 L1.8,-2 L3.6,7 Z" />
        <path d="M-7,-5 L-2.6,-3.4 M7,-5 L2.6,-3.4" />
        <path d="M-1.8,-2 L1.8,-2" />
      </>
    )
  return <circle cx={0} cy={0} r={2.2} />
}

/** 信号名（图例与悬浮提示共用；与 `WORMHOLE_PLACE_TEXT` 分开：信号 ≠ 地点真相） */
const SIGNAL_TEXT: Readonly<Record<WormholeSignal, string>> = {
  wreck: '残骸信号',
  ship: '舰船信号',
  resource: '资源信号',
  radar: '雷达信号',
  beacon: '信标信号',
}

/** 地图图例（与格内符号共用同一个 `WhGlyph` ⇒ 图例与看板永远一致） */
const GRID_LEGEND: ReadonlyArray<{
  key: string
  text: string
  signal: WormholeSignal | null
  none?: boolean
  /** 「去过」那一档：画基线空 hex + 右上角小点 */
  done?: boolean
}> = [
  { key: 'unknown', text: '未扫描（蓝灰虚线边框）', signal: null, none: true },
  { key: 'visited', text: '去过（变暗 + 右上小点；清空的连图标一起去掉）', signal: null, none: true, done: true },
  { key: 'wreck', text: SIGNAL_TEXT.wreck, signal: 'wreck' },
  { key: 'ship', text: SIGNAL_TEXT.ship, signal: 'ship' },
  { key: 'resource', text: SIGNAL_TEXT.resource, signal: 'resource' },
  { key: 'radar', text: SIGNAL_TEXT.radar, signal: 'radar' },
  { key: 'beacon', text: SIGNAL_TEXT.beacon, signal: 'beacon' },
  { key: 'blank', text: '空信息', signal: null },
]

/** 地点说明（看板一处说清"这里有什么/能干什么"；数字口径与 core 常量同源） */
const PLACE_NOTE: Readonly<Record<WormholePlace, string>> = {
  empty: '空信息地点：什么都没有，没有可执行的作业。',
  graveyard: '舰船墓场：走到就铺好普通残骸 3~10 堆（不用激活）、稀有残骸每 3 堆普通判一次——**要打捞器**，每回合回收 = 台数 的堆。',
  ruins: '遗迹：走到就铺好稀有残骸 2~3 堆（不用激活），小概率拿到一次性图纸或专属装备；打捞结束大概率触发一场恶战。',
  ship: '舰船信号：到达即交火；打赢固定获得残骸与稀有残骸。',
  vein: '矿脉：走到这一格就铺好虚空母矿 1~3 堆（**不用激活**）——**要采集器**，每回合回收 = 台数 的堆。',
  matter: '虫洞谜质：取回后，本趟探索中我方所有舰船获得指定增强。',
  beacon: '漂浮信标：到达即读出它标出的下一层入口位置（地图上会一直标着）。',
}
/**
 * **货仓页 = 形状网格**（F4b · 船长 2026-09-13：「类似背包英雄那种需要管理的背包格（没有背包，
 * 货仓直接代表背包大小）」；F5 补一条：「散货也在货仓背包内，并允许玩家拖拽移动」）。
 *
 * 画法（与 core 同一套几何，`wormholeHold`）：
 * - **8 列**、行数 = ⌈可用格数 ÷ 8⌉；超出可用格数的显示位 = **锁定格**（虚线、不可放）；
 * - **一切占格的东西都在 `run.hold.placements` 里**（F5 起散货也是**真摆放件**，不再是画面上临时填的散格）：
 *   **形状件**（遗迹安全货柜 2×2）与**散货条**（一种货一条 1×N 横条，放不下自动改 N×1 竖条）
 *   都按自己的坐标画成整块、**都能拖拽**（落点非法 ⇒ 拒绝并提示）；
 * - 散货条由 core `wormholeHoldSyncCargo` 与 `run.bag` 对齐（数量变了就重放，**先试原位**保住玩家摆好的位置）；
 * - 超载（沉船后格数变小）⇒ 顶部红条 + 「一键抛到容量内」；抛弃**永远手动**（船长裁定 8）。
 */
function WhHold({ engine, onToast }: { engine: GameEngine; onToast: ToastFn }) {
  const state = engine.state
  const ctx = engine.ctx
  const run = state.wormhole.run!
  const info = engine.wormholeHoldInfo()
  const [dragId, setDragId] = useState<string | null>(null)
  const cols = WORMHOLE_HOLD_COLS
  const rows = holdRows(info.capacity, cols)
  const placements = run.hold?.placements ?? []
  const boxes = placements.filter((p) => p.kind === 'box').length
  const cargoBars = placements.length - boxes

  /** 格 → 件（画块用；散货条与货柜共用一张占用表） */
  const ownerOf = new Map<string, (typeof placements)[number]>()
  for (const p of placements) {
    for (const c of placementCells(p)) ownerOf.set(`${c.x},${c.y}`, p)
  }

  function dropAt(x: number, y: number): void {
    if (!dragId) return
    const r = engine.wormholeHoldMove(dragId, x, y)
    if (!r.ok) onToast(r.error ?? '这里放不下。', true)
    setDragId(null)
  }

  return (
    <div className="app-wh-hold">
      <div className="app-bay-title">
        货仓 · 已用 <b>{info.used}</b> / {info.capacity} 格
        {info.overload ? <span className="app-wh-hold-warn"> · 超载</span> : null}
        <span className="app-dim">
          {' '}（散货 {info.cargoCells} 格 + 货柜 {info.shapeCells} 格
          {info.unplacedCells > 0 ? ` + 放不下 ${info.unplacedCells} 格` : ''}）
        </span>
      </div>
      <div className="app-dim app-note">
        每格 {n(WORMHOLE_SLOT_M3)} m³；**货柜**（遗迹安全货柜）占 2×2 整块、**散货**一种一条横条——
        都能拖拽摆放（点一下选中、再点空格也算落位），放不下整件拒收；整理按钮把所有件自动重排。
      </div>
      {info.overload ? (
        <div className="app-wh-hold-overload">
          <span>
            货仓超载：沉船拖走了货舱，现在装不下（{info.used}/{info.capacity} 格）。
            **请手动抛弃货物**——超载期间不能再拾取/打捞，撤离与深入也要先抛到容量内。
          </span>
          <button
            className="app-btn is-small is-warn"
            onClick={() => {
              const r = engine.wormholeDiscardToFit()
              if (!r.ok) onToast(r.error ?? '没有可抛的货。', true)
            }}
          >
            一键抛到容量内（按每格价值从低到高）
          </button>
        </div>
      ) : null}
      <div className="app-wh-hold-grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        {Array.from({ length: rows * cols }, (_, i) => {
          const x = i % cols
          const y = Math.floor(i / cols)
          const key = `${x},${y}`
          const locked = i >= info.capacity
          const p = ownerOf.get(key)
          const isOrigin = p !== undefined && p.x === x && p.y === y
          const def = p ? ctx.items.get(p.itemId) : undefined
          const cls = [
            'app-wh-hold-cell',
            locked ? 'is-locked' : '',
            p ? (p.kind === 'cargo' ? 'is-cargo' : 'is-box') : locked ? '' : 'is-free',
            isOrigin ? 'is-origin' : p ? 'is-body' : '',
            p && p.kind === 'cargo' && !isOrigin ? 'is-cargobody' : '',
            dragId !== null && isOrigin ? 'is-dragging' : '',
          ]
            .filter((s) => s.length > 0)
            .join(' ')
          return (
            <div
              key={key}
              className={cls}
              title={
                locked
                  ? '锁定格：超出货仓容量'
                  : p
                    ? p.kind === 'cargo'
                      ? `${def?.name ?? p.itemId} ×${n(p.units ?? 0)}（散货条：占 ${p.w}×${p.h} 格，可拖拽）`
                      : `${def?.name ?? p.itemId}（货柜：占 ${p.w}×${p.h} 格，可拖拽）`
                    : '空位：可放货柜'
              }
              draggable={isOrigin}
              onDragStart={() => {
                if (isOrigin) setDragId(p!.id)
              }}
              onDragEnd={() => setDragId(null)}
              onDragOver={(e) => {
                if (dragId) e.preventDefault()
              }}
              onDrop={(e) => {
                e.preventDefault()
                dropAt(x, y)
              }}
              onClick={() => {
                if (isOrigin) {
                  // 点一下选中/取消（选中后再点空格也能落位，照顾不方便拖的场景）
                  setDragId((prev) => (prev === p!.id ? null : p!.id))
                } else if (dragId) {
                  dropAt(x, y)
                }
              }}
            >
              {isOrigin && p ? (
                p.kind === 'cargo' ? (
                  <>
                    <span className="app-wh-hold-cargo-name">
                      {def?.name ?? p.itemId} ×{n(p.units ?? 0)}
                    </span>
                    <span className="app-wh-hold-box-size">
                      {p.w}×{p.h} 格
                    </span>
                  </>
                ) : (
                  <>
                    <span className="app-wh-hold-box-name">{def?.name ?? p.itemId}</span>
                    <span className="app-wh-hold-box-size">
                      {p.w}×{p.h}
                    </span>
                  </>
                )
              ) : null}
            </div>
          )
        })}
      </div>
      <div className="app-wh-actions">
        <button
          className="app-btn is-small"
          disabled={placements.length === 0}
          onClick={() => {
            const r = engine.wormholeHoldCompact()
            if (!r.ok) onToast(r.error ?? '无法整理。', true)
          }}
        >
          整理（自动重排）
        </button>
        <span className="app-dim">
          {boxes} 件货柜 + {cargoBars} 条散货 · 拖拽摆放（也可点选中后再点空位）
        </span>
      </div>
      {/* 货柜清单（形状件：位置读数 + 抛弃；散货条在下面的散货清单里按"类"处理） */}
      <div className="app-bay-title">货柜 · {boxes} 件</div>
      {boxes === 0 ? (
        <div className="app-dim app-inv-empty">没有货柜：遗迹打捞出来的安全货柜才会占这种整块格子。</div>
      ) : (
        <ul className="app-inv-list">
          {placements
            .filter((p) => p.kind === 'box')
            .map((p) => (
              <li key={p.id} className="app-inv-row">
                <div className="app-inv-main">
                  <span className="app-inv-name">{ctx.items.get(p.itemId)?.name ?? p.itemId}</span>
                  <span className="app-inv-count">
                    {p.w}×{p.h} 格 · 位置 第 {p.y + 1} 行第 {p.x + 1} 列
                  </span>
                </div>
                <div className="app-inv-btns">
                  <button
                    className="app-btn is-small is-warn"
                    onClick={() => {
                      const r = engine.wormholeDiscardHold(p.id)
                      if (!r.ok) onToast(r.error ?? '抛弃失败。', true)
                    }}
                  >
                    抛弃
                  </button>
                </div>
              </li>
            ))}
        </ul>
      )}
      {/* 散货清单（可叠加的那些；抛弃按"整条"给，省得点两次） */}
      <div className="app-bay-title">散货 · {run.bag.length} 类</div>
      {run.bag.length === 0 ? (
        <div className="app-dim app-inv-empty">没有散货：去矿脉挖原矿、去墓场/遗迹打捞残骸。</div>
      ) : (
        <ul className="app-inv-list">
          {run.bag.map((s) => {
            const def = ctx.items.get(s.itemId)
            const per = wormholeUnitsPerSlot(def?.unitM3 ?? 0)
            const cells = Math.ceil(s.units / Math.max(1, per))
            return (
              <li key={s.itemId} className="app-inv-row">
                <div className="app-inv-main">
                  <span className="app-inv-name">
                    {def?.name ?? s.itemId} ×{n(s.units)}
                  </span>
                  <span className="app-inv-count">
                    {n(s.units * (def?.unitM3 ?? 0))} m³ · 占 {cells} 格 · 每格 {n(per)} 单位
                  </span>
                </div>
                <div className="app-inv-btns">
                  <button
                    className="app-btn is-small is-warn"
                    onClick={() => {
                      const r = engine.wormholeDiscardCargo(s.itemId)
                      if (!r.ok) onToast(r.error ?? '抛弃失败。', true)
                    }}
                  >
                    抛弃
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
