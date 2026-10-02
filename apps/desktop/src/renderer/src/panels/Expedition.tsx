/**
 * M3 远征中心：势力声望、星图（SVG）、悬赏任务卡。
 * 中列面板：SkirmishStatus（远征中作业）→ StarMap（可点选）→ Standing → 任务列表。
 */
import { useEffect, useRef, useState } from 'react'
import type { AnomalyDef } from '@whale/core'
// 2026-09-23 船长令：使用 AI 核心时默认选「当前拥有的最高级核心」
import {
  DSI_FACTION_ID,
  expeditionStatus,
  isExplored,
  originGalaxyOf,
  scanStatus,
  weekendZoneLiveAt,
  shortestTravelMinutes,
  standingOf,
  /** 声望**可支配**余额（＝累计 − 已花）——声望商店子页标题行那两本账走它（与弹层同一口径） */
  spendableStandingOf,
  transitStatus,
} from '@whale/core'
import { Panel } from '@whale/ui'
import type { GameEngine } from '../game/engine'
import { tr, cmdText } from '../i18n/locale'
import type { ToastFn } from '../pages/common'
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
import { Glyph, NAV_TONES, ICO_TONES } from '../ui/Glyphs'
import { sessionPick, setSessionPick, useSessionScroll } from '../ui/sessionView'
// ⚠ 舰船角色名走本地化单点（2026-09-26 船长报障「舰船类型文本漏中文」）——core 的 shipRoleLabel 是纯中文表
import { fmtDuration } from '../i18n/fmt'
// 星图域（2026-10-02 批次 4p 拆到 StarMap.tsx；本文件借回使用）
import { StarMap, useFoeArtFit } from './StarMap'
// 远征任务卡族（2026-10-02 批次 4q 拆到 ExpeditionCards.tsx；本文件借回使用）
import { AnomalyCard, BountyTasksArea, SideTasksArea, StationCard } from './ExpeditionCards'
// 通讯弹层（2026-10-02 批次 4o 拆到 ui/communicator；App 走本文件再导出）
export { Communicator } from '../ui/communicator'

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
/** 时效任务排序（2026-10-02 批次 4q 随任务卡族迁到 ExpeditionCards.tsx） */

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
   * 判据 = `weekendZoneLiveAt`（**仍被占**才算；与"赏金栏改显结算口径"、星系详细那行入侵框
   * 同一把尺 ⇒ 三处不会各说各话）。已夺回的星系不算 —— 它的常驻悬赏本来就还在隐藏状态，
   * 不占板面、也无需置顶。
   *
   * 比较器本体抽到 `./bountySort`（纯函数 ⇒ 工具/用例可直接断言"置顶恒成立"）。
   */
  const pinnedIds = new Set(listed.filter((a) => weekendZoneLiveAt(state, a.galaxyId, Date.now())).map((a) => a.id))
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
