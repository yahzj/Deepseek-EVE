/**
 * M3 远征中心：势力声望、星图（SVG）、悬赏任务卡。
 * 中列面板：SkirmishStatus（远征中作业）→ StarMap（可点选）→ Standing → 任务列表。
 */
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'
import type { AnomalyDef, GalaxyDef, AiCoreType, SimContext, SideTask, SideTaskBoardView } from '@whale/core'
// 2026-09-23 船长令：使用 AI 核心时默认选「当前拥有的最高级核心」
import { bestAiCoreOf } from '@whale/core'
import {
  AI_CORE_ORDER,
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
  weekendProgressAt,
  weekendCoreGateView,
  /** 旗舰视图（2026-09-25：核心的"旗舰期红光"与旗舰准备入口读同一份判据，不许在本文件另判一遍） */
  weekendFlagshipView,
  weekendFoePoolOf,
  /** 2026-09-25 船长令：核心节点上方那根**母舰血量条**（读数与事件日志那条同源） */
  weekendBossPoolView,
  /** 2026-09-25 船长令：已收复星系的常驻悬赏**押后到活动结束**（板面与星系详细都按它隐藏） */
  weekendStandingBountyHeldAt,
  cargoCapacityM3Of,
  cargoUsedM3Of,
  countAiCore,
  expeditionStatus,
  fleetDefOf,
  foeLayerSplit,
  formatDurationMs,
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
import { tr, useL10n, cmdText } from '../i18n/locale'
import type { ToastFn } from '../pages/common'
import { DmgChip, FoeDamageMix, ProfileChip } from '../ui/shipInfo'
import { FirstTasks } from './FirstTasks'
import { MilestoneTasks } from './MilestoneTasks'
import { ImportantTasks } from './ImportantTasks'
import { Glyph, NAV_TONES, ICO_TONES } from '../ui/Glyphs'
import { UI_TONES } from '../ui/tones'
import { WeekendFlagshipPrepModal } from './WeekendFlagshipPrep'
import { FOE_ACCENT, FOE_FAMILY_LABEL, foeFamilyOf } from '../ui/shipArt'
import { briefsOfPool, mountLabelText } from '../ui/foeBrief'
import { hoverTipProps } from '../ui/Tooltip'
import { sessionPick, setSessionPick, useSessionScroll } from '../ui/sessionView'
import { foeCardShipIdOf as coreFoeCardShipIdOf } from '@whale/core'
import { ShipSprite } from '../ui/ShipSprite'
// ⚠ 舰船角色名走本地化单点（2026-09-26 船长报障「舰船类型文本漏中文」）——core 的 shipRoleLabel 是纯中文表
import { lairTierText, shipRoleText } from '../ui/labelsText'

/* ─────────── 敌舰影列（2026-09-13 船长：「在常驻悬赏内，将悬赏敌族的舰船 SVG 图形，
 * 像我的舰队里的我方舰船那样，放入悬赏的最左侧」——同批扩到任务中心两处敌族卡） ───────────
 * 口径与舰队卡（ShipPage.FleetArt / .app-ship-card.is-fleet）**逐条同款**：列宽固定、置卡片最左侧、
 * 容器实测宽不足时整列不渲染（不留空位）；图形取**敌族形**（`FOE_ART` 的 A~G 族字母），
 * 配色取敌族色 `FOE_ACCENT`——与战斗画面 `BattleScreen` 同一取形/取色口径，不新增美术资产。
 * 族来源一律是**数据侧** `AnomalyDef.foeFamily`（`foeFamilyOf`，全仓唯一缺省点），不另建映射表。 */
/** 舰影列宽（与 ShipPage.FLEET_ART_W 同值：三处悬赏卡与舰队卡观感一致） */
const FOE_ART_W = 132
/** 舰影列与右侧信息列的间距（与 CSS .is-foe-art 的 gap 保持一致） */
const FOE_ART_GAP = 10
/** 右侧信息列可读下限（再窄就藏舰影；与 ShipPage.FLEET_MAIN_MIN 同值） */
const FOE_ART_MAIN_MIN = 560

/**
 * **悬赏敌舰影（置卡片最左侧）**。
 *
 * 2026-09-26 船长令「旧版敌人按敌舰不同做出些许区分」——舰影由**族形**改为**逐舰形**：
 * `shipId` = 该卡的代表舰级 id（30 条敌舰各画各的），未给/未录 → 按 `fam` 落族形兜底。
 * 代表舰 = **本卡最高档那一条**（同档优先头目档）——玩家一眼看到的是本卡最危险的那型，
 * 档位来自 core `foeShipTierOf`/`foeShipEliteOf`（与体积、舰名同一次反查，不另推一套）。
 *
 * memo：引擎每 tick 触发整树重渲染（App 层订阅 force），舰影 props（族字母 + 舰级 id）恒定即整棵 SVG 子树跳过 diff。
 * 不带尾焰（engine={false}）——列表里的静止展示件，与舰队卡同款；不翻转（船头朝右、面向右侧信息）。
 * 悬浮提示用词典既有族短名表（星图「敌对派系」模式同一张表），不新造称呼。
 */
const FoeArt = memo(function FoeArt({ fam, shipId }: { fam: string; shipId?: string }) {
  return (
    <div className="app-ship-art" title={tr("ui.Expedition.186", { p1: FOE_FAMILY_LABEL[fam] ?? fam })}>
      {/* 未知敌族的兜底色：原来写的是一个色板里不存在的 token（wui-tone-a）⇒ 静默无色，
          2026-09-24 由 token 契约抓出 ⇒ 换成既有的中性色 --wui-dim（注：注释里不写完整 var(...) 写法，
          免得契约扫描把注释也当成引用） */}
      <ShipSprite
        shipId={shipId}
        foeKey={fam}
        accent={FOE_ACCENT[fam] ?? 'rgb(var(--wui-dim))'}
        size={FOE_ART_W}
        engine={false}
      />
    </div>
  )
})

/** 卡片代表舰（本卡最强那型；口径与编成枚举同在 core `foeCardShipIdOf`，界面不另推档位） */
function foeCardShipIdOf(a: AnomalyDef): string | undefined {
  return coreFoeCardShipIdOf(a) ?? undefined
}

/**
 * 舰影列自适应：容器实测宽 ≥ 舰影列 + 间距 + 信息列下限 ⇒ 显示舰影。
 * 判定取容器的 clientWidth（已扣滚动条），不用窗口宽猜——与 `ShipPage` 舰队页同一套做法与常量
 * （卡片高由右侧信息列决定、舰影更矮，故显隐不会反过来改变容器宽，无振荡）。
 */
function useFoeArtFit(ref: RefObject<HTMLElement | null>): boolean {
  const [show, setShow] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const update = (): void => {
      const next = el.clientWidth >= FOE_ART_W + FOE_ART_GAP + FOE_ART_MAIN_MIN
      setShow((old) => (old === next ? old : next))
    }
    update() // 首帧先量一次（布局阶段、绘制前，无闪烁）
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return show
}

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
  const standing = standingOf(state, DSI_FACTION_ID)
  const view = expeditionStatus(state, engine.ctx)
  const scan = scanStatus(state)
  const tv = transitStatus(state, engine.ctx)

  return (
    <Panel
      className="is-fill app-exp-panel"
      title={tr("ui.Expedition.187")}
      right={<span className="app-standing">{tr("ui.Expedition.068")} {standing}</span>}
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
                  ? tr("ui.Expedition.126", { p1: tv.siteName ?? '', p2: formatDurationMs(Math.max(0, state.transit.finishAtGameMs - state.gameMs)) })
                  : tr("ui.Expedition.244", { p1: formatDurationMs(Math.max(0, state.transit.finishAtGameMs - state.gameMs)) })}
              </>
            )
            : ''}
          {state.transit.active && (scan.active || view.active) ? ' ｜ ' : ''}
          {scan.active ? (
            <>
              <span className="app-ico">
                <Glyph name="ico-scan" size={12} color={ICO_TONES['ico-scan']} />
              </span>
              {tr("ui.Expedition.127", { p1: formatDurationMs(scan.remainingMs) })}
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
              : tr("ui.Expedition.010", { p1: view.anomalyName, p2: view.galaxyName, p3: view.phaseLabel, p4: formatDurationMs(view.remainingMs) })
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
 * 2026-09-10 船长定：改称「常驻悬赏」——与任务中心的「赏金任务」（临时战斗任务）区分） ─────────── */
export function BountyPanel({ engine, onToast }: { engine: GameEngine; onToast: ToastFn }) {
  const state = engine.state
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
  // ⚠ **2026-09-25 船长令**：「入侵期间，被占领星系的所有被收复的星系的常驻悬赏依旧处于隐藏状态，
  // 要等到入侵活动结束」⇒ 再叠一条 core 判据（`weekendStandingBountyHeldAt`，只在板面这一层过滤；
  // 遇袭敌群池与残骸打捞池读的是 `weekendBountyCardsOf`，不受影响）。
  const listed = engine.anomalies.filter((a) => {
    if (weekendStandingBountyHeldAt(state, a.galaxyId, Date.now())) return false
    const g = engine.ctx.galaxies.get(a.galaxyId)
    return g ? isExplored(state, g.id) : true
  })

  // —— 悬赏任务排序（2026-09-09：默认 = 危险 = 目标星系安全等级 sec 降序、安全在前；次级均按名称） ——
  const byName = (x: { a: AnomalyDef }, y: { a: AnomalyDef }): number =>
    x.a.name.localeCompare(y.a.name, 'zh-Hans-CN') || x.a.id.localeCompare(y.a.id)
  const galaxySecOf = (a: AnomalyDef): number => engine.ctx.galaxies.get(a.galaxyId)?.security ?? 1
  const items = listed.map((a) => {
    const galaxy = engine.ctx.galaxies.get(a.galaxyId)
    const mins = shortestTravelMinutes(engine.ctx, originGalaxyOf(state, engine.ctx), a.galaxyId)
    return {
      a,
      galaxyName: galaxy?.name ?? a.galaxyId,
      dist: Number.isFinite(mins) ? mins : Number.POSITIVE_INFINITY,
      reward: a.rewardIsk,
      standing: a.standingGain,
    }
  })
  const sorted = [...items].sort((x, y) => {
    if (sort === 'danger') {
      const gx = galaxySecOf(x.a)
      const gy = galaxySecOf(y.a)
      if (gx !== gy) return gy - gx // sec 降序 = 安全在前
      return byName(x, y)
    }
    if (sort === 'distance') {
      if (x.dist !== y.dist) return x.dist - y.dist
      return byName(x, y)
    }
    if (sort === 'galaxy') {
      const g = x.galaxyName.localeCompare(y.galaxyName, 'zh-Hans-CN')
      if (g !== 0) return g
      return byName(x, y)
    }
    if (sort === 'reward') {
      if (x.reward !== y.reward) return y.reward - x.reward
      return byName(x, y)
    }
    if (sort === 'standing') {
      if (x.standing !== y.standing) return y.standing - x.standing
      return byName(x, y)
    }
    return byName(x, y)
  })

  return (
    <Panel
      className="is-fill"
      title={tr("ui.MapPage.004")}
      right={<span className="app-dim">{tr("ui.Expedition.131")} {listed.length} {tr("ui.Expedition.132")}</span>}
    >
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
    </Panel>
  )
}

/* ─────────── 星图（SVG：名称在图标正下方 + 布局拖拽编辑器） ─────────── */

const MAP_W = 700
const MAP_H = 300
/**
 * 画布边缘留白（2026-09-10 船长：星图边缘要挪出足够位置）。
 * 节点上方要叠「徽标 + 倒计时」两层（最高到节点中心上方约 33 单位），贴顶星系会顶出画布被裁；
 * 这里把可视范围向上扩 PAD_TOP、左右各扩 PAD_X——**内容坐标仍按 (0,0)-(700,300) 记账**
 * （布局数据 / 本地覆盖 / 编辑器坐标一律不变，只改 viewBox 的可视范围）。
 */
const MAP_PAD_TOP = 20
const MAP_PAD_X = 8
/** 敌对派系活跃"选中方框"边长（2026-09-10 船长：用方框选中目标星系）——34 足以框住最大 r=11 的母港形节点 */
const FACTION_BOX_M = 34
/** viewBox 与实际内容尺寸（拖拽换算用；getBoundingClientRect 覆盖的是含留白的可视范围） */
const MAP_VB_W = MAP_W + MAP_PAD_X * 2
const MAP_VB_H = MAP_H + MAP_PAD_TOP
/**
 * 布局本地覆盖键（v2，2026-09-05）：船长本地排版坐标已合入内置默认（universe.ts，并整体左移 14），
 * 旧键 v1（whale-idle:starmap-layout，09-04 编辑器排版本）一律不再读取——
 * 旧本地覆盖会遮蔽新默认（此前改内置坐标看不到变化即此因）；今后编辑器排完版「保存并复制 JSON」合入默认即可。
 */
const LAYOUT_KEY = 'whale-idle:starmap-layout-v2'
/** v1 旧键（whale-idle:starmap-layout）已作废且不再读取：启动时顺手删除本地残留数据 */
const LEGACY_LAYOUT_KEY = 'whale-idle:starmap-layout'
try {
  localStorage.removeItem(LEGACY_LAYOUT_KEY)
} catch {
  // 存储不可用时忽略（布局编辑器本就依赖 localStorage，读不到也无碍）
}
/**
 * 开发模式开关：星图布局编辑器（拖拽/交叉检测/自动整理/导出 JSON）默认对玩家隐藏；
 * 需要调整布局时在 DevTools 执行 localStorage.setItem('whale-idle:dev-layout','1') 后刷新页面即可显示入口。
 */
const DEV_EDITOR_KEY = 'whale-idle:dev-layout'

/* ── 星图显示模式（2026-09-11 船长：名称 / 安全等级 / 敌对派系 三态互斥） ── */

/** 三种显示模式：星系名称（默认）/ 安全等级数字 / 敌对派系标签 */
type LabelMode = 'name' | 'sec' | 'faction'
/** 本地记忆键（与其它星图偏好同前缀） */
const LABEL_KEY = 'whale-idle:starmap-label'
const LABEL_MODES: ReadonlyArray<{ key: LabelMode; label: string; tip: string }> = [
  { key: 'name', label: tr("ui.MapPage.001"), tip: tr("ui.Expedition.190") },
  { key: 'sec', label: tr("ui.Handbook.065"), tip: tr("ui.Expedition.191") },
  { key: 'faction', label: tr("ui.Expedition.192"), tip: tr("ui.Expedition.193") },
]

function readLabelMode(): LabelMode {
  try {
    const v = localStorage.getItem(LABEL_KEY)
    return v === 'sec' || v === 'faction' ? v : 'name'
  } catch {
    return 'name'
  }
}

/** 族标签字宽估算（SVG 里量不了 DOM：按字号 + 内边距估；几何自检探针用同一公式）。
 *  **2026-09-11 修**：文字字号与星系名一致 = 11px（styles.css `.app-map-famchip-text`），
 *  中文全角字宽 ≈ 字号 → 每字 11、左右各留 5；初版按 9.5 且未给字号，实机撑出标签框（船长发现）。 */
const FAM_CHIP_CHAR_W = 11
const FAM_CHIP_PAD_X = 5
const FAM_CHIP_GAP = 3
const FAM_CHIP_H = 14
const FAM_CHIP_Y = 12 // 标签顶边相对星系中心的高度（文字基线 ≈ 中心 +22.5，与名称基线 +21 同带）
const FAM_CHIP_BASE = 10.5 // 文字基线相对标签顶边（11px 字在 14 高里的垂直居中）
const famChipW = (text: string): number => text.length * FAM_CHIP_CHAR_W + FAM_CHIP_PAD_X * 2

type LayoutMap = Record<string, { x: number; y: number }>

function readLayoutOverride(): LayoutMap {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as LayoutMap
    return typeof parsed === 'object' && parsed !== null ? parsed : {}
  } catch {
    return {}
  }
}

/** 名称放在图标正下方（恒为两节点下方，同航道已按名宽留距） */
function NodeLabel({ name, x, y, cls }: { name: string; x: number; y: number; cls?: string }) {
  return (
    <text x={x} y={y + 21} textAnchor="middle" className={`app-map-label${cls ?? ''}`}>
      {name}
    </text>
  )
}

/**
 * 敌对派系标签行（2026-09-11 船长：「文字的颜色以敌族进行划分并采用标签化展示，
 * 以和安全等级明显区分」）——每枚 = SVG 圆角矩形 + 文字，颜色统一取该族色
 * （`FOE_ACCENT`，与战场敌舰同源；见 styles.css 的 `.app-map-famchip.is-fam-*`）；
 * 整行以星系圆点为中轴居中，取代名称位置。未探索 = 灰「未知」、无敌情 = 灰「无敌情」。
 */
function FamChips({
  chips,
  rowW,
  x,
  y,
  cls,
}: {
  chips: Array<{ text: string; fam: string; dim?: boolean }>
  rowW: number
  x: number
  y: number
  cls?: string
}) {
  let cursor = x - rowW / 2
  return (
    <g className={`app-map-famrow${cls ?? ''}`}>
      {chips.map((c, i) => {
        const w = famChipW(c.text)
        const rx = cursor
        cursor += w + FAM_CHIP_GAP
        return (
          <g key={`${c.text}-${i}`} className={`app-map-famchip${c.dim ? ' is-unknown' : ` is-fam-${c.fam}`}`}>
            <rect x={rx} y={y + FAM_CHIP_Y} width={w} height={FAM_CHIP_H} rx={3} fill="currentColor" fillOpacity={0.14} stroke="currentColor" strokeOpacity={0.55} strokeWidth={0.8} />
            <text x={rx + w / 2} y={y + FAM_CHIP_Y + FAM_CHIP_BASE} textAnchor="middle" fill="currentColor" className="app-map-famchip-text">
              {c.text}
            </text>
          </g>
        )
      })}
    </g>
  )
}

/* ── V16.1 安全等级（EVE 式 −1.0 ~ +1.0）：文字色阶与展示 ── */

/** 安全等级显示文本（+0.6 / 0.0 / −0.5） */
function secText(v: number | undefined): string {
  if (v === undefined) return ''
  return v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1)
}

