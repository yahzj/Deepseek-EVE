/**
 * M3 远征中心：势力声望、星图（SVG）、悬赏任务卡。
 * 中列面板：SkirmishStatus（远征中作业）→ StarMap（可点选）→ Standing → 任务列表。
 */
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode, RefObject } from 'react'
import type { AnomalyDef, GalaxyDef, AiCoreType, SimContext, SideTask, SideTaskBoardView } from '@whale/core'
// 2026-09-23 船长令：使用 AI 核心时默认选「当前拥有的最高级核心」
import { bestAiCoreOf } from '@whale/core'
import {
  DSI_FACTION_ID,
  HOME_GALAXY_ID,
  LAIR_RARE_WRECK_GAIN,
  lairLevelOf,
  scanWindowMsFor,
  aiCoreName,
  bountyDamageForecast,
  bountyWinPercentGuarded,
  bountyCooldownRemainingMs,
  bountyRewardFactor,
  calcPower,
  // 2026-09-25 入侵旗舰入口（星系详细里那一行）：族名全称走 core 的同一张表（别在本文件另写一份）
  weekendFamilyNameId,
  beaconTargetBlocked,
  /* 信号发射器（2026-09-30 船长令）：持有量 + 指定星系的资格判据 + 位置限制（有空间站的地方不能启动） */
  INVASION_BEACON_ITEM_ID,
  HIGH_SEC_PENALTY,
  beaconLaunchHighSecOf,
  consumableStockOf,
  isAtHomeLike,
  playerGalaxyIdOf,
  weekendProgressAt,
  weekendCoreGateView,
  /** 旗舰视图（2026-09-25：核心的"旗舰期红光"与旗舰准备入口读同一份判据，不许在本文件另判一遍） */
  weekendFlagshipView,
  weekendFoePoolOf,
  /** 2026-09-26：旗舰入口的编成一览取本族**旗舰卡** id（与开战 `weekendFlagshipSpecOf` 同源） */
  weekendFoeCardOf,
  /** 2026-09-25 船长令：核心节点上方那根**母舰血量条**（读数与事件日志那条同源） */
  weekendBossPoolView,
  cargoCapacityM3Of,
  cargoUsedM3Of,
  /** 2026-10-02 模块化：可用核心列表走 core 单点（原为本页 AI_CORE_ORDER.filter 一处） */
  usableAiCoresOf,
  expeditionStatus,
  fleetDefOf,
  foeLayerSplit,
  frontierGalaxyIds,
  idleAiShipIds,
  isExplored,
  isFactionBounty,
  isLairCandidate,
  factionAnomalyOf,
  factionBaseRewardIsk,
  factionGalaxyId,
  /** 2026-09-24：卡面掉落率**随档位现算**（含限时倍率与铁人 ×1.2）——不再印裸常量 */
  factionRareDropChanceOf,
  FACTION_RARE_DROP_COUNT,
  lairAnomalyOf,
  lairBaseRewardIsk,
  nearestStationGalaxyId,
  originGalaxyOf,
  scanStatus,
  shipDisplayName,
  autoLoopReopenBlockReason,
  wreckDensityOf,
  weekendWreckDensityOf,
  // 2026-09-26 玩家舰船残骸（船长令）：该星系残留的舰船残骸读数卡（船名 + 可回收件数 + 倒计时）
  shipWrecksOf,
  wreckLootRowsOf,
  SHIP_WRECK_DECAY_MS,
  weekendOccupiedLiveAt,
  shortestTravelMinutes,
  standingOf,
  /** 声望**可支配**余额（＝累计 − 已花）——声望商店子页标题行那两本账走它（与弹层同一口径） */
  spendableStandingOf,
  travelLegMs,
  travelMinutesEff,
  playerAtSite,
  tierNeedOf,
  billNeedOf,
  stationBillView,
  transitStatus,
  /** 主控活动判据（2026-09-22：建站交付的按钮门槛与 core 同源——见 `tripReadyDock` 那段注释） */
  mainActivityOf,
  RARE_WRECK_VOLUME_M3,
  RETURN_LEG_MUL,
  /** 快递板周期（120 分钟，2026-09-24 船长令）——快递页的倒计时与"每 N 分钟一轮"都按它算 */
  COURIER_BOARD_PERIOD_MS,
} from '@whale/core'
import { Panel, ProgressBar } from '@whale/ui'
import type { GameEngine } from '../game/engine'
import { MONEY_GLYPH, rareWreckRefsOf } from '../pages/common'
import { tr, useL10n, cmdText, isEn } from '../i18n/locale'
import type { ToastFn } from '../pages/common'
import { DmgChip, FoeDamageMix, ProfileChip } from '../ui/shipInfo'
import { FirstTasks } from './FirstTasks'
// 2026-09-26 船长令「入侵的悬赏卡片在常驻悬赏里置顶」：排序比较器抽成纯函数（可被工具/用例直接断言）
import { bountyComparatorOf } from './bountySort'
import { MilestoneTasks } from './MilestoneTasks'
import { ImportantTasks } from './ImportantTasks'
/**
 * **声望商店内容体**（**2026-09-27 船长令**：「我打算将声望商店嵌入常驻悬赏内，作为子页面的存在」）——
 * 与旧弹层 `PlugExchangeModal` **同一份实现**（兑换命令、卡面、确认层全在那边，这里只当容器）。
 */
import { PlugExchangeBody } from './PlugExchange'
import { Glyph, NAV_TONES, ICO_TONES, itemGlyphName } from '../ui/Glyphs'
import { BeaconHighSecPrompt } from '../ui/beaconPrompt'
import { UI_TONES } from '../ui/tones'
import { WeekendFlagshipPrepModal } from './WeekendFlagshipPrep'
import { FOE_ACCENT, FOE_FAMILY_LABEL, foeFamilyOf } from '../ui/shipArt'
import { briefsOfPool, briefShipsOf, mountLabelText } from '../ui/foeBrief'
import type { FoeBriefLine } from '../ui/foeBrief'
import { hoverTipProps } from '../ui/Tooltip'
import { sessionPick, setSessionPick, useSessionScroll } from '../ui/sessionView'
import { foeCardShipIdOf as coreFoeCardShipIdOf } from '@whale/core'
import { ShipSprite } from '../ui/ShipSprite'
// ⚠ 舰船角色名走本地化单点（2026-09-26 船长报障「舰船类型文本漏中文」）——core 的 shipRoleLabel 是纯中文表
import { aiCoreText, lairTierText, shipRoleText } from '../ui/labelsText'
import { fmtDayClock, fmtDuration, fmtSideClock } from '../i18n/fmt'
// 星图域（2026-10-02 批次 4p 拆到 StarMap.tsx；本文件借回使用）
import { FoeArt, FOE_TACTIC_HINTS, FoeBriefTip, foeCardShipIdOf, secCls, secText, secTone, StarMap, useFoeArtFit } from './StarMap'

/** 星图页「星图·远征」标签内容：声望条 + 扫描/远征作业 + 星图 */
export function ExpeditionPanel({
  engine,
  onToast,
  onOpenWormhole,
}: {
  engine: GameEngine
  onToast: ToastFn
  /** 开虫洞面板（面板本体挂在 App 那一层；见 GalaxyActions 里的入口行） */
  onOpenWormhole?: () => void
}) {
  const state = engine.state
  const view = expeditionStatus(state, engine.ctx)
  const scan = scanStatus(state)
  const tv = transitStatus(state, engine.ctx)

  return (
    <Panel
      className="is-fill app-exp-panel"
      title={tr("ui.Expedition.187")}
      /**
       * ⚠ **本面板标题行右侧原先挂着「声望 N」**（`app-standing` 那枚芯片）——
       * **2026-09-29 船长令**：「在钱包的右侧，新增一个容器显示玩家的声望，**移除其他地方显示的声望**」
       * ⇒ 顶栏那枚容器成为声望的**唯一常显点**，这里撤掉（面板标题只留名字）。
       * 阈值类读数（"还差多少声望""需要声望 N"）是**门槛提示**、不是"显示声望"，照旧保留。
       */
    >
      {/* T1：远征作业状态与停止入口已收敛到顶部活动窗口；**星系扫描不再占主控**（船长 2026-09-15）
          ⇒ 顶部没有它的"玩家活动"行了，这里补一条读数 + 「终止扫描」（扫描艇只有一艘，要换目标得先召回） */}
      {scan.active || view.active || state.transit.active ? (
        <div className="app-dim app-exp-idle">
          {state.transit.active
            ? (
              <>
                <span className="app-ico">
                  <Glyph name="ico-home" size={12} color={ICO_TONES['ico-home']} />
                </span>
                {tv.trip === 'deliver-to-site' || tv.trip === 'deliver-to-station'
                  ? tr("ui.Expedition.126", { p1: tv.siteName ?? '', p2: fmtDuration(Math.max(0, state.transit.finishAtGameMs - state.gameMs)) })
                  : tr("ui.Expedition.244", { p1: fmtDuration(Math.max(0, state.transit.finishAtGameMs - state.gameMs)) })}
              </>
            )
            : ''}
          {state.transit.active && (scan.active || view.active) ? ' ｜ ' : ''}
          {scan.active ? (
            <>
              <span className="app-ico">
                <Glyph name="ico-scan" size={12} color={ICO_TONES['ico-scan']} />
              </span>
              {tr("ui.Expedition.127", { p1: fmtDuration(scan.remainingMs) })}
              <button
                className="app-btn is-small is-warn"
                style={{ marginLeft: 'var(--wui-sp-6)' }}
                title={tr("ui.Expedition.069")}
                onClick={() => {
                  const r = engine.stopScanNow()
                  if (!r.ok) onToast(cmdText(r) || tr('ui.Expedition.378'), true)
                  else onToast(tr("ui.Expedition.070"))
                }}
              >
                {tr("ui.Expedition.245")}
              </button>
            </>
          ) : (
            ''
          )}
          {scan.active && view.active ? ' ｜ ' : ''}
          {view.active
            ? view.phase === 'combat'
              ? (
                <>
                  <span className="app-ico">
                    <Glyph name="nav-bounty" size={13} color={NAV_TONES['nav-bounty']} />
                  </span>
                  {tr("ui.Expedition.071")}{view.anomalyName}{tr('ui.Expedition.379')} {view.power} {tr("ui.Expedition.008")} {view.threat}{tr("ui.Expedition.009")}
                </>
              )
              : tr("ui.Expedition.010", { p1: view.anomalyName, p2: view.galaxyName, p3: view.phaseLabel, p4: fmtDuration(view.remainingMs) })
            : ''}
        </div>
      ) : state.dockedSite !== null ? (
        <div className="app-dim app-exp-idle">
          {tr("ui.Expedition.011")}{engine.ctx.stations.get(state.dockedSite)?.name ?? state.dockedSite}{tr("ui.Expedition.012")}
        </div>
      ) : state.awayGalaxy !== null ? (
        /* 2026-09-06：野外停留来源 = 掩护巡逻驻留（悬赏胜利/扫描完成已改为自动返航，不再停留）——远征/扫描/采矿均可即时出发，或显式返航 */
        <div className="app-exp-idle app-idle-field">
          <span>
            <span className="app-ico">
              <Glyph name="ico-flag" size={13} color={ICO_TONES['ico-flag']} />
            </span>
            {tr("ui.Expedition.246")}{engine.ctx.galaxies.get(state.awayGalaxy)?.name ?? state.awayGalaxy}{tr('ui.Expedition.380')}
          </span>
          <button
            className="app-btn is-small"
            title={tr("ui.Expedition.188")}
            onClick={() => {
              const r = engine.flyHomeNow()
              if (!r.ok) onToast(cmdText(r) || tr('ui.Expedition.381'), true)
            }}
          >
            <span className="app-ico">
              <Glyph name="ico-home" size={13} color={ICO_TONES['ico-home']} />
            </span>
            {tr("ui.Expedition.247")}
          </button>
        </div>
      ) : (
        <div className="app-dim app-exp-idle">
          {tr("ui.Expedition.013")}
        </div>
      )}
      <StarMap engine={engine} onToast={onToast} onOpenWormhole={onOpenWormhole} />
    </Panel>
  )
}

/** 星图页「任务中心」标签内容：统一任务目录（T10）。
 * - 任务族：当前 = 悬赏（22 张，完整沿用其机制）；建站/引导等族随后续内容加入同一框架；
 * - 悬赏页排序（2026-09-09 船长拍板，BountyPanel 用）：危险（默认 = 目标星系安全等级 sec 降序、
 *   安全在前）/ 距离 / 星系 / 奖励 / 声望——旧「默认（可接取优先）」退役；选择存本地。
 */
type TaskSort = 'danger' | 'distance' | 'galaxy' | 'reward' | 'standing'
const TASK_SORT_KEY = 'whale-idle:task-sort'
const TASK_SORT_LABEL: Record<TaskSort, string> = {
  danger: tr("ui.MapPage.008"),
  distance: tr("ui.Expedition.248"),
  galaxy: tr("ui.MapPage.009"),
  reward: tr("ui.Expedition.072"),
  standing: tr("ui.Expedition.073"),
}

/* 选项卡分类（船长优化）：重要 / 资源（建站） / 快递——任务可属于多类（如建站=重要+资源） */
/* 注：常驻悬赏已从任务中心抽出，独立成出港「常驻悬赏」标签（见 BountyPanel，船长 2026-09-05）；
 * 2026-09-10 船长定：任务中心设「赏金任务」子页——限时高难窝点目标，与常驻悬赏区分 */
