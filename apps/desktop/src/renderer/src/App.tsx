/**
 * 主界面壳（V14.1 UI 版）：
 * - 顶栏：游戏名 / 飞行员 / ISK / 在线时长 / 保存 / 重置
 * - 顶部总菜单（原在窗口底部，移至顶部）：舰船 · 装配 · 物品 · 市场 · 工业 · 技能 · 星图
 *   （货仓已并入「物品」页的 仓库/货仓 子标签）；
 *   星图页内以标签切换三个功能区（矿带开采 / 星图·远征 / 悬赏情报）
 * - 中部：左侧为主窗口（按顶部菜单切换页面），右侧事件日志
 *   （可向右滑出隐藏 + 按日志类型过滤，偏好存 localStorage）
 */
import { useEffect, useReducer, useRef, useState } from 'react'
import { formatDurationMs, shipDisplayName } from '@whale/core'
import type { LogKind } from '@whale/core'
import { LogList, Panel } from '@whale/ui'
import { Communicator } from './panels/Expedition'
import { PrologueScreen } from './panels/PrologueScreen'
import { TutorialGuide, TutorialEpilogue, type GuideGo } from './panels/TutorialGuide'
import { FitPage } from './pages/FitPage'
import { ShipPage, type ShipTab } from './pages/ShipPage'
import { ItemsPage } from './pages/ItemsPage'
import { MarketPage } from './pages/MarketPage'
import { IndustryPage } from './pages/IndustryPage'
import { SkillsPage } from './pages/SkillsPage'
import { MapPage } from './pages/MapPage'
import type { MapTab } from './pages/MapPage'
import type { ToastFn } from './pages/common'
import type { GameEngine } from './game/engine'
import { SaveManager } from './panels/SaveManager'
import { Handbook } from './panels/Handbook'
import { BattleScreen } from './panels/BattleScreen'
import { DebugButton, debugEnabled as readDebugEnabled } from './panels/DebugPanel'
import { ActivityBar } from './panels/ActivityBar'
import { TooltipLayer, hideTip } from './ui/Tooltip'
import { Glyph, NAV_TONES, ICO_TONES } from './ui/Glyphs'

/** 左侧导航项（出港 = 星图主入口，为首并放大描边，见 NAV_ITEMS 的 map 特例）；icon = Glyphs 字形名 */
const NAV_ITEMS: Array<{ key: PageKey; label: string; icon: string }> = [
  { key: 'map', label: '出港', icon: 'nav-map' },
  { key: 'ship', label: '舰船', icon: 'nav-ship' },
  { key: 'fit', label: '装配', icon: 'nav-fit' },
  { key: 'items', label: '物品', icon: 'nav-items' },
  { key: 'market', label: '市场', icon: 'nav-market' },
  { key: 'industry', label: '工业', icon: 'nav-industry' },
  { key: 'skills', label: '技能', icon: 'nav-skills' },
]

type PageKey = 'ship' | 'fit' | 'items' | 'market' | 'industry' | 'skills' | 'map'

/** 游戏内时钟（HH:MM，日志前缀用） */
function gameClock(gameMs: number): string {
  const totalMin = Math.floor(gameMs / 60_000)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return `${h}:${String(m).padStart(2, '0')}`
}

/* ═══════════════ 日志面板偏好（折叠 + 类型过滤，存 localStorage） ═══════════════ */

const LOG_KINDS: readonly LogKind[] = ['system', 'info', 'queue', 'levelup', 'warn', 'trade']
const KIND_LABEL: Record<LogKind, string> = {
  system: '系统',
  info: '信息',
  queue: '训练',
  levelup: '升级',
  warn: '警告',
  trade: '交易',
}
/** 分类语义（T6：与 ui index.css 的 wui-log-* 色值保持同步） */
const KIND_DESC: Record<LogKind, string> = {
  system: '系统：开档/版本/欢迎等',
  info: '信息：无资金变动的流程与搬运（采矿/扫描/制造完成/装配/切船/卸货/离线结算等）',
  queue: '训练：技能队列增删与完成',
  levelup: '升级：技能升级',
  warn: '警告：异常/失利/数据缺失',
  trade: '交易：市场成交与挂单、买船买核心、维修费、远征奖金等一切资金往来',
}
/** 开关色点（图例）：色值须与 ui index.css 的 wui-log-* 一致 */
const KIND_DOT: Record<LogKind, string> = {
  system: 'var(--wui-purple)',
  levelup: '#ecc264',
  warn: '#ff8278',
  queue: '#54d4de',
  info: '#8fa3c2',
  trade: '#6fdc8f',
}
const PREFS_KEY = 'whale-idle:log-prefs'