/** 色阶类后缀（V16.2：≥0 安全向绿/黄；低于 0 即红，越近 −1 越偏紫） */
function secTone(v: number | undefined): string {
  if (v === undefined) return ''
  if (v >= 0.5) return '1'
  if (v >= 0) return '2'
  if (v >= -0.4) return '3'
  if (v >= -0.8) return '4'
  return '5'
}

/** 名称着色追加类（hub 保持金色徽标不参与） */
function secCls(v: number | undefined): string {
  const t = secTone(v)
  return t ? ` app-sec-${t}` : ''
}

/* ─────────── 通路交叉检测与整理（布局编辑器辅助） ─────────── */

interface Pt {
  x: number
  y: number
}
interface Seg {
  a: Pt
  b: Pt
}

function orient(p: Pt, q: Pt, r: Pt): number {
  const v = (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
  return v > 1e-9 ? 1 : v < -1e-9 ? -1 : 0
}

function onSeg(p: Pt, q: Pt, r: Pt): boolean {
  return (
    Math.min(p.x, q.x) <= r.x && r.x <= Math.max(p.x, q.x) && Math.min(p.y, q.y) <= r.y && r.y <= Math.max(p.y, q.y)
  )
}

const closePt = (u: Pt, v: Pt): boolean => Math.abs(u.x - v.x) < 1e-6 && Math.abs(u.y - v.y) < 1e-6

/** 两线段是否在内部交叉（共享端点不算——端点按坐标比较，因为线段对象每次渲染都会重建；退化/共线不算） */
function segsCross(s1: Seg, s2: Seg): boolean {
  if (closePt(s1.a, s2.a) || closePt(s1.a, s2.b) || closePt(s1.b, s2.a) || closePt(s1.b, s2.b)) return false
  const o1 = orient(s1.a, s1.b, s2.a)
  const o2 = orient(s1.a, s1.b, s2.b)
  const o3 = orient(s2.a, s2.b, s1.a)
  const o4 = orient(s2.a, s2.b, s1.b)
  if (o1 === 0 && onSeg(s1.a, s1.b, s2.a)) return false // 共线重叠不算（罕见）
  if (o2 === 0 && onSeg(s1.a, s1.b, s2.b)) return false
  if (o3 === 0 && onSeg(s2.a, s2.b, s1.a)) return false
  if (o4 === 0 && onSeg(s2.a, s2.b, s1.b)) return false
  return o1 * o2 < 0 && o3 * o4 < 0
}

/** 求两线段交点（segsCross 保证存在） */
function segIntersectPt(s1: Seg, s2: Seg): Pt {
  const a1 = s1.a
  const b1 = s1.b
  const a2 = s2.a
  const b2 = s2.b
  const den = (b1.x - a1.x) * (b2.y - a2.y) - (b1.y - a1.y) * (b2.x - a2.x)
  if (Math.abs(den) < 1e-9) return { x: (s1.a.x + s1.b.x) / 2, y: (s1.a.y + s1.b.y) / 2 }
  const t = ((a2.x - a1.x) * (b2.y - a2.y) - (a2.y - a1.y) * (b2.x - a2.x)) / den
  return { x: a1.x + t * (b1.x - a1.x), y: a1.y + t * (b1.y - a1.y) }
}

const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y)

/** 计算互相交叉的边对（返回边索引对） */
function findCrossings(segs: Seg[]): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      if (segsCross(segs[i]!, segs[j]!)) out.push([i, j])
    }
  }
  return out
}

/* ── 自动整理：确定性模拟退火最小化通路交叉 ── */

/** mulberry32 确定性随机数（同样输入 → 同样结果，便于撤销/复现） */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function clonePos(m: Map<string, Pt>): Map<string, Pt> {
  const o = new Map<string, Pt>()
  for (const [k, v] of m) o.set(k, { x: v.x, y: v.y })
  return o
}
function copyInto(dst: Map<string, Pt>, src: Map<string, Pt>): void {
  for (const [k, v] of src) dst.set(k, { x: v.x, y: v.y })
}
function countCrossings(pos: Map<string, Pt>, segNodes: Array<[string, string]>): number {
  return findCrossings(segNodes.map(([na, nb]) => ({ a: pos.get(na)!, b: pos.get(nb)! }))).length
}

interface TidyOpts {
  iterations: number
  t0: number
  t1: number
  sigma: number
  bigJumpP: number
  bigJumpSigma: number
  minDist: number
  crossW: number
  moveW: number
}

/**
 * 退火一轮：以 origPos 为锚点随机游走，代价 = 交叉数×crossW + 节点位移×moveW + 过近惩罚；
 * 始终返回过程中遇到的最优（最少交叉）布局快照。
 */
function annealUncross(
  segNodes: Array<[string, string]>,
  origPos: Map<string, Pt>,
  seed: number,
  cfg: TidyOpts
): { best: number; pos: Map<string, Pt> } {
  const rand = mulberry32(seed)
  const ids = [...origPos.keys()]
  const pos = clonePos(origPos)
  const segCount = segNodes.length
  const evalCost = (): number => {
    const segs = new Array<Seg>(segCount)
    for (let i = 0; i < segCount; i++) {
      const [na, nb] = segNodes[i]!
      segs[i] = { a: pos.get(na)!, b: pos.get(nb)! }
    }
    let cost = findCrossings(segs).length * cfg.crossW
    for (let a = 0; a < ids.length; a++) {
      for (let b = a + 1; b < ids.length; b++) {
        const d = dist(pos.get(ids[a])!, pos.get(ids[b])!)
        if (d < cfg.minDist) cost += (cfg.minDist - d) * 120
      }
    }
    for (const id of ids) {
      const p = pos.get(id)!
      const o = origPos.get(id)!
      cost += Math.hypot(p.x - o.x, p.y - o.y) * cfg.moveW
    }
    return cost
  }
  let cur = evalCost()
  let best = countCrossings(pos, segNodes)
  const bestPos = clonePos(origPos)
  let T = cfg.t0
  const cool = Math.pow(cfg.t1 / cfg.t0, 1 / Math.max(1, cfg.iterations))
  const gauss = (): number => {
    const u = rand() || 1e-9
    const v = rand()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }
  for (let it = 0; it < cfg.iterations; it++) {
    const id = ids[Math.floor(rand() * ids.length)]!
    const p = pos.get(id)!
    const sigma = rand() < cfg.bigJumpP ? cfg.bigJumpSigma : cfg.sigma
    const prev = { x: p.x, y: p.y }
    p.x = Math.min(MAP_W - 12, Math.max(12, p.x + gauss() * sigma))
    p.y = Math.min(MAP_H - 12, Math.max(12, p.y + gauss() * sigma))
    const nc = evalCost()
    if (nc <= cur || rand() < Math.exp(-(nc - cur) / T)) {
      cur = nc
      const c = countCrossings(pos, segNodes)
      if (c < best) {
        best = c
        copyInto(bestPos, pos)
      }
    } else {
      p.x = prev.x
      p.y = prev.y
    }
    T *= cool
  }
  return { best, pos: bestPos }
}

/**
 * 自动整理：第一轮全局退火（动得稍大），随后至多两轮"锚定上一轮结果"的本地抛光；
 * 交叉数不再下降即停止；返回整理后的坐标表（id → 四舍五入坐标），不修改入参。
 * 同一输入布局结果可复现。
 */
function autoTidy(posMap: Map<string, Pt>, segNodes: Array<[string, string]>): Record<string, Pt> {
  if (posMap.size < 2 || segNodes.length === 0) {
    const outEmpty: Record<string, Pt> = {}
    for (const [id, p] of posMap) outEmpty[id] = { x: Math.round(p.x), y: Math.round(p.y) }
    return outEmpty
  }
  const passes: Array<TidyOpts & { seed: number }> = [
    { seed: 20240917, iterations: 14000, t0: 160, t1: 0.35, sigma: 12, bigJumpP: 0.08, bigJumpSigma: 48, minDist: 46, crossW: 1500, moveW: 1.4 },
    { seed: 20240918, iterations: 9000, t0: 90, t1: 0.35, sigma: 8, bigJumpP: 0.05, bigJumpSigma: 30, minDist: 46, crossW: 1500, moveW: 2.6 },
    { seed: 20240919, iterations: 6000, t0: 70, t1: 0.35, sigma: 6, bigJumpP: 0.04, bigJumpSigma: 22, minDist: 46, crossW: 1500, moveW: 3.6 },
  ]
  let anchor = clonePos(posMap)
  for (const p of passes) {
    const before = countCrossings(anchor, segNodes)
    if (before === 0) break
    const res = annealUncross(segNodes, anchor, p.seed, p)
    if (res.best >= before) break // 无改进：保留当前
    anchor = res.pos
    if (res.best === 0) break
  }
  const out: Record<string, Pt> = {}
  for (const [id, p] of anchor) out[id] = { x: Math.round(p.x), y: Math.round(p.y) }
  return out
}

