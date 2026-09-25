/**
 * **应用外壳（app shell）——两套布局 + 设置内切换**（2026-09-25 · ui-redesign-2）
 *
 * 船长令：「**新旧界面能否允许玩家在设置内切换？**」→ 裁定**甲：两套 DOM 并存**。
 *
 * ## 做法（上一轮失败三次换来的）
 * 外壳内联了大量 App 局部状态与回调；上一轮试图「抽 34 个 props ＋ 逐个加 p. 前缀」，
 * 结果 JSX 标签名 / 属性名 / 箭头函数 => 的 > 都被误改。本轮改为：
 *   · **一个结构化 props 对象** ctx，在组件顶部**解构** ⇒ 两套外壳块**原名即用、零改写**；
 *   · pageMain / logDock 由 App 作为 ctx 字段传入（它们属 App，不搬进来）；
 *   · 两套布局**共用同一份 ctx** ⇒ 不会各存一份状态而漂移。
 *
 * ## 两套布局
 * · modern（新）：顶栏 +（**左列**：舰船窗 + 活动栏）+ 主区 → **底部横栏**导航 + 右侧日志浮层
 * · classic（旧，取自 main 分支原文）：顶栏（含存档按钮）+（**左侧竖栏**：舰船窗 + 钱包 + 导航项）
 *   +（活动栏横条 + 主区 + 日志坞），**原样冻结**
 *
 * ⚠ 旧版是**冻结的历史形态**；新版后续新增（副AI活动 / 计时中组 / AI 迷你卡动画…）只在 modern 出现
 * —— 这是船长已知并接受的差异。
 */
import type { ReactNode } from 'react'
import type { GameEngine } from '../game/engine'
import type { ActivePromo, ActiveTuning, GameState } from '@whale/core'
import { formatDurationMs, formatDurationShort } from '@whale/core'
import type { ToastFn } from '../pages/common'
import { ActivityBar } from '../panels/ActivityBar'
// 旧版活动栏：从「昨天那版」原样拆出的冻结件（船长令「旧版建议你从昨天的版本中 git 下来进行拆解」）
import { ActivityBarClassic } from '../panels/ActivityBarClassic'
import { AnnouncementHub } from '../panels/Announcements'
import { DebugButton } from '../panels/DebugPanel'
import { Glyph } from './Glyphs'
import { ICO_TONES, NAV_TONES } from './tones'
import { MoneyFit } from './MoneyFit'
import { ShipStatusWin } from './ShipStatusWin'
import type { MapTab } from '../pages/MapPage'
import type { ShipTab } from '../pages/ShipPage'
import type { PageKey } from '../App'
import { tr, useL10n } from '../i18n/locale'

export type LayoutKind = 'modern' | 'classic'

/** 外壳需要的全部输入（App 提供；外壳只读） */
export interface ShellCtx {
  state: GameState
  engine: GameEngine
  changePage: (p: PageKey) => void
  handleSave: () => Promise<void>
  handleReset: () => void
  setShowSaveManager: (v: boolean) => void
  changeMapTab: (t: MapTab) => void
  changeShipTab: (t: ShipTab) => void
  showToast: ToastFn
  hideActivityWin: () => void
  openWormhole: () => void
  windowRestore: { title: string; onRestore: () => void } | null
  unlocked: (s: GameState, key: string) => boolean
  commsUnread: number
  bountyNew: number
  firstTaskNew: { title: string; ready: boolean } | null
  navBeat: { key: string } | null
  page: string
  setShowSettings: (v: boolean) => void
  setShowHandbook: (v: boolean) => void
  copyQqGroup: () => void
  qqCopied: boolean
  setReportDismissed: (v: boolean) => void
  setPerfOpen: (f: (v: boolean) => boolean) => void
  debugOn: boolean
  promosNow: readonly ActivePromo[]
  tuningsNow: readonly ActiveTuning[]
  tuningTick: number
  layoutKind: LayoutKind
  navItems: readonly { key: string; label: string; icon: string }[]
  debugNavItems: readonly { key: string; label: string; icon: string }[]
  readDebugEnabled: () => boolean
  qqGroup: string
  pageMain: ReactNode
  logDock: ReactNode
}