interface LogPrefs {
  collapsed: boolean
  kinds: Record<LogKind, boolean>
}

function defaultLogPrefs(): LogPrefs {
  return {
    collapsed: false,
    kinds: { system: true, info: true, queue: true, levelup: true, warn: true, trade: true },
  }
}

/** 读取本地偏好（容错：坏了就回默认） */
function readLogPrefs(): LogPrefs {
  const fallback = defaultLogPrefs()
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<LogPrefs>
    const kinds = { ...fallback.kinds, ...(typeof parsed.kinds === 'object' && parsed.kinds !== null ? parsed.kinds : {}) }
    return { collapsed: parsed.collapsed === true, kinds }
  } catch {
    return fallback
  }
}

export function App({ engine }: { engine: GameEngine }) {
  const [, force] = useReducer((n: number) => n + 1, 0)
  useEffect(() => engine.subscribe(force), [engine])

  // ── 手机竖屏自动横屏（船长 2026-09-05）：触屏 + 竖屏时把整窗旋转 90° 并等比缩放，游戏画面横过来显示（免手动转手机） ──
  const [mobileRot, setMobileRot] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const update = (): void => {
      const coarse = window.matchMedia('(pointer: coarse)').matches
      const portrait = window.innerHeight > window.innerWidth
      const rot = coarse && portrait && window.innerWidth < 900
      setMobileRot(rot)
      const el = rootRef.current
      if (el) {
        if (rot) {
          // 虚拟横屏设计宽度：越大画面整体越小、看到越多（船长 2026-09-05：横屏后偏大，改 1200 放宽）
          const designW = 1200
          const scale = window.innerHeight / designW
          const vh = designW * window.innerWidth / window.innerHeight
          el.style.setProperty('--mob-w', `${designW}px`)
          el.style.setProperty('--mob-h', `${vh}px`)
          el.style.setProperty('--mob-scale', String(scale))
        } else {
          el.style.removeProperty('--mob-w')
          el.style.removeProperty('--mob-h')
          el.style.removeProperty('--mob-scale')
        }
      }
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
    }
  }, [])

  // 全局：点击被禁用的按钮时，把按钮禁用原因（title / data-disabled-reason）以警告提示弹出，
  // 没有写明原因的统一回退文案——避免"点了没反应"
  useEffect(() => {
    const onPointerDown = (e: PointerEvent): void => {
      const el = e.target as HTMLElement | null
      const btn = el?.closest?.('button') as HTMLButtonElement | null
      if (!btn || !btn.disabled) return
      const reason = btn.title || btn.dataset.disabledReason
      showToast(reason ? `（按钮不可用）${reason}` : '此操作当前不可用。', true)
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => window.removeEventListener('pointerdown', onPointerDown, true)
  }, [])

  // T9：待播通讯（首次抵达建站点等）→ 自动播放一次（镜像日志+已读由 wrapper.openDialogue 完成）
  const [pendingOpen, setPendingOpen] = useState<string | null>(null)
  const pd = engine.state.pendingDialogue
  useEffect(() => {
    if (pd && pendingOpen !== pd) {
      const r = engine.openDialogue(pd)
      if (r.ok) setPendingOpen(pd)
    }
  }, [pd, pendingOpen])

  const state = engine.state
  const [page, setPage] = useState<PageKey>('map')
  // 星图页功能区（页内标签状态；常驻 App，跨页保留；默认「星图·远征」= 玩家查看大地图的主入口）
  const [mapTab, setMapTab] = useState<MapTab>('star')
  const [shipTab, setShipTab] = useState<ShipTab>('fleet')
  // 舰船页"去市场"→ 市场页聚焦该船订单（seq 递增触发一次）
  const [mktFocus, setMktFocus] = useState<{ key: string; seq: number } | null>(null)
  // 舰船页卡片"装配"→ 装配页默认目标船（船长 2026-09-05：入口在舰队卡片；离开装配页即清，再次直进默认当前驾驶船）
  const [fitShipId, setFitShipId] = useState<string | null>(null)
  useEffect(() => {
    if (page !== 'fit') setFitShipId(null)
    // 页面切换时隐藏残留悬停浮层（卸载不会触发 hover leave；如舰队卡 hover 中点「装配」跳转后悬浮窗残留）
    hideTip()
  }, [page])
  // B1：首次进入低安的一次性醒目提示（规则全文在手册「航行须知」）
  const lowSecPrev = useRef(state.lowSecNotified)
  useEffect(() => {
    if (state.lowSecNotified && !lowSecPrev.current) {
      showToast('⚠ 已进入低安星系：采矿/停留/远征可能遭遇巡逻拦截或海盗伏击——可迎战或快速脱离，规则见手册「航行须知」。', true)
    }
    lowSecPrev.current = state.lowSecNotified
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.lowSecNotified])
  // V15 调试模式入口（开发工具：localStorage 标志启用后才显示）
  const [debugOn] = useState<boolean>(readDebugEnabled)

  const [toast, setToast] = useState<{ text: string; warn: boolean } | null>(null)
  const toastTimer = useRef<number | null>(null)
  const showToast: ToastFn = (text, warn = false) => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current)
    setToast({ text, warn })
    toastTimer.current = window.setTimeout(() => setToast(null), 3200)
  }

  // ── 弹层：存档管理 / 手册图鉴 / 全屏战斗 ──
  const [showSaveManager, setShowSaveManager] = useState(false)
  const [showHandbook, setShowHandbook] = useState(false)
  const [battleOpen, setBattleOpen] = useState(false)

  // 交火中（主动进入全屏战斗页；不自动切换页面）
  const inBattle = state.expedition.active && state.expedition.phase === 'battle'

  // V12.3：出发远征到港开战（phase 进入 battle 的上升沿）→ 自动切入全屏战场；
  // 玩家手动退出战场后（battleOpen=false 而 inBattle 仍 true）不会再被自动弹回
  const prevInBattleRef = useRef(false)
  useEffect(() => {
    // 优化：连续出击自动发起的远征默认最小化战斗界面（仍可用右上角「⚔ 战斗中」主动进入）
    if (inBattle && !prevInBattleRef.current && !engine.autoSortieNow()) setBattleOpen(true)
    prevInBattleRef.current = inBattle
  }, [inBattle])

  // ── 日志偏好：折叠状态 + 六类开关（本地持久化） ──
  const [logCollapsed, setLogCollapsed] = useState<boolean>(() => readLogPrefs().collapsed)
  const [logKinds, setLogKinds] = useState<Record<LogKind, boolean>>(() => readLogPrefs().kinds)
  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ collapsed: logCollapsed, kinds: logKinds }))
    } catch {
      // 本地存储不可用（隐私模式等）：忽略，不影响游戏
    }
  }, [logCollapsed, logKinds])

  const visibleLogs = state.logs.filter((l) => logKinds[l.kind] ?? true)
  const hiddenAll = visibleLogs.length === 0 && state.logs.length > 0

  // ── 离线简报卡（本次启动一次性，手动关闭） ──
  const [reportDismissed, setReportDismissed] = useState(false)
  const offlineReport = engine.offlineReport
  const showOfflineReport = offlineReport !== null && !reportDismissed

  // ── 随机事件小弹卡（在线触发时展示 6 秒；离线触发的不弹，避免启动刷屏） ──
  const [eventToast, setEventToast] = useState<{ id: number; text: string } | null>(null)
  const lastSeenLogId = useRef<number>(state.logs[state.logs.length - 1]?.id ?? 0)
  const eventTimer = useRef<number | null>(null)
  useEffect(() => {
    const logs = state.logs
    for (let i = logs.length - 1; i >= 0; i--) {
      const l = logs[i]!
      if (l.id <= lastSeenLogId.current) break // 只检查新增日志（id 单调递增）
      if (l.text.startsWith('✦')) {
        setEventToast({ id: l.id, text: l.text })
        if (eventTimer.current !== null) window.clearTimeout(eventTimer.current)
        eventTimer.current = window.setTimeout(() => setEventToast(null), 6000)
        break // 每次最多弹最新一条
      }
    }
    const tail = logs[logs.length - 1]
    if (tail) lastSeenLogId.current = tail.id
  }, [state.logs])

  async function handleSave(): Promise<void> {
    const ok = await engine.persist()
    showToast(ok ? '存档已写入本地。' : '保存失败！', !ok)
  }

  function handleReset(): void {
    if (!window.confirm('确定要重置档案吗？当前所有进度将被清空。')) return
    engine.resetGame()
    showToast('档案已重置，祝新航程顺利。')
  }

  const pageProps = { engine, onToast: showToast }

  // ── 序章·苏醒：教程锁定与引导（步骤 1..6 页签/按钮级锁定；7 收尾演出；99 全解锁） ──
  const tutStep = engine.state.onboarding.step
  const tutLocked = tutStep >= 1 && tutStep <= 6
  const guideOn = tutStep >= 1 && tutStep <= 6
  const epiOn = tutStep === 7
  const TUT_LOCK: Record<number, { pages: PageKey[]; map?: MapTab; ship?: ShipTab }> = {
    1: { pages: ['ship', 'map'], map: 'mine', ship: 'fleet' },
    2: { pages: ['map'], map: 'task' },
    3: { pages: ['ship', 'map'], map: 'mine', ship: 'fleet' },
    4: { pages: ['map'], map: 'bounty' },
    5: { pages: ['skills'] },
    6: { pages: ['ship'], ship: 'ai' },
  }
  const tutCanOpen = (p: PageKey): boolean => {
    if (!tutLocked) return true
    const allow = TUT_LOCK[tutStep]
    return !!allow && allow.pages.includes(p)
  }
  const tutMapTab = tutLocked ? TUT_LOCK[tutStep]?.map : undefined
  const tutShipTab = tutLocked ? TUT_LOCK[tutStep]?.ship : undefined
  const MAP_TAB_LABEL: Record<MapTab, string> = {
    star: '星图·远征',
    mine: '矿带开采',
    bounty: '战斗悬赏',
    salvage: '残骸打捞',
    task: '任务中心',
  }
  const changePage = (p: PageKey): void => {
    if (!tutCanOpen(p)) {
      showToast('按教程引导进行：先完成当前「教程目标」（右下角引导卡）。', true)
      return
    }
    setPage(p)
  }
  const changeMapTab = (t: MapTab): void => {
    if (tutMapTab && t !== tutMapTab) {
      showToast(`当前教程步骤请使用「${MAP_TAB_LABEL[tutMapTab] ?? tutMapTab}」标签。`, true)
      return
    }
    setMapTab(t)
  }
  const changeShipTab = (t: ShipTab): void => {
    if (tutShipTab && t !== tutShipTab) {
      showToast('当前教程步骤请使用舰船页对应标签（见引导卡）。', true)
      return
    }
    setShipTab(t)
  }
  // 步骤推进 → 跳到该步骤默认视图（切换瞬间发生；恢复读档也会归位一次）
  const prevTutStep = useRef(-1)
  useEffect(() => {
    if (tutStep !== prevTutStep.current) {
      prevTutStep.current = tutStep
      if (tutStep >= 1 && tutStep <= 6) {
        const d = TUT_LOCK[tutStep]
        if (d) {
          setPage(d.pages[0]!)
          if (d.map) setMapTab(d.map)
          if (d.ship) setShipTab(d.ship)
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tutStep])

  return (
    <div ref={rootRef} className={`app-root${mobileRot ? ' is-mobile-rot' : ''}`}>
      {/* ───── 顶栏 ───── */}
      <header className="app-header">
        <div className="app-header-left">
          <span className="app-logo">大鲸鱼 · 深空工业</span>
          <span className="app-pilot">{state.character.name}</span>
        </div>
        <div className="app-header-right">
          {/* V15 调试模式入口（开发工具：DevTools 置 whale-idle:debug=1 后出现） */}
          {debugOn ? <DebugButton engine={engine} onFastForwarded={() => setReportDismissed(false)} /> : null}
          <span className="app-isk">{state.wallet.isk.toLocaleString('zh-CN')} ISK</span>
          <span className="app-clock">在线 {formatDurationMs(state.gameMs)}</span>
          <button className="app-btn" onClick={() => setShowHandbook(true)} title="玩法说明与图鉴">
            手册
          </button>
          <button className="app-btn" onClick={() => void handleSave()}>
            保存
          </button>
          <button className="app-btn" disabled={tutLocked} title={tutLocked ? '教程期间暂不可用（避免误触）' : '备份 / 恢复存档'} onClick={() => setShowSaveManager(true)}>
            存档管理
          </button>
          <button className="app-btn is-danger" disabled={tutLocked} title={tutLocked ? '教程期间暂不可用（避免误触）' : undefined} onClick={handleReset}>
            重置档案
          </button>
        </div>
      </header>

      {/* ───── 工作区：左导航栏 + 主窗口（活动窗口置于主列顶部，宽度与主窗口一致）+ 事件日志 ───── */}
      <div className="app-workspace">
        <nav className="app-nav-side">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.key}
              className={`app-nav-item${page === item.key ? ' is-active' : ''}${item.key === 'map' ? ' is-featured' : ''}`}
              disabled={tutLocked && !tutCanOpen(item.key)}
              title={tutLocked && !tutCanOpen(item.key) ? '按教程引导进行：先完成当前「教程目标」' : undefined}
              onClick={() => changePage(item.key)}
            >
              <span className="app-nav-icon">
                <Glyph name={item.icon} size={item.key === 'map' ? 40 : 19} color={NAV_TONES[item.icon]} />
              </span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <main className="app-page-main">
          <ActivityBar
            engine={engine}
            onToast={showToast}
            onAiCenter={() => {
              changePage('ship')
              changeShipTab('ai') // AI 徽标 → 舰船页「AI 指挥」标签
            }}
            onGoPage={(page, mapTab) => {
              changePage(page as PageKey)
              if (mapTab) changeMapTab(mapTab as MapTab)
            }}
          />
          <div className="app-page-content" key={page}>
            {page === 'ship' ? (
              <ShipPage
                {...pageProps}
                tab={shipTab}
                onTab={changeShipTab}
                onGotoMarket={(goodKey) => {
                  setMktFocus((p) => ({ key: goodKey, seq: (p?.seq ?? 0) + 1 }))
                  changePage('market')
                }}
                onGotoFit={(shipId) => {
                  setFitShipId(shipId)
                  changePage('fit')
                }}
              />
            ) : null}
            {page === 'fit' ? <FitPage {...pageProps} fitShipId={fitShipId} /> : null}
            {page === 'items' ? (
              <ItemsPage
                {...pageProps}
                onGotoMarket={(goodKey) => {
                  setMktFocus((p) => ({ key: goodKey, seq: (p?.seq ?? 0) + 1 }))
                  changePage('market')
                }}
              />
            ) : null}
            {page === 'market' ? <MarketPage {...pageProps} focusKey={mktFocus?.key ?? null} focusSeq={mktFocus?.seq ?? 0} /> : null}
            {page === 'industry' ? <IndustryPage {...pageProps} /> : null}
            {page === 'skills' ? <SkillsPage {...pageProps} /> : null}
            {page === 'map' ? <MapPage {...pageProps} mapTab={mapTab} onMapTab={changeMapTab} /> : null}
          </div>
        </main>
        <div className="app-log-dock">
          <aside className={`app-log-side${logCollapsed ? ' is-collapsed' : ''}`}>
            <Panel
              title="事件日志"
              right={
                <div className="app-log-head-right">
                  <span className="app-dim">游戏内时钟</span>
                  <button className="app-btn is-small" onClick={() => setLogCollapsed(true)} title="向右收起日志面板">
                    收起 ›
                  </button>
                </div>
              }
            >
              <div className="app-log-filters" title="只显示勾选的日志类型（引擎照常记录，不影响存档）；色点 = 该类型的图例">
                {LOG_KINDS.map((kind) => {
                  const on = logKinds[kind] ?? true
                  return (
                    <button
                      key={kind}
                      className={`app-log-filter${on ? '' : ' is-off'}`}
                      title={KIND_DESC[kind]}
                      onClick={() => setLogKinds((prev) => ({ ...prev, [kind]: !on }))}
                    >
                      <span className="app-log-dot" style={{ background: KIND_DOT[kind] }} />
                      {KIND_LABEL[kind]}
                    </button>
                  )
                })}
              </div>
              {hiddenAll ? (
                <div className="app-dim app-log-empty">已隐藏全部日志类型（引擎仍在记录，点上方开关即可恢复显示）。</div>
              ) : (
                <LogList
                  logs={visibleLogs.map((l) => ({ id: l.id, kind: l.kind, text: l.text, timeLabel: gameClock(l.atGameMs) }))}
                  limit={220}
                />
              )}
            </Panel>
          </aside>
          {logCollapsed ? (
            <button className="app-log-handle" onClick={() => setLogCollapsed(false)} title="展开事件日志面板">
              «
            </button>
          ) : null}
        </div>
      </div>



        {toast ? <div className={`app-toast${toast.warn ? ' is-warn' : ''}`}>{toast.text}</div> : null}
        {eventToast ? <div className="app-event-toast">{eventToast.text}</div> : null}
        {/* B1 低安遭遇横幅：待决（迎战/快速脱离，60s 超时自动脱离）与遭遇战进行中 */}
        {state.encounter.active ? (
          <div className={`app-enc-banner${state.encounter.battle ? ' is-fight' : ''}`}>
            {state.encounter.battle ? (
              <span className="app-enc-title">
                遭遇战中：{shipDisplayName(state, engine.ctx, state.encounter.shipId ?? state.shipId)} vs{' '}
                {state.encounter.name}（引擎自动推演，战报稍后）
              </span>
            ) : (
              <>
                <span className="app-enc-title">⚠ 低安遭遇 · {state.encounter.name}</span>
                <span className="app-enc-sub">
                  {shipDisplayName(state, engine.ctx, state.encounter.shipId ?? state.shipId)}（{state.encounter.origin}）被盯上 ·{' '}
                  {Math.max(1, Math.ceil((state.encounter.deadlineGameMs - state.gameMs) / 1000))} 秒内未处置将自动脱离
                </span>
                <button
                  className="app-btn is-small is-primary"
                  title="进入实时战斗（引擎自动打完）；战斗失利将受损甚至被抢"
                  onClick={() => {
                    const r = engine.fightEncounterNow()
                    if (!r.ok) showToast(r.error ?? '无法应战', true)
                  }}
                >
                  <span className="app-ico"><Glyph name="nav-bounty" size={14} color={NAV_TONES["nav-bounty"]} /></span>迎战
                </button>
                <button
                  className="app-btn is-small"
                  title="立即脱离：按文字结算（可能击退缴获 / 受损 / 被抢小部分货）"
                  onClick={() => {
                    const r = engine.fleeEncounterNow()
                    if (!r.ok) showToast(r.error ?? '无法脱离', true)
                  }}
                >
                  <span className="app-ico"><Glyph name="ico-swap" size={14} color={ICO_TONES["ico-swap"]} /></span>快速脱离
                </button>
              </>
            )}
          </div>
        ) : null}
        {pendingOpen ? (() => {
          const s = engine.dialogues.find((d) => d.id === pendingOpen)
          return s ? <Communicator script={s} onClose={() => setPendingOpen(null)} /> : null
        })() : null}

      {/* ───── 交火中：右上角悬浮入口（主动进入战斗页，不自动切换页面） ───── */}
      {inBattle && !battleOpen ? (
        <button className="app-battle-float" onClick={() => setBattleOpen(true)} title="进入全屏战场：观察实时战斗，可拖动距离条指挥">
          战斗中 · 进入战场
        </button>
      ) : null}

      {/* ───── 离线简报（启动后一次性显示） ───── */}
      {showOfflineReport ? (
        <div className="app-report-card">
          <div className="app-report-head">
            <span className="app-report-title">离线简报</span>
            <button className="app-btn is-small" onClick={() => setReportDismissed(true)}>
              ✕ 关闭
            </button>
          </div>
          <div className="app-report-body">
            <div className="app-dim">
              离开 {formatDurationMs(offlineReport.wallAwayMs)} · 结算 {formatDurationMs(offlineReport.settledMs)}
              {offlineReport.overflowMs > 0 ? `（另有 ${formatDurationMs(offlineReport.overflowMs)} 超出上限未结算）` : ''}
            </div>
            <div className="app-report-line">
              钱包：
              <b className={offlineReport.iskDelta >= 0 ? 'app-trend-up' : 'app-trend-down'}>
                {offlineReport.iskDelta >= 0 ? '+' : '−'}
                {Math.abs(offlineReport.iskDelta).toLocaleString('zh-CN')}
              </b>{' '}
              ISK
            </div>
            {offlineReport.items.length > 0 ? (
              <div className="app-report-line">
                收获：{offlineReport.items.map((i) => `${i.name}×${i.delta.toLocaleString('zh-CN')}`).join('、')}
              </div>
            ) : null}
            {offlineReport.modules.length > 0 ? (
              <div className="app-report-line">
                装备入库：{offlineReport.modules.map((m) => `${m.name}×${m.delta}`).join('、')}
              </div>
            ) : null}
            {offlineReport.shipsIn.length > 0 ? (
              <div className="app-report-line"><span className="app-ico"><Glyph name="nav-ship" size={13} color={NAV_TONES["nav-ship"]} /></span>新船入坞：{offlineReport.shipsIn.join('、')}</div>
            ) : null}
            {offlineReport.skillsUp.length > 0 ? (
              <div className="app-report-line">技能：{offlineReport.skillsUp.join('、')}</div>
            ) : null}
            {offlineReport.learnedIn.length > 0 ? (
              <div className="app-report-line"><span className="app-ico"><Glyph name="ico-cross" size={13} color={ICO_TONES["ico-cross"]} /></span>学会配方：{offlineReport.learnedIn.join('、')}</div>
            ) : null}
            {offlineReport.highlights.map((h, i) => (
              <div key={i} className={`app-report-highlight is-${h.kind}`}>
                {h.kind === 'warn' ? '⚠' : '¥'} {h.text}
              </div>
            ))}
            <div className="app-dim app-report-tail">
              期间共 {offlineReport.logCount.toLocaleString('zh-CN')} 条新事件，详见右侧事件日志。
            </div>
          </div>
        </div>
      ) : null}

      {/* ───── 弹层：存档管理 / 手册图鉴 / 全屏战斗 ───── */}
      {showSaveManager ? <SaveManager engine={engine} onToast={showToast} onClose={() => setShowSaveManager(false)} /> : null}
      {showHandbook ? <Handbook engine={engine} onClose={() => setShowHandbook(false)} /> : null}
      {battleOpen ? (
        <BattleScreen
          engine={engine}
          onToast={showToast}
          onClose={() => {
            // 手动退出战场：若正处于"连击自动发起的战斗"→ 停连击（避免冷却后又自动开战）
            engine.onBattleViewClosed()
            setBattleOpen(false)
          }}
        />
      ) : null}

      {/* 序章·苏醒：教程引导卡（步骤 1..6）与收尾演出（步骤 7） */}
      {guideOn ? (
        <TutorialGuide
          engine={engine}
          step={tutStep}
          onGo={(g: GuideGo) => {
            changePage(g.page as PageKey)
            if (g.mapTab) changeMapTab(g.mapTab as MapTab)
            if (g.shipTab) changeShipTab(g.shipTab as ShipTab)
          }}
        />
      ) : null}
      {epiOn ? <TutorialEpilogue engine={engine} onDone={() => undefined} /> : null}

      {/* 序章·苏醒：新档演出覆盖层（step 0；演出期间引擎时间冻结） */}
      {engine.state.onboarding.step === 0 ? <PrologueScreen engine={engine} /> : null}

      {/* 全局悬停提示层（置于最上） */}
      <TooltipLayer />
    </div>
  )
}