function StarMap({
  engine,
  onToast,
  onOpenWormhole,
}: {
  engine: GameEngine
  onToast: ToastFn
  /** 开虫洞面板（一路传到行动区的入口行；面板本体挂在 App 层） */
  onOpenWormhole?: () => void
}) {
  const state = engine.state
  const [editing, setEditing] = useState(false)
  /**
   * 星图显示模式（2026-09-11 船长：「在星图上添加切换按钮，让玩家可以快速在：显示星系名称、
   * 显示安全等级、显示敌对派系 之间切换」）——**三态互斥**，选择存本地、重启保留。
   */
  const [labelMode, setLabelMode] = useState<LabelMode>(readLabelMode)
  useEffect(() => {
    try {
      localStorage.setItem(LABEL_KEY, labelMode)
    } catch {
      // 存储不可用：本次会话内仍生效，只是不记忆
    }
  }, [labelMode])
  const [devEditor] = useState<boolean>(() => {
    try {
      return localStorage.getItem(DEV_EDITOR_KEY) === '1'
    } catch {
      return false
    }
  })
  const [override, setOverride] = useState<LayoutMap>(readLayoutOverride)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  /** 2026-09-08 船长：点星系行动改弹窗——星图不再被长详情纵向挤压 */
  const [modalId, setModalId] = useState<string | null>(null)
  /**
   * **「点了扫描就关窗」的防误触闸门**（船长 2026-09-18：「点下『扫描探索』的那一刻就关。
   * 但是要注意不要出现关闭窗口太快导致误触的情况」）。三道闸：
   * ① 关窗**延后 260ms**：让这一次点击彻底结束、按钮的按下态走完，窗口不会在指针还压着时凭空消失；
   * ② 关窗后 **420ms 内忽略星系节点的点击**：连点两下时，第二下不会顺手点开另一个星系的弹窗；
   * ③ 延后期间窗口照常显示（按钮已置灰），玩家看得见"已经点上了"。
   * 失败时（例如已有一处扫描在跑）**不关窗**——错误提示要留在弹窗里让他看见。
   */
  const nodeClickGuardUntilRef = useRef(0)
  const closeTimerRef = useRef<number | null>(null)
  const closeModalSoon = (): void => {
    if (closeTimerRef.current !== null) return
    nodeClickGuardUntilRef.current = Date.now() + 680
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null
      setModalId(null)
    }, 260)
  }
  useEffect(
    () => () => {
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current)
    },
    [],
  )
  const dragRef = useRef<{ id: string } | null>(null)
  const hubName = engine.ctx.galaxies.get('galaxy-hub')?.name ?? ''
  const selected: GalaxyDef | null = engine.ctx.galaxies.get(selectedId ?? '') ?? null
  /** 该星系已到手的稀有残骸（窝点战果）：与「残骸打捞」卡**同一份口径**（`pages/common.rareWreckRefsOf`） */
  const rare = selected ? rareWreckRefsOf(engine, selected.id) : { count: 0, text: '', refs: [] }
  const view = expeditionStatus(state, engine.ctx)
  const scan = scanStatus(state)

  // ── V13 探索迷雾：dev/编辑器模式看全图；正常模式 = 已探索亮 + 一跳剪影 + 其余隐藏 ──
  const devView = devEditor || editing
  const exploredIds: Set<string> = devView
    ? new Set(engine.galaxies.map((g) => g.id))
    : new Set(state.exploredGalaxies)
  const frontierIds: Set<string> = devView ? new Set() : new Set(frontierGalaxyIds(state, engine.ctx))
  const isFrontier = (id: string): boolean => frontierIds.has(id) && !exploredIds.has(id)
  // 悬赏情报例外：无论探索状态都统计（协会共享情报；剪影节点上显示数量徽标）
  const bountyByGalaxy = new Map<string, number>()
  for (const a of engine.anomalies) {
    bountyByGalaxy.set(a.galaxyId, (bountyByGalaxy.get(a.galaxyId) ?? 0) + 1)
  }

  /**
   * **周末入侵的占领区**（2026-09-23 船长令「继续补」；**2026-09-25 船长两次改版**：
   * ① 红圈 → **身后红色发光**；② **已夺回的外围不再发光** ＋ 旗子换成**节点上方的进度条**）。
   *
   * 于是这里出两张表：
   * - `invasionProgress`：**仍被占**（进度 < 1）的星系 → 进度 0~1 ⇒ 画发光与其上方的进度条；
   * - `invasionReclaimed`：**已夺回**的星系 → 只记 id（不发光、不画进度条，避免"打下来了还红着"的误导）。
   * 只在活动存在时收集（可见性由 core 的 `WEEKEND_DEBUG_ONLY` 单点判据决定：
   * **2026-09-25 船长已解除** ⇒ 正常模式照常有活动、这组标记照常画）。
   */
  const invasionProgress: Map<string, number> = (() => {
    const ev = state.weekendEvent
    if (!ev || ev.endedAtWallMs !== undefined) return new Map<string, number>()
    const now = Date.now()
    const out = new Map<string, number>()
    for (const id of [ev.coreId, ...ev.peripheryIds]) {
      const p = weekendProgressAt(state, ev, id, now)
      if (p < 1) out.set(id, p)
    }
    return out
  })()
  /** 核心：仍在入侵中（未结束）**且仍被占**才算 —— 已夺回的核心不再点亮 ★ */
  const invasionCoreId: string | undefined = (() => {
    const ev = state.weekendEvent
    if (!ev || ev.endedAtWallMs !== undefined) return undefined
    return invasionProgress.has(ev.coreId) ? ev.coreId : undefined
  })()
  /**
   * **核心的"旗舰期红光"**（船长 2026-09-25：「**入侵母舰没摧毁前，敌方核心星系需要依旧有红光。**」）：
   * 核心被夺回（进度 = 1）之后它就从 `invasionProgress`（= "仍被占"那张表）里掉出去了，
   * 可母舰还停在那一片 ⇒ 核心**要继续发红光**，只是**不再画那根进度条**（那根条画的是"夺回进度"，
   * 已经 100% 了）。
   * 判据走 core 的 `weekendFlagshipView`（与「发现敌方旗舰 → 战前准备」入口同一份）：**现身着且未落定局**。
   * 母舰被摧毁 ⇒ 活动收场（`endedAtWallMs`）⇒ 红光与 ★ 一起消失（上面两道判据都先查它）。
   */
  const invasionCoreHeld: string | undefined = (() => {
    const ev = state.weekendEvent
    if (!ev || ev.endedAtWallMs !== undefined) return undefined
    if (invasionProgress.has(ev.coreId)) return undefined // 还没夺回 ⇒ 上面那张表已经画了
    const nowMs = Date.now()
    const v = weekendFlagshipView(state, ev, nowMs, nowMs)
    return v.shown && v.down === undefined ? ev.coreId : undefined
  })()
  /**
   * **母舰血量读数**（**船长 2026-09-25 令**：「**母舰的血量也以进度条的形式显示在星系上方吧。**」）——
   * 供核心节点上方那根条用。与事件日志那条**同源**（`weekendBossPoolView`：剩余 = 池子总量 −
   * （玩家已造成 ＋ 章鱼已削）；船长 2026-09-25 已定"章鱼人 = 真实削血"，故只报这一条血）。
   *
   * ⚠ 池子在**首次接战**才锁定（`flagshipHpMax` 那一刻才落盘）⇒ 未接战按**满血**画：
   * 池子总量是**固定常量**（15 万），满血不是假数，也让这根条"旗舰一现身就在"而不是打一场才冒出来。
   */
  const mothershipFrac: number = (() => {
    const ev = state.weekendEvent
    if (!ev) return 1
    const pool = weekendBossPoolView(state, ev)
    return pool === null ? 1 : Math.max(0, Math.min(1, pool.hpLeft / pool.hpMax))
  })()
  /* 赏金任务（当日板）按星系归组（2026-09-10 船长：普通赏金任务也要在星图上显示——
     样式与"未探索剪影上的悬赏情报徽标"同款，并在对应星系上给出剩余时间）。
     任务自带 galaxyId（刷出时绑定窝点所在星系）；倒计时 = 当日板剩余（每天本地 0 点整板替换，
     口径与任务中心那行「距下批刷新」完全同源）。 */
  const board = engine.sideTasksView()
  const tasksByGalaxy = new Map<string, SideTask[]>()
  for (const t of board.bounty) {
    if (t.galaxyId === undefined) continue
    const arr = tasksByGalaxy.get(t.galaxyId)
    if (arr) arr.push(t)
    else tasksByGalaxy.set(t.galaxyId, [t])
  }
  // 弹窗里的完整倒计时（h:mm:ss，逐秒刷新；节点上不再显示倒计时，见下方节点注释）
  const taskEtaText = board.bountyOpened ? fmtDayClock(board.bountyRemainingMs) : ''
  /**
   * 敌对派系归属（2026-09-11 船长：「显示敌对派系」）——由该星系的悬赏卡推导
   * （**2026-09-11 起改为读数据侧 `AnomalyDef.foeFamily`**，不再走 `ui/shipArt` 的硬编码族表）
   * 排序 = 卡数降序 → 最高威胁降序 → 族字母（稳定）；首位 = **主族**（决定该星系"势力范围"光晕的颜色）。
   */
  const familyByGalaxy = new Map<string, Array<{ fam: string; count: number; maxThreat: number }>>()
  for (const a of engine.anomalies) {
    const fam = foeFamilyOf(a)
    const arr = familyByGalaxy.get(a.galaxyId) ?? []
    const hit = arr.find((x) => x.fam === fam)
    if (hit) {
      hit.count += 1
      hit.maxThreat = Math.max(hit.maxThreat, a.threat)
    } else {
      arr.push({ fam, count: 1, maxThreat: a.threat })
    }
    familyByGalaxy.set(a.galaxyId, arr)
  }
  for (const arr of familyByGalaxy.values()) {
    arr.sort((x, y) => y.count - x.count || y.maxThreat - x.maxThreat || x.fam.localeCompare(y.fam))
  }
  /** 节点下方的族标签（最多 2 枚，超出写「等 N 族」；未探索 = 灰「未知」；已探索但无敌情 = 灰「无敌情」） */
  const familyChipsOf = (gid: string, explored: boolean): Array<{ text: string; fam: string; dim?: boolean }> => {
    if (!explored) return [{ text: tr("ui.Expedition.194"), fam: '', dim: true }]
    const arr = familyByGalaxy.get(gid) ?? []
    if (arr.length === 0) return [{ text: tr("ui.Expedition.195"), fam: '', dim: true }]
    const chips = arr.slice(0, 2).map((x) => ({ text: FOE_FAMILY_LABEL[x.fam] ?? x.fam, fam: x.fam }))
    if (arr.length > 2) chips[1] = { text: tr("ui.Expedition.251", { p1: arr.length }), fam: arr[0]!.fam }
    return chips
  }
  /** 主族（势力范围光晕的颜色）：该星系卡数最多的族 */
  const primaryFamilyOf = (gid: string): string | undefined => familyByGalaxy.get(gid)?.[0]?.fam
  /** 族标签行的总宽 / 半宽（几何避让用：标签带比名称带更宽时要一起放进去算） */
  const famRowWidth = (gid: string, explored: boolean): number => {
    const chips = familyChipsOf(gid, explored)
    return chips.reduce((s, c) => s + famChipW(c.text), 0) + FAM_CHIP_GAP * Math.max(0, chips.length - 1)
  }
  /** 名称/标签带的半宽（节点下方那条信息带）：名称与安全等级 = 现状 23；
   *  敌对派系 = 该模式下**最宽**的族标签行的一半（不够 23 就仍按 23 保守取） */
  const labelBandHalfW =
    labelMode === 'faction'
      ? Math.max(
          23,
          Math.ceil(
            engine.galaxies.reduce(
              (m, g) => Math.max(m, famRowWidth(g.id, exploredIds.has(g.id) || isFrontier(g.id)) / 2),
              0,
            ),
          ),
        )
      : 23
  /**
   * 徽标栈（节点上方两层：符号徽标 + 短倒计时）的避让偏移（2026-09-10 船长：缩短格式 + 边缘挪位）。
   * 星图节点是固定坐标系（布局数据/本地覆盖都是 (0,0)-(700,300)），故不靠 DOM 测量、直接按坐标算：
   * 依次尝试 0 / ±15 / ±26 / ±36 的横向偏移，取第一个"不与邻居冲突"的位置——
   * 冲突判定 = 与**别的节点**的圆点带（±9）或名称带（±23 × [中心+12, 中心+38]）相交；
   * 都不行就用 0（居中保底）。徽标与倒计时整体平移，保持两层对齐、信息不丢。
   */
  const STACK_DX_TRIES = [0, 15, -15, 26, -26, 36, -36] as const
  const STACK_HALF_W = 14
  const STACK_Y1 = -35
  const STACK_Y2 = -11
  /** 与其它节点的圆点带（±9）/名称带（±labelHalfW × [中心+12, 中心+38]）是否相交——徽标避让的公共判定。
   *  2026-09-11：名称带半宽改为参数（「敌对派系」模式的族标签行比名称更宽，避让要按实际宽度算）。 */
  const bandClear = (g: GalaxyDef, ax1: number, ax2: number, ay1: number, ay2: number, labelHalfW = 23): boolean => {
    for (const other of engine.galaxies) {
      if (other.id === g.id) continue
      const op = posOf(other)
      const dotHit = ax1 < op.x + 9 && ax2 > op.x - 9 && ay1 < op.y + 9 && ay2 > op.y - 9
      const labelHit = ax1 < op.x + labelHalfW && ax2 > op.x - labelHalfW && ay1 < op.y + 38 && ay2 > op.y + 12
      if (dotHit || labelHit) return false
    }
    return true
  }
  const stackClear = (g: GalaxyDef, dx: number, halfW: number, y1: number, y2: number): boolean => {
    const p = posOf(g)
    return bandClear(g, p.x + dx - halfW, p.x + dx + halfW, p.y + y1, p.y + y2, labelBandHalfW)
  }
  const stackDx = (g: GalaxyDef, halfW: number, y1: number, y2: number): number => {
    for (const dx of STACK_DX_TRIES) {
      if (stackClear(g, dx, halfW, y1, y2)) return dx
    }
    return 0
  }
  /**
   * 敌对派系活跃标记（✦ + 「敌对派系活跃」全称）的**纵向**避让（2026-09-10 船长：要与星系按钮对齐）。
   * 原来这组标记沿用徽标栈的**左右平移**（stackDx）躲邻居 → 整组会偏到星系旁边，看着不像"选中这个星系"；
   * 船长定：**横向永远居中在星系圆点正上方**，遇到邻居节点冲突改为整组**上抬** 12 / 24 单位
   * （上抬不破坏对齐感；星图顶部另有 MAP_PAD_TOP 留白，抬到会被裁切就不采用）。
   */
  const FACTION_HALF_W = 27 // 「敌对派系活跃」6 字 × (8.5px + 0.5 字距) ≈ 54 → 半宽 27
  // 标记组顶端相对星系中心的高度。⚠ 2026-09-20 图标与文字互换后，**顶端改由 ✦（11px 基线 y−34）决定**
  //   （✦ 顶边 ≈ 中心 −34 −8 = −42 ⇒ 取 41；原为 8.5px 全称标签的顶边）——数值恰好不变。
  const FACTION_MARK_TOP = 41
  const FACTION_DY_TRIES = [0, -12, -24] as const
  const factionDy = (g: GalaxyDef): number => {
    const p = posOf(g)
    for (const dy of FACTION_DY_TRIES) {
      if (p.y + dy - FACTION_MARK_TOP < -MAP_PAD_TOP) continue // 抬出画布：不采用（宁可让位也不裁切）
      if (bandClear(g, p.x - FACTION_HALF_W, p.x + FACTION_HALF_W, p.y + dy - 40, p.y + dy - 16, labelBandHalfW)) return dy
    }
    return 0 // 兜底：保持居中（对齐优先，宁可压住邻居）
  }
  /* 敌对派系活跃（2026-09-10 船长：对应星系上要显示剩余时间）——当日选中的中安/低安星系，
     该星系常驻悬赏 +10% 奖金/+10% 威胁、胜利概率掉稀有残骸、每天本地 0 点重选。
     判定走 core 单点 `factionGalaxyId`（与战斗、任务中心同一个口径）；
     倒计时与赏金日板同一界（每天 0 点整板替换）；该星系已被排除在赏金任务抽签池外，
     故「✦ 派系活跃」与「⚑ 赏金任务」两枚徽标不会落在同一个节点上。 */
  const factionGalaxy = factionGalaxyId(state)
  const factionName = state.sideTasks.faction?.factionAnomalyName ?? ''

  /**
   * **目标星系的扫描窗口文案**（2026-09-18 修）：原先这里恒写「约 10 分钟」（只读基准常量），
   * 而母港的窗口已被船长裁定改成 **10 秒** ⇒ 改成按目标星系实算，短于 1 分钟就按秒显示。
   */
  const scanWindowTextOf = (galaxyId: string): string => {
    const ms = scanWindowMsFor(state, engine.ctx, galaxyId)
    return ms < 60_000 ? tr("ui.Expedition.252", { p1: Math.max(1, Math.round(ms / 1000)) }) : tr("ui.Expedition.253", { p1: Math.max(1, Math.round(ms / 60_000)) })
  }

  function handleScan(g: GalaxyDef): void {
    const r = engine.startScanAt(g.id)
    if (!r.ok) {
      onToast(cmdText(r) || tr('ui.Expedition.382'), true)
      return // 失败不关窗：错误提示留在弹窗里
    }
    onToast(tr("ui.Expedition.135"))
    closeModalSoon() // 成功 ⇒ 点下这一刻就关（带防误触闸门，见 closeModalSoon 的注释）
  }

  const posOf = (g: GalaxyDef): { x: number; y: number } => {
    const o = override[g.id]
    return o ? { x: o.x, y: o.y } : { x: g.x, y: g.y }
  }

  // ── 通路几何：按当前坐标重建线段，逐帧检测交叉（拖动时会实时更新） ──
  const mapEdges: Array<{ from: GalaxyDef; to: GalaxyDef; travelMinutes: number }> = []
  for (const edge of engine.galaxyEdges) {
    const a = engine.ctx.galaxies.get(edge.from)
    const b = engine.ctx.galaxies.get(edge.to)
    if (!a || !b) continue
    mapEdges.push({ from: a, to: b, travelMinutes: edge.travelMinutes })
  }
  const segs: Seg[] = mapEdges.map((e) => ({ a: posOf(e.from), b: posOf(e.to) }))
  const segNodes: Array<[string, string]> = mapEdges.map((e) => [e.from.id, e.to.id])
  const crossings = findCrossings(segs)
  const crossedEdge = new Set<number>()
  for (const [i, j] of crossings) {
    crossedEdge.add(i)
    crossedEdge.add(j)
  }

  // 「撤销整理」快照：记录最近一次点「自动整理」前的全部坐标
  const preTidyRef = useRef<LayoutMap | null>(null)
  function snapshotLayout(): LayoutMap {
    const out: LayoutMap = {}
    for (const g of engine.galaxies) out[g.id] = { ...posOf(g) }
    return out
  }
  function applyAutoTidy(): void {
    preTidyRef.current = snapshotLayout()
    const posMap = new Map<string, Pt>()
    for (const g of engine.galaxies) posMap.set(g.id, posOf(g))
    setOverride(autoTidy(posMap, segNodes))
  }
  function undoAutoTidy(): void {
    const snap = preTidyRef.current
    preTidyRef.current = null
    if (snap) setOverride(snap)
  }

  function saveOverride(): void {
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(override))
    } catch {
      // 忽略存储失败
    }
  }

  function resetOverride(): void {
    setOverride({})
    try {
      localStorage.removeItem(LAYOUT_KEY)
    } catch {
      // 忽略
    }
  }

  async function copyJson(): Promise<void> {
    const all = engine.galaxies.map((g) => ({ id: g.id, ...posOf(g) }))
    const out: Record<string, { x: number; y: number }> = {}
    for (const e of all) out[e.id] = { x: e.x, y: e.y }
    try {
      await navigator.clipboard.writeText(JSON.stringify(out))
    } catch {
      // 剪贴板不可用（Electron 环境一般可用）
    }
  }

  // 拖拽：换算到 viewBox 坐标（可视范围含边缘留白 → 先减留白再换算）
  function toViewBox(e: { clientX: number; clientY: number }, svg: SVGSVGElement): { x: number; y: number } {
    const r = svg.getBoundingClientRect()
    return {
      x: Math.min(MAP_W - 14, Math.max(14, ((e.clientX - r.left) / r.width) * MAP_VB_W - MAP_PAD_X)),
      y: Math.min(MAP_H - 10, Math.max(10, ((e.clientY - r.top) / r.height) * MAP_VB_H - MAP_PAD_TOP)),
    }
  }

  function onPointerDown(id: string, e: ReactPointerEvent<SVGGElement>): void {
    if (!editing) return
    e.preventDefault()
    setSelectedId(id)
    const svg = e.currentTarget.ownerSVGElement ?? ((e.currentTarget.closest('svg') ?? null) as SVGSVGElement | null)
    if (!svg) return
    dragRef.current = { id }
    const move = (ev: PointerEvent): void => {
      const d = dragRef.current
      if (!d) return
      const p = toViewBox(ev, svg)
      setOverride((prev) => ({ ...prev, [d.id]: { x: Math.round(p.x), y: Math.round(p.y) } }))
    }
    const up = (): void => {
      dragRef.current = null
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div className="app-starmap-wrap">
      {/* 显示模式切换（2026-09-11 船长）：三态互斥、选择存本地；按钮复刻 .app-map-editbar 同族做法（同 wrapper / 同 .app-btn.is-small） */}
      <div className="app-map-viewbar">
        {LABEL_MODES.map((m) => (
          <button
            key={m.key}
            className={`app-btn is-small${labelMode === m.key ? ' is-primary' : ''}`}
            title={m.tip}
            onClick={() => setLabelMode(m.key)}
          >
            {m.label}
          </button>
        ))}
        <span className="app-dim">{tr("ui.Expedition.196")}{LABEL_MODES.find((m) => m.key === labelMode)?.label}</span>
      </div>
      <svg viewBox={`${-MAP_PAD_X} ${-MAP_PAD_TOP} ${MAP_VB_W} ${MAP_VB_H}`} className={`app-starmap${editing ? ' is-editing' : ''}`} role="img" aria-label={tr('ui.ActivityBar.006')}>
        {/* 敌对派系"势力范围"光晕的径向渐变（2026-09-11）：每个族一枚，静态光效、不用 filter（第十四章） */}
        <defs>
          {Object.entries(FOE_ACCENT).map(([fam, color]) => (
            <radialGradient key={fam} id={`app-famglow-${fam}`}>
              {/* ⚠ 走 style（不是 `stopColor={…}` 属性）：色值是 `var(--wui-tone-*)`，呈现属性不认 var() */}
              <stop offset="0%" style={{ stopColor: color }} stopOpacity="0.34" />
              <stop offset="60%" style={{ stopColor: color }} stopOpacity="0.14" />
              <stop offset="100%" style={{ stopColor: color }} stopOpacity="0" />
            </radialGradient>
          ))}
          {/**
           * **周末入侵：被占星系的红色发光**（2026-09-25 船长令：「被占领地区不应该用红圈提醒，
           * 应该用一个**红色发光**放置于所有被入侵的星系**后方**」；同日二次裁定：「**范围太小、不够红、
           * 衰减有些高**」＋「可以做一个脉动」）。
           *
           * 数值（船长 2026-09-25 认可的建议值）：
           * - **半径 46**（原 30）；
           * - **不透明度 0.62 / 0.34 / 0.16 / 0**，偏移 **0% / 45% / 75% / 100%**（原 0.38/0.16/0 与 0%/55%/100%）
           *   ⇒ 更亮、而且**衰减更缓**（多一段 75%，中远处不再空）；
           * - **颜色 = 固定深红**（新 token **`--wui-danger-strong`** = `229 57 53` / #E53935，六套主题同值、
           *   不随主题走），不再吃 `--wui-danger`（默认主题那枚是偏亮的珊瑚橙红 `255 131 115`，"不够红"的来源）；
           * - **脉动**：`app-map-invasion-pulse`（与敌对派系标记同族语汇：透明度呼吸 + 轻微缩放，
           *   周期用同一枚 `--wui-dur-map`），见 styles.css。
           * 做法仍与上面那族"势力范围光晕"同源：**静态径向渐变、不用 filter**（约定第十四章）。
           */}
          <radialGradient id="app-invglow">
            <stop offset="0%" style={{ stopColor: 'rgb(var(--wui-danger-strong))' }} stopOpacity="0.62" />
            <stop offset="45%" style={{ stopColor: 'rgb(var(--wui-danger-strong))' }} stopOpacity="0.34" />
            <stop offset="75%" style={{ stopColor: 'rgb(var(--wui-danger-strong))' }} stopOpacity="0.16" />
            <stop offset="100%" style={{ stopColor: 'rgb(var(--wui-danger-strong))' }} stopOpacity="0" />
          </radialGradient>
        </defs>
        {/* 航线（V13 迷雾）：双亮实线带分钟；涉及剪影暗化无分钟；剪影连向更深处只画半段虚化提示 */}
        {mapEdges.map((e, idx) => {
          const pa = posOf(e.from)
          const pb = posOf(e.to)
          const aExp = exploredIds.has(e.from.id)
          const bExp = exploredIds.has(e.to.id)
          const aFront = frontierIds.has(e.from.id)
          const bFront = frontierIds.has(e.to.id)
          const aVis = aExp || aFront
          const bVis = bExp || bFront
          const crossed = editing && crossedEdge.has(idx)
          const halfX = pa.x + (pb.x - pa.x) * 0.5
          const halfY = pa.y + (pb.y - pa.y) * 0.5
          if (!aVis && !bVis) return null // 迷雾深处：不渲染
          if (aVis && !bVis) {
            // 亮/剪影端 → 未知深处：从可见端画半段虚化，提示“这边还有路”
            return (
              <line
                key={`${e.from.id}-${e.to.id}`}
                x1={pa.x}
                y1={pa.y}
                x2={halfX}
                y2={halfY}
                className="app-map-edge is-hint"
              />
            )
          }
          if (bVis && !aVis) {
            return (
              <line
                key={`${e.from.id}-${e.to.id}`}
                x1={pb.x}
                y1={pb.y}
                x2={halfX}
                y2={halfY}
                className="app-map-edge is-hint"
              />
            )
          }
          if (!(aExp && bExp)) {
            // 至少一端是剪影：整条暗色线可见，但不暴露分钟数
            return (
              <line
                key={`${e.from.id}-${e.to.id}`}
                x1={pa.x}
                y1={pa.y}
                x2={pb.x}
                y2={pb.y}
                className="app-map-edge is-fog"
              />
            )
          }
          const mx = (pa.x + pb.x) / 2
          const my = (pa.y + pb.y) / 2
          // T7 统一口径：边距显示"当前驾驶船实际耗时"（跃迁速度 × 航行技能），标称分钟只进悬停说明
          const actMin = travelMinutesEff(state, engine.ctx, e.travelMinutes)
          const actLabel = actMin >= 10 ? `${Math.round(actMin)}′` : `${Math.round(actMin * 10) / 10}′`
          const actTitle = tr("ui.Expedition.197", { p1: e.travelMinutes, p2: formatDurationMs(Math.max(1, Math.round(actMin * 60_000))) })
          return (
            <g key={`${e.from.id}-${e.to.id}`}>
              <line
                x1={pa.x}
                y1={pa.y}
                x2={pb.x}
                y2={pb.y}
                className={`app-map-edge${crossed ? ' is-cross' : ''}`}
              />
              {/* 悬停说明：SVG 元素用 **`data-tip`**（React 的 SVG 类型不接受 `title` 属性；而 SVG 的
                  `<title>` 子元素会被浏览器弹**系统默认**提示）——两者都由全局接管层 `ui/Tooltip.tsx`
                  换成站内自绘提示（2026-09-14 船长报障后统一） */}
              <text
                x={mx}
                y={my - 6}
                textAnchor="middle"
                className={`app-map-min${crossed ? ' is-cross' : ''}`}
                data-tip={actTitle}
              >
                {actLabel}
              </text>
            </g>
          )
        })}
        {/* 交叉点标记（编辑中实时显示） */}
        {editing
          ? crossings.map(([i, j], k) => {
              const p = segIntersectPt(segs[i]!, segs[j]!)
              return <circle key={`x${k}`} cx={p.x} cy={p.y} r={3.5} className="app-map-xdot" />
            })
          : null}
        {/* 星系节点：已探索完整显示；剪影 = 半透明“未知信号”+ 悬赏情报徽标例外显示 */}
        {engine.galaxies.map((g) => {
          const p = posOf(g)
          const explored = exploredIds.has(g.id)
          const frontier = isFrontier(g.id)
          if (!explored && !frontier) return null // 迷雾深处：不渲染
          const isHub = g.id === 'galaxy-hub'
          const isSel = g.id === selectedId
          const secExtra = isHub || frontier ? '' : secCls(g.security)
          const cls = isHub ? ' is-hub' : isSel ? ' is-sel' : frontier ? ' is-frontier' : ''
          const bounty = bountyByGalaxy.get(g.id) ?? 0
          const isFactionNode = factionGalaxy === g.id
          /**
           * **入侵标记的悬停读数**（**船长 2026-09-25 令「② 修」**）——原来它只挂在
           * `<g className="app-map-invasion" data-tip=…>` 上，而那一组是 `pointer-events: none`
           * （2026-09-23 为"不挡点击"而设）⇒ **悬停事件落到下面的圆点上、`closest('[data-tip]')`
           * 找不到那一组，提示永远弹不出来**（018 / 099 从上线起就是死的）。
           * 修法 = 把这个读数**同时挂到节点圆点**（最自然的悬停目标）＋ 让进度条/★ 自己可悬停
           * （见 `styles.css` 那两条 `pointer-events`）；点击照旧冒泡给节点 ⇒ 不影响选星系。
           */
          const invasionTip = invasionProgress.has(g.id)
            ? tr('ui.weekend.018')
            : g.id === invasionCoreHeld
              ? tr('ui.weekend.101', { p1: String(Math.round(mothershipFrac * 100)) })
              : null
          // 显示模式（2026-09-11）：名称 / 安全等级 / 敌对派系（母港恒显名称与金色徽标，不参与族色）
          const famChips = labelMode === 'faction' && !isHub ? familyChipsOf(g.id, explored) : []
          const famRowW = famChips.reduce((s, c) => s + famChipW(c.text), 0) + FAM_CHIP_GAP * Math.max(0, famChips.length - 1)
          const primaryFam = labelMode === 'faction' && !isHub ? primaryFamilyOf(g.id) : undefined
          /** 节点下方那条信息带的文字与配色（三态各自的取法） */
          const labelText =
            isHub || frontier
              ? isHub
                ? tr("ui.Expedition.007")
                : tr("ui.ActivityBar.015")
              : labelMode === 'sec'
                ? secText(g.security)
                : g.name
          return (
            <g
              key={g.id}
              className="app-map-node"
              onClick={() => {
                // 刚点过「扫描探索」⇒ 这 420ms 内不吃点击（防连点顺手点开另一个星系）
                if (Date.now() < nodeClickGuardUntilRef.current) return
                setSelectedId(g.id)
                setModalId(g.id)
              }}
              onPointerDown={(e) => onPointerDown(g.id, e)}
            >
              {/**
               * 周末入侵：**仍被占**的星系 = 身后一团红色发光 ＋ 节点上方的**进度条**（2026-09-25 船长令：
               * 「已经被夺回的外围星系不再发光」＋「每个被入侵的星系顶部显示一个进度条替换原先的旗子」）。
               * 画在节点最底层、不挡点击；已夺回的星系整组不画（表里就没有它）。
               * ⚠ **例外 = 核心的"旗舰期"**（2026-09-25 船长令：「入侵母舰没摧毁前，敌方核心星系需要
               * 依旧有红光」）：核心已夺回但母舰还在 ⇒ 画红光与 ★，条改画**母舰血量**（见下）。
               * ⚠ **本组 `pointer-events: none` ⇒ 这里的 `data-tip` 弹不出来**（船长 2026-09-25 令「② 修」）：
               * 读数另挂一份在**节点圆点**上（见上 `invasionTip`），进度条与 ★ 由 `styles.css` 放行悬停。
               */}
              {invasionProgress.has(g.id) || g.id === invasionCoreHeld ? (
                <g className="app-map-invasion" data-tip={invasionTip ?? undefined}>
                  <circle cx={p.x} cy={p.y} r={46} fill="url(#app-invglow)" className="app-map-invasion-glow" />
                  {/**
                   * 节点上方那根条（30×3.5 圆角）：**仍被占** = 夺回进度；**核心旗舰期** = 母舰血量
                   * （船长 2026-09-25：「母舰的血量也以进度条的形式显示在星系上方吧」）。
                   * 两者同一套类名 ⇒ 观感与位置逐字同款（★ 仍在这根条上方）。
                   */}
                  {(() => {
                    const frac = invasionProgress.has(g.id) ? (invasionProgress.get(g.id) ?? 0) : g.id === invasionCoreHeld ? mothershipFrac : null
                    if (frac === null) return null
                    const w = 30
                    const h = 3.5
                    const x = p.x - w / 2
                    const y = p.y - 26
                    return (
                      <g className="app-map-invbar">
                        <rect x={x} y={y} width={w} height={h} rx={h / 2} className="app-map-invbar-bg" />
                        <rect
                          x={x}
                          y={y}
                          width={Math.max(0.5, w * Math.min(1, Math.max(0, frac)))}
                          height={h}
                          rx={h / 2}
                          className="app-map-invbar-fill"
                        />
                      </g>
                    )
                  })()}
                  {/* 核心另有 ★（旗子已撤 ⇒ 只留这一枚"这是核心"的记号）——夺回后进入旗舰期时同样保留 */}
                  {g.id === invasionCoreId || g.id === invasionCoreHeld ? (
                    <text x={p.x} y={p.y - 32} className="app-map-invasion-tag">
                      ★
                    </text>
                  ) : null}
                </g>
              ) : null}
              {/* 势力范围光晕（2026-09-11 船长：星系后方对应颜色的发光＝这块是这个势力的辐射范围）——
                  静态径向渐变、低透明度；画在圆点之前（压住航线但不压节点），只有敌族模式且该星系有敌情时渲染 */}
              {primaryFam ? (
                <circle cx={p.x} cy={p.y} r={26} fill={`url(#app-famglow-${primaryFam})`} className="app-map-famglow" />
              ) : null}
              {/* 敌对派系活跃（2026-09-10 船长：改红色 + 用方框选中目标星系 + 文字写全称；
                  2026-09-10 追加：**与星系按钮对齐**——✦ 与全称标签横向永远居中在圆点正上方，
                  不再为躲邻居而左右平移，冲突时整组上抬（factionDy）；标记自带闪缩脉动，见 styles.css；
                  2026-09-20 船长：**图标与文字行互换** ⇒ ✦ 在上、全称在下，见下方内联说明）——
                  ①红色方框选中该星系（画在圆点之前，圆点压上层）②红色圆点 + 伸缩脉动
                  ③红色 ✦ 徽标 + 「敌对派系活跃」全称标签（现 ✦ 在上）④星系名加粗（颜色仍交给安全等级色阶）
                  该星系已被排除在赏金任务抽签池外，故不会与 ⚑ 徽标叠在同一节点 */}
              {isFactionNode ? (
                <>
                  <rect
                    x={p.x - FACTION_BOX_M / 2}
                    y={p.y - FACTION_BOX_M / 2}
                    width={FACTION_BOX_M}
                    height={FACTION_BOX_M}
                    rx={2}
                    className="app-map-faction-box"
                  />
                  {(() => {
                    const dy = factionDy(g)
                    return (
                      <>
                        {/**
                         * **✦ 与全称标签的位置互换**（2026-09-20 船长：「星图的敌对派系活跃里的图标和文字行互换一下」）
                         * ⇒ 现在 **✦ 徽标在上（y−34）、「敌对派系活跃」全称在下（y−20）**（原为文字在上、✦ 在下）。
                         * ⚠ 只对调两个 `y` 值、**不动标记组整体定位**：两行互换后"组顶边 = ✦ 顶边"（仍 ≈ 中心−34−8）
                         * 与"组底边 = 全称降部"（仍 ≈ 中心−20+4）**都没变** ⇒ 上面 `FACTION_MARK_TOP = 41`
                         * 与 `factionDy` 的避让带（中心−40 ~ −16）**一字不用改**，避让行为与改前完全一致。
                         */}
                        <text x={p.x} y={p.y - 34 + dy} textAnchor="middle" className="app-map-bounty is-faction">
                          ✦
                        </text>
                        <text x={p.x} y={p.y - 20 + dy} textAnchor="middle" className="app-map-faction-label">
                          {tr('ui.Expedition.198')}
                        </text>
                      </>
                    )
                  })()}
                </>
              ) : null}
              <circle
                cx={p.x}
                cy={p.y}
                r={frontier ? 7 : isHub ? 11 : 8}
                className={`app-map-dot${cls}${isFactionNode ? ' is-faction' : ''}`}
                /* 入侵标记的读数挂在圆点上（见上面 `invasionTip` 的说明）：圆点是节点最自然的悬停目标，
                   而那一组标记自己是 `pointer-events: none`（不挡点击）⇒ 只挂那边等于没挂 */
                {...(invasionTip !== null ? { 'data-tip': invasionTip } : {})}
              />
              {/* 悬赏情报徽标（协会共享情报：剪影也显示数量，帮助判断是否值得扫描） */}
              {bounty > 0 && frontier ? (
                <text x={p.x} y={p.y - 12} textAnchor="middle" className="app-map-bounty">
                  ⚔{bounty}
                </text>
              ) : null}
              {/* 赏金任务徽标（2026-09-10 船长）：与悬赏情报同款样式，换符号（⚑）与配色区分。
                  2026-09-10 船长复查：**节点上不再显示倒计时**（h:mm 粒度看起来"不走"，
                  精确倒计时留在任务中心头部与星系弹窗里）→ 只留 ⚑ 数量徽标 */}
              {(tasksByGalaxy.get(g.id)?.length ?? 0) > 0 ? (
                <text x={p.x + stackDx(g, 14, -24, -10)} y={p.y - 12} textAnchor="middle" className="app-map-bounty is-task">
                  ⚑{tasksByGalaxy.get(g.id)!.length}
                </text>
              ) : null}
              {/* 节点下方信息带（三态）：①名称（默认）②安全等级数字（沿用安全色阶）
                  ③敌对派系标签（按敌族配色、SVG 圆角标签化，与安全色阶明显区分；最多 2 枚 + 等 N 族） */}
              {labelMode === 'faction' && !isHub ? (
                <FamChips
                  chips={famChips}
                  rowW={famRowW}
                  x={p.x}
                  y={p.y}
                  cls={cls + (isFactionNode ? ' is-faction' : '')}
                />
              ) : (
                <NodeLabel
                  name={labelText}
                  x={p.x}
                  y={p.y}
                  cls={
                    isHub
                      ? cls
                      : frontier
                        ? cls
                        : labelMode === 'sec'
                          ? cls + secExtra
                          : cls + secExtra + (isFactionNode ? ' is-faction' : '')
                  }
                />
              )}
            </g>
          )
        })}
      </svg>
      {/* 星系行动弹窗（2026-09-08 船长方案：点选星系弹出行动窗口；复用通讯浮层 app-comm 样式族，滚动在 .app-comm-body 内） */}
      {modalId !== null && selected ? (
        <div className="app-comm-mask" onClick={() => setModalId(null)}>
          <div className="app-comm" onClick={(e) => e.stopPropagation()}>
            <div className="app-comm-title">{tr("ui.Expedition.199")} {isFrontier(selected.id) ? tr("ui.ActivityBar.015") : selected.name}</div>
            <div className="app-comm-body">
        {isFrontier(selected.id) ? (
            <div className="app-map-detail">
              <div className="app-map-detail-name app-map-frontier-name">{tr("ui.ActivityBar.015")}</div>
              <div className="app-map-detail-desc">
                {tr("ui.Expedition.075")}
              </div>
              <div className="app-dim">
                {tr("ui.ActivityBar.016")} {bountyByGalaxy.get(selected.id) ?? 0} {tr("ui.Expedition.076")}
                {scan.active ? tr("ui.Expedition.349") : ''}
              </div>
              <div className="app-map-scan-row">
                <button
                  className="app-btn is-small is-primary"
                  disabled={scan.active}
                  onClick={() => handleScan(selected)}
                  title={tr("ui.Expedition.200", { p1: scanWindowTextOf(selected.id) })}
                >
                  <span className="app-ico"><Glyph name="ico-scan" size={13} color={ICO_TONES["ico-scan"]} /></span>{tr("ui.Expedition.136")}{scanWindowTextOf(selected.id)}）
                </button>
                <span className="app-dim app-map-scan-note">
                  {scan.active ? tr("ui.Expedition.137", { p1: formatDurationMs(scan.remainingMs) }) : tr("ui.Expedition.077")}
                </span>
              </div>
            </div>
          ) : (
            <div className="app-map-detail">
              <div className="app-map-detail-name">
                {selected.name}
                {selected.security !== undefined ? (
                  <span className={`app-sec-chip app-sec-chip-${secTone(selected.security)}`} title={tr("ui.Expedition.078")}>
                    {secText(selected.security)}
                  </span>
                ) : null}
              </div>
              <div className="app-map-detail-desc">{selected.description}</div>
              {/* B1.5 前往星系动作区：掩护巡逻（主控/副船）/ 矿带 / 悬赏，含简介。
                  ⚠ 2026-09-24 船长：「重复清剿明明在现有的悬赏处加个按钮就行，为啥还要单开一个容器」⇒
                  原独立容器 `BountyLoopBlock` 已删，环按钮并入下面 ④ 悬赏的每一行（同一个列表、同一套门槛）。 */}
              <GalaxyActions engine={engine} galaxy={selected} onToast={onToast} onOpenWormhole={onOpenWormhole} />
              {/* 赏金任务（当日板）落在这个星系时的提示（2026-09-10 船长：星图上要能看出哪些星系有任务） */}
              {(tasksByGalaxy.get(selected.id)?.length ?? 0) > 0 ? (
                <div className="app-map-taskline">
                  <span className="app-ico">
                    <Glyph name="nav-task" size={12} color={NAV_TONES['nav-task']} />
                  </span>
                  {tr("ui.Expedition.250")} {tasksByGalaxy.get(selected.id)!.length} {tr("ui.Expedition.014")}
                  {tasksByGalaxy.get(selected.id)!
                    .map((t) => tr("ui.Expedition.015", { p1: t.lairName ?? t.anomalyId ?? tr('ui.Expedition.294'), p2: t.rewardIsk.toLocaleString('zh-CN') }))
                    .join(tr("ui.MatterTechTab.017"))}
                  {taskEtaText.length > 0 ? tr("ui.Expedition.350", { taskEtaText: taskEtaText }) : ''}
                </div>
              ) : null}
              {/* 敌对派系活跃（2026-09-10 船长）：与任务中心那条置顶卡同一个判定口（core factionGalaxyId），
                  口径同步 = 该星系全部常驻悬赏奖金 +10%、敌人威胁 +10%、胜利按概率掉稀有残骸；
                  不因打赢而下板，每天本地 0 点重新选星系 → 剩余时间与赏金日板同一界 */}
              {factionGalaxy === selected.id ? (
                <div className="app-map-taskline is-faction">
                  <span className="app-ico">✦</span>
                  {tr("ui.Expedition.201")}
                  {factionName.length > 0 ? tr("ui.Expedition.351", { factionName: factionName }) : ''}
                  {taskEtaText.length > 0 ? tr("ui.Expedition.352", { taskEtaText: taskEtaText }) : ''}
                </div>
              ) : null}
              {/* 稀有残骸战果（2026-09-11 船长：「稀有残骸能否在星图的星系详细里看到？」）：
                  与该星系"残骸打捞"卡同源同口径（state.galaxyWrecks[星系].rareBy 按敌群记账），
                  故这里只列**数量 + 来源窝点**；未探索星系不显示、无战果不占位（避免界面跳动）。 */}
              {rare.count > 0 ? (
                <div
                  className="app-map-taskline is-rare"
                  title={tr("ui.Expedition.254", { p1: rare.text, RARE_WRECK_VOLUME_M3: RARE_WRECK_VOLUME_M3 })}
                >
                  <span className="app-ico">◆</span>
                  <em className="app-chip is-rare">{tr("ui.MapPage.066")}{rare.count}</em>
                  <span className="app-dim">（{rare.text}）</span>
                </div>
              ) : null}
              <div className="app-dim">
                {tr("ui.Expedition.255")}{hubName}）{view.active ? tr("ui.Expedition.353") : ''}
              </div>
              {editing ? (
                <div className="app-map-edit-tip">
                  {tr("ui.Expedition.138")}{Math.round(posOf(selected).x)}, {Math.round(posOf(selected).y)})
                </div>
              ) : null}
            </div>
          )
        }
            </div>
            <div className="app-comm-foot">
              <button className="app-btn is-small" onClick={() => setModalId(null)}>
                {tr("ui.App.086")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {!selected ? (
        <div className="app-dim app-map-hint">
          {tr("ui.Expedition.202")}
        </div>
      ) : null}
      {/* 布局编辑工具条（开发工具：默认隐藏，置 dev-layout 标志后显示入口） */}
      {!devEditor && !editing ? null : (
        <div className="app-map-editbar">
        {!editing ? (
          <button
            className="app-btn is-small"
            onClick={() => setEditing(true)}
            title={tr("ui.Expedition.139")}
          >
            {tr("ui.Expedition.016")}{crossings.length > 0 ? tr("ui.Expedition.304") : ''}
          </button>
        ) : (
          <>
            <span className={crossings.length > 0 ? 'app-map-xcount' : 'app-dim'}>
              {crossings.length > 0
                ? tr("ui.Expedition.017", { p1: crossings.length })
                : tr("ui.Expedition.018")}
            </span>
            <button
              className="app-btn is-small is-primary"
              onClick={applyAutoTidy}
              title={tr("ui.Expedition.256")}
            >
              {tr("ui.Expedition.257")}
            </button>
            <button
              className="app-btn is-small"
              onClick={undoAutoTidy}
              disabled={!preTidyRef.current}
              title={tr("ui.Expedition.079")}
            >
              {tr("ui.Expedition.140")}
            </button>
            <button
              className="app-btn is-small is-primary"
              onClick={() => {
                saveOverride()
                void copyJson()
              }}
              title={tr("ui.Expedition.019")}
            >
              {tr("ui.Expedition.020")}
            </button>
            <button className="app-btn is-small" onClick={resetOverride} title={tr("ui.Expedition.203")}>
              {tr("ui.Expedition.305")}
            </button>
            <button className="app-btn is-small" onClick={() => setEditing(false)}>
              {tr("ui.App.024")}
            </button>
          </>
        )}
        </div>
      )}
    </div>
  )
}

/* ─────────── 野外应急修理（修理系统 2026-09-05：驾驶船停留本星系时的手动组件入口） ─────────── */
function FieldKitRepair({ engine, onToast }: { engine: GameEngine; onToast: ToastFn }) {
  const state = engine.state
  const ship = state.fleet[state.shipId]
  if (!ship) return null
  const kits = (['repairkit-civ', 'repairkit-mil'] as const).reduce((n, id) => n + (ship.cargo[id] ?? 0), 0)
  const worn = ship.durability < 1 || (ship.armorPct ?? 1) < 1
  if (kits <= 0 || !worn) return null
  return (
    <div className="app-ga-row">
      <span className="app-ga-main">
        <span className="app-ico"><Glyph name="ico-cross" size={12} color={ICO_TONES["ico-cross"]} /></span>{tr("ui.Expedition.141")}
        <span className="app-dim app-ga-desc">{tr("ui.Expedition.204")}</span>
      </span>
      <button
        className="app-btn is-small is-primary"
        onClick={() => {
          const r = engine.useRepairKitNow()
          if (!r.ok) onToast(cmdText(r) || tr('ui.Expedition.383'), true)
          else onToast(tr("ui.Expedition.080"))
        }}
        title={tr("ui.Expedition.081")}
      >
        {tr("ui.BattleScreen.066")}{kits}
      </button>
    </div>
  )
}

/* ─────────── B1.5 星图「前往星系」动作区（掩护巡逻/矿带/悬赏 + 简介） ─────────── */

function GalaxyActions({
  engine,
  galaxy,
  onToast,
  onOpenWormhole,
}: {
  engine: GameEngine
  galaxy: GalaxyDef
  onToast: ToastFn
  onOpenWormhole?: () => void
}) {
  const state = engine.state
  const ctx = engine.ctx
  /**
   * **旧版虫洞入口已于 2026-09-26 删除**（船长令：「将调试模式的旧版虫洞入口删除」）。
   *
   * 沿革：该行曾是施工期的**调试入口**（`debugEnabled()` 把关，点开面板后走 `wormholeEnter(picked)`
   * ——**不消耗库存虫洞、直接用游戏种子开一趟**）；玩家侧在 2026-09-14 就关了这道门
   * （它会绕过「协会声望 ≥ 40」门槛、跳过"扫描发现"整条链），只留调试可见。
   *
   * **玩家入口唯一 = 星图「出港 · 扫描虫洞」页**：选一处库存虫洞 ⇒ `wormholeEnterFromStock`（消耗该处）。
   * 验收也不再需要这个后门：扫描页本身就能造库存、开趟。
   *
   * ⚠ 面板本体仍挂在 App 那一层（`onOpenWormhole`）——原先挂在这里，而本组件要"星图选中星系"才渲染
   * ⇒ 人在洞里时可能回不到面板（船长 2026-09-13：「活动栏直接开面板」）；活动栏那行只在已有本趟时出现。
   * 该回调**仍然需要**（活动栏的"进洞"跳转、星图「出港」里 → 扫描页的返回），故 prop 保留。
   */
  /**
   * **入侵旗舰入口**（2026-09-25 船长令：「星图核心星系的**星系详细**里要添加入口」）：
   * 判据全在 core（`weekendFlagshipPrep()` 非空 = 旗舰已现身、未落定局、本族是 BOSS 族），
   * 这里再要求**选中的正是本场核心星系** —— 外围星系不摆这个按钮，免得玩家以为哪儿都能打。
   */
  const [prepOpen, setPrepOpen] = useState(false)
  const flagshipPrep = state.weekendEvent?.coreId === galaxy.id ? engine.weekendFlagshipPrep() : null
  /**
   * **这一格是否正被入侵占领**（2026-09-25 船长令）：占领中 ⇒ 星系详细里的悬赏整行换成「击退入侵舰队」
   * ＋威胁范围（不逐张列被替换的卡）。
   */
  const invadedHere = (() => {
    const ev = state.weekendEvent
    if (!ev || ev.endedAtWallMs !== undefined) return null
    if (galaxy.id !== ev.coreId && !ev.peripheryIds.includes(galaxy.id)) return null
    return weekendProgressAt(state, ev, galaxy.id, Date.now()) < 1 ? ev : null
  })()
  /**
   * **已收复 ⇒ 常驻悬赏押后到活动结束**（**船长 2026-09-25 令**：「入侵期间，被占领星系的所有被收复的
   * 星系的常驻悬赏依旧处于隐藏状态，要等到入侵活动结束」）。
   *
   * 与 `invadedHere` 正好互补：仍被占 ⇒ 那一行是「击退入侵舰队」；已收复 ⇒ 常驻悬赏**不列出**、
   * 只留一行状态占位（`ui.weekend.100`）——活动一结束，判据自然转假，悬赏照旧整批回来。
   * 判据在 core 单点（`weekendStandingBountyHeldAt`），界面不另判一遍。
   */
  const bountyHeldHere = weekendStandingBountyHeldAt(state, galaxy.id, Date.now())
  /**
   * **「悬赏（N）」里的 N = 这一格实际列出的行数**（**船长 2026-09-25 报障**：「**被入侵的星系，
   * 星系详细界面，悬赏的标题显示"悬赏（2）"而实际上这时候只显示了"击退入侵舰队"这一个**」）。
   *
   * - 仍被占（`invadedHere`）⇒ 整池换成**一行**「击退入侵舰队」⇒ **1**（原先报的是被替换掉的那 2 张卡）；
   * - 已收复押后（`bountyHeldHere`）⇒ 一张不列、只留状态占位 ⇒ **0**；
   * - 平常 ⇒ 该星系拥有的卡数（**声望不足时的空态照旧**：那时列出 0 张但"这里有几张悬赏"本身是
   *   给玩家的信息，另有 `ui.Expedition.264` 明说原因，故这一档保持原口径）。
   */
  const bountyRowCount =
    invadedHere !== null ? 1 : bountyHeldHere ? 0 : engine.anomalies.filter((a) => a.galaxyId === galaxy.id).length

  // —— 主控掩护巡逻（原"待命"） ——
  const inFlight = state.standby.active && state.standby.galaxyId === galaxy.id
  const alreadyHere =
    state.awayGalaxy === galaxy.id && !state.transit.active && !state.expedition.active && !state.mining.active
  /**
   * ⚠ **2026-09-21 船长令改口径**：`state.mining.active` **从这条里删掉**（原先采矿中 ⇒ 巡逻按钮直接置灰）——
   * 采矿属"可自动停"那一档，点下去会先停采（统一日志）再转场；留着它就把统一口径又堵回去了。
   * 仍留在里面的：远征（统一判据拒）、换港返航（锁定态）、别处的掩护巡逻（同一项，由 core 自己判）。
   */
  const pilotBusy = state.expedition.active || state.transit.active || (state.standby.active && !inFlight)
  const standbyDisabled = inFlight || alreadyHere || pilotBusy || state.awayGalaxy === galaxy.id
  const standbyTitle = inFlight
    ? tr("ui.Expedition.205")
    : alreadyHere
      ? tr("ui.Expedition.258", { p1: galaxy.name })
      : pilotBusy
        ? tr("ui.Expedition.142")
        : undefined
  function handleStandby(): void {
    const r = engine.goStandbyAt(galaxy.id)
    if (!r.ok) onToast(cmdText(r) || tr('ui.Expedition.384'), true)
    else onToast(tr("ui.Expedition.143", { p1: galaxy.name }))
  }

  // —— 副船掩护巡逻 ——
  const idleShips = idleAiShipIds(state)
  const [aiShip, setAiShip] = useState('')
  const [aiCore, setAiCore] = useState<AiCoreType>(() => bestAiCoreOf(state) ?? 'basic')
  // 2026-09-08 紧急修复：核心下拉与提交类型脱节（basic 无库存时仍按 basic 提交被拒）
  const usableCores = AI_CORE_ORDER.filter((t) => countAiCore(state, t) > 0)
  const effCore = usableCores.includes(aiCore) ? aiCore : (usableCores[usableCores.length - 1] ?? 'basic')
  const aiCoreAvailable = usableCores.length > 0
  function handleAiStandby(): void {
    if (!aiShip) {
      onToast(tr("ui.MapPage.102"), true)
      return
    }
    const r = engine.assignAiStandbyAt(aiShip, effCore, galaxy.id)
    if (!r.ok) onToast(cmdText(r) || tr('ui.Expedition.385'), true)
    else onToast(tr("ui.Expedition.082"))
  }

  // —— 该星系矿带 ——
  const belts = engine.belts.filter(
    (b) => b.galaxyId === galaxy.id || (galaxy.id === 'galaxy-hub' && !b.galaxyId),
  )
  const expOn = state.expedition.active
  const [mineAskBelt, setMineAskBelt] = useState<string | null>(null)
  function handleMineStart(beltId: string): void {
    /**
     * ⚠ **2026-09-21 船长答 2「允许切换」**：原先"正在开采 ⇒ 直接 toast 拦住"那条已删——
     * 换矿带现在**直接切**（core 先停旧带那一趟、货留在船上、写「已切换矿带」日志）。
     * 远征在飞时那条"转战"两段确认照旧（`startMiningFromExpeditionAt`）。
     */
    if (expOn && !mineAskBelt) {
      setMineAskBelt(beltId)
      onToast(
        tr('ui.Expedition.386') +
          (state.autoLoopAnomalyId !== null ? tr("ui.MapPage.039") : '') +
          tr('ui.Expedition.387'),
        true,
      )
      return
    }
    setMineAskBelt(null)
    const r = expOn ? engine.startMiningFromExpeditionAt(beltId) : engine.startMiningAt(beltId)
    if (!r.ok) onToast(cmdText(r) || tr('ui.Expedition.388'), true)
  }

  // —— 该星系悬赏（只列当前可接；已首胜标黄不隐藏） ——
  const pilotName = shipDisplayName(state, ctx, state.shipId)
  const pilotRoleLabel = (() => {
    const role = fleetDefOf(state, ctx, state.shipId)?.role
    return role ? shipRoleText(role) : ''
  })()
  const miningActive = state.mining.active
  const [goAskAno, setGoAskAno] = useState<string | null>(null)
  /** 待确认"顶替环目标"的那张卡（null = 没有待确认）——**内联警示**，照抄 `goAskAno` 的写法，不新增弹窗机制 */
  const [loopAskAno, setLoopAskAno] = useState<string | null>(null)
  function handleAnoGo(ano: AnomalyDef): void {
    if (miningActive && goAskAno !== ano.id) {
      setGoAskAno(ano.id)
      onToast(
        tr("ui.Expedition.021", { p1: state.mining.tripUnits }) +
          tr("ui.Expedition.348", { pilotName: pilotName, p2: pilotRoleLabel ? tr("ui.Expedition.307", { pilotRoleLabel: pilotRoleLabel }) : '' }),
        true,
      )
      return
    }
    setGoAskAno(null)
    /**
     * **出击要把"界面上这一行的星系"带上**（2026-09-25 修"串星系"）：H 族多个被占星系会抽到
     * **同一张独立卡**（同 id）⇒ 引擎按 id 反查只能命中列表第一个 ⇒ 进度/威胁/残骸全串到别处。
     */
    const r = miningActive
      ? engine.startExpeditionFromMiningAt(ano.id, ano.galaxyId)
      : engine.startExpeditionAt(ano.id, ano.galaxyId)
    if (!r.ok) onToast(cmdText(r) || tr('ui.Expedition.389'), true)
  }

  return (
    <div className="app-galaxy-actions">
      {/* 旗舰战战前准备弹层（2026-09-25）：本地状态开合，弹层自包含 */}
      {prepOpen ? <WeekendFlagshipPrepModal engine={engine} onClose={() => setPrepOpen(false)} /> : null}
      <div className="app-bay-title">{tr("ui.Expedition.083")}</div>
      {/* ⑨ 入侵旗舰（2026-09-25 船长令）：核心星系的星系详细里摆入口 ⇒ 点开战前准备界面。
          ⚠ 同日第二条：「找不到是因为**不明显**，给容器加一个**红色圆边背景**」⇒ 行容器挂
          `app-ga-invasion`（观感照抄入侵框 `.app-weekend-box`：红边 ＋ 圆角 ＋ 红底）。 */}
      {flagshipPrep ? (
        <div className="app-ga-row app-ga-invasion">
          <span className="app-ga-main">
            <span className="app-ico">
              <Glyph name="ico-tact" size={13} color={ICO_TONES['ico-tact']} />
            </span>
            {tr('ui.weekend.060')}
            <span className="app-dim app-ga-desc">{tr('ui.weekend.061', { p1: tr(weekendFamilyNameId(state.weekendEvent?.family ?? 'H') ?? 'core.weekend.023'), p2: galaxy.name })}</span>
          </span>
          <button className="app-btn is-small is-primary" onClick={() => setPrepOpen(true)}>
            {tr('ui.weekend.062')}
          </button>
        </div>
      ) : null}      {/* ⑧ 野外停留应急修理（修理系统 2026-09-05：驾驶船正停留本星系且带修理组件时可用） */}
      {state.awayGalaxy === galaxy.id ? (
        <FieldKitRepair engine={engine} onToast={onToast} />
      ) : null}
      {/* ① 前往掩护巡逻 */}
      <div className="app-ga-row">
        <span className="app-ga-main">
          <span className="app-ico"><Glyph name="ico-flag" size={13} color={ICO_TONES["ico-flag"]} /></span>{tr("ui.Expedition.084")}
          <span className="app-dim app-ga-desc">{tr("ui.Expedition.085")}</span>
        </span>
        <button
          className="app-btn is-small is-primary"
          disabled={standbyDisabled}
          title={standbyDisabled ? standbyTitle : tr("ui.Expedition.086", { p1: galaxy.name })}
          onClick={handleStandby}
        >
          {inFlight ? tr("ui.Expedition.087") : alreadyHere || state.awayGalaxy === galaxy.id ? tr("ui.Expedition.088") : tr("ui.Expedition.084")}
        </button>
      </div>
      {/* ② 副船掩护巡逻 */}
      <div className="app-ga-row app-ga-ai">
        <select
          className="app-select"
          value={aiShip}
          onChange={(e) => setAiShip(e.target.value)}
          title={tr("ui.Expedition.261")}
          disabled={idleShips.length === 0}
        >
          <option value="">{idleShips.length === 0 ? tr("ui.Expedition.206") : tr("ui.Expedition.022")}</option>
          {idleShips.map((id) => (
            <option key={id} value={id}>
              {shipDisplayName(state, ctx, id)}
            </option>
          ))}
        </select>
        {/* 核心下拉常驻：无可用核心时置灰并在控件里直接写明（船长 2026-09-10） */}
        <select
          className="app-select"
          value={usableCores.length === 0 ? '' : effCore}
          onChange={(e) => setAiCore(e.target.value as AiCoreType)}
          disabled={!aiCoreAvailable}
          title={
            aiCoreAvailable
              ? tr("ui.Expedition.023")
              : tr("ui.Expedition.207")
          }
        >
          {usableCores.length === 0 ? (
            <option value="">{tr("ui.ShipPage.070")}</option>
          ) : (
            usableCores.map((t) => (
              <option key={t} value={t}>
                {aiCoreName(t)}
              </option>
            ))
          )}
        </select>
        <button
          className="app-btn is-small"
          disabled={!aiShip || !aiCoreAvailable}
          onClick={handleAiStandby}
          title={
            !aiShip
              ? idleShips.length === 0
                ? tr("ui.Expedition.208")
                : tr("ui.Expedition.024")
              : !aiCoreAvailable
                ? tr("ui.Expedition.209")
                : undefined
          }
        >
          {tr("ui.Expedition.210")}
        </button>
      </div>
      {/* ③ 矿带 */}
      <div className="app-bay-title app-ga-sub">{tr("ui.Expedition.262")}{belts.length}）</div>
      {belts.length === 0 ? (
        <div className="app-dim app-ga-empty">{tr("ui.Expedition.263")}</div>
      ) : (
        belts.map((b) => {
          const ore = ctx.items.get(b.oreId)
          const isMiningThis = state.mining.active && state.mining.beltId === b.id
          return (
            <div key={b.id} className="app-ga-row">
              <span className="app-ga-main">
                {b.name}
                <span className="app-dim app-ga-desc">{ore?.name ?? b.oreId}{tr("ui.Expedition.309")}</span>
              </span>
              <button
                className={`app-btn is-small${isMiningThis || mineAskBelt === b.id ? ' is-warn' : ' is-primary'}`}
                /** **换矿带允许直接切**（船长 2026-09-21 答 2「允许切换」）：别处正在开采也照点（core 先停旧带） */
                disabled={isMiningThis}
                title={
                  isMiningThis
                    ? tr("ui.Expedition.310")
                    : expOn
                      ? mineAskBelt === b.id
                        ? tr("ui.Expedition.025")
                        : tr("ui.Expedition.312")
                      : tr("ui.MapPage.035")
                }
                onClick={() => handleMineStart(b.id)}
              >
                {isMiningThis ? tr("ui.ShipPage.146") : mineAskBelt === b.id ? (<><span className="app-ico"><Glyph name="ico-swap" size={13} color={ICO_TONES['ico-swap']} /></span>{tr("ui.Expedition.026")}</>) : expOn ? (<><span className="app-ico"><Glyph name="ico-swap" size={13} color={ICO_TONES['ico-swap']} /></span>{tr("ui.MapPage.034")}</>) : (<><span className="app-ico"><Glyph name="nav-mine" size={13} color={NAV_TONES['nav-mine']} /></span>{tr("ui.Expedition.144")}</>)}
              </button>
            </div>
          )
        })
      )}
      {/* ④ 悬赏（2026-09-24 船长：**重复清剿的环按钮就挂在这一行**，不再开容器）
          ⚠ 括号里的数 = **这一格实际列出的行数**（`bountyRowCount`）——仍被占 ⇒ 1（只有「击退入侵舰队」
          那一行）· 已收复押后 ⇒ 0（只有状态占位）· 平常 ⇒ 该星系卡数。 */}
      <div className="app-bay-title app-ga-sub">{tr("ui.Expedition.145")}{bountyRowCount}）
      </div>
      {/* ⚠ 本列表**列出该星系全部悬赏**（只按声望门槛过滤）：冷却中/进行中的卡原先被滤掉，
          而"开环"恰恰最需要它们可见（`setAutoLoopBounty` 只受 autoLoopReopenBlockReason 管、与冷却无关，
          见 core/expedition.ts）——否则打完之后那张卡会从列表消失、环还在跑却看不到也停不掉。
          每行两个按钮：「出击」（沿用原有禁用规则）＋ 环图标（开/停该卡的重复清剿）。 */}
      {(() => {
        const cands = engine.anomalies.filter((a) => a.galaxyId === galaxy.id)
        const list = cands.filter((a) => standingOf(state, DSI_FACTION_ID) >= a.standingReq)
        /**
         * **已收复 ⇒ 整区押后**（船长 2026-09-25 令，见 `bountyHeldHere`）：不列常驻悬赏，
         * 只留一行状态占位 —— 与 `invadedHere` 那一支互补（那边是"仍被占 ⇒ 击退入侵舰队"）。
         */
        if (bountyHeldHere) {
          return <div className="app-dim app-ga-empty">{tr('ui.weekend.100')}</div>
        }
        if (list.length === 0) {
          return <div className="app-dim app-ga-empty">{cands.length === 0 ? tr("ui.Expedition.437") : tr("ui.Expedition.264")}</div>
        }
        const transitOn = state.transit.active
        const otherExpOn = state.expedition.active && state.expedition.anomalyId !== null
        const goBlocked = transitOn || (otherExpOn && !miningActive)
        const loopId = state.autoLoopAnomalyId
        /** 「要开」方向的前置未满足（战损未补 / 装甲或结构 <50%）——关闭一律放行（与卡面同尺） */
        const reopenBlock = autoLoopReopenBlockReason(state)
        /** 开/停该卡的重复清剿（null = 停）；走 T8 那条唯一开关，忙碌/再开门槛与卡面同一把尺 */
        const runLoop = (id: string | null): void => {
          const r = engine.bountyLoopAt(id)
          setLoopAskAno(null)
          if (!r.ok) onToast(cmdText(r) || tr('ui.Expedition.393'), true)
        }
        /**
         * **入侵期间：这一格整行换成一个入口**（2026-09-25 船长令：「建议入侵的时候，在星系详细内的悬赏显示的是
         * **击退入侵舰队**，然后**告知威胁范围**就行了」）——
         * 不再逐张列被替换的卡（名字/威胁是抽签产物、对外不必暴露），只给一行 + **威胁范围**（按该区域池里的
         * 卡面威胁取 min~max：外围 {90,108} · 核心 {108,129}）。点「出击」照旧走既有出击链路，
         * 实际打的是**该星系驻留的那一支**（core 抽签定，与板面同源）。
         */
        if (invadedHere !== null) {
          const ev = invadedHere
          const threats = weekendFoePoolOf(ev.family, galaxy.id === ev.coreId)
            .map((id) => engine.ctx.anomalies.get(id)?.threat ?? 0)
            .filter((t) => t > 0)
          const lo = threats.length > 0 ? Math.min(...threats) : 0
          const hi = threats.length > 0 ? Math.max(...threats) : 0
          const card = list[0] ?? cands[0]
          /**
           * **敌对舰船一览**（2026-09-26 船长令：「**敌人舰船的名称和特殊装置染色**」＋
           * 「**因为入侵卡是随机抽取的，你应该显示所有抽取的卡可能出现的敌人**」）。
           *
           * · 范围 = 该族该区域**整池**（`weekendFoePoolOf` 与抽取同源）∪ 本卡编成 ⇒ 不再只报"这一仗抽到的那一种"；
           * · 染色走**富内容悬停**（`hoverTipProps`）：舰名用战场同款 `UI_TONES.foeName`（主舰 `foeNameMain`）、
           *   "特殊装置"那一节用 `UI_TONES.foeName` 同色系标出——与战斗画面的敌舰名同一套色，不自造颜色。
           */
          const foeLines = briefsOfPool(engine.ctx.anomalies, weekendFoePoolOf(ev.family, galaxy.id === ev.coreId), card)
          /**
           * **重复出击**（2026-09-26 船长报障：「**星系详细里的入侵悬赏重复清缴的按钮不见了**」）：
           * 那枚环按钮原先只加在**板面**的入侵卡（`AnomalyCard`）上，而**星系详细的被占分支只有「出击」**
           * —— 于是同一张卡换个地方看就少一枚按钮。这里按板面那一套补齐：
           * · 开关走 `engine.invasionLoopAt(galaxyId | null)`（与 `bountyLoopAt` 互斥，同一把尺）；
           * · 禁用规则沿用本组件已有的 `goBlocked` / `reopenBlock`（与列表里那条环同一套）；
           * · 文案 `ui.weekend.106`（重复出击）/ `ui.weekend.107`（开启说明）/ `ui.Expedition.043`（关闭）。
           */
          const invasionLoopOn = state.weekendEvent?.autoLoopGalaxyId === galaxy.id
          const loopBusy = state.mining.active || state.transit.active || (state.expedition.active && state.expedition.anomalyId !== null)
          const invasionLoopBlocked = !invasionLoopOn && (loopBusy || reopenBlock !== null)
          const toggleInvasionLoop = (): void => {
            const r = engine.invasionLoopAt(invasionLoopOn ? null : galaxy.id)
            if (!r.ok) onToast(cmdText(r) || tr('ui.Expedition.393'), true)
          }
          const foeTip =
            foeLines.length === 0 ? null : (
              <span className="app-ano-foebrief">
                {foeLines.map((l) => (
                  <span key={l.id} className="app-ano-foebrief-row">
                    <b style={{ color: l.count > 0 ? UI_TONES.foeNameMain : UI_TONES.foeName }}>
                      {l.name}（{l.hull}
                      {l.count > 0 ? `×${l.count}` : ''}）
                    </b>
                    <span className="app-dim">{'：'}</span>
                    {l.bits.map((b, i) => (
                      <span key={i}>
                        {b}
                        {i < l.bits.length - 1 || l.mounts !== undefined ? '，' : '。'}
                      </span>
                    ))}
                    {/**
                     * **特殊装置**（2026-09-26 船长令：「**特殊装置颜色不要和舰船名称颜色一样。
                     * 建议就特殊装置这四个字染色**」）：
                     * · **只染这四个字**，效果说明保持正文色；
                     * · 用 `UI_TONES.matBattle`（谜质「战斗线」的琥珀）——与舰名那条敌族红
                     *   （`foeName` / `foeNameMain`）是**不同的 token**，深空主题实测 224,168,106 vs 216,160,143。
                     */}
                    {l.mounts !== undefined ? (
                      <span>
                        <b style={{ color: UI_TONES.matBattle }}>{mountLabelText()}</b>
                        {'：'}
                        {l.mounts}。
                      </span>
                    ) : null}
                  </span>
                ))}
              </span>
            )
          return (
            /**
             * ⚠ **同一套红框**（船长 2026-09-25 第二条令：「星系详细『悬赏』区那行『击退入侵舰队』
             * 加同样的红框」）：与上面的旗舰入口同一对类名 ⇒ 观感与 `.app-weekend-box` 逐字同款。
             * 悬停（`title`）挂在**整张卡**上，见 `foeBriefTip` 的注释。
             */
            <div className="app-ga-row app-ga-invasion" {...(foeTip ? hoverTipProps(foeTip) : {})}>
              <span className="app-ga-main">
                <span className="app-ico">
                  <Glyph name="nav-bounty" size={13} color={NAV_TONES['nav-bounty']} />
                </span>
                {tr('ui.weekend.092')}
                <span className="app-dim app-ga-desc">
                  {tr('ui.weekend.093', { p1: lo, p2: hi })}
                  {' · '}
                  {tr('ui.weekend.096')}
                </span>
                {/**
                 * **敌火力类型 ＋ 敌血型**（2026-09-26 船长令：「像常驻悬赏那样，添加一个敌人火力类型、
                 * 敌人血量类型」）：与常驻悬赏卡（`AnomalyCard`）**同一对组件与同一套取数**
                 * （`FoeDamageMix` / `foeLayerSplit` + `ProfileChip`），口径与战斗结算同源。
                 * `card` 缺省时不渲染这两行（没抽签就没有可报的敌情）。
                 */}
                {card ? (
                  <span className="app-dim app-ga-invprog-line" title={tr('ui.Expedition.218')}>
                    {tr('ui.Expedition.366')}
                    <FoeDamageMix anomaly={card} />
                  </span>
                ) : null}
                {card
                  ? (() => {
                      const p = card.defProfile ?? 'balanced'
                      const cn = p === 'shield' ? tr('ui.Expedition.272') : p === 'armor' ? tr('ui.Expedition.273') : tr('ui.Expedition.098')
                      return (
                        <span className="app-dim app-ga-invprog-line" title={tr('ui.Expedition.219', { p1: Math.round(foeLayerSplit(p).s * 100), p2: Math.round(foeLayerSplit(p).a * 100), p3: Math.round(foeLayerSplit(p).h * 100) })}>
                          {tr('ui.Expedition.367')}
                          <ProfileChip profile={p} text={cn} />
                        </span>
                      )
                    })()
                  : null}
                {/**
                 * **收复进度（2026-09-26 船长令）**：「被入侵的星系的星系详细内，在'击退入侵舰队'卡片处
                 * 显示该星系的**收复进度**。当核心星系无法收复时，在对应的击退入侵舰队卡片**提示玩家**」
                 * ——提示文案（船长照抄）：「**至少需要夺回一个外围星系**」。
                 *
                 * 读数与门禁同源：核心那格取 `weekendCoreGateView`（内部就是 `weekendCoreProgressAt`
                 * 与它用的那条 `weekendPeripheryClearedAt`）；外围那格取 `weekendProgressAt`。
                 * 进度**即时读**（NPC 铺底随时间涨）⇒ 每次重渲染自然刷新。
                 * 进度条复用既有 `.app-card-progress.is-invasion`（与 MapPage 入侵框、星系详细的入侵残骸条同款）。
                 */}
                {(() => {
                  const isCore = galaxy.id === ev.coreId
                  const gate = isCore ? weekendCoreGateView(state, ev, Date.now()) : null
                  const p = gate ? gate.progress : weekendProgressAt(state, ev, galaxy.id, Date.now())
                  const pct = Math.max(0, Math.min(100, Math.round(p * 100)))
                  return (
                    <span className="app-ga-invprog">
                      <span className="app-ga-invprog-line">
                        {tr('ui.weekend.103', { p1: String(pct) })}
                        {gate?.gated
                          ? ` · ${
                              gate.missing >= gate.total
                                ? tr('ui.weekend.104')
                                : tr('ui.weekend.105', { p1: String(gate.missing) })
                            }`
                          : ''}
                      </span>
                      <span className="app-card-progress is-invasion">
                        <i style={{ width: `${pct}%` }} />
                      </span>
                    </span>
                  )
                })()}
              </span>
              <span className="app-ga-btns">
                {/* 环按钮：**纯图标 ＋ 文字**（与板面入侵卡同款「重复出击」），悬停给开启说明 */}
                <button
                  className={`app-btn is-small${invasionLoopOn ? ' is-warn' : ''}`}
                  disabled={invasionLoopBlocked}
                  title={
                    invasionLoopOn
                      ? tr('ui.Expedition.043')
                      : reopenBlock !== null
                        ? reopenBlock
                        : loopBusy
                          ? tr('ui.Expedition.154')
                          : tr('ui.weekend.107')
                  }
                  onClick={toggleInvasionLoop}
                >
                  {invasionLoopOn ? (
                    tr('ui.Expedition.044')
                  ) : (
                    <>
                      <span className="app-ico">
                        <Glyph name="ico-loop" size={13} color={ICO_TONES['ico-loop']} />
                      </span>
                      {tr('ui.weekend.106')}
                    </>
                  )}
                </button>
                <button
                  className={`app-btn is-small${miningActive ? ' is-warn' : ' is-primary'}`}
                  disabled={card === undefined || goBlocked}
                  title={card === undefined ? tr('ui.Expedition.437') : miningActive ? tr('ui.Expedition.315') : tr('ui.Expedition.090')}
                  onClick={() => card !== undefined && handleAnoGo(card)}
                >
                  {miningActive ? tr('ui.Expedition.265') : tr('ui.Expedition.091')}
                </button>
              </span>
            </div>
          )
        }
        return list.map((a) => {
          const looping = loopId === a.id
          const inFlightSelf = state.expedition.active && state.expedition.anomalyId === a.id
          const cdRemain = bountyCooldownRemainingMs(state, a.id)
          const busyOther =
            state.mining.active || state.transit.active || (state.expedition.active && state.expedition.anomalyId !== a.id)
          const loopBlocked = !looping && (busyOther || reopenBlock !== null)
          return (
            <div key={a.id} className="app-ga-row">
              <span className="app-ga-main">
                <span className="app-ico"><Glyph name="nav-bounty" size={13} color={NAV_TONES["nav-bounty"]} /></span>{a.name}
                <span className="app-dim app-ga-desc">
                  {tr("ui.Expedition.089")} {a.threat}{tr('ui.Expedition.369')}{Math.round(a.rewardIsk * bountyRewardFactor(state)).toLocaleString('zh-CN')} {tr("ui.FirstTasks.003")}
                  {state.completedBounties.includes(a.id) ? tr("ui.Expedition.354") : ''}
                  {/* 行内状态字（原先这些卡被过滤掉了，现在补上状态让玩家看得懂为什么按钮灰着） */}
                  {cdRemain > 0 ? ` · ${tr("ui.Expedition.037")} ${Math.max(1, Math.ceil(cdRemain / 1000))}${tr('ui.Expedition.418')}` : ''}
                  {inFlightSelf ? ` · ${tr("ui.Expedition.436")}` : ''}
                  {looping ? ` · ${tr("ui.Expedition.433")}` : ''}
                </span>
              </span>
              {/* 行尾按钮组：**环 + 出击必须相邻**（船长 2026-09-24：「按钮离出击有点太远了。要相邻」）
                  —— `.app-ga-row` 是 `justify-content: space-between` + `gap: 10px`，两个按钮各自做 flex 项
                  就会被主内容那段的余量撑开；包成一组后组内只剩 4px。 */}
              <span className="app-ga-btns">
                {/* 环按钮：**纯图标**（船长选定），悬停说明走既有卡片文案 */}
                <button
                  className={`app-btn is-small${looping ? ' is-warn' : ''}`}
                  disabled={loopBlocked || loopAskAno === a.id}
                  title={looping ? tr("ui.Expedition.043") : reopenBlock !== null ? reopenBlock : busyOther ? tr("ui.Expedition.154") : tr("ui.Expedition.155")}
                  onClick={() => {
                    if (looping) runLoop(null)
                    else if (loopId !== null) setLoopAskAno(a.id)
                    else runLoop(a.id)
                  }}
                >
                  <span className="app-ico">
                    <Glyph name="ico-loop" size={13} color={ICO_TONES['ico-loop']} />
                  </span>
                </button>
                <button
                  className={`app-btn is-small${goAskAno === a.id ? ' is-warn' : ' is-primary'}`}
                  disabled={goBlocked || cdRemain > 0 || inFlightSelf}
                  title={
                    cdRemain > 0
                      ? tr("ui.Expedition.323", { p1: Math.max(1, Math.ceil(cdRemain / 1000)) })
                      : inFlightSelf
                        ? tr("ui.Expedition.277")
                        : transitOn
                          ? tr("ui.Expedition.313")
                          : otherExpOn && !miningActive
                            ? tr("ui.Expedition.314")
                            : miningActive
                              ? goAskAno === a.id
                                ? tr("ui.Expedition.027")
                                : tr("ui.Expedition.315")
                              : tr("ui.Expedition.090")
                  }
                  onClick={() => handleAnoGo(a)}
                >
                  {cdRemain > 0 ? tr("ui.Expedition.100") : goAskAno === a.id ? tr("ui.Expedition.028") : miningActive ? tr("ui.Expedition.265") : tr("ui.Expedition.091")}
                </button>
              </span>
              {/* 顶替确认（船长选的「允许顶替但先确认」）：**内联在行内**，照抄同文件 goAsk 的写法，不新增弹窗机制 */}
              {loopAskAno === a.id ? (
                <span className="app-ga-switch-confirm">
                  <span className="app-dim">{tr("ui.Expedition.430")}</span>
                  <button className="app-btn is-small is-danger" onClick={() => runLoop(a.id)}>
                    {tr("ui.App.086")}
                  </button>
                  <button className="app-btn is-small" onClick={() => setLoopAskAno(null)}>
                    {tr("ui.ActivityBar.004")}
                  </button>
                </span>
              ) : null}
            </div>
          )
        })
      })()}
      {/**
       * **入侵残骸条（置顶）**（船长 2026-09-25：「需要独立的残骸条」＋「打捞界面置顶」）：
       * 放在「残骸打捞」标题**之前**；与星系密度分开读（船长：「入侵残骸不算当地星系密度」），
       * 只有 >0 时才出这一条。
       */}
      {(() => {
        const invWreck = weekendWreckDensityOf(state, galaxy.id)
        if (invWreck <= 0) return null
        const densityHere = wreckDensityOf(state, galaxy.id, engine.ctx)
        const pct = Math.round((invWreck / (invWreck + densityHere)) * 100)
        return (
          <div className="app-belt-invwreck" title={tr('ui.weekend.095', { p1: String(pct) })}>
            <span className="app-belt-invwreck-label">{tr('ui.weekend.094', { p1: invWreck.toFixed(1) })}</span>
            <div className="app-card-progress is-invasion">
              <i style={{ width: `${pct}%` }} />
            </div>
          </div>
        )
      })()}
      {/**
       * **玩家舰船残骸（置顶）**（**2026-09-26 船长令**：「玩家舰船被摧毁后，如果是在非虫洞的正常星系内，
       * 在该星系生成一个'<被摧毁的舰船名称>的残骸'该残骸存在48小时，玩家如果在该星系打捞，
       * 优先打捞该残骸（比稀有残骸优先级还高）」）。
       *
       * 读数卡（**只做读数，观感交船长审**）：船名 ＋ 还可回收件数 ＋ 剩余小时（48h 线性衰减）。
       * 一具一张卡（同星系可多具、各算各的 48h）；没有残骸时整段不渲染。
       */}
      {(() => {
        const wrecks = shipWrecksOf(state, galaxy.id)
        if (wrecks.length === 0) return null
        return (
          <div className="app-belt-invwreck" title={tr('ui.weekend.110', { p1: String(wrecks.length) })}>
            <span className="app-belt-invwreck-label">{tr('ui.weekend.110', { p1: String(wrecks.length) })}</span>
            {wrecks.map((w) => {
              const leftH = Math.max(0, Math.round((1 - w.decayAccMs / SHIP_WRECK_DECAY_MS) * 48))
              const rows = wreckLootRowsOf(w, engine.ctx).length
              return (
                <span key={w.shipId} className="app-dim app-ga-desc">
                  {tr('ui.weekend.111', { p1: w.name, p2: String(rows), p3: String(leftH) })}
                </span>
              )
            })}
          </div>
        )
      })()}
      {/* ⑤ 残骸打捞（B3：采矿式自动循环作业；需高槽打捞器，满仓自动返航卸货后自动续捞） */}
      <div className="app-bay-title app-ga-sub">
        <span className="app-ico"><Glyph name="nav-salvage" size={14} color={NAV_TONES["nav-salvage"]} /></span>{tr("ui.Expedition.211")} {wreckDensityOf(state, galaxy.id, engine.ctx).toFixed(1)}）
      </div>
      {state.salvaging.active && state.salvaging.galaxyId === galaxy.id ? (
        <div className="app-ga-row">
          <span className="app-ga-main">
            {tr("ui.Expedition.146")}
            <span className="app-dim app-ga-desc">
              {state.salvaging.phase === 'outbound'
                ? tr("ui.MapPage.056")
                : state.salvaging.phase === 'returning'
                  ? tr("ui.MapPage.057")
                  : tr("ui.Expedition.147", { p1: Math.round(state.salvaging.tripM3 * 10) / 10 })}
            </span>
          </span>
          <button className="app-btn is-small is-warn" onClick={() => engine.stopSalvageOpNow()}>
            {tr("ui.ActivityBar.005")}
          </button>
        </div>
      ) : (
        <div className="app-ga-row">
          <span className="app-ga-main">
            {tr("ui.Expedition.148")}
            <span className="app-dim app-ga-desc">
              {tr("ui.Expedition.212")}
            </span>
          </span>
          <button
            className="app-btn is-small is-primary"
            /**
             * ⚠ **2026-09-26 船长报障**：「**星系详细里，如果处于打捞状态是无法直接在其他星系详细内切换打捞对象**」
             * ——真因 = 这里写死了 `disabled={state.salvaging.active}`。
             * core 早已允许**直接换打捞点**（`startSalvageOp` 先 `salvageHalt` 停本趟、残骸留在船上，再按新星系开工；
             * 船长 2026-09-21 答 2「允许切换」），MapPage 那侧也一直是可点的 ⇒ **界面这一格才是 bug**，
             * 与「换矿带允许直接切」同一把尺。现在与 MapPage 一致：别处正在打捞时这里照点。
             */
            title={tr("ui.MapPage.070")}
            onClick={() => {
              const r = engine.startSalvageOpAt(galaxy.id)
              if (!r.ok) onToast(cmdText(r) || tr('ui.Expedition.390'), true)
            }}
          >
            <span className="app-ico"><Glyph name="nav-salvage" size={13} color={NAV_TONES["nav-salvage"]} /></span>{tr("ui.MapPage.071")}
          </button>
        </div>
      )}
      {/* 2026-09-08 建站交付航线 v2（船长定稿：物理载货 + 自动多趟循环）——该星系有未建成工地 → 一键交付循环 */}
      {(() => {
        const site = [...engine.ctx.stations.values()].find((s) => s.galaxyId === galaxy.id)
        if (!site) return null
        const prog = state.stationSites[site.id]
        if (prog && prog.stage >= site.tiers.length) return null // 已建成：不需要交付航线
        if (!isExplored(state, galaxy.id)) return null
        const tripOn = state.transit.active && state.transit.delivery?.siteId === site.id
        // 交付循环只装仓库建材（当前档材料单；2026-09-09 逐档材料单口径）
        const billRowsHere = stationBillView(state, engine.ctx, site)
        const mat = billRowsHere.reduce((s0, r) => s0 + (state.warehouse.items[r.itemId] ?? 0), 0)
        const freeM3 = Math.max(0, Math.floor(cargoCapacityM3Of(state, engine.ctx, state.shipId) - cargoUsedM3Of(state, engine.ctx, state.shipId)))
        const matNames = billRowsHere.map((r) => `${r.itemName}×${r.remaining.toLocaleString('zh-CN')}`).join(tr("ui.MatterTechTab.017"))
        const canSend =
          !tripOn && !state.transit.active && !state.standby.active && state.awayGalaxy === null && !pilotBusy && mat > 0 && freeM3 > 0
        const title = tripOn
          ? tr("ui.Expedition.029")
          : state.awayGalaxy !== null
            ? tr("ui.Expedition.266")
            : pilotBusy || state.standby.active || state.transit.active
              ? tr("ui.Expedition.316")
              : freeM3 <= 0
                ? tr("ui.Expedition.267")
                : mat <= 0
                  ? tr("ui.Expedition.030", { matNames: matNames })
                  : tr("ui.Expedition.031", { freeM3: freeM3 })
        return (
          <div className="app-ga-row">
            <span className="app-ga-main">
              <span className="app-ico"><Glyph name="ico-flag" size={13} color={ICO_TONES['ico-flag']} /></span>
              {tr("ui.Expedition.150")} {site.name}
              <span className="app-dim app-ga-desc">
                {tr("ui.Expedition.032")} {mat.toLocaleString('zh-CN')} {tr("ui.Expedition.092")} {matNames}{tr('ui.Expedition.391')}{freeM3.toLocaleString('zh-CN')} {tr("ui.Expedition.033")}
              </span>
            </span>
            <button
              className="app-btn is-small is-primary"
              disabled={!canSend}
              title={title}
              onClick={() => {
                const r = engine.deliverTripAt(site.id)
                if (!r.ok) onToast(cmdText(r) || tr('ui.Expedition.389'), true)
                else onToast(tr("ui.Expedition.093", { p1: site.name }))
              }}
            >
              <span className="app-ico"><Glyph name="ico-home" size={13} color={ICO_TONES['ico-home']} /></span>
              {tripOn ? tr("ui.Expedition.034") : tr("ui.Expedition.094")}
            </button>
          </div>
        )
      })()}
      {/* 虫洞面板本体已搬到 App 那一层（`onOpenWormhole`）：入口行在这里，面板不再依赖"星图选中星系" */}
    </div>
  )
}

/* ─────────── 悬赏任务卡 ─────────── */

/**
 * 敌方战术 → 打法提示（C4 第二批收口·#3 丙，2026-09-05 船长确认"甲+丙"）：
 * 威胁数字是强度刻度、战术决定"哪种装配吃瘪"——kite 卡专治短程，光看威胁会误判。
 */
const FOE_TACTIC_HINTS: Record<string, string> = {
  brawl: tr("ui.Expedition.268"),
  orbit: tr("ui.Expedition.269"),
  kite: tr("ui.Expedition.317"),
}

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
              {tr("ui.Expedition.096")} {formatDurationMs(anomaly.combatSeconds * 1000)}
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
          title={tr("ui.Expedition.039", { p1: grossIsk.toLocaleString('zh-CN'), p2: formatDurationMs(roundTripMs) })}
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
export function Communicator({
  script,
  onClose,
}: {
  script: { title: string; lines: readonly { speaker: string; text: string }[] }
  onClose: () => void
}) {
  return (
    <div className="app-comm-mask" onClick={onClose}>
      <div className="app-comm" onClick={(e) => e.stopPropagation()}>
        <div className="app-comm-title">{script.title}</div>
        <div className="app-comm-body">
          {script.lines.map((l, i) => (
            <div key={i} className="app-comm-line">
              <span className="app-comm-speaker">{l.speaker}</span>
              <span className="app-comm-text">{l.text}</span>
            </div>
          ))}
        </div>
        <div className="app-comm-foot">
          <button className="app-btn is-small is-primary" onClick={onClose}>
            {tr("ui.Expedition.048")}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ─────────── v24 任务中心·时效任务（资源 / 快递：随 20 分钟补给周期整板刷新，限时有效；
   2026-09-10 追加：赏金任务 = 独立日板，24 小时一轮、每天本地 0 点整板替换） ─────────── */

/** mm:ss（向上取整到秒；与市场页下次补给同口径） */
function fmtSideClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/** h:mm:ss（日板倒计时：赏金一轮 24 小时，mm:ss 不够看） */
function fmtDayClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

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
                    <span className="app-dim">{tr("ui.Expedition.114")} {fmtDayClock(view.bountyRemainingMs)}</span>
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
          {/* 5 席已清空时：派系活跃卡仍在（上方），这里补一行说明为什么席位是空的 */}
          {tasks.length === 0 ? (
            <div className="app-dim app-exp-idle">
              {tr('ui.Expedition.409')}
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