/* 2026-09-09：长途运输已从任务中心独立为星图「长途运输」标签（残骸打捞之后，见 HaulingPanel；建成副站解锁） */
type TaskTabKey = 'important' | 'milestone' | 'resource' | 'courier' | 'bounty'
const TASK_TABS: Array<{ key: TaskTabKey; label: string }> = [
  { key: 'important', label: tr("ui.Expedition.302") },
  /* 2026-09-20 船长（玩家反馈）：完成「第一次」后的里程碑（次数）链单开一页装 */
  { key: 'milestone', label: tr('ui.Expedition.424') },
  { key: 'resource', label: tr("ui.Expedition.249") },
  { key: 'courier', label: tr("ui.Expedition.128") },
  { key: 'bounty', label: tr("ui.Expedition.250") },
]
/**
 * 任务中心内层标签的记忆键 —— **2026-09-26 船长令改会话制**。
 *
 * 沿革：原先是 `whale-idle:task-tab`（**localStorage ⇒ 跨启动也记得**）；船长 2026-09-26 令
 * 「舰船、技能、工业、任务中心、通讯」五页统一「**本次游戏启动期间记忆，不入存档**」
 * 并在集中提问中裁定「**改成会话制，与新规矩统一**」⇒ 换成 `ui/sessionView.ts` 的会话存储。
 * ⚠ 老键（localStorage）从此**不再读写**：新规矩下"这次开 App 里选过的签"才有意义，
 * 重置档案/换档也不该被上一局的页面状态影响。
 */
const TASK_TAB_SESSION_KEY = 'task.tab'
const TASK_TAB_VALUES: readonly string[] = ['important', 'milestone', 'resource', 'courier', 'bounty']

/* ── 时效任务板（资源 / 快递）的排序（船长 2026-09-19 追加）─────────────────────────
 * 两档：**默认排序（从低到高）** = 按任务级别 L1→L5；**价值排序（从高到低）** = 按奖励。
 * 只在「资源任务 / 快递任务」两个子页渲染（重要/赏金没有 L1~L5）；键存本地、与悬赏排序同家族。
 * ⚠ 两档的**文案在组件内用 `t(...)` 取**（2026-09-19 双语规矩：新增可见文案必须双语，
 *   而语言可在运行时切换 ⇒ 不能在模块级求值）。 */
type SideTaskSort = 'level' | 'value'
const SIDE_TASK_SORT_KEY = 'whale-idle:sidetask-sort'