export function AppShell(ctx: ShellCtx): JSX.Element {
  // 解构 ⇒ 下面两套外壳块里的标识符**原名即用**（本轮避免「改坏」的关键）
  const {
    state,
    engine,
    changePage,
    handleSave,
    handleReset,
    setShowSaveManager,
    changeMapTab,
    changeShipTab,
    showToast,
    hideActivityWin,
    openWormhole,
    windowRestore,
    unlocked,
    commsUnread,
    bountyNew,
    firstTaskNew,
    navBeat,
    page,
    setShowSettings,
    setShowHandbook,
    copyQqGroup,
    qqCopied,
    setReportDismissed,
    setPerfOpen,
    debugOn,
    promosNow,
    tuningsNow,
    tuningTick,
    layoutKind,
    navItems,
    debugNavItems,
    readDebugEnabled,
    qqGroup,
    // 两支插槽由 App 传入：`pageMainSlot` = `<main class="app-page-main">` 整块；`logDockSlot` = 右侧日志坞
    pageMain: pageMainSlot,
    logDock: logDockSlot,
  } = ctx
  /**
   * ⚠ **两支插槽在两套布局里的落点不同**（2026-09-25 船长报障后修正）：
   * · 新版：`.app-workspace` = 左列 + 右体；**主区在右体里**（`pageMainSlot`），日志坞是**右侧浮层**（`logDockSlot`）；
   * · 旧版（main 原文）：`.app-workspace` 三个直接子块 = `nav` + **主列** + **日志坞（流内右栏）**，
   *   且主列的首个子块是「活动窗口」那条。
   * ⇒ 旧版里两支插槽**对调**：主列位置放日志坞的 DOM（`app-log-dock`），第三块放 `<main>` 整块。
   *   React 同一次渲染只会挂其中一个位置，不会重复渲染同一份数据。
   */
  const NAV_ITEMS = navItems
  const DEBUG_NAV_ITEMS = debugNavItems
  const QQ_GROUP = qqGroup
  // 导航项文案：外壳块里用的是 `t(...)`（App 里来自 useL10n）⇒ 外壳自取一份，不追加 props
  const { t } = useL10n()

  return layoutKind === 'classic' ? renderClassic() : renderModern()

  /* ─────────────────── 新版（modern）─────────────────── */
  function renderModern(): JSX.Element {
    return (
      <>
        <header className="app-header">
          <div className="app-header-left">
            {/* 游戏名（2026-09-11 船长：「将游戏的名称改为大鲸鱼-深空放置」；
                注意「深空工业协会」是**游戏内势力**、不随游戏名改） */}
            <span className="app-logo">{tr("ui.App.056")}</span>
            <span className="app-pilot">{state.character.name}</span>
  
            {/* **钱包**（2026-09-25 船长令：「钱包显示移动到顶部玩家名字的右侧」）
                —— 原在左侧栏「出港上方」（2026-09-13 令），本轮随外壳重排移到顶栏。 */}
            <MoneyFit amount={state.wallet.isk} className="app-isk app-wallet" />
            {/*
             * **限时活动 + 限时加成**（2026-09-25 船长令：「限时活动和限时加成，放到顶部钱包的右侧」）
             * —— 原来在活动栏的标题栏里；标题栏移除后归到顶栏、紧跟钱包。
             * 类名与去向口径**沿用原样**（促销 `p.open` 决定去「扫描虫洞」还是「星图」），只是换了容器。
             */}
            {promosNow.map((p) => (
              <button
                key={`promo-${p.id}-${p.untilMs}`}
                className="app-header-tuning app-header-promo"
                title={
                  `${p.label}${p.detail ? `\n${p.detail}` : ''}\n` +
                  tr("ui.ActivityBar.054", { p1: new Date(p.untilMs - 1).toLocaleDateString('zh-CN'), p2: formatDurationMs(Math.max(0, p.untilMs - tuningTick)) }) +
                  tr("ui.ActivityBar.059", { p1: p.open === 'wormhole-scan' ? tr("ui.MapPage.007") : tr("ui.ActivityBar.006") })
                }
                onClick={() => {
                  if (p.open === 'wormhole-scan') {
                    changePage('map')
                    changeMapTab('whscan')
                    return
                  }
                  changePage('map')
                  changeMapTab('star')
                }}
              >
                <span className="app-ico">
                  <Glyph name="ico-scan" size={12} color={ICO_TONES['ico-scan']} />
                </span>
                <span className="app-header-tuning-name">{p.label}</span>
                <span className="app-header-tuning-time">{formatDurationShort(Math.max(0, p.untilMs - tuningTick))}</span>
              </button>
            ))}
            {tuningsNow.map((tn) => (
              <button
                key={`${tn.key}-${tn.untilMs}`}
                className="app-header-tuning"
                title={
                  tr("ui.ActivityBar.060", { p1: tn.name, p2: tn.mul, p3: tn.note ? `\n${tn.note}` : '' }) +
                  tr("ui.ActivityBar.054", { p1: new Date(tn.untilMs - 1).toLocaleDateString('zh-CN'), p2: formatDurationMs(Math.max(0, tn.untilMs - tuningTick)) })
                }
                onClick={() => {
                  changePage('map')
                  changeMapTab('star')
                }}
              >
                <span className="app-ico">
                  <Glyph name="ico-scan" size={12} color={ICO_TONES['ico-scan']} />
                </span>
                <span className="app-header-tuning-name">{tn.name} ×{tn.mul}</span>
                <span className="app-header-tuning-time">{formatDurationShort(Math.max(0, tn.untilMs - tuningTick))}</span>
              </button>
            ))}
          </div>
          <div className="app-header-right">
            {/* V15 调试模式入口（开发工具：DevTools 置 whale-idle:debug=1 后出现） */}
            {debugOn ? (
              <>
                <DebugButton engine={engine} onFastForwarded={() => setReportDismissed(false)} />
                <button
                  className="app-btn"
                  onClick={() => setPerfOpen((v) => !v)}
                  title={tr("ui.App.057")}
                >
                  {tr("ui.App.058")}
                </button>
              </>
            ) : null}
            {/* 在线时长。⚠ 本条注释原写「金钱栏已移到左侧栏」（船长 2026-09-13 令）；
                 **2026-09-25 船长令「钱包显示移动到顶部玩家名字的右侧」** ⇒ 钱包已回到顶栏
                 （见上方 `app-pilot` 右侧的 `MoneyFit`），本注释随之更正。 */}
            <span className="app-clock">{tr("ui.App.059")} {formatDurationMs(state.gameMs)}</span>
            {/* 公告弹层一开就收起嵌入的活动窗口（2026-09-21 船长令：打开弹层即隐藏并最小化） */}
            <AnnouncementHub engine={engine} onOpen={hideActivityWin} />
            <button
              className="app-btn"
              onClick={copyQqGroup}
              title={tr("ui.App.111", { QQ_GROUP: QQ_GROUP })}
            >
              {qqCopied ? tr("ui.App.060") : tr("ui.App.112", { QQ_GROUP: QQ_GROUP })}
            </button>
            <button
              className="app-btn"
              onClick={() => {
                setShowHandbook(true)
                hideActivityWin() // 打开弹层即收起（同上）
              }}
              title={tr("ui.App.061")}
            >
              {t('ui.App.028')}
            </button>
            <button
              className="app-btn"
              onClick={() => {
                setShowSettings(true)
                hideActivityWin() // 打开弹层即收起（同上）
              }}
              title={tr("ui.App.062")}
            >
              {t('ui.App.010')}
            </button>
            {/**
             * ⚠ **顶栏的「保存 / 存档管理 / 重置档案」三个按钮已移入设置弹窗**
             * （2026-09-25 船长令：「将存档管理，重置档案，保存移动到设置内」）
             * ⇒ 见 `SettingsPanel` 里的「存档」一组。顶栏只留：在线时长 / 公告 / QQ群 / 手册 / 设置。
             */}
          </div>
        </header>
  
        <div className="app-workspace">
          {/* 活动栏：**左侧竖列**（2026-09-25 船长令「将活动栏放到左侧，竖列显示。这样 AI 作业也能
              同时显示多个」）。宽 150px、高占满内容区 ⇒ 同时可见作业行数由约 7 提到约 18。
              ⚠ 与右侧 `.app-workspace-body` 在横向 flex 的 workspace 里**并列**；
              （早先误做成"顶部横条"1244×110，与船长批准的草图丁不符，此处已改回。） */}
          {/* **左列**（2026-09-25 船长令：「SVG舰船动画小窗口依旧是在左上角，**活动页面的上方**」）
              ⇒ 舰船窗在上、活动栏在下，同处左侧一列。
              先前把舰船窗放进主区上方的信息带，与船长要求不符，此处改回。 */}
          <div className="app-left-col">
              <ShipStatusWin engine={engine} restore={windowRestore} />
          <ActivityBar
          engine={engine}
          onToast={showToast}
          onAiCenter={() => {
          changePage('ship')
          changeShipTab('ai') // AI 徽标 → 舰船页「AI 指挥中心」标签
          }}
          onGoPage={(page, mapTab) => {
          changePage(page as PageKey)
          if (mapTab) changeMapTab(mapTab as MapTab)
          }}
          onOpenWormhole={openWormhole}
          />
          </div>
  
          {/* 右侧纵向体：信息带（舰船窗 + 金钱栏）+ 主区 + 日志坞 */}
            <div className="app-workspace-body">
            {pageMainSlot}
          </div>
        </div>
        <nav className="app-nav-side">
        {/**
        * 2026-09-25 船长令：「将导航栏放到底部…出港放在正中间」
        *
        * ⚠ **为什么改成分两组渲染**（而不是只调 `NAV_ITEMS` 的数组顺序）：导航项有**解锁门槛**
        * （`unlocked()`：市场 ← 第一次生产、工业 ← 第一次精炼），初期项数会变（8~10 项）
        * ⇒ 平铺时"出港前面有几项"随之变化，**居中会被解锁进度破坏**。
        * 拆成「左组 + 出港 + 右组」后由底栏的 `justify-content: space-between` 定位：
        * 左组贴左、右组贴右、出港恒在正中——**与解锁几项无关**。
        */}
        {(() => {
        const allItems = [...NAV_ITEMS, ...(readDebugEnabled() ? DEBUG_NAV_ITEMS : [])]
        // 「第一次」前置未达 ⇒ **该导航项不显示**（船长：未解锁页面与任务都隐藏）
        const shown = allItems.filter((it) => unlocked(state, it.key))
        const navBtn = (item: (typeof allItems)[number]): ReactNode => {
        // 徽标两族（船长 2026-09-11 / 2026-09-14）：通讯 = 未读条数；任务中心 = 赏金新板条数
        // ＋**2026-09-20**：「第一次」推进提醒（有新的一步可做时 +1）
        const unreadN =
        item.key === 'comms'
        ? commsUnread
        : item.key === 'task'
        ? bountyNew + (firstTaskNew !== null ? 1 : 0)
        : 0
        return (
        <button
        key={item.key}
        className={`app-nav-item${page === item.key ? ' is-active' : ''}${item.key === 'map' ? ' is-featured' : ''}${unreadN > 0 ? ' is-unread' : ''}${navBeat?.key === item.key ? ' is-beat' : ''}`}
        title={
        unreadN > 0
        ? item.key === 'task'
        ? [
        /**
        * 「第一次」有新的一步 ⇒ 先说它（写清是哪一条），赏金新板另起一行。
        * ⚠ **2026-09-21**：任务改成"玩家点「完成」才推进" ⇒ **已达成**时补一句
        * 「（已达成，回任务中心点「完成」）」——否则玩家在别处干完活不知道要回去点。
        */
        firstTaskNew !== null
        ? tr('ui.App.120', { p1: firstTaskNew.title }) + (firstTaskNew.ready ? tr('ui.App.122') : '')
        : null,
        bountyNew > 0 ? tr('ui.App.113', { unreadN: bountyNew }) : null,
        ]
        .filter((s) => s !== null)
        .join('\n')
        : tr("ui.App.114", { unreadN: unreadN })
        : undefined
        }
        onClick={() => changePage(item.key as PageKey)}
        >
        <span className="app-nav-icon">
        {/* 2026-09-25 船长令：「导航栏图除了出港外的图标还是太小了，在宽度不变的前提下，高度要和导航栏匹配」
                          ⇒ 普通项图标 19 → **34px**（出港 40 → 44px），并同步加大底栏与图标容器（见 styles.css）。 */}
                      <Glyph name={item.icon} size={item.key === 'map' ? 44 : 34} color={NAV_TONES[item.icon]} />
        {unreadN > 0 ? <i className="app-nav-badge">{unreadN > 9 ? '9+' : unreadN}</i> : null}
        </span>
        <span>{t(item.label)}</span>
        </button>
        )
        }
        /**
         * ⚠ **左右分组不能按"出港在数组里的位置"切**（2026-09-25 修，此前就是这么错的）：
         * `NAV_ITEMS` 里出港（星图）**排第一位** ⇒ `slice(0, featIdx)` 切出空数组、
         * 其余 9 项全挤到右组（无头实测：左组 children=1 且是空占位、右组 children=7）。
         * 现改为**把出港单独摘出、其余项按数量对半分成左右两组** ⇒ 与它在数组里的位置无关。
         */
        const feat = shown.find((it) => it.key === 'map') ?? null
        const others = shown.filter((it) => it.key !== 'map')
        const half = Math.ceil(others.length / 2)
        const left = others.slice(0, half)
        const right = others.slice(half)
        return (
        <>
        <div className="app-nav-group is-left">
        {left.length > 0 ? left.map(navBtn) : <span className="app-nav-ph" />}
        </div>
        {feat ? navBtn(feat) : null}
        <div className="app-nav-group is-right">
        {right.length > 0 ? right.map(navBtn) : <span className="app-nav-ph" />}
        </div>
        </>
        )
        })()}
        </nav>
        {logDockSlot}
      </>
    )
  }

  /* ─────────────────── 旧版（classic · main 原文冻结）─────────────────── */
  function renderClassic(): JSX.Element {
    return (
      <>
        <header className="app-header">
          <div className="app-header-left">
            {/* 游戏名（2026-09-11 船长：「将游戏的名称改为大鲸鱼-深空放置」；
                注意「深空工业协会」是**游戏内势力**、不随游戏名改） */}
            <span className="app-logo">{tr("ui.App.056")}</span>
            <span className="app-pilot">{state.character.name}</span>
          </div>
          <div className="app-header-right">
            {/* V15 调试模式入口（开发工具：DevTools 置 whale-idle:debug=1 后出现） */}
            {debugOn ? (
              <>
                <DebugButton engine={engine} onFastForwarded={() => setReportDismissed(false)} />
                <button
                  className="app-btn"
                  onClick={() => setPerfOpen((v) => !v)}
                  title={tr("ui.App.057")}
                >
                  {tr("ui.App.058")}
                </button>
              </>
            ) : null}
            {/**
             * ⚠ **金钱栏已移到左侧栏**（船长 2026-09-13：「将顶部的金钱栏移动到左侧的出港上方」）
             * ⇒ 顶栏这里不再显示余额，只留在线时长与公告/按钮。落点在 `app-nav-side` 首项上方。
             */}
            <span className="app-clock">{tr("ui.App.059")} {formatDurationMs(state.gameMs)}</span>
            {/* 公告弹层一开就收起嵌入的活动窗口（2026-09-21 船长令：打开弹层即隐藏并最小化） */}
            <AnnouncementHub engine={engine} onOpen={hideActivityWin} />
            <button
              className="app-btn"
              onClick={copyQqGroup}
              title={tr("ui.App.111", { QQ_GROUP: QQ_GROUP })}
            >
              {qqCopied ? tr("ui.App.060") : tr("ui.App.112", { QQ_GROUP: QQ_GROUP })}
            </button>
            <button
              className="app-btn"
              onClick={() => {
                setShowHandbook(true)
                hideActivityWin() // 打开弹层即收起（同上）
              }}
              title={tr("ui.App.061")}
            >
              {t('ui.App.028')}
            </button>
            <button
              className="app-btn"
              onClick={() => {
                setShowSettings(true)
                hideActivityWin() // 打开弹层即收起（同上）
              }}
              title={tr("ui.App.062")}
            >
              {t('ui.App.010')}
            </button>
            {/* **存档三件套已移入设置**（2026-09-25 船长令：「旧版的顶部，可以将保存，存档管理，
                重置档案按钮移除，设置内采用新版的样式」）——旧版顶栏与新版一致，只留
                在线时长 / 公告 / QQ群 / 手册 / 设置；三个动作在设置弹层的「存档」一组里。 */}
          </div>
        </header>
        <div className="app-workspace">
          <nav className="app-nav-side">
            {/* 舰船状态小窗：2026-09-21 起同时是**窗口最小化后的还原按钮**（见 `windowRestore`） */}
            <ShipStatusWin engine={engine} restore={windowRestore} />
            {/**
             * **金钱栏**（船长 2026-09-13：「将顶部的金钱栏移动到左侧的**出港上方**」＋
             * 「更换金钱单位为**信用点**」）：位置 = 舰船状态窗之下、**第一个导航项（出港）之上**。
             * ⚠ 显示口径（船长同日二次口径）：「**如果有条件，还是优先显示全额数字**…如果实在显示不下，
             * 采用数量级缩写（**但是仍要尽可能保证数字够长**）」⇒ 值走 `ui/MoneyFit`：
             * **逐候选实测宽度**，档序 = 全额（带单位 → 去掉单位）→ 缩写（带单位 → 去掉单位，长的在前），
             * **精确值恒挂 `title`**。窄栏里优先保住的是**数字**，不是「信用点」三个字。
             */}
            <MoneyFit amount={state.wallet.isk} className="app-isk app-wallet" />
            {[...NAV_ITEMS, ...(readDebugEnabled() ? DEBUG_NAV_ITEMS : [])].map((item) => {
              // 「第一次」前置未达 ⇒ **该导航项不显示**（船长：未解锁页面与任务都隐藏）
              if (!unlocked(state, item.key)) return null
              // 徽标两族（船长 2026-09-11 / 2026-09-14）：通讯 = 未读条数；任务中心 = 赏金新板条数
              // ＋**2026-09-20**：「第一次」推进提醒（有新的一步可做时 +1）
              const unreadN =
                item.key === 'comms'
                  ? commsUnread
                  : item.key === 'task'
                    ? bountyNew + (firstTaskNew !== null ? 1 : 0)
                    : 0
              return (
                <button
                  key={item.key}
                  className={`app-nav-item${page === item.key ? ' is-active' : ''}${item.key === 'map' ? ' is-featured' : ''}${unreadN > 0 ? ' is-unread' : ''}${navBeat?.key === item.key ? ' is-beat' : ''}`}
                  title={
                    unreadN > 0
                      ? item.key === 'task'
                        ? [
                            /**
                             * 「第一次」有新的一步 ⇒ 先说它（写清是哪一条），赏金新板另起一行。
                             * ⚠ **2026-09-21**：任务改成"玩家点「完成」才推进" ⇒ **已达成**时补一句
                             * 「（已达成，回任务中心点「完成」）」——否则玩家在别处干完活不知道要回去点。
                             */
                            firstTaskNew !== null
                              ? tr('ui.App.120', { p1: firstTaskNew.title }) + (firstTaskNew.ready ? tr('ui.App.122') : '')
                              : null,
                            bountyNew > 0 ? tr('ui.App.113', { unreadN: bountyNew }) : null,
                          ]
                            .filter((s) => s !== null)
                            .join('\n')
                        : tr("ui.App.114", { unreadN: unreadN })
                      : undefined
                  }
                  onClick={() => changePage(item.key as PageKey)}
                >
                  <span className="app-nav-icon">
                    <Glyph name={item.icon} size={item.key === 'map' ? 40 : 19} color={NAV_TONES[item.icon]} />
                    {unreadN > 0 ? <i className="app-nav-badge">{unreadN > 9 ? '9+' : unreadN}</i> : null}
                  </span>
                  <span>{t(item.label)}</span>
                </button>
              )
            })}
          </nav>
          {/**
           * **主列**（`<main class="app-page-main">` 由外壳自己组合，App 只传里面的内容）：
           * 旧版的顺序与 main 原文一致 = **活动窗口条在最上**，然后才是页面内容。
           * ⚠ 活动栏必须**在 `<main>` 内部**：它的 `width: 100%` 要相对主列的宽度算；
           *   放到 `<main>` 外面就成了 `.app-workspace` 的同级项，会把整行吃掉（实测主区被压到 4px）。
           */}
          <main className="app-page-main">
            {/* 旧版活动栏 = **从昨天那版拆出的冻结件**（标题栏 + 两组 + 行内操作按钮，无副AI迷你卡） */}
            <ActivityBarClassic
              engine={engine}
              onToast={showToast}
              onAiCenter={() => {
                changePage('ship')
                changeShipTab('ai')
              }}
              onGoPage={(p, mapTab) => {
                changePage(p as PageKey)
                if (mapTab) changeMapTab(mapTab as MapTab)
              }}
              onOpenWormhole={openWormhole}
            />
            {pageMainSlot}
          </main>
          {logDockSlot}
        </div>
      </>
    )
  }
}