export function TaskPanel({
  engine,
  onToast,
  focusTab = null,
  onOpenComms,
  onJump,
}: {
  engine: GameEngine
  onToast: ToastFn
  /** 外部定位请求（2026-09-11 船长：跳转任务中心要切到「重要任务」；seq 变化即应用） */
  focusTab?: { tab: string; seq: number } | null
  /** 「第一次」卡片的「看情报」（App 层定位到那封情报信） */
  onOpenComms?: (messageId: string) => void
  /** 「第一次」卡片的跳转按钮（App 层切页面/页签，自带解锁闸门） */
  onJump?: (t: { page: string; mapTab?: string; shipTab?: string; industrySec?: 'refine' | 'shelf' | 'craft' | 'shipyard' }) => void
}) {
  const [tab, setTab] = useState<TaskTabKey>(() => {
    // 会话级记忆（2026-09-26 船长令）；旧 localStorage 存过 'hauling'（运输任务已独立为星图
    // 「长途运输」标签）——那条历史判别随老键一并退役，认不出的值一律回退「重要任务」
    const v = sessionPick(TASK_TAB_SESSION_KEY)
    return v !== null && TASK_TAB_VALUES.includes(v) ? (v as TaskTabKey) : 'important'
  })
  // 外部定位：本页内层标签会被记住，光切到星图「任务中心」不够——按请求切到指定内层标签
  const lastFocusSeq = useRef(-1)
  useEffect(() => {
    const req = focusTab
    if (!req || req.seq === lastFocusSeq.current) return
    lastFocusSeq.current = req.seq
    if (TASK_TAB_VALUES.includes(req.tab)) {
      setTab(req.tab as TaskTabKey)
      setSessionPick(TASK_TAB_SESSION_KEY, req.tab)
    }
  }, [focusTab?.seq])

  /**
   * **任务列表滚动位置 · 会话级记忆**（2026-09-26 船长令，只做"主列表那一条"）。
   * 滚动体 = 本面板的内滚体 `.app-win-body`（`overflow-y:auto`）⇒ 直接接，不必反查。
   * ⚠ `listRef`（下面那支）是**量列宽**用的（`useFoeArtFit`），与本记忆无关、各自独立。
   */
  const taskScrollRef = useRef<HTMLDivElement | null>(null)
  useSessionScroll('task.list.scroll', taskScrollRef)

  // 建站任务初期不出现：只有“抵达/探索过”该星系后才解锁（船长 2026-09-05 拍板）
  const state = engine.state
  const visStationIds = [...engine.ctx.stations.values()]
    .filter((site) => {
      const g = engine.ctx.galaxies.get(site.galaxyId)
      return !!g && isExplored(state, g.id)
    })
    .map((site) => site.id)
  const stationCount = visStationIds.length
  // 已完成（建成）的副站不再占位（船长 2026-09-10：已完成的重要任务一律隐藏）
  const unbuiltStationIds = visStationIds.filter((id) => {
    const site = engine.ctx.stations.get(id)
    const prog = state.stationSites[id]
    return !!site && (prog?.stage ?? 0) < site.tiers.length
  })

  function changeTab(next: TaskTabKey): void {
    setTab(next)
    // 会话级记忆（2026-09-26 船长令）：切走再回来仍是这一签
    setSessionPick(TASK_TAB_SESSION_KEY, next)
  }

  return (
    <Panel
      className="is-fill win-fixed-body"
      title={tr("ui.App.008")}
      right={<span className="app-dim">{tr("ui.Expedition.129")} {stationCount}{tr('ui.Expedition.365')}</span>}
    >
      {/* 子标签固定（固定头+下滚）：重要/资源/快递/赏金任务 常显，下方任务内容独立内滚 */}
      <div className="app-task-tabs" role="tablist">
        {TASK_TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className={`app-tasktab${tab === t.key ? ' is-active' : ''}`}
            onClick={() => changeTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="app-win-body" ref={taskScrollRef}>
      {tab === 'important' ? (
        <div>
          {/* 2026-09-17 教程重做：重要任务＝「第一次」系列；**2026-09-20 起顺序解锁、一次只出一条**
              （玩家反馈"一次性太多"），完成后的里程碑（次数）链搬到「里程碑任务」页。
              2026-09-20 第三道令：「寻找人类」**置于顶部**（完成第 11 条后它与末段两条一起显示）
              ⇒ `ImportantTasks`（贯穿任务卡）画在「第一次」列表**之上** */}
          <ImportantTasks engine={engine} />
          <FirstTasks engine={engine} onToast={onToast} onOpenComms={onOpenComms} onJump={onJump} />
          {stationCount > 0 && unbuiltStationIds.length > 0 ? (
            <>
              <div className="app-dim app-exp-idle">{tr("ui.Expedition.303")}</div>
              <div className="app-station-list">
                <StationCard engine={engine} onToast={onToast} siteIds={unbuiltStationIds} />
              </div>
            </>
          ) : stationCount > 0 ? (
            // 已建成的副站卡不再占位（船长 2026-09-10：已完成的重要任务一律隐藏）
            <div className="app-dim app-exp-idle">{tr("ui.Expedition.074")}</div>
          ) : (
            <div className="app-dim app-exp-idle">{tr("ui.Expedition.189")}</div>
          )}
        </div>
      ) : tab === 'milestone' ? (
        /* 2026-09-20 船长（玩家反馈）：里程碑（次数）链单开一页；恒显，一条都没解锁时页内给提示 */
        <div>
          <MilestoneTasks engine={engine} onToast={onToast} />
        </div>
      ) : tab === 'resource' ? (
        <div>
          {/* v24：资源时效任务（每 20 分钟补给周期整板刷新，仓库足量交付即结；原 StationCard 建站内容保留在下方） */}
          <SideTasksArea engine={engine} onToast={onToast} kind="resource" />
          {stationCount > 0 && unbuiltStationIds.length > 0 ? (
            <>
              <div className="app-task-family">{tr("ui.Expedition.130")}</div>
              <div className="app-station-list">
                <StationCard engine={engine} onToast={onToast} siteIds={unbuiltStationIds} />
              </div>
            </>
          ) : stationCount > 0 ? (
            <div className="app-dim app-exp-idle">{tr("ui.Expedition.074")}</div>
          ) : (
            <div className="app-dim app-exp-idle">{tr("ui.Expedition.189")}</div>
          )}
        </div>
      ) : tab === 'courier' ? (
        <div>
          {/* v24：快递时效任务（建成任一副空间站后解锁；未解锁时给建设提示） */}
          <SideTasksArea engine={engine} onToast={onToast} kind="courier" />
        </div>
      ) : tab === 'bounty' ? (
        <div>
          {/* 2026-09-10：赏金任务——限时高难「敌人窝点」目标，与资源/快递同周期整板刷新 */}
          <BountyTasksArea engine={engine} onToast={onToast} />
        </div>
      ) : null}
      </div>
    </Panel>
  )
}

/* ─────────── 常驻悬赏（船长 2026-09-05：从「任务中心」抽出，独立成出港顶级标签——悬赏卡列表；
 * 2026-09-10 船长定：改称「常驻悬赏」——与任务中心的「赏金任务」（临时战斗任务）区分）
 *
 * **2026-09-27 船长令**：「**我打算将声望商店嵌入常驻悬赏内，作为子页面的存在，类似扫描虫洞
 * 页面内的虫洞探索和谜质科技**」⇒ 本面板加**两个子页**：`bounty`（默认，老内容一字不动）与
 * `shop`（声望商店 = `PlugExchangeBody`）。
 *
 * 结构照抄 `panels/WormholeScan.tsx` 那一套（船长点名的先例）：
 * `.app-subtabs` 两枚按钮 ＋ `.app-subpage is-hidden` 包住非当前子页；
 * 子页切换**不落档**（会话内存，与虫洞那两个子页同款）。
 * 切换信号由 `App` → `MapPage` → 本组件的 `focusShopSeq` 传入（"定位信号"手法与 `craftFocus` 同款）：
 * 通讯弹窗/通讯页/组装机三处入口一律 **切到星图页 · 常驻悬赏 · 声望商店**（不再弹窗）。
 * ─────────── */
export function BountyPanel({
  engine,
  onToast,
  focusShopSeq = 0,
}: {
  engine: GameEngine
  onToast: ToastFn
  /** **声望商店定位信号**（每次 +1）：变化即切到 `shop` 子页（与 `craftFocus` 同款的一次性信号） */
  focusShopSeq?: number
}) {
  const state = engine.state
  /** 子页（`bounty` = 悬赏板 / `shop` = 声望商店）；默认悬赏板 = 老行为 */
  const [sec, setSec] = useState<'bounty' | 'shop'>('bounty')
  /**
   * ⚠ 依赖只认 `focusShopSeq`：**首帧不切**（`seq` 初值 0 与"没请求"同貌）⇒ 进页面默认看悬赏板；
   * 有请求（≥1）就落 `shop`。这样"点入口跳过来"与"自己点进来"两种情形不会互相踩。
   */
  useEffect(() => {
    if (focusShopSeq > 0) setSec('shop')
  }, [focusShopSeq])
  const [sort, setSort] = useState<TaskSort>(() => {
    try {
      const v = localStorage.getItem(TASK_SORT_KEY)
      // 旧存值 'default'（可接取优先，已退役）一律按新默认 'danger' 读取
      return v === 'danger' || v === 'distance' || v === 'galaxy' || v === 'reward' || v === 'standing' ? v : 'danger'
    } catch {
      return 'danger'
    }
  })

  function changeSort(next: TaskSort): void {
    setSort(next)
    try {
      localStorage.setItem(TASK_SORT_KEY, next)
    } catch {
      // 忽略
    }
  }

  // —— 舰影列自适应（同舰队页：容器实测宽驱动，过窄整列不渲染、不留空位）——
  // 量在列表容器上（.app-ano-list 宽度 = 面板内容宽，已扣面板体滚动条）。
  const listRef = useRef<HTMLDivElement | null>(null)
  const showFoeArt = useFoeArtFit(listRef)

  // —— 未探索星系的悬赏卡**不再列出**（2026-09-13 船长：「将未探索的悬赏卡隐藏。」）——
  // 同日**作废** V13 旧口径「悬赏情报例外：列表照常可见」（见 docs/design/v13-exploration.md §四）；
  // 星图上的 ⚔N 悬赏情报徽标与剪影窗口的「悬赏情报 N 处」**照旧**（那是协会共享情报，不是卡面）。
  // 判定口径与卡内 `unexplored` 逐字同式：星系条目缺失（脏数据）不隐藏，按现状照常显示。
  // ⚠ **2026-09-28 船长令**：「入侵期间，赏金任务照常发放（只有势力活跃关闭）」⇒ 原先那条
  // 「已收复的占领星系把常驻悬赏押后到活动结束」的过滤（`weekendStandingBountyHeldAt`）**已删除**：
  // 这里不再按入侵状态过滤，收复后照常列悬赏；入侵期间关掉的只有「敌对派系活跃」。
  const listed = engine.anomalies.filter((a) => {
    const g = engine.ctx.galaxies.get(a.galaxyId)
    return g ? isExplored(state, g.id) : true
  })

  // —— 悬赏任务排序（2026-09-09：默认 = 危险 = 目标星系安全等级 sec 降序、安全在前；次级均按名称） ——
  //     ⚠ 比较器本体在 `./bountySort`（纯函数：2026-09-26 加"入侵卡置顶"后，置顶这条要能被工具断言）
  const galaxySecOf = (a: AnomalyDef): number => engine.ctx.galaxies.get(a.galaxyId)?.security ?? 1
  const items = listed.map((a) => {
    const galaxy = engine.ctx.galaxies.get(a.galaxyId)
    const mins = shortestTravelMinutes(engine.ctx, originGalaxyOf(state, engine.ctx), a.galaxyId)
    return {
      a,
      /** 排序键需要的字段（与 `bountySort.BountySortRow` **同名列** ⇒ 比较器可直接吃这一行） */
      id: a.id,
      name: a.name,
      security: galaxySecOf(a),
      galaxyName: galaxy?.name ?? a.galaxyId,
      dist: Number.isFinite(mins) ? mins : Number.POSITIVE_INFINITY,
      rewardIsk: a.rewardIsk,
      standingGain: a.standingGain,
    }
  })
  /**
   * **入侵的悬赏卡置顶**（**2026-09-26 船长令**：「**入侵的悬赏卡片在常驻悬赏里置顶。**」）。
   *
   * 判据 = `weekendOccupiedLiveAt`（**仍被占**才算；与"赏金栏改显结算口径"、星系详细那行入侵框
   * 同一把尺 ⇒ 三处不会各说各话）。已夺回的星系不算 —— 它的常驻悬赏本来就还在隐藏状态，
   * 不占板面、也无需置顶。
   *
   * 比较器本体抽到 `./bountySort`（纯函数 ⇒ 工具/用例可直接断言"置顶恒成立"）。
   */
  const pinnedIds = new Set(listed.filter((a) => weekendOccupiedLiveAt(state, a.galaxyId, Date.now())).map((a) => a.id))
  const sorted = [...items].sort(
    bountyComparatorOf(sort, pinnedIds),
  )

  return (
    <Panel
      className="is-fill"
      title={tr("ui.MapPage.004")}
      /* 标题行右侧随子页换口径：悬赏板报"N 处"，商店报**两本声望账**（可支配/累计获得） */
      right={
        sec === 'shop' ? (
          <span className="app-dim">
            {tr("ui.IndustryPage.119", { p1: spendableStandingOf(state, DSI_FACTION_ID), p2: standingOf(state, DSI_FACTION_ID) })}
          </span>
        ) : (
          <span className="app-dim">{tr("ui.Expedition.131")} {listed.length} {tr("ui.Expedition.132")}</span>
        )
      }
    >
      {/* **子页标签**（船长 2026-09-27 令）：常驻悬赏（老内容）/ 声望商店（章鱼人兑换）——
          结构与 `.app-subtabs` 写法照抄 `panels/WormholeScan.tsx` 那两个子页。 */}
      <div className="app-subtabs" role="tablist">
        <button
          role="tab"
          aria-selected={sec === 'bounty'}
          className={`app-subtab${sec === 'bounty' ? ' is-active' : ''}`}
          onClick={() => setSec('bounty')}
        >
          {tr("ui.MapPage.004")}
        </button>
        <button
          role="tab"
          aria-selected={sec === 'shop'}
          className={`app-subtab${sec === 'shop' ? ' is-active' : ''}`}
          onClick={() => setSec('shop')}
        >
          {tr("ui.Expedition.446")}
        </button>
      </div>
      {sec === 'shop' ? <PlugExchangeBody engine={engine} onToast={onToast} /> : null}
      {/* ───── 以下 = 「常驻悬赏」子页（原内容，一字未动） ───── */}
      <div className={`app-subpage${sec === 'bounty' ? '' : ' is-hidden'}`}>
      <div className="app-task-sortrow">
        <span className="app-dim">{tr("ui.Expedition.133")}</span>
        <select className="app-select" value={sort} onChange={(e) => changeSort(e.target.value as TaskSort)}>
          {(Object.keys(TASK_SORT_LABEL) as TaskSort[]).map((k) => (
            <option key={k} value={k}>
              {TASK_SORT_LABEL[k]}
            </option>
          ))}
        </select>
      </div>
      <div className="app-ano-list" ref={listRef}>
        {sorted.length === 0 ? (
          <div className="app-dim app-exp-idle">
            {tr("ui.Expedition.134")}
          </div>
        ) : null}
        {sorted.map((item) => (
          <AnomalyCard key={item.a.id} engine={engine} anomaly={item.a} onToast={onToast} showFoeArt={showFoeArt} />
        ))}
      </div>
      </div>
    </Panel>
  )
}

/** 野外应急修理（2026-10-02 批次 4p 随 GalaxyActions 迁到 StarMap.tsx） */


/** 常驻悬赏卡。`showFoeArt` = 舰影列是否渲染（由列表容器实测宽驱动，见 BountyPanel）；
 *  2026-09-13 起未探索星系的卡**不再进入本列表**（船长：「将未探索的悬赏卡隐藏」）——
 *  卡内 `unexplored` 分支保留为防御路径（万一别处复用本卡，行为仍与原口径一致）。 */
function AnomalyCard({
  engine,
  anomaly,
  onToast,
  showFoeArt,
}: {
  engine: GameEngine
  anomaly: AnomalyDef
  onToast: ToastFn
  showFoeArt: boolean
}) {
  const state = engine.state
  const galaxy = engine.ctx.galaxies.get(anomaly.galaxyId)
  const power = calcPower(state, engine.ctx)
  // 敌对派系活跃（2026-09-10 船长定）：该星系当天的**全部悬赏**吃 +10% 奖金 / +10% 威胁。
  // 展示必须与实战一致（展示=到账）：威胁/奖金/胜率都按加成后的卡算；蒙特卡洛缓存按卡 id 建键、
  // 算的是未加成卡，故派系卡一律走"带伤预警"解析口径（与赏金任务卡同源）。
  const factionHit = isFactionBounty(state, anomaly)
  const shownCard = factionHit ? factionAnomalyOf(anomaly) : anomaly
  const mc = factionHit ? null : engine.winEstimateOf(anomaly.id)
  /**
   * 派系活跃卡（2026-09-10 船长：「展示必须与实战一致」）：威胁/奖金都按 +10% 后的卡算，
   * 而 MC 缓存按**未加成卡**建键 ⇒ 这张卡走带伤预警解析口径（与赏金任务卡同源）。
   */
  const fc = factionHit ? bountyDamageForecast(state, engine.ctx, shownCard) : null
  /**
   * **算出来多少就显示多少；缓存没算完就显示「计算中」**（**2026-09-23 船长报障**：
   * 「**胜率过于极端，98 胜率打噬口猎杀令连续失败**」）：
   * ① 旧写法 `Math.min(98, …)` 把"全胜"也显示成 **98%** ⇒ 玩家读成"几乎必胜"，而实战仍会输；
   *    现上限自然 100%（下限 2% 的"仍有希望"语义保留）。三处胜率显示（常驻悬赏卡 / 派系置顶卡 /
   *    赏金任务卡）**同一口径**，不再有的地方夹、有的地方不夹。
   * ② 缓存未就绪时**不再回退另一套尺子**（解析口径自己也夹 98%）⇒ 显示「计算中」，
   *    预热完成后随 notify 变成实测推演读数（`BOUNTY_MC_RUNS`：三点各 10 局）。
   * ③ 有实战胜利记录的卡按记录距离算（`state.winRecord`）⇒ 悬停附带**最差距离胜率**。
   */
  const pending = !factionHit && mc === null
  const armorLoss = mc ? mc.armorLoss : fc?.armorLoss ?? 0
  const hullLoss = mc ? mc.hullLoss : fc?.hullLoss ?? 0
  const chance = mc
    ? Math.max(2, Math.round(mc.winRate * 100))
    : pending
      ? null
      : Math.max(2, Math.round(bountyWinPercentGuarded(state, engine.ctx, shownCard) * 100))
  const chanceTone = chance === null ? '' : chance >= 70 ? tr("ui.Expedition.318") : chance >= 40 ? tr("ui.Expedition.035") : tr("ui.Expedition.036")
  const combatMs = anomaly.combatSeconds * 1000
  // 奖励/小时（2026-09-08：胜利自动返航——基准 = 目标星系最近已建成站；本地悬赏（目标=基准）
  // = 固定返港 120s；异星系 = 单程 × RETURN_LEG_MUL，2026-09-14 起 1×）——每单耗时 = 交火 + 返航
  const retBase = nearestStationGalaxyId(state, engine.ctx, anomaly.galaxyId)
  const localTarget = anomaly.galaxyId === retBase
  const retMins = localTarget ? NaN : shortestTravelMinutes(engine.ctx, retBase, anomaly.galaxyId)
  const retMs = localTarget ? 120_000 : Number.isFinite(retMins) ? travelLegMs(state, engine.ctx, retMins) * RETURN_LEG_MUL : 0
  const roundTripMs = Math.max(1, combatMs + retMs)
  const grossIsk = (factionHit ? factionBaseRewardIsk(anomaly) : anomaly.rewardIsk) * bountyRewardFactor(state)
  const iskPerHour = roundTripMs > 0 ? grossIsk / (roundTripMs / 3_600_000) : 0
  const iskPerHourTxt =
    iskPerHour >= 1000
      ? `${(iskPerHour / 1000).toLocaleString('zh-CN', { maximumFractionDigits: 1 })}k`
      : Math.round(iskPerHour).toLocaleString('zh-CN')
  const standing = standingOf(state, DSI_FACTION_ID)
  const reqMet = standing >= anomaly.standingReq
  const unexplored = galaxy ? !isExplored(state, galaxy.id) : false // 星系未探索（2026-09-13 起本列表已不列这类卡，此分支为防御路径）
  // T4 延后项：采矿中可「转战」（两步确认）；提示当前驾驶船（可能开着战斗船在挖矿）
  const [goAsk, setGoAsk] = useState(false)
  const lootText = anomaly.loot
    .map((l) => `${engine.ctx.items.get(l.itemId)?.name ?? l.itemId}×${l.units}`)
    .join(tr("ui.MatterTechTab.017"))
  const mining = state.mining
  const miningActive = mining.active
  const pilotName = shipDisplayName(state, engine.ctx, state.shipId)
  const pilotRoleLabel = (() => {
    const role = fleetDefOf(state, engine.ctx, state.shipId)?.role
    return role ? shipRoleText(role) : ''
  })()
  const inFlightSelf = state.expedition.active && state.expedition.anomalyId === anomaly.id
  const inFlightOther = state.expedition.active && !inFlightSelf
  /**
   * **这张卡现在是不是"入侵舰队"**（2026-09-25 船长令「**入侵舰队不应该有赏金**」）：
   * 被占星系的悬赏位由 `weekendBountyCardsOf` 换成了入侵舰队（`rewardIsk` 已是 0）⇒
   * 赏金那一栏改显「结算时按进度发放」，"估算奖励/小时"那一栏也整条不显示（没有即时收入可估）。
   */
  const invadedHere = weekendOccupiedLiveAt(state, anomaly.galaxyId, Date.now())
  /**
   * **核心门禁读数**（船长批「丙」）：只在"这一行就是核心星的入侵卡"时取。
   * 与「星系详细」那张卡同一取数口（`weekendCoreGateView`）⇒ 两处不会各说各话。
   */
  const coreGate =
    invadedHere && state.weekendEvent !== undefined && anomaly.galaxyId === state.weekendEvent.coreId
      ? weekendCoreGateView(state, state.weekendEvent, Date.now())
      : null
  /**
   * **被占星系里这张卡 = 入侵舰队**（2026-09-25 船长令 · 乙案）：标题与威胁**向"星系详细"那一行对齐**——
   * 标题统一写「击退入侵舰队」（`ui.weekend.092`，抽到的那支舰队名挪到悬停里）、威胁改写成该区域池的
   * **区间**（`ui.weekend.093`，与星系详细逐字同源）、赏金继续走「结算时按进度发放」。
   * 理由：同一场入侵在板面与星系详细两处长得不一样，玩家会以为是两件事。
   */
  const invadedThreats = invadedHere
    ? weekendFoePoolOf(
        state.weekendEvent?.family ?? 'A',
        anomaly.galaxyId === state.weekendEvent?.coreId,
      )
        .map((id) => engine.ctx.anomalies.get(id)?.threat ?? 0)
        .filter((t) => t > 0)
    : []
  const invadedLo = invadedThreats.length > 0 ? Math.min(...invadedThreats) : 0
  const invadedHi = invadedThreats.length > 0 ? Math.max(...invadedThreats) : 0
  /** 入侵「重复出击」的循环目标（2026-09-25 船长令）：与常驻悬赏那条环互斥 */
  const invasionLoopOn = invadedHere && state.weekendEvent?.autoLoopGalaxyId === anomaly.galaxyId
  // 声望仅首胜发放：已首胜过的目标重复完成不再涨声望
  const bountyCleared = state.completedBounties.includes(anomaly.id)
  // T8：重复冷却 + 重复清剿状态；优化：其它作业（采矿/返航/非本目标的远征）中不可开启
  // （2026-09-15：星系扫描不再算"别的作业"——无人扫描艇不占主控）
  const cdRemain = bountyCooldownRemainingMs(state, anomaly.id)
  /** 常驻悬赏那条环（入侵卡上不算：那条环有自己的目标语义，见 `invasionLoopOn`） */
  const looping = !invadedHere && state.autoLoopAnomalyId === anomaly.id
  /** 本卡按钮要显示"开/停"哪一态 */
  const loopOn = invadedHere ? invasionLoopOn : looping
  /**
   * **"别的作业占着主控"⇒ 本卡开关禁用**（船长 2026-09-18 沿用现有忙碌判定）。
   *
   * ⚠ 本次改一处：判据由"**环**是不是这个目标"改成"**在飞的是谁**"——
   * 旧写法下"正在打这个目标但还没开环"会被当成忙碌 ⇒ **进行中根本开不了**（船长报的正是这个）。
   * 现在：本目标在飞 ⇒ 不忙 ⇒ 未开环可点「重复清剿」开、已开环可点「停止讨伐」关。
   */
  const busyOther =
    state.mining.active ||
    state.transit.active ||
    (state.expedition.active && state.expedition.anomalyId !== anomaly.id)
  /** 再开的前置未满足（战损未补 / 装甲或结构 <50%）：只在"要开"的方向挡，关闭一律放行 */
  const reopenBlock = loopOn ? null : autoLoopReopenBlockReason(state)
  // 出击可点条件：声望/探索/冷却/返港/远征在飞时禁；采矿中放行（转战）
  const goDisabled =
    !reqMet || unexplored || cdRemain > 0 || state.transit.active || inFlightSelf || inFlightOther

  function handleGoClick(): void {
    if (miningActive && !goAsk) {
      setGoAsk(true) // 展开卡片内联警示（替换底部 toast——警示要够明显）
      return
    }
    if (!goAsk) {
      // 带上"界面上这一行的星系"（2026-09-25 修"串星系"：同 id 多星系按 id 反查会串，见 `foeGalaxyOf`）
      const r = engine.startExpeditionAt(anomaly.id, anomaly.galaxyId)
      if (!r.ok) onToast(cmdText(r) || tr('ui.Expedition.389'), true)
      else onToast(tr("ui.Expedition.270"))
      return
    }
    // 面板「确认转战」
    setGoAsk(false)
    const r = engine.startExpeditionFromMiningAt(anomaly.id, anomaly.galaxyId)
    if (!r.ok) onToast(cmdText(r) || tr('ui.Expedition.392'), true)
    else onToast(tr("ui.Expedition.151"))
  }

  function toggleLoop(): void {
    // 入侵卡走「重复出击」（目标是**被占星系**：每场重抽一支）；常驻悬赏仍走「重复清剿」
    const r = invadedHere
      ? engine.invasionLoopAt(invasionLoopOn ? null : anomaly.galaxyId)
      : engine.bountyLoopAt(looping ? null : anomaly.id)
    if (!r.ok) onToast(cmdText(r) || tr('ui.Expedition.393'), true)
  }

  const locked = !reqMet || unexplored

  return (
    <div className={`app-ano-card is-foe-art${locked ? ' is-locked' : ''}`}>
      {/* 舰影列：固定尺寸、置卡片最左侧；容器过窄时整列不渲染（样式 .app-ano-card.is-foe-art） */}
      {showFoeArt ? <FoeArt fam={foeFamilyOf(anomaly)} shipId={foeCardShipIdOf(anomaly)} /> : null}
      <div className="app-foe-main">
      <div className="app-ano-top">
        <span className="app-ano-name" title={invadedHere ? anomaly.name : undefined}>
          {invadedHere ? tr('ui.weekend.092') : anomaly.name}
          {factionHit ? (
            <em className="app-chip is-rare" title={tr("ui.Expedition.213")}>
              {tr("ui.Expedition.198")}
            </em>
          ) : null}
        </span>
        <span className={`app-chip${locked ? ' is-dim' : ''}`}>
          {unexplored ? (<><span className="app-ico"><Glyph name="ico-scan" size={12} color={ICO_TONES["ico-scan"]} /></span>{tr("ui.Expedition.214")}</>) : reqMet ? (invadedHere ? tr('ui.weekend.093', { p1: invadedLo, p2: invadedHi }) : tr("ui.Expedition.095", { p1: shownCard.threat, p2: factionHit ? '（+10%）' : '' })) : (<><span className="app-ico"><Glyph name="ico-lock" size={12} color={ICO_TONES["ico-lock"]} /></span>{tr("ui.Expedition.319")}{anomaly.standingReq}</>)}
        </span>
      </div>
      <div className="app-ano-meta">
        {galaxy ? (unexplored ? tr("ui.Expedition.215") : (
          <>
            {galaxy.name}
            {galaxy.security !== undefined ? (
              <span className={`app-sec-chip app-sec-chip-${secTone(galaxy.security)}`} title={tr("ui.Expedition.271")}>
                {secText(galaxy.security)}
              </span>
            ) : null}
          </>
        )) : '？'} ·{' '}
        {(() => {
          // 2026-09-06：去程取消（下达即开战）；胜利自动返航（2026-09-08：基准 = 最近已建成站；
          // 本地悬赏 = 固定返港 2 分钟不可召回；异星系 = 单程 × RETURN_LEG_MUL（现值 1×）不可召回）
          const homeTarget = localTarget
          const backTxt =
            homeTarget
              ? ''
              : !Number.isFinite(retMins)
                ? ''
                : tr("ui.Expedition.355", { p1: Math.max(1, Math.round(travelMinutesEff(state, engine.ctx, retMins) * RETURN_LEG_MUL)) })
          return (
            <>
              {tr("ui.Expedition.096")} {fmtDuration(anomaly.combatSeconds * 1000)}
              {homeTarget ? tr("ui.Expedition.356") : backTxt}
            </>
          )
        })()}
        {cdRemain > 0 ? (
          <span className="app-dim" title={tr("ui.Expedition.097")}>
            {' '}· <span className="app-ico"><Glyph name="ico-clock" size={12} color={ICO_TONES['ico-clock']} /></span>{tr("ui.Expedition.037")} {Math.max(1, Math.ceil(cdRemain / 1000))}{tr('ui.Expedition.418')}
          </span>
        ) : null}
      </div>
      {anomaly.tactic ? (
        <div className="app-ano-meta">
          <span className="app-dim" title={tr("ui.Expedition.216")}>
            <span className="app-ico"><Glyph name="ico-tact" size={12} color={ICO_TONES["ico-tact"]} /></span>{FOE_TACTIC_HINTS[anomaly.tactic] ?? tr("ui.Expedition.152", { p1: anomaly.tactic })}
          </span>
        </div>
      ) : null}
      <div className="app-ano-win">
        {/**
         * **入侵舰队的卡不出胜率预估**（**2026-09-26 船长令**：「**入侵舰队的悬赏卡因为是随机抽取的敌人，
         * 胜率不固定的，所以在做预估胜率的时候忽略入侵舰队的卡，替换为提示'遭遇随机入侵舰队，敌人未知'。
         * 并且将入侵卡标红，打上危险的标签。**」）。
         *
         * 判据 = `invadedHere`（被占星系的悬赏位已被 `weekendBountyCardsOf` 换成入侵舰队，与"赏金栏改显
         * 结算口径"同一把尺）⇒ 这一支**既不显示我方战力指数、也不显示百分比**，只给一句"敌人未知"；
         * 旁边按船长令挂一枚**危险**芯片（`.app-chip.is-danger`）。
         */}
        {invadedHere ? (
          <>
            <em className="app-chip is-danger" title={tr('ui.Expedition.440')}>
              {tr('ui.Expedition.439')}
            </em>{' '}
            <span className="app-dim">{tr('ui.Expedition.438')}</span>
          </>
        ) : (
          <>
            {tr("ui.Expedition.217")} {power} {tr("ui.Expedition.038")}{' '}
            <b
              className={chance === null ? `app-dim` : `app-win-${chanceTone}`}
              title={
                mc
                  ? tr("ui.Expedition.426", {
                      p1: Math.round(mc.armorLoss * 100),
                      p2: Math.round(mc.hullLoss * 100),
                      p3: Math.round(mc.worstWinRate * 100),
                    })
                  : pending
                    ? tr("ui.Expedition.425")
                    : tr("ui.Expedition.153", { p1: Math.round(armorLoss * 100), p2: Math.round(hullLoss * 100) })
              }
            >
              {chance === null ? tr("ui.Expedition.425") : `${Math.round(chance)}%`}
            </b>
          </>
        )}
        {!reqMet ? <span className="app-dim">{tr("ui.Expedition.320")} {standing}/{anomaly.standingReq}）</span> : null}
        {/* V17：敌方主伤害类型色 chip——护盾/装甲增强器按系配抗的换装依据
            2026-09-10 船长（混伤）：改为「敌火力 主 80% · 副 20%」——构成与战斗结算同源 */}
        <span
          className="app-dim"
          title={tr("ui.Expedition.218")}
        >
          {' '}{tr('ui.Expedition.366')}<FoeDamageMix anomaly={anomaly} />
        </span>
        {/* V17.2：敌方血型色 chip——选弹种依据：动能克盾 ×1.5 / 高爆克甲 ×1.5 */}
        {(() => {
          const p = anomaly.defProfile ?? 'balanced'
          const split = foeLayerSplit(p)
          const cn = p === 'shield' ? tr("ui.Expedition.272") : p === 'armor' ? tr("ui.Expedition.273") : tr("ui.Expedition.098")
          return (
            <span
              className="app-dim"
              title={tr("ui.Expedition.219", { p1: Math.round(split.s * 100), p2: Math.round(split.a * 100), p3: Math.round(split.h * 100) })}
            >
              {' '}{tr('ui.Expedition.367')}<ProfileChip profile={p} text={cn} />
            </span>
          )
        })()}
      </div>
      <div className="app-ano-reward">
        {invadedHere ? (
          <>{tr('ui.weekend.096')}</>
        ) : (
          <>
            {tr("ui.Expedition.099")} {Math.round((factionHit ? factionBaseRewardIsk(anomaly) : anomaly.rewardIsk) * bountyRewardFactor(state)).toLocaleString('zh-CN')} {tr("ui.FirstTasks.003")}
            {factionHit ? <span className="app-dim" title={tr("ui.Expedition.220", { p1: anomaly.rewardIsk.toLocaleString('zh-CN') })}>{tr("ui.Expedition.321")}</span> : null}
            {anomaly.loot.length > 0 ? ` + ${lootText}` : ''}{tr('ui.Expedition.368')}{anomaly.standingGain}
          </>
        )}
        {bountyCleared ? <span className="app-dim" title={tr("ui.Expedition.274")}>{tr("ui.Expedition.322")}</span> : null}
        {/**
         * **核心门禁提示**（**船长批「丙」** · 2026-09-25）：外围没清完时，打核心**一点夺回进度都不给**
         * （`weekendResolveBattle` 的 gated 分支连台账都不记）⇒ 在**常驻悬赏这一行**就写明，
         * 别让玩家白打一场威胁最高的舰队。文案与「星系详细」那张卡**同源**（`ui.weekend.104/105`），
         * 读数也同源（`weekendCoreGateView` = `weekendCoreProgressAt` 那一条门禁）。
         */}
        {coreGate?.gated ? (
          <span className="app-dim" title={tr('ui.weekend.104')}>
            {coreGate.missing >= coreGate.total
              ? tr('ui.weekend.104')
              : tr('ui.weekend.105', { p1: String(coreGate.missing) })}
          </span>
        ) : null}
      </div>
      {/* 入侵场次没有即时赏金 ⇒ "估算奖励/小时"整条不显示（免得拿 0 去估一个数出来） */}
      {invadedHere ? null : (
        <div
          className="app-ano-econ"
          title={tr("ui.Expedition.039", { p1: grossIsk.toLocaleString('zh-CN'), p2: fmtDuration(roundTripMs) })}
        >
          {MONEY_GLYPH} {tr("ui.Expedition.040")}{iskPerHourTxt} {tr("ui.Expedition.041")}
        </div>
      )}
      <div className="app-ano-bottom">
        <span className="app-ano-desc">
          {unexplored ? tr("ui.Expedition.275") : anomaly.description}
        </span>
        <div className="app-ano-btns">
          <button
            className={`app-btn is-small${loopOn ? ' is-warn' : ''}`}
            disabled={!reqMet || unexplored || busyOther || reopenBlock !== null}
            title={
              !reqMet || unexplored
                ? tr("ui.Expedition.042")
                : busyOther
                  ? tr("ui.Expedition.154")
                  : reopenBlock !== null
                    ? reopenBlock
                    : loopOn
                      ? tr("ui.Expedition.043")
                      : invadedHere
                        ? tr('ui.weekend.107')
                        : tr("ui.Expedition.155")
            }
            onClick={toggleLoop}
          >
            {loopOn ? (
              tr("ui.Expedition.044")
            ) : (
              <>
                <span className="app-ico"><Glyph name="ico-loop" size={13} color={ICO_TONES['ico-loop']} /></span>
                {invadedHere ? tr('ui.weekend.106') : tr("ui.Handbook.294")}
              </>
            )}
          </button>
          <button
            className={`app-btn is-small ${miningActive && !goAsk ? 'is-warn is-primary' : goAsk ? 'is-dim' : 'is-primary'}`}
            disabled={goDisabled || goAsk}
            title={
              goAsk
                ? tr("ui.Expedition.276")
                : cdRemain > 0
                ? tr("ui.Expedition.323", { p1: Math.max(1, Math.ceil(cdRemain / 1000)) })
                : !reqMet || unexplored
                  ? tr("ui.Expedition.042")
                  : state.transit.active
                    ? tr("ui.Expedition.324")
                    : inFlightSelf
                      ? tr("ui.Expedition.277")
                      : inFlightOther
                        ? tr("ui.Expedition.314")
                        : miningActive
                          ? tr("ui.Expedition.325")
                          : ''
            }
            onClick={handleGoClick}
          >
            {cdRemain > 0 ? tr("ui.Expedition.100") : miningActive ? tr("ui.Expedition.045") : tr("ui.Expedition.101")}
          </button>
        </div>
      </div>
      {/* T4 延后项：采矿中转战的醒目内联警示（操作按钮正下方全宽，取代易忽略的底部提示） */}
      {goAsk ? (
        <div className="app-ano-switch-confirm">
          <div className="app-sell-warn">
            {tr("ui.Expedition.046")} <b>{tr("ui.MapPage.037")}</b>{tr('ui.Expedition.419')}
            <b> {mining.tripUnits} {tr("ui.Expedition.102")}</b>{tr("ui.Expedition.278")}
            <b> {tr("ui.Expedition.156")}</b>{tr("ui.Expedition.279")}{anomaly.name}{tr("ui.Expedition.047")}
          </div>
          <div className="app-ano-pilot-note">
            {tr("ui.Expedition.157")}{pilotName}」{pilotRoleLabel ? tr("ui.Expedition.307", { pilotRoleLabel: pilotRoleLabel }) : ''}
          </div>
          <div className="app-sell-confirm-btns">
            <button className="app-btn is-small is-danger" onClick={handleGoClick}>
              {tr("ui.Expedition.280")}
            </button>
            <button className="app-btn is-small" onClick={() => setGoAsk(false)}>
              {tr("ui.ActivityBar.004")}
            </button>
          </div>
        </div>
      ) : null}
      </div>
    </div>
  )
}

/* ═══════════════ T9：建站族任务卡 + 通讯器 ═══════════════ */

/** 通讯器浮层（D2：一次性完整呈现；逐句镜像日志由 engine.openDialogue 负责） */
import { Communicator } from '../ui/communicator'
export { Communicator } from '../ui/communicator'

/* ─────────── v24 任务中心·时效任务（资源 / 快递：随 20 分钟补给周期整板刷新，限时有效；
   2026-09-10 追加：赏金任务 = 独立日板，24 小时一轮、每天本地 0 点整板替换） ─────────── */

/** mm:ss（向上取整到秒；与市场页下次补给同口径）
 * （2026-10-02 批次 4p 迁到 i18n/fmt：StarMap 与 Expedition 共用，留本文件会造回环） */

/** h:mm:ss（日板倒计时：赏金一轮 24 小时，mm:ss 不够看）
 * （2026-10-02 批次 4p 迁到 i18n/fmt） */

/** 时效任务区：资源 = 限时收购（协会收商品，仓库足量直接交付）；快递 = 副站真实航行投送
 *  （需建成一座副站解锁；两步：出发投送 → 到站自动结算） */
function SideTasksArea({ engine, onToast, kind }: { engine: GameEngine; onToast: ToastFn; kind: 'resource' | 'courier' }) {
  const state = engine.state
  const { t } = useL10n()
  const view = engine.sideTasksView()
  const isCourier = kind === 'courier'
  /**
   * **两族节奏不同，各自算各自的**（**2026-09-24 船长报障**：「快递任务现在是 2 小时刷新周期，但是卡片上和
   * 快递任务页面写的还是 20 分钟」）：资源仍跟市场「补给刷新」（`orderLifeMs.common`，20 分钟）；
   * 快递按 `COURIER_BOARD_PERIOD_MS`（120 分钟，2026-09-24 船长令）——**倒计时与"每 N 分钟一轮"文案
   * 都取本族的常量**，别再拿资源那 20 分钟套在快递头上。
   */
  const periodMin = Math.max(
    1,
    Math.round((isCourier ? COURIER_BOARD_PERIOD_MS : engine.ctx.balance.market.orderLifeMs.common) / 60_000),
  )
  /** 本族本批的剩余（快递 = 到下一个 120 分钟整点；资源 = 到下一个 20 分钟整点） */
  const remainMs = isCourier ? view.courierRemainingMs : view.remainingMs
  /** 倒计时格式：快递一轮两小时 ⇒ 用 h:mm:ss（`mm:ss` 会写出「118:23」那种分钟数） */
  const clock = isCourier ? fmtDayClock : fmtSideClock
  /**
   * **任务排序**（船长 2026-09-19：「添加个默认排序（从低到高）和价值排序（从高到低）」；
   * 追问三答：默认排序 = **按任务级别 L1→L5** · 价值排序 = **按奖励从高到低** ·
   * **两者只在「资源任务」「快递任务」两个子页出现**（重要/赏金没有 L1~L5，故那一页不渲染本行）。
   * 选择随档存本地（与悬赏排序同一个 `whale-idle:*` 家族）；默认 = 「默认排序」。
   */
  const [sort, setSort] = useState<SideTaskSort>(() => {
    try {
      return localStorage.getItem(SIDE_TASK_SORT_KEY) === 'value' ? 'value' : 'level'
    } catch {
      return 'level'
    }
  })
  function changeSort(next: SideTaskSort): void {
    setSort(next)
    try {
      localStorage.setItem(SIDE_TASK_SORT_KEY, next)
    } catch {
      /* 忽略 */
    }
  }
  // 快递：**已接单的排在前面**（跨刷新保留；出发/放弃才离场），随后是本批板上的订单
  // ⚠ 排序键只作用于**同一组之内**（已接单组 / 本批板组各自排），免得"已接单"被级别混到后面去
  const bySort = (arr: readonly SideTask[]): SideTask[] =>
    [...arr].sort((a, b) =>
      sort === 'value' ? (b.rewardIsk ?? 0) - (a.rewardIsk ?? 0) : (a.level ?? 0) - (b.level ?? 0),
    )
  const tasks = isCourier ? [...bySort(view.accepted), ...bySort(view.courier)] : bySort(view.resource)
  // 快递：本批某单是否就是当前在途投送（仍在板上）；整板刷新后原单被换下 → 由顶部横幅继续提示
  const deliverNowId = view.deliver?.taskId ?? null
  // 在途单不在本批板上（整板刷新后）：横幅 + 本批其余订单都显示
  const inflightOffBoard = isCourier && deliverNowId !== null && !tasks.some((t) => t.id === deliverNowId)

  const act = (id: number): void => {
    if (isCourier) {
      const r = engine.startCourierDeliveryAt(id)
      if (r.ok) onToast(tr("ui.Expedition.158"))
      else onToast(cmdText(r) || tr('ui.Expedition.396'), true)
      return
    }
    const r = engine.completeSideTaskAt('resource', id)
    if (r.ok) onToast(tr("ui.Expedition.049"))
    else onToast(cmdText(r) || tr('ui.Expedition.397'), true)
  }

  const headText = isCourier
    ? view.courierUnlocked
      ? tr("ui.Expedition.103")
      : tr("ui.Expedition.104")
    : tr("ui.Expedition.105")

  return (
    <div className="app-sidetasks">
      <div className="app-sidetasks-head">
        <span>{headText}</span>
        {!isCourier || view.courierUnlocked ? (
          view.opened || tasks.length > 0 ? (
            <span
              className="app-st-time"
              title={isCourier ? tr('ui.Expedition.434', { periodMin: periodMin }) : tr("ui.Expedition.221", { periodMin: periodMin })}
            >
              {tr("ui.Expedition.281")} {clock(remainMs)}{tr('ui.Expedition.420')}{periodMin} {tr("ui.Expedition.106")}
            </span>
          ) : (
            <span className="app-dim">{tr("ui.Expedition.326")} {periodMin} {tr("ui.Expedition.107")}</span>
          )
        ) : null}
      </div>
      {isCourier && !view.courierUnlocked ? (
        <div className="app-dim app-exp-idle">
          {tr("ui.Expedition.159")}
        </div>
      ) : (
        <>
          {/* 排序行（船长 2026-09-19）：结构逐字复刻「常驻悬赏」那条（`app-task-sortrow` + `app-select`） */}
          <div className="app-task-sortrow">
            <span className="app-dim">{tr('ui.Expedition.377')}</span>
            <select
              className="app-select"
              value={sort}
              onChange={(e) => changeSort(e.target.value as SideTaskSort)}
              title={tr('ui.Expedition.372')}
            >
              <option value="level">{tr('ui.Expedition.373')}</option>
              <option value="value">{tr('ui.Expedition.374')}</option>
            </select>
          </div>
          {tasks.length === 0 ? (
        isCourier && inflightOffBoard ? (
          // 整板刷新把在途单换下：投送不受影响，横幅持续显示到到站结算
          <CourierInFlightBanner view={view} ctx={engine.ctx} />
        ) : view.opened ? (
          <div className="app-dim app-exp-idle">
            {isCourier
              ? tr("ui.Expedition.435", { periodMin: periodMin })
              : tr("ui.Expedition.223")}
          </div>
        ) : (
          <div className="app-dim app-exp-idle">
            {isCourier
              ? tr("ui.Expedition.108")
              : tr("ui.Expedition.224")}
          </div>
        )
      ) : (
        <>
          {isCourier && inflightOffBoard ? <CourierInFlightBanner view={view} ctx={engine.ctx} /> : null}
          {tasks.map((t) => {
            const name = engine.ctx.items.get(t.refId)?.name ?? t.refId
            const have = state.warehouse.items[t.refId] ?? 0
            const short = Math.max(0, t.need - have)
            if (isCourier) {
              // —— 快递卡（2026-09-18 虚拟货物版）：接单 / 出发投送 / 投送中 ——
              const siteId = t.stationId
              const siteName = siteId ? engine.ctx.stations.get(siteId)?.name ?? siteId : undefined
              const galaxyName = t.galaxyId ? engine.ctx.galaxies.get(t.galaxyId)?.name ?? t.galaxyId : undefined
              const isThisInFlight = view.deliver !== null && view.deliver.taskId === t.id
              const otherInFlight = view.deliver !== null && !isThisInFlight
              const expired = remainMs <= 0
              const vol = t.volumeM3 ?? 0
              const cap = engine.cargoCapacityM3()
              const warp = engine.warpSpeedOfCurrent()
              const warpShort = t.timed === true && t.warpReqAus !== undefined && warp + 1e-9 < t.warpReqAus
              const cargoShort = vol > cap
              const accepted = view.accepted.some((a) => a.id === t.id)
              const limitMin = t.timeLimitMs !== undefined ? Math.max(1, Math.round(t.timeLimitMs / 60_000)) : null
              const lockedTxt = cargoShort
                ? tr("ui.Expedition.282", { p1: vol.toLocaleString('zh-CN'), p2: cap.toLocaleString('zh-CN') })
                : warpShort
                  ? tr("ui.Expedition.327", { p1: t.warpReqAus ?? 0, p2: warp.toFixed(2) })
                  : expired && !accepted
                    ? tr("ui.Expedition.225")
                    : otherInFlight
                      ? tr("ui.Expedition.160")
                      : undefined
              return (
                <div key={t.id} className="app-station-card">
                  <div className="app-station-head">
                    <span className="app-station-name">
                      {tr("ui.Expedition.050")}{t.level ?? 1}：{vol.toLocaleString('zh-CN')} m³
                      <em className="app-chip">{t.timed === true ? tr("ui.Expedition.328", { p1: t.warpReqAus ?? 0 }) : tr("ui.Expedition.226")}</em>
                    </span>
                    <span className="app-dim">{accepted ? tr("ui.Expedition.161") : tr("ui.Expedition.109", { p1: clock(remainMs) })}</span>
                  </div>
                  <div className="app-station-mats">
                    {tr("ui.Expedition.283")}{siteName ?? tr("ui.Expedition.329")}」{galaxyName ? `（${galaxyName}）` : ''}{tr('ui.Expedition.421')}
                    {vol.toLocaleString('zh-CN')}{tr('ui.Expedition.422')}
                    {t.timed === true && limitMin !== null
                      ? ` 限时快递：需在 ${limitMin} 分钟内抵达，超时无报酬（本舰跃迁 ${warp.toFixed(2)} AU/s，门槛 ${t.warpReqAus} AU/s）。`
                      : ''}
                  </div>
                  {/* 奖励独立成行 + 金色 */}
                  <div className="app-task-reward">
                    <span className="app-dim">{t.timed === true ? tr("ui.Expedition.330") : tr("ui.Expedition.331")}</span>
                    {MONEY_GLYPH} {t.rewardIsk.toLocaleString('zh-CN')} {tr("ui.FirstTasks.003")}
                  </div>
                  <div className="app-station-deliver">
                    <span className="app-dim">
                      {tr("ui.Expedition.227")} {cap.toLocaleString('zh-CN')} m³{accepted ? tr("ui.Expedition.357") : ''}
                    </span>
                    {isThisInFlight ? (
                      <span className="app-btn is-small is-primary" aria-disabled title={tr("ui.Expedition.284")}>
                        {tr("ui.Expedition.162")} {fmtSideClock(view.deliver!.remainingMs)}
                      </span>
                    ) : (
                      <>
                        {accepted ? (
                          <button
                            className="app-btn is-small"
                            title={tr("ui.Expedition.228")}
                            onClick={() => {
                              const r = engine.abandonAcceptedCourierAt(t.id)
                              onToast(r.ok ? tr("ui.Expedition.163") : cmdText(r) || tr('ui.Expedition.401'), !r.ok)
                            }}
                          >
                            {tr("ui.Expedition.006")}
                          </button>
                        ) : (
                          <button
                            className="app-btn is-small"
                            disabled={otherInFlight}
                            title={tr("ui.Expedition.164")}
                            onClick={() => {
                              const r = engine.acceptCourierAt(t.id)
                              onToast(r.ok ? tr("ui.Expedition.165") : cmdText(r) || tr('ui.Expedition.402'), !r.ok)
                            }}
                          >
                            {tr("ui.Expedition.166")}
                          </button>
                        )}
                        <button
                          className="app-btn is-small is-primary"
                          disabled={cargoShort || warpShort || (expired && !accepted) || otherInFlight}
                          title={lockedTxt ?? tr("ui.Expedition.110", { p1: vol.toLocaleString('zh-CN'), p2: siteName ?? tr('ui.Expedition.403'), p3: t.rewardIsk.toLocaleString('zh-CN') })}
                          onClick={() => {
                            const r = engine.startCourierDeliveryAt(t.id)
                            onToast(
                              r.ok
                                ? t.timed === true
                                  ? tr("ui.Expedition.111")
                                  : tr("ui.Expedition.112")
                                : cmdText(r) || tr('ui.Expedition.396'),
                              !r.ok,
                            )
                          }}
                        >
                          {tr("ui.Expedition.113")}{vol.toLocaleString('zh-CN')} m³）
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )
            }
            // —— 资源卡：仓库足量即时交付（级别越高，收购量与奖励越大）——
            const canFinish = have >= t.need && view.remainingMs > 0
            const lockedTxt = short > 0
              ? tr("ui.Expedition.229", { name: name, p2: short.toLocaleString('zh-CN'), p3: t.need.toLocaleString('zh-CN'), p4: have.toLocaleString('zh-CN') })
              : tr("ui.Expedition.230")
            return (
              <div key={t.id} className="app-station-card">
                <div className="app-station-head">
                  <span className="app-station-name">
                    {tr("ui.Expedition.051")}{t.level ?? 1}：{name} × {t.need.toLocaleString('zh-CN')}
                    <em className="app-chip">{tr("ui.Expedition.231")}</em>
                  </span>
                  <span className="app-dim">{tr("ui.Expedition.114")} {fmtSideClock(view.remainingMs)}</span>
                </div>
                <div className="app-station-mats">
                  {tr("ui.Expedition.115")} {name}×{t.need.toLocaleString('zh-CN')}（L{t.level ?? 1}{tr('ui.Expedition.423')}
                </div>
                {/* 奖励独立成行 + 金色（船长 2026-09-18：「所有任务卡片都有的问题，奖励不明显」） */}
                <div className="app-task-reward">
                  <span className="app-dim">{tr("ui.Expedition.004")} </span>
                  {MONEY_GLYPH} {t.rewardIsk.toLocaleString('zh-CN')} {tr("ui.FirstTasks.003")}
                  {/**
                   * **均价**（船长 2026-09-19：「资源任务，在报酬后面用**普通颜色**的字体显示
                   * **平均每单位资源的价格**」）：`奖励 ÷ 收购量`，四舍五入到整数信用点。
                   *
                   * 为什么要它：资源单之间**只有"总价"可比**，而同一档的收购量不同 ⇒ 总价高的单
                   * 未必单价高（换货/买入交付时，单价才是真正决定赚不赚的数）。
                   * 颜色：外层 `.app-task-reward` 是金色（奖励专用）⇒ 这里显式用**普通正文色**
                   * （`.app-unit-price`），与"奖励"从观感上分开——船长要的就是这个对比。
                   */}
                  <span
                    className="app-unit-price"
                    title={tr('ui.Expedition.375', {
                      isk: t.rewardIsk.toLocaleString('zh-CN'),
                      need: t.need.toLocaleString('zh-CN'),
                    })}
                  >
                    {tr('ui.Expedition.376', { n: Math.round(t.rewardIsk / Math.max(1, t.need)).toLocaleString('zh-CN') })}
                  </span>
                </div>
                <div className="app-station-deliver">
                  <span className="app-dim">
                    {tr("ui.Expedition.052")} {have.toLocaleString('zh-CN')} {tr("ui.Expedition.102")}{short > 0 ? tr("ui.Expedition.332", { p1: short.toLocaleString('zh-CN') }) : ''}
                  </span>
                  <button
                    className="app-btn is-small is-primary"
                    disabled={!canFinish}
                    title={canFinish ? tr("ui.Expedition.053", { name: name, p2: t.need.toLocaleString('zh-CN'), p3: t.rewardIsk.toLocaleString('zh-CN') }) : lockedTxt}
                    onClick={() => act(t.id)}
                  >
                    {tr("ui.Expedition.116")}{Math.min(have, t.need).toLocaleString('zh-CN')}/{t.need.toLocaleString('zh-CN')}）
                  </button>
                </div>
              </div>
            )
          })}
        </>
      )}
        </>
      )}
    </div>
  )
}

/**
 * 赏金任务区（2026-09-10 船长定）：任务中心第四个子页——临时战斗任务，目标 = 「敌人窝点」。
 * - 与资源/快递同周期（20 分钟整点）整板刷新，每轮 2 张，过期作废无惩罚；
 * - 窝点 = 该星系主题悬赏按档位派生（档位上限由协会声望决定）：威胁更高、加僚机与波次；
 * - 必须亲自出击（AI 不能代劳）；打赢 → 窝点奖金 + 赏金任务酬金入账，并在该星系留下
 *   稀有残骸 ×档位件数（打捞必得，回站精炼炉「残骸回收」当高级箱开）；
 * - 卡片结构与资源/快递卡同族（app-station-card 家族），只多一行窝点情报与档位徽标。
 */
function BountyTasksArea({ engine, onToast }: { engine: GameEngine; onToast: ToastFn }) {
  const state = engine.state
  const view = engine.sideTasksView()
  const tasks = view.bounty
  const standing = standingOf(state, DSI_FACTION_ID)
  // T4 延后项：采矿中可「转战」（卡片内联两步确认，与常驻悬赏卡同口径）
  const [goAsk, setGoAsk] = useState<number | null>(null)
  // —— 舰影列自适应（2026-09-13 船长：赏金任务窝点卡与派系活跃置顶卡也加敌族舰影）——
  // 两处共用同一个测量点：本区根容器 .app-sidetasks（宽度 = 面板内容宽，已扣面板体滚动条）。
  const areaRef = useRef<HTMLDivElement | null>(null)
  const showFoeArt = useFoeArtFit(areaRef)

  function go(t: SideTask): void {
    const miningActive = state.mining.active
    if (miningActive && goAsk !== t.id) {
      setGoAsk(t.id)
      return
    }
    setGoAsk(null)
    const r = engine.startLairExpeditionAt(t.anomalyId ?? '', (t.lairTier ?? 1) as 1 | 2 | 3, miningActive)
    if (!r.ok) onToast(cmdText(r) || tr('ui.Expedition.389'), true)
    else if (miningActive) onToast(tr("ui.Expedition.151"))
    else onToast(tr("ui.Expedition.285"))
  }

  // 当日席位构成（档位随机发放，但保证每天三档各至少一张）：按实际板统计，供头部摘要
  const tierCount = (lv: 1 | 2 | 3): number => tasks.filter((t) => (t.lairTier ?? 1) === lv).length
  const tierSummary = tr("ui.Expedition.232", { p1: tasks.length, p2: lairTierText(1), p3: tierCount(1), p4: lairTierText(2), p5: tierCount(2), p6: lairTierText(3), p7: tierCount(3) })
  // 敌对派系活跃（2026-09-10 船长定：置顶那一条）——目标 = 当日选中星系的**常驻悬赏**（不是窝点）
  const faction = view.faction
  const factionCard = faction?.anomalyId ? engine.ctx.anomalies.get(faction.anomalyId) : undefined
  const factionGalaxy = faction?.galaxyId ? engine.ctx.galaxies.get(faction.galaxyId) : undefined

  function goFaction(): void {
    const miningActive = state.mining.active
    if (miningActive && goAsk !== faction!.id) {
      setGoAsk(faction!.id)
      return
    }
    setGoAsk(null)
    const r = miningActive
      ? engine.startExpeditionFromMiningAt(faction!.anomalyId ?? '')
      : engine.startExpeditionAt(faction!.anomalyId ?? '')
    if (!r.ok) onToast(cmdText(r) || tr('ui.Expedition.389'), true)
    else if (miningActive) onToast(tr("ui.Expedition.151"))
    else onToast(tr("ui.Expedition.270"))
  }

  return (
    <div className="app-sidetasks" ref={areaRef}>
      <div className="app-sidetasks-head">
        <span>
          {tr("ui.Expedition.286")}
          {tasks.length > 0 ? <span className="app-dim"> · {tierSummary}</span> : null}
          {faction ? <span className="app-dim">{tr('ui.Expedition.405')}</span> : null}
        </span>
        {view.bountyOpened || tasks.length > 0 ? (
          <span
            className="app-st-time"
            title={tr("ui.Expedition.233")}
          >
            {tr("ui.Expedition.281")} {fmtDayClock(view.bountyRemainingMs)}{tr('ui.Expedition.370')}
          </span>
        ) : (
          <span className="app-dim">{tr("ui.Expedition.234")}</span>
        )}
      </div>
      {/* 2026-09-11 修复（玩家反馈「清空赏金任务后敌对派系活跃消失了」）：派系活跃卡**不随 5 席清空而消失**——
          原先它被放在「tasks.length === 0 ? 空态 : 列表」的**列表分支里**，玩家打完全部 5 席后整块被空态替换，
          于是置顶的派系活跃卡一起被吞掉（而 core 侧当天照常生效：该星系常驻悬赏 +10% 奖金/威胁、照常掉稀有残骸）。
          现改为：只要当天有派系活跃（`factionCard` 可解析）就照常渲染，空态行只在"确实没有派系卡"时占位。 */}
      {tasks.length === 0 && !(faction && factionCard && factionGalaxy) ? (
        <div className="app-dim app-exp-idle">
          {view.bountyOpened
            ? tr("ui.Expedition.235")
            : tr("ui.Expedition.236")}
        </div>
      ) : (
        <>
          {/* ── 敌对派系活跃（2026-09-10 船长定）：置顶一条；目标 = 该星系**常驻悬赏**（不是窝点），
              奖金 ×1.1、威胁 ×1.1、胜利概率掉稀有残骸；**打赢不下板**，当天可反复刷 ── */}
          {faction && factionCard && factionGalaxy ? (
            (() => {
              const boostCard = factionAnomalyOf(factionCard)
              const sec = factionGalaxy.security
              const fc2 = bountyDamageForecast(state, engine.ctx, boostCard)
              const pWin2 = bountyWinPercentGuarded(state, engine.ctx, boostCard, state.shipId) * 100
              // 2026-09-23 船长：「不再夹到 98%」——三处显示同一口径（算出来多少显示多少）
              const chance2 = Math.max(2, Math.round(pWin2))
              const tone2 = chance2 >= 70 ? tr("ui.Expedition.318") : chance2 >= 40 ? tr("ui.Expedition.035") : tr("ui.Expedition.036")
              const reward2 = factionBaseRewardIsk(factionCard)
              const inFlightSelf2 = state.expedition.active && state.expedition.anomalyId === faction.anomalyId
              const inFlightOther2 = state.expedition.active && !inFlightSelf2
              const exploreOk2 = isExplored(state, factionGalaxy.id)
              const cd2 = bountyCooldownRemainingMs(state, faction.anomalyId ?? '')
              const locked2 = !exploreOk2
                ? tr("ui.Expedition.287")
                : state.transit.active
                  ? tr("ui.Expedition.167")
                  : inFlightSelf2
                    ? tr("ui.Expedition.288")
                    : inFlightOther2
                      ? tr("ui.Expedition.289")
                      : cd2 > 0
                        ? tr("ui.Expedition.054", { p1: factionCard.name, p2: Math.max(1, Math.ceil(cd2 / 1000)) })
                        : undefined
              const canGo2 = locked2 === undefined || (goAsk === faction.id && !inFlightOther2)
              // 2026-09-10 船长定：派系置顶卡加「循环剿灭」——**复用同一条重复清剿开关**
              // （state.autoLoopAnomalyId；与其它悬赏卡的「重复清剿」共用，开这里会顶掉那边），
              // 引擎零改动：开/关走 engine.bountyLoopAt，推进/自动暂停/停环全沿用既有机器。
              const loopOn2 = state.autoLoopAnomalyId === faction.anomalyId
              const busyOther2 =
                state.mining.active ||
                state.transit.active ||
                (state.expedition.active && state.autoLoopAnomalyId !== faction.anomalyId)
              const reqMet2 = standing >= (factionCard.standingReq ?? 0)
              return (
                <div className="app-station-card is-foe-art is-faction">
                  {/* 舰影列（2026-09-13 船长）：族取**置顶那张代表悬赏卡**的族——与卡面标的出击目标同一张卡，不另算族 */}
                  {showFoeArt ? <FoeArt fam={foeFamilyOf(factionCard)} shipId={foeCardShipIdOf(factionCard)} /> : null}
                  <div className="app-foe-main">
                  <div className="app-station-head">
                    <span className="app-station-name">
                      {tr("ui.Expedition.055")}{factionCard.name}
                      <em className="app-chip is-rare">{tr("ui.Expedition.056")}</em>
                      <em className="app-chip" title={tr("ui.Expedition.237")}>
                        {tr("ui.Expedition.168")}
                      </em>
                    </span>
                    {/* 换新倒计时走**派系自己那条界碑**（本地 12:00；2026-09-29 船长令「只挪活跃」） */}
                    <span className="app-dim">{tr("ui.Expedition.114")} {fmtDayClock(view.factionRemainingMs)}</span>
                  </div>
                  <div className="app-lair-kv">
                    <span>{tr("ui.Expedition.290")}{factionGalaxy.name}」</span>
                    {sec !== undefined ? (
                      <span className={`app-sec-chip app-sec-chip-${secTone(sec)}`} title={tr("ui.Expedition.271")}>
                        {secText(sec)}
                      </span>
                    ) : null}
                    <span>
                      <span className="app-lair-key">{tr("ui.Expedition.089")}</span> {boostCard.threat}
                      <span className="app-dim">{tr("ui.Expedition.333")} {factionCard.threat}，+10%）</span>
                    </span>
                    <span>
                      <span className="app-lair-key">{tr("ui.Expedition.099")}</span> {MONEY_GLYPH} {reward2.toLocaleString('zh-CN')} {tr("ui.FirstTasks.003")}
                      <span className="app-dim">{tr("ui.Expedition.333")} {factionCard.rewardIsk.toLocaleString('zh-CN')}，+10%）</span>
                    </span>
                  </div>
                  <div className="app-ano-win">
                    {tr("ui.Expedition.217")} {calcPower(state, engine.ctx)} → <span className="app-lair-key">{tr("ui.Expedition.334")}</span>{' '}
                    <b
                      className={`app-win-${tone2}`}
                      title={tr("ui.Expedition.169", { p1: Math.round(fc2.armorLoss * 100), p2: Math.round(fc2.hullLoss * 100) })}
                    >
                      {chance2}%
                    </b>
                    <span
                      className="app-dim"
                      title={tr("ui.Expedition.238")}
                    >
                      {' '}{tr('ui.Expedition.366')}<FoeDamageMix anomaly={boostCard} />
                    </span>
                  </div>
                  <div className="app-ano-reward">
                    <span className="app-lair-key">{tr("ui.IndustryPage.009")}</span>{' '}
                    {/* ⚠ **2026-09-24 修**（船长报障「铁人模式的残骸掉率加成似乎没应用到？」）：
                        这里原先写死 `Math.round(FACTION_RARE_DROP_CHANCE * 100)` = 恒 30% ⇒
                        **卡面把限时倍率与铁人 ×1.2 挡在读数之外**（机制本身一直生效）。
                        现改走 `factionRareDropChanceOf(state)`——**与 `expedition.ts` 那条掷骰同一函数**。 */}
                    {Math.round(factionRareDropChanceOf(state) * 100)}{tr('ui.Expedition.406')}{FACTION_RARE_DROP_COUNT}
                    <span className="app-dim" title={tr("ui.Expedition.117")}>
                      {tr("ui.Expedition.335")}
                    </span>
                  </div>
                  <div className="app-ano-desc">
                    {tr('ui.Expedition.407')}
                  </div>
                  <div className="app-station-deliver">
                    <span className="app-dim">
                      {state.mining.active
                        ? tr("ui.Expedition.170")
                        : tr("ui.Expedition.171", { standing: standing, p2: factionCard.standingReq })}
                    </span>
                    {inFlightSelf2 ? (
                      <span className="app-btn is-small is-primary" aria-disabled title={tr("ui.Expedition.288")}>
                        {tr("ui.Expedition.057")}
                      </span>
                    ) : (
                      <button
                        className="app-btn is-small is-primary"
                        disabled={!canGo2}
                        title={goAsk === faction.id ? tr("ui.Expedition.058") : locked2 ?? tr("ui.Expedition.118", { p1: factionGalaxy.name, p2: factionCard.name })}
                        onClick={goFaction}
                      >
                        {goAsk === faction.id ? tr("ui.Expedition.291") : tr("ui.Expedition.101")}
                      </button>
                    )}
                    <button
                      className={`app-btn is-small${loopOn2 ? ' is-warn' : ''}`}
                      disabled={!reqMet2 || !exploreOk2 || busyOther2}
                      title={
                        !reqMet2
                          ? tr("ui.Expedition.336", { p1: factionCard.standingReq, standing: standing })
                          : !exploreOk2
                            ? tr("ui.Expedition.059")
                            : busyOther2
                              ? tr("ui.Expedition.172")
                              : loopOn2
                                ? tr("ui.Expedition.060")
                                : tr("ui.Expedition.173")
                      }
                      onClick={() => {
                        if (!faction.anomalyId) return
                        const r = engine.bountyLoopAt(loopOn2 ? null : faction.anomalyId)
                        if (!r.ok) onToast(cmdText(r) || tr('ui.Expedition.393'), true)
                      }}
                    >
                      {loopOn2 ? (
                        tr('ui.Expedition.408')
                      ) : (
                        <>
                          <span className="app-ico">
                            <Glyph name="ico-loop" size={13} color={ICO_TONES['ico-loop']} />
                          </span>
                          {tr("ui.Expedition.174")}
                        </>
                      )}
                    </button>
                  </div>
                  </div>
                </div>
              )
            })()
          ) : null}
          {/* 5 席已清空时：派系活跃卡仍在（上方），这里补一行说明为什么席位是空的。
              ⚠ **2026-09-29 起分两态**（活跃切换时间改本地 12 点、赏金板仍 0 点，两个时点不再相同）：
              有活跃卡 ⇒ 用 `.447`（尾句讲"活跃星系明天中午 12 点重选"）；没有活跃卡 ⇒ 用 `.409`
              （尾句讲"赏金板 0 点刷新"）。此前共用 `.409`，活跃在跑时会把赏金板的 0 点说成活跃的时点。 */}
          {tasks.length === 0 ? (
            <div className="app-dim app-exp-idle">
              {faction && factionCard && factionGalaxy ? tr('ui.Expedition.447') : tr('ui.Expedition.409')}
            </div>
          ) : null}
          {tasks.map((t) => {
          const base = t.anomalyId ? engine.ctx.anomalies.get(t.anomalyId) : undefined
          const tier = (t.lairTier ?? 1) as 1 | 2 | 3
          const card = base ? lairAnomalyOf(base, tier) : undefined
          const galaxy = engine.ctx.galaxies.get(t.galaxyId ?? '')
          const galaxyName = galaxy?.name ?? t.galaxyId ?? '？'
          const waves = card?.waves?.length ?? 0
          const rareGain = LAIR_RARE_WRECK_GAIN[tier]
          // 胜率预估（2026-09-10 船长定：赏金卡也要有）——按**本档位强化后的卡**算，与实战同口径；
          // 口径 = 带伤预警推演（与常驻悬赏卡缓存未就绪时的回退同一套），损耗同一推演给出。
          const power = calcPower(state, engine.ctx)
          const fc = card ? bountyDamageForecast(state, engine.ctx, card) : null
          const pWin = card ? bountyWinPercentGuarded(state, engine.ctx, card, state.shipId) * 100 : 0
          // 2026-09-23 船长：「不再夹到 98%」——三处显示同一口径（算出来多少显示多少）
          const chance = Math.max(2, Math.round(pWin))
          const chanceTone = chance >= 70 ? tr("ui.Expedition.318") : chance >= 40 ? tr("ui.Expedition.035") : tr("ui.Expedition.036")
          // 赏金 = 窝点奖金 + 任务酬金（胜利时**一起到账**）：2026-09-10 船长定——两张卡别写两个数，
          // 合并成一条「赏金」。窝点奖金含赏金猎手学系数（展示=到账），任务酬金为刷出时锁定值。
          const lairRewardIsk = base ? Math.round(lairBaseRewardIsk(base, tier) * bountyRewardFactor(state)) : 0
          const totalIsk = lairRewardIsk + t.rewardIsk
          const inFlightSelf = state.expedition.active && state.expedition.anomalyId === t.anomalyId
          const inFlightOther = state.expedition.active && !inFlightSelf
          const expired = view.remainingMs <= 0
          const unexplored = t.galaxyId ? !isExplored(state, t.galaxyId) : true
          const notCandidate = base ? !isLairCandidate(base) : true
          // 声望门槛 = **接取条件**（2026-09-10 船长定）：不够也能在板上看见，但出发被拒
          const reqStanding = base?.standingReq ?? 0
          const standingMet = standing >= reqStanding
          const lockedTxt = !base || notCandidate
            ? tr("ui.Expedition.292")
            : !standingMet
              ? tr("ui.Expedition.119", { reqStanding: reqStanding, standing: standing })
              : unexplored
                ? tr("ui.Expedition.287")
                : expired
                  ? tr("ui.Expedition.230")
                  : inFlightSelf
                    ? tr("ui.Expedition.293")
                    : inFlightOther
                      ? tr("ui.Expedition.289")
                      : state.transit.active
                        ? tr("ui.Expedition.167")
                        : undefined
          const canGo = lockedTxt === undefined || (goAsk === t.id && !inFlightOther)
          return (
            <div key={t.id} className={`app-station-card is-foe-art${standingMet ? '' : ' is-locked'}`}>
              {/* 舰影列（2026-09-13 船长）：族取该任务**主题悬赏卡**（档位强化卡与原卡同族，`lairAnomalyOf` 不改族） */}
              {showFoeArt && base ? <FoeArt fam={foeFamilyOf(base)} shipId={foeCardShipIdOf(base)} /> : null}
              <div className="app-foe-main">
              <div className="app-station-head">
                <span className="app-station-name">
                  {tr("ui.Expedition.061")}{t.lairName ?? card?.name ?? t.anomalyId}
                  <em className="app-chip">{lairTierText(tier)}{tr("ui.Expedition.294")}</em>
                  {reqStanding > 0 ? (
                    <em className={`app-chip${standingMet ? '' : ' is-dim'}`} title={tr("ui.Expedition.175", { reqStanding: reqStanding, standing: standing })}>
                      {standingMet ? (
                        tr("ui.Expedition.337", { reqStanding: reqStanding })
                      ) : (
                        <>
                          <span className="app-ico">
                            <Glyph name="ico-lock" size={12} color={ICO_TONES['ico-lock']} />
                          </span>
                          {tr("ui.Expedition.338")} {reqStanding}
                        </>
                      )}
                    </em>
                  ) : null}
                </span>
                <span className="app-dim">{tr("ui.Expedition.114")} {fmtDayClock(view.bountyRemainingMs)}</span>
              </div>
              {/* 目标行：星系 + 安全等级 + 威胁 + 守军波次（关键字变色；2026-09-10 船长定） */}
              <div className="app-lair-kv">
                <span>{tr("ui.Expedition.283")}{galaxyName}」</span>
                {galaxy?.security !== undefined ? (
                  <span className={`app-sec-chip app-sec-chip-${secTone(galaxy.security)}`} title={tr("ui.Expedition.271")}>
                    {secText(galaxy.security)}
                  </span>
                ) : null}
                {card ? (
                  <span>
                    <span className="app-lair-key">{tr("ui.Expedition.089")}</span> {card.threat}
                    {base && card.threat !== base.threat ? <span className="app-dim">{tr("ui.Expedition.339")} {base.threat}）</span> : null}
                  </span>
                ) : null}
                {waves >= 2 ? (
                  <span>
                    <span className="app-lair-key">{tr("ui.Expedition.120")}</span> {waves}{tr('ui.Expedition.410')}
                  </span>
                ) : null}
                {/* 地图级别提示（2026-09-10 船长定）：级别 < 3 的星系出不了高档位，不写清楚玩家会当成 bug */}
                {base && lairLevelOf(base) < 3 ? (
                  <span title={tr("ui.Expedition.295")}>
                    <span className="app-lair-key">{tr("ui.Expedition.239")}</span> {lairTierText(lairLevelOf(base))}
                  </span>
                ) : null}
              </div>
              {/* 胜率行：与常驻悬赏卡同口径（火力 → 预估胜率%·损耗 + 敌主伤/敌型 chip） */}
              <div className="app-ano-win">
                {tr("ui.Expedition.217")} {power} → <span className="app-lair-key">{tr("ui.Expedition.334")}</span>{' '}
                <b
                  className={`app-win-${chanceTone}`}
                  title={
                    card
                      ? tr("ui.Expedition.176", { p1: Math.round((fc?.armorLoss ?? 0) * 100), p2: Math.round((fc?.hullLoss ?? 0) * 100) })
                      : tr("ui.Expedition.296")
                  }
                >
                  {Math.round(chance)}%
                </b>
                {card ? (
                  <span
                    className="app-dim"
                    title={tr("ui.Expedition.240")}
                  >
                    {' '}{tr('ui.Expedition.366')}<FoeDamageMix anomaly={card} />
                  </span>
                ) : null}
                {card
                  ? (() => {
                      const p = card.defProfile ?? 'balanced'
                      const cn = p === 'shield' ? tr("ui.Expedition.272") : p === 'armor' ? tr("ui.Expedition.273") : tr("ui.Expedition.098")
                      return (
                        <span className="app-dim" title={tr("ui.Expedition.241")}>
                          {' '}{tr('ui.Expedition.367')}<ProfileChip profile={p} text={cn} />
                        </span>
                      )
                    })()
                  : null}
              </div>
              {/* 收益行：赏金 = 窝点奖金 + 任务酬金（合并成一条，避免两个数重复）；稀有残骸为战利品 */}
              <div className="app-ano-reward">
                <span className="app-lair-key">{tr("ui.Expedition.297")}</span> {MONEY_GLYPH} {totalIsk.toLocaleString('zh-CN')} {tr("ui.FirstTasks.003")}
                <span className="app-dim" title={tr("ui.Expedition.298", { p1: lairRewardIsk.toLocaleString('zh-CN'), p2: t.rewardIsk.toLocaleString('zh-CN') })}>
                  {' '}{tr("ui.Expedition.340")} {lairRewardIsk.toLocaleString('zh-CN')} {tr("ui.Expedition.062")} {t.rewardIsk.toLocaleString('zh-CN')}）
                </span>
                {' · '}
                <span className="app-lair-key">{tr("ui.IndustryPage.009")}</span> ×{rareGain}
              </div>
              <div className="app-ano-desc">
                {tr("ui.Expedition.299")}
              </div>
              <div className="app-station-deliver">
                <span className="app-dim">
                  {state.mining.active
                    ? tr("ui.Expedition.170")
                    : tr("ui.Expedition.177", { standing: standing })}
                </span>
                {inFlightSelf ? (
                  <span className="app-btn is-small is-primary" aria-disabled title={tr("ui.Expedition.293")}>
                    {tr("ui.Expedition.057")}
                  </span>
                ) : (
                  <button
                    className="app-btn is-small is-primary"
                    disabled={!canGo}
                    title={goAsk === t.id ? tr("ui.Expedition.063") : lockedTxt ?? tr("ui.Expedition.121", { galaxyName: galaxyName, p2: t.lairName ?? '' })}
                    onClick={() => go(t)}
                  >
                    {goAsk === t.id ? tr("ui.Expedition.291") : tr("ui.Expedition.101")}
                  </button>
                )}
              </div>
              </div>
            </div>
          )
        })}
        </>
      )}
    </div>
  )
}

/** 快递投送在途横幅（2026-09-18 虚拟货物版）：体积/级别/限时与截止倒计时；到站自动结算不可取消 */
function CourierInFlightBanner({ view, ctx }: { view: SideTaskBoardView; ctx: SimContext }) {
  const d = view.deliver
  if (!d) return null
  const legacyName = d.refId.length > 0 ? ctx.items.get(d.refId)?.name ?? d.refId : ''
  const head =
    d.volumeM3 > 0
      ? `投送中：虚拟货物 ${d.volumeM3.toLocaleString('zh-CN')} m³（L${d.level}${d.timed ? tr("ui.Expedition.358") : ''}）→ 「${d.stationName}」（${d.galaxyName}）`
      : tr("ui.Expedition.178", { legacyName: legacyName, p2: d.need.toLocaleString('zh-CN'), p3: d.stationName, p4: d.galaxyName })
  return (
    <div className="app-station-card is-built">
      <div className="app-station-head">
        <span className="app-station-name">
          ⌁ {head}
          <em className="app-chip">{d.remainingMs > 0 ? tr("ui.Expedition.122") : tr("ui.Expedition.123")}</em>
        </span>
        <span className="app-dim">
          {d.remainingMs > 0 ? tr("ui.Expedition.341", { p1: fmtSideClock(d.remainingMs) }) : tr("ui.Expedition.124")}
          {d.deadlineRemainingMs !== null
            ? d.deadlineRemainingMs >= 0
              ? tr("ui.Expedition.359", { p1: fmtSideClock(d.deadlineRemainingMs) })
              : tr("ui.Expedition.360")
            : ''}
        </span>
      </div>
      <div className="app-station-mats">
        {tr('ui.Expedition.411')}
      </div>
    </div>
  )
}

/** 建站族任务卡：状态 / 档位进度 / 提交 / 通讯重看（siteIds 为空数组时不显示任何卡——任务初期不出现） */
function StationCard({ engine, onToast, siteIds }: { engine: GameEngine; onToast: ToastFn; siteIds?: string[] }) {
  const state = engine.state
  const [comm, setComm] = useState<string | null>(null)
  const [qty, setQty] = useState<number>(0)
  const [selItem, setSelItem] = useState<Record<string, string>>({})
  const sites = siteIds
    ? siteIds.flatMap((id) => {
        const s = engine.ctx.stations.get(id)
        return s ? [s] : []
      })
    : [...engine.ctx.stations.values()]
  return (
    <>
      {sites.map((site) => {
        const galaxy = engine.ctx.galaxies.get(site.galaxyId)
        const explored = galaxy ? isExplored(state, galaxy.id) : false
        const prog = state.stationSites[site.id] ?? { stage: 0, delivered: {} }
        const built = prog.stage >= site.tiers.length
        const tier = !built ? site.tiers[prog.stage]! : null
        // 2026-09-09：逐档材料单视图（当前档每项需求/已缴/剩余）
        const billRows = !built ? stationBillView(state, engine.ctx, site) : []
        const need = billRows.reduce((s, r) => s + r.need, 0)
        const delTotal = billRows.reduce((s, r) => s + r.delivered, 0)
        const remain = billRows.reduce((s, r) => s + r.remaining, 0)
        const itemId = selItem[site.id] ?? billRows[0]?.itemId ?? ''
        // 工地现场 = 停靠该站，或野外停留于站点星系（2026-09-06 修复：现场交付无需"先停靠"）
        const presentAtSite = playerAtSite(state, site)
        const availOf = (id: string): number =>
          (state.warehouse.items[id] ?? 0) + (state.fleet[state.shipId]?.cargo[id] ?? 0)
        const selRow = billRows.find((r) => r.itemId === itemId)
        const avail = itemId ? availOf(itemId) : 0
        // 2026-09-08 一键「前往工地交付」＝交付循环（物理载货：装仓库建材→到点清仓→自动续趟→建成或仓库耗尽终止）
        const tripOn = state.transit.active && state.transit.delivery?.siteId === site.id
        /**
         * ⚠ **2026-09-22 船长令**：「建设空间站的运输也加入可以打断其他行为的切换里，不需要先暂停其他活动」
         * ⇒ 原先的 `tripBusy`（开采/远征/打捞/掩护巡逻/在途/亲自开炉/亲自开线 任一项在跑就置灰）**整段删掉**：
         * 那些活动由 core 的统一判据裁决（能自动停的先停掉 ＋ 一条统一日志；远征/快递直接拒）。
         *
         * 位置门槛只保留两种"点了也白点"的情形：
         * ① 舰船在野外**且手上没有可停的活动**（纯野外留守）⇒ 得先自己返航；
         * ② `transit` 槽被占着（换港返航 / 另外一条在建的交付航线）⇒ 同一个槽，等它跑完。
         * 其余一律交给 core 判（`mainActivityOf` 与 activityGate 同源）。
         */
        const tripAway = state.awayGalaxy !== null
        const tripReadyDock = !tripAway || mainActivityOf(state) !== null
        const tripBusy = state.transit.active && !tripOn
        const wareStock = billRows.reduce((s, r) => s + (state.warehouse.items[r.itemId] ?? 0), 0)
        const tripFreeM3 = Math.max(
          0,
          Math.floor(cargoCapacityM3Of(state, engine.ctx, state.shipId) - cargoUsedM3Of(state, engine.ctx, state.shipId)),
        )
        const tripBlocked = tripOn || !tripReadyDock || tripBusy || wareStock <= 0 || tripFreeM3 <= 0
        const want = Math.min(Math.max(0, Math.floor(qty)), selRow ? selRow.remaining : 0, avail)
        const intro = site.introDialogueId ? engine.dialogues.find((d) => d.id === site.introDialogueId) : undefined
        return (
          <div key={site.id} className={`app-station-card${built ? ' is-built' : ''}`}>
            <div className="app-station-head">
              <span className="app-station-name">
                {site.name}
                {built ? <em className="app-chip app-station-built"><span className="app-ico"><Glyph name="ico-crane" size={12} color={ICO_TONES["ico-crane"]} /></span>{tr("ui.Expedition.179")}</em> : null}
                {!built && tier ? (
                  <em className="app-chip">{tr("ui.Expedition.180")}{tier.name}」</em>
                ) : null}
              </span>
              <span className="app-dim">
                {galaxy?.name ?? site.galaxyId}
                {galaxy?.security !== undefined ? (
                  <span className={`app-sec-chip app-sec-chip-${secTone(galaxy.security)}`}>
                    {secText(galaxy.security)}
                  </span>
                ) : null}
                {presentAtSite && state.dockedSite === site.id ? (
                  tr('ui.Expedition.412')
                ) : state.awayGalaxy === null && state.dockedSite === null ? (
                  tr('ui.Expedition.413')
                ) : state.awayGalaxy === site.galaxyId ? (
                  tr('ui.Expedition.414')
                ) : (
                  ''
                )}
              </span>
            </div>
            <div className="app-dim">{site.description}</div>
            {(() => {
              // 2026-09-09：展示各档材料单（精炼矿物；排除原矿）
              const billTxt = (t: (typeof site.tiers)[number]): string =>
                t.bill.map((b) => `${engine.ctx.items.get(b.itemId)?.name ?? b.itemId}×${b.count.toLocaleString('zh-CN')}`).join(' + ')
              return (
                <div className="app-station-mats">
                  {tr("ui.Expedition.181")}
                  {site.tiers.map((t, i) => (
                    <div key={t.name} className="app-dim">
                      {i + 1}·{t.name}：{billTxt(t)}
                    </div>
                  ))}
                  <span className="app-dim">{tr("ui.Expedition.064")}</span>
                </div>
              )
            })()}
            <div className="app-station-tiers">
              {site.tiers.map((t, i) => {
                const billTxt = t.bill
                  .map((b) => `${engine.ctx.items.get(b.itemId)?.name ?? b.itemId}×${billNeedOf(state, site, i, b.itemId).toLocaleString('zh-CN')}`)
                  .join(' + ')
                return (
                  <span key={t.name} className={`app-station-tier${prog.stage > i ? ' is-done' : ''}${prog.stage === i && !built ? ' is-cur' : ''}`}>
                    {i + 1}·{t.name}：{billTxt}（{tierNeedOf(state, site, i).toLocaleString('zh-CN')} {tr("ui.ShipPage.100")}{prog.stage > i ? ' ✓' : ''}
                  </span>
                )
              })}
            </div>
            {!explored ? (
              <div className="app-dim">{tr("ui.Expedition.300")}</div>
            ) : built ? (
              <div className="app-dim">{tr("ui.Expedition.125")}</div>
            ) : tier ? (
              <>
                <div className="app-station-progress">
                  {billRows.length > 0 ? (
                    <div>
                      {billRows.map((r) => (
                        <div key={r.itemId} className="app-dim">
                          {r.itemName}{tr('ui.Expedition.415')}{r.delivered.toLocaleString('zh-CN')} / {r.need.toLocaleString('zh-CN')}
                          {r.remaining > 0 ? tr("ui.Expedition.342", { p1: r.remaining.toLocaleString('zh-CN') }) : ' ✓'}
                        </div>
                      ))}
                      <span className="app-dim">
                        {tr("ui.Expedition.242")} {remain.toLocaleString('zh-CN')} {tr("ui.Expedition.102")}{remain === 0 ? tr("ui.Expedition.343") : ''}
                      </span>
                    </div>
                  ) : null}
                </div>
                {presentAtSite ? (
                  <div className="app-station-deliver">
                    <span className="app-dim">{tr("ui.Expedition.182")}</span>
                    <select
                      className="app-select"
                      value={itemId}
                      onChange={(e) => setSelItem((prev) => ({ ...prev, [site.id]: e.target.value }))}
                    >
                      {billRows.map((r) => (
                        <option key={r.itemId} value={r.itemId}>
                          {r.itemName}{tr("ui.Expedition.344")} {availOf(r.itemId).toLocaleString('zh-CN')}{tr('ui.Expedition.371')}{r.remaining.toLocaleString('zh-CN')}）
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min={0}
                      max={avail}
                      value={Number.isFinite(qty) && qty > 0 ? qty : ''}
                      placeholder={tr("ui.Expedition.003")}
                      onChange={(e) => setQty(Number(e.target.value))}
                      style={{ width: 90 }}
                    />
                    <button
                      className="app-btn is-small is-primary"
                      disabled={want <= 0}
                      title={want > 0 ? tr("ui.Expedition.183", { p1: want.toLocaleString('zh-CN') }) : tr("ui.Expedition.243")}
                      onClick={() => {
                        const r = engine.deliverSiteAt(site.id, itemId, want)
                        if (!r.ok) onToast(cmdText(r) || tr('ui.Expedition.416'), true)
                        else onToast(tr("ui.Expedition.184"))
                        setQty(0)
                      }}
                    >
                      {tr("ui.Expedition.185")}
                    </button>
                  </div>
                ) : (
                  <div className="app-station-deliver">
                    <span className="app-dim">
                      {tr("ui.Expedition.065")}
                    </span>
                    <button
                      className="app-btn is-small is-primary"
                      disabled={tripBlocked}
                      title={
                        tripOn
                          ? tr("ui.Expedition.029")
                          : !tripReadyDock
                            ? tr("ui.Expedition.301")
                            : tripBusy
                              ? tr("ui.Expedition.345")
                              : tripFreeM3 <= 0
                                ? tr("ui.Expedition.267")
                                : wareStock <= 0
                                  ? tr("ui.Expedition.066", { p1: billRows.map((r) => `${r.itemName}×${r.remaining.toLocaleString('zh-CN')}`).join(tr("ui.MatterTechTab.017")) })
                                  : tr("ui.Expedition.067", { p1: galaxy?.name ?? site.galaxyId, p2: tripFreeM3.toLocaleString('zh-CN') })
                      }
                      onClick={() => {
                        const r = engine.deliverTripAt(site.id)
                        if (!r.ok) onToast(cmdText(r) || tr('ui.Expedition.389'), true)
                        else onToast(tr("ui.Expedition.093", { p1: site.name }))
                      }}
                    >
                      <span className="app-ico"><Glyph name="ico-home" size={13} color={ICO_TONES["ico-home"]} /></span>
                      {tripOn ? tr("ui.Expedition.034") : tr("ui.Expedition.094")}
                    </button>
                  </div>
                )}
              </>
            ) : null}
            {intro ? (
              <button
                className="app-btn is-small"
                title={tr("ui.Expedition.346")}
                onClick={() => {
                  const r = engine.openDialogue(intro.id)
                  if (r.ok) setComm(intro.id)
                  else onToast(cmdText(r) || tr('ui.Expedition.417'), true)
                }}
              >
                <span className="app-ico"><Glyph name="ico-antenna" size={13} color={ICO_TONES["ico-antenna"]} /></span>{tr("ui.Expedition.347")}
              </button>
            ) : null}
          </div>
        )
      })}
      {comm ? (
        <Communicator
          script={engine.dialogues.find((d) => d.id === comm)!}
          onClose={() => setComm(null)}
        />
      ) : null}
    </>
  )
}


