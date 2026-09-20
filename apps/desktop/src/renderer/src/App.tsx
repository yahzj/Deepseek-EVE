/**
 * 主界面壳（V14.1 UI 版）：
 * - 顶栏：游戏名 / 飞行员 / 信用点 / 在线时长 / 保存 / 重置
 * - 顶部总菜单（原在窗口底部，移至顶部）：舰船 · 装配 · 物品 · 市场 · 工业 · 技能 · 星图
 *   （货仓已并入「物品」页的 仓库/货仓 子标签）；
 *   星图页内以标签切换三个功能区（矿带开采 / 星图·远征 / 悬赏情报）
 * - 中部：左侧为主窗口（按顶部菜单切换页面），右侧事件日志
 *   （可向右滑出隐藏 + 按日志类型过滤，偏好存 localStorage）
 */
import { useEffect, useReducer, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { flushSync } from 'react-dom'
import { useL10n } from './i18n/locale'
import { formatDurationMs, moneyDelta, shipDisplayName, unlocked, unlockNeedTitle, ONB_AWAKEN } from '@whale/core'
import type { LogKind } from '@whale/core'
import { LogList, Panel } from '@whale/ui'
import { perfHub, perfAutoEnabled } from './game/perf'
import { currentSpaceBg, rerollSpaceBg, type SpaceBgInfo } from './ui/spaceBg'
import { Communicator } from './panels/Expedition'
import { PrologueScreen } from './panels/PrologueScreen'
import { AnnouncementHub } from './panels/Announcements'
import { FitPage } from './pages/FitPage'
import { ShipPage, type ShipTab } from './pages/ShipPage'
import { ItemsPage } from './pages/ItemsPage'
import { MarketPage } from './pages/MarketPage'
import { IndustryPage } from './pages/IndustryPage'
import { SkillsPage } from './pages/SkillsPage'
import { MapPage, MAP_TABS, TAB_UNLOCK_KEY } from './pages/MapPage'
import { CommsPage } from './pages/CommsPage'
import { CommsEave, CommsScreen } from './panels/CommsReader'
import { TaskCenterPage } from './pages/TaskCenterPage'
import { AchievementsPage } from './pages/AchievementsPage'
import type { MapGotoTarget, MapTab, TaskFocusTarget } from './pages/MapPage'
import type { ToastFn } from './pages/common'
import type { GameEngine } from './game/engine'
import { SaveManager } from './panels/SaveManager'
import { Handbook } from './panels/Handbook'
import { BattleScreen } from './panels/BattleScreen'
import { DebugButton, debugEnabled as readDebugEnabled } from './panels/DebugPanel'
import { ActivityBar } from './panels/ActivityBar'
import { WormholePanel } from './panels/Wormhole'
import { TooltipLayer, hideTip } from './ui/Tooltip'
import { Glyph, NAV_TONES, ICO_TONES } from './ui/Glyphs'
import { ShipStatusWin } from './ui/ShipStatusWin'
import { MoneyFit } from './ui/MoneyFit'

/** 左侧导航项（出港 = 星图主入口，为首并放大描边；船长 2026-09-05：文案「点击 出港」+强调配色避免被误认作栏目装饰） */
const NAV_ITEMS: Array<{ key: PageKey; label: string; icon: string }> = [
  { key: 'map', label: '点击 出港', icon: 'nav-map' },
  { key: 'ship', label: '舰船', icon: 'nav-ship' },
  { key: 'fit', label: '装配', icon: 'nav-fit' },
  { key: 'items', label: '物品', icon: 'nav-items' },
  { key: 'market', label: '市场', icon: 'nav-market' },
  { key: 'industry', label: '工业', icon: 'nav-industry' },
  { key: 'skills', label: '技能', icon: 'nav-skills' },
  /**
   * **任务中心**（2026-09-14 船长：「将任务中心界面移出星图，放入左侧导航栏，**通讯的上方**」）：
   * 原先它是星图页（出港）的一个选项卡 —— 那条路要先选中星系才渲染行动区，绕；
   * 搬成一级页后从左侧导航直达（内层标签与跳转定位照旧，见 `pages/TaskCenterPage.tsx`）。
   */
  { key: 'task', label: '任务中心', icon: 'nav-task' },
  /**
   * **成就**（2026-09-20 船长：「一级页，但是内部再加一个二级子窗口容器」）：
   * 徽章全由任务与次数链产出 ⇒ 放在任务中心下方；页内是固定头 + 内容内滚的子窗口容器，
   * 页面本体不滚（一级页不滚红线），见 `pages/AchievementsPage.tsx`。
   */
  { key: 'achieve', label: '成就', icon: 'ach-first' },
  // 2026-09-11 船长定：新增「通讯」页（NPC 消息 = 剧情与任务提示；邮件形图标，未读时闪烁 + 计数）
  { key: 'comms', label: '通讯', icon: 'nav-mail' },
]

type PageKey = 'ship' | 'fit' | 'items' | 'market' | 'industry' | 'skills' | 'map' | 'task' | 'achieve' | 'comms'

/** 已转换"一级页不滚"的页面（每完成一页在此登记；见 docs/design/page-scroll-layout.md 实施清单） */
const PAGE_NO_SCROLL = new Set<string>(['ship', 'fit', 'market', 'map', 'industry', 'skills', 'items', 'task', 'achieve', 'comms'])

/** 游戏内时钟（HH:MM，日志前缀用） */
function gameClock(gameMs: number): string {
  const totalMin = Math.floor(gameMs / 60_000)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return `${h}:${String(m).padStart(2, '0')}`
}

/* ═══════════════ 日志面板偏好（折叠 + 类型过滤，存 localStorage） ═══════════════ */

const LOG_KINDS: readonly LogKind[] = ['system', 'info', 'queue', 'levelup', 'warn', 'trade', 'event']
const KIND_LABEL: Record<LogKind, string> = {
  system: '系统',
  info: '信息',
  queue: '训练',
  levelup: '升级',
  warn: '警告',
  trade: '交易',
  event: '事件',
}

/** 分类语义（T6：与 ui index.css 的 wui-log-* 色值保持同步） */
const KIND_DESC: Record<LogKind, string> = {
  system: '系统：欢迎与系统通告等',
  info: '信息：无资金变动的流程与搬运（采矿/扫描/制造完成/装配/切船/卸货/离线结算等）',
  queue: '训练：技能队列增删与完成',
  levelup: '升级：技能升级',
  warn: '警告：异常/失利/记录缺失',
  trade: '交易：市场成交与挂单、买船买核心、维修费、远征奖金等一切资金往来',
  event: '事件：深空偶发奇遇与市场风云（日志带 ✦，在线时会弹小卡）',
}

/** 开关色点（图例）：色值须与 ui index.css 的 wui-log-* 一致 */
const KIND_DOT: Record<LogKind, string> = {
  system: 'var(--wui-purple)',
  levelup: '#ecc264',
  warn: '#ff8278',
  queue: '#54d4de',
  info: '#8fa3c2',
  trade: '#6fdc8f',
  event: '#ffb35c',
}

const PREFS_KEY = 'whale-idle:log-prefs'

interface LogPrefs {
  collapsed: boolean
  kinds: Record<LogKind, boolean>
}

function defaultLogPrefs(): LogPrefs {
  return {
    collapsed: false,
    kinds: { system: true, info: true, queue: true, levelup: true, warn: true, trade: true, event: true },
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

/** 读取数字偏好（带范围钳制；损坏回默认） */
function readNum(key: string, def: number, min: number, max: number): number {
  try {
    const v = Number.parseFloat(localStorage.getItem(key) ?? '')
    return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def
  } catch {
    return def
  }
}

const ZOOM_KEY = 'whale-idle:ui-zoom'
const FS_KEY = 'whale-idle:ui-fs'

/** 设置面板（船长 2026-09-05）：界面缩放 = 整窗 zoom；字体大小 = 字号族 CSS 系数 --ui-fs；
 *  宇宙背景（2026-09-10 船长）：铺在界面最底层的无缝星图，可在此换一张 */
function SettingsPanel({ root, onClose }: { root: RefObject<HTMLDivElement>; onClose: () => void }) {
  const { locale, setLocale, t } = useL10n()
  const [zoom, setZoom] = useState(() => readNum(ZOOM_KEY, 1, 0.8, 1.25))
  const [fs, setFs] = useState(() => readNum(FS_KEY, 1, 0.85, 1.25))
  /** 当前宇宙底图（模块级状态：关闭设置再打开仍是同一张） */
  const [bg, setBg] = useState<SpaceBgInfo | null>(() => currentSpaceBg())
  useEffect(() => {
    const el = root.current
    if (!el) return
    ;(el.style as { zoom?: string }).zoom = String(zoom)
    el.style.setProperty('--ui-fs', String(fs))
  }, [zoom, fs, root])
  function persist(): void {
    try {
      localStorage.setItem(ZOOM_KEY, String(zoom))
      localStorage.setItem(FS_KEY, String(fs))
    } catch {
      // 忽略
    }
  }
  return (
    <div className="app-modal-mask" onClick={onClose}>
      <div className="app-modal app-settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="app-settings-title">{t('设置')}</div>
        <div className="app-settings-sub">
          {t('界面缩放、字体大小与宇宙背景，即时生效 · 缩放与字号自动记忆')}
        </div>
        <div className="app-settings-list">
          {/* 语言（2026-09-19 船长令「英语本地化」）：默认跟随系统，这里可随时覆盖；语言不进存档 */}
          <div className="app-settings-row">
            <div className="app-settings-head">
              <span className="app-settings-label">{t('语言')}</span>
              <span className="app-settings-val">{locale === 'zh' ? '中文' : 'English'}</span>
            </div>
            <div className="app-settings-btns">
              <button
                className={`app-btn is-small${locale === 'zh' ? ' is-primary' : ''}`}
                onClick={() => setLocale('zh')}
              >
                中文
              </button>
              <button
                className={`app-btn is-small${locale === 'en' ? ' is-primary' : ''}`}
                onClick={() => setLocale('en')}
              >
                English
              </button>
            </div>
            <div className="app-settings-desc">{t('界面语言（即时生效；默认跟随系统）')}</div>
          </div>
          <div className="app-settings-row">
            <div className="app-settings-head">
              <span className="app-settings-label">{t('界面缩放')}</span>
              <span className="app-settings-val">{Math.round(zoom * 100)}%</span>
            </div>
            <input className="app-settings-slider" type="range" min={0.8} max={1.25} step={0.05} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
            <div className="app-settings-desc">{t('整窗缩放：面板几何与文字一起放大/缩小（80%~125%）')}</div>
          </div>
          <div className="app-settings-row">
            <div className="app-settings-head">
              <span className="app-settings-label">{t('字体大小')}</span>
              <span className="app-settings-val">{Math.round(fs * 100)}%</span>
            </div>
            <input className="app-settings-slider" type="range" min={0.85} max={1.25} step={0.05} value={fs} onChange={(e) => setFs(Number(e.target.value))} />
            <div className="app-settings-desc">{t('独立于界面缩放，只调整文字（85%~125%）')}</div>
          </div>
          <div className="app-settings-row">
            <div className="app-settings-head">
              <span className="app-settings-label">{t('宇宙背景')}</span>
              <span className="app-settings-val">{bg ? bg.label : t('未启用')}</span>
            </div>
            <div className="app-settings-btns">
              <button
                className="app-btn is-small"
                onClick={() => setBg(rerollSpaceBg())}
                disabled={!bg}
                title={t('换成另一张随机底图（立即生效）')}
              >
                {t('换一张')}
              </button>
            </div>
            <div className="app-settings-desc">
              {bg
                ? t('{n} 张无缝星图铺在界面最底层，每次启动随机一张；这里换的这张本场有效（下次启动仍随机）', { n: bg.total })
                : t('背景图缺失：当前用的是默认深色底')}
            </div>
          </div>
        </div>
        <div className="app-settings-foot">
          <span className="app-dim">{t('可随时从顶栏「设置」调回')}</span>
          <span className="app-settings-btns">
            <button className="app-btn is-small" onClick={() => { setZoom(1); setFs(1) }}>
              {t('恢复默认')}
            </button>
            <button
              className="app-btn is-small is-primary"
              onClick={() => {
                persist()
                onClose()
              }}
            >
              {t('完成')}
            </button>
          </span>
        </div>
      </div>
    </div>
  )
}

/* ═══════════════ 性能监测（2026-09-08 诊断工具：隐形采集；whale-idle:debug 下顶栏出现 ⏱ 性能 可查看/导出） ═══════════════ */

/**
 * 性能监测下的引擎订阅封装：生产构建中 React <Profiler> 不触发 onRender，
 * 因此在采集激活时用 flushSync 把整树刷新压成同步并实测耗时（正常路径不受影响、仍是异步渲染）。
 */
function PerfListener({ engine, force }: { engine: GameEngine; force: () => void }) {
  useEffect(() => {
    return engine.subscribe(() => {
      if (perfHub.recording) {
        const t0 = performance.now()
        flushSync(force)
        perfHub.recordCommit(performance.now() - t0)
      } else {
        force()
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine])
  return null
}

/** 调试悬浮 HUD：当前推进/通知/提交耗时 + 一键复制完整快照 JSON（玩家可按引导导出） */
function PerfHud({ onClose }: { onClose: () => void }) {
  const [, bump] = useReducer((n: number) => n + 1, 0)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    const iv = window.setInterval(bump, 1_000)
    return () => window.clearInterval(iv)
  }, [])
  function fmtBox(b?: { n: number; sumMs: number; maxMs: number }): string {
    if (!b || b.n === 0) return '—'
    return `均 ${(b.sumMs / b.n).toFixed(2)}ms · 峰 ${b.maxMs.toFixed(1)}ms ×${b.n}`
  }
  async function doCopy(): Promise<void> {
    const rep = perfHub.report()
    if (!rep) return
    const text = JSON.stringify(rep, null, 1)
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }
  const t = perfHub.liveTotals()
  const fps = t && t.fps.samples > 0 ? (t.fps.avg / t.fps.samples).toFixed(0) : '—'
  const wallS = Math.round(perfHub.liveWallMs() / 1000)
  return (
    <div className="app-perf-hud">
      <div className="app-perf-hud-title">
        性能快照 · {wallS}s · FPS ≈{fps}
        <button className="app-btn is-small" onClick={() => void doCopy()}>
          {copied ? '✓ 已复制' : '复制报告'}
        </button>
        <button className="app-btn is-small" onClick={onClose}>
          ✕
        </button>
      </div>
      {t ? (
        <>
          <div className="app-perf-hud-line">
            <span>引擎推进 · 挂机</span>
            <span>{fmtBox(t.adv.idle)}</span>
          </div>
          <div className="app-perf-hud-line">
            <span>引擎推进 · 战斗</span>
            <span>{fmtBox(t.adv.battle)}</span>
          </div>
          <div className="app-perf-hud-line">
            <span>整树刷新 · 挂机</span>
            <span>{fmtBox(t.notify.idle)}</span>
          </div>
          <div className="app-perf-hud-line">
            <span>整树刷新 · 战斗</span>
            <span>{fmtBox(t.notify.battle)}</span>
          </div>
          <div className="app-perf-hud-line">
            <span>React 提交</span>
            <span>{fmtBox(t.commit)}</span>
          </div>
          <div className="app-perf-hud-line">
            <span>长任务</span>
            <span>{t.long.n} 次{t.long.n > 0 ? ` · 最长 ${t.long.maxMs.toFixed(0)}ms` : ''}</span>
          </div>
        </>
      ) : null}
      <div className="app-dim app-perf-hud-tip">此面板只记录/展示，不影响游戏；「复制报告」= 发给开发者的完整诊断 JSON</div>
    </div>
  )
}

/**
 * 手机自绘下拉面板「最短出现间隔」（毫秒 · 2026-09-13 船长定）。
 * 船长原话：「手机浏览器的下拉框选项我记得是优化过的？不过现在出现的太快，玩家会出现误操作，
 * 建议加入出现延迟，保证玩家手指能即时离开屏幕」；集中提问后选定 **抬手才弹 ＋ 最短 200ms**。
 * 为什么"抬手才弹"是必须的：面板原先在 `pointerdown` 那一刻就插入 DOM，选项正好落在手指底下——
 * 抬手那一下的 click 直接命中某个选项（这就是误操作的来源）。现在按下只记录，手指离开屏幕才出现。
 */
const MOB_SEL_MIN_OPEN_MS = 200

/** 按下→抬起之间手指移动超过这个距离（px）视为"滑动/拖拽"，不弹面板（旋钮） */
const MOB_SEL_MOVE_TOLERANCE_PX = 24

export function App({ engine }: { engine: GameEngine }) {
  const [, force] = useReducer((n: number) => n + 1, 0)
  /** 语言（2026-09-19 船长令「英语本地化」）：界面文案走 `t(中文源串)`；缺词条回退中文 */
  const { locale, t } = useL10n()
  /** 切语言 ⇒ 让引擎按语言重建 ctx 与目录表（只换文案，id/数值不动），引擎 `notify()` 后界面整体刷新 */
  useEffect(() => {
    engine.setLocale(locale)
  }, [engine, locale])

  // ── 手机竖屏自动横屏（船长 2026-09-05；2026-09-06 改：按 visualViewport 真实可见区铺满对齐，
  //    修复 Edge/Chrome 移动端地址栏悬浮导致左右/上下被遮——不再依赖"布局视口 50% 居中"） ──
  const [mobileRot, setMobileRot] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  // 手机横屏下的自绘下拉面板（2026-09-06 船长：原生下拉弹层不受 CSS 旋转影响 → 方向错位）
  const [mobSel, setMobSel] = useState<{ el: HTMLSelectElement; opts: { value: string; label: string }[]; sel: string } | null>(null)
  useEffect(() => {
    const update = (): void => {
      const coarse = window.matchMedia('(pointer: coarse)').matches
      const portrait = window.innerHeight > window.innerWidth
      const rot = coarse && portrait && window.innerWidth < 900
      setMobileRot(rot)
      const el = rootRef.current
      if (el) {
        if (rot) {
          // 真实可见区（布局视口内可视区域）：移动端地址栏/工具栏悬浮时 ≠ innerWidth/innerHeight
          const vv = window.visualViewport
          const visW = vv ? vv.width : window.innerWidth
          const visH = vv ? vv.height : window.innerHeight
          const visX = vv ? vv.offsetLeft : 0
          const visY = vv ? vv.offsetTop : 0
          // 虚拟横屏设计宽度：越大画面整体越小、看到越多（船长 2026-09-05：横屏后偏大，改 1200 放宽）
          const designW = 1200
          const scale = visH / designW
          const vh = designW * visW / visH
          // 布局坐标对齐：旋转(绕原点 -90°)后，元素的"右下"恰好落在可见区右下
          // 映射：物理 x = L + s·y，物理 y = T − s·x ⇒ 取 L=visX、T=visY+visH 即整区铺满
          el.style.setProperty('--mob-w', `${designW}px`)
          el.style.setProperty('--mob-h', `${vh}px`)
          el.style.setProperty('--mob-scale', String(scale))
          el.style.setProperty('--mob-x', `${visX}px`)
          el.style.setProperty('--mob-y', `${visY + visH}px`)
        } else {
          el.style.removeProperty('--mob-w')
          el.style.removeProperty('--mob-h')
          el.style.removeProperty('--mob-scale')
          el.style.removeProperty('--mob-x')
          el.style.removeProperty('--mob-y')
        }
      }
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)
    const vv = window.visualViewport
    if (vv) {
      // 地址栏展开/收起、键盘弹出等只会改 visualViewport 尺寸/偏移的场合也要重算
      vv.addEventListener('resize', update)
      vv.addEventListener('scroll', update)
    }
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
      const v2 = window.visualViewport
      if (v2) {
        v2.removeEventListener('resize', update)
        v2.removeEventListener('scroll', update)
      }
    }
  }, [])

  // 手机横屏：拦截原生 select 弹层 → 自绘大号选项面板（仅 is-mobile-rot 生效，桌面不变）
  // ⚠ 2026-09-13 船长：「下拉框…现在出现的太快，玩家会出现误操作」⇒ 弹出时机改**抬手才弹 + 最短 200ms**
  //   （原先是 pointerdown 即弹 ⇒ 选项落在手指底下、抬手就误选；常量见文件头 MOB_SEL_MIN_OPEN_MS）。
  useEffect(() => {
    if (!mobileRot) {
      setMobSel(null)
      return
    }
    /** 已按下、等抬手的下拉（含按下时刻与按下点，用于"最短间隔"与"滑动取消"） */
    let pending: { el: HTMLSelectElement; at: number; x: number; y: number } | null = null
    let timer = 0
    let raf = 0
    const clearPending = (): void => {
      pending = null
      if (timer !== 0) {
        window.clearTimeout(timer)
        timer = 0
      }
      if (raf !== 0) {
        window.cancelAnimationFrame(raf)
        raf = 0
      }
    }
    /** 真正弹出：**推到下一帧**——防"抬手那一瞬的 click 落在刚出现的选项上"（同帧插入面板会被它命中） */
    const fire = (el: HTMLSelectElement): void => {
      if (raf !== 0) return
      raf = window.requestAnimationFrame(() => {
        raf = 0
        if (!el.isConnected) return
        const opts = Array.from(el.options).map((o) => ({
          value: o.value,
          label: (o.textContent ?? '').trim() || o.value,
        }))
        setMobSel({ el, opts, sel: el.value })
      })
    }
    const onPointerDown = (e: PointerEvent): void => {
      const t = e.target as HTMLElement | null
      if (t?.closest?.('.app-mob-sel-mask')) return // 面板自身（点遮罩由 onClick 关闭）
      const sel = t?.closest?.('select') as HTMLSelectElement | null
      if (!sel || sel.disabled || sel.options.length === 0) return
      e.preventDefault()
      e.stopPropagation()
      // 只**记录**，不弹（口径①：抬手才弹）；照旧 preventDefault 挡住原生选择器
      clearPending()
      pending = { el: sel, at: Date.now(), x: e.clientX, y: e.clientY }
    }
    const onPointerUp = (e: PointerEvent): void => {
      const p = pending
      if (!p) return
      pending = null
      // 手指拖走了（滑动/拖拽意图）⇒ 不弹
      if (
        Math.abs(e.clientX - p.x) > MOB_SEL_MOVE_TOLERANCE_PX ||
        Math.abs(e.clientY - p.y) > MOB_SEL_MOVE_TOLERANCE_PX
      ) {
        return
      }
      // 口径②：从按下算起不早于 MOB_SEL_MIN_OPEN_MS（快点的剩余时间补齐；慢点已满则立即）
      const wait = MOB_SEL_MIN_OPEN_MS - (Date.now() - p.at)
      if (wait <= 0) fire(p.el)
      else timer = window.setTimeout(() => {
        timer = 0
        fire(p.el)
      }, wait)
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('pointerup', onPointerUp, true)
    window.addEventListener('pointercancel', clearPending, true)
    return () => {
      clearPending()
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('pointerup', onPointerUp, true)
      window.removeEventListener('pointercancel', clearPending, true)
    }
  }, [mobileRot])

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
  // 通讯未读（2026-09-11 船长定）：导航图标闪烁 + 数字徽标；逐条已读，点开即读
  const commsUnread = engine.commsUnread()
  const [page, setPage] = useState<PageKey>('map')
  /**
   * **点导航的"这一下"**（船长 2026-09-14：「点击左边侧边栏的时候，中间主窗口进行切换时最好给予玩家一个反馈，
   * 哪怕点的是当前窗口」）：只在**点当前页**时用（换页由内容区重挂载的入场淡入负责）——
   * 内容区与该项图标各播一次 220ms 脉冲；计时器落下来摘掉 class，于是连点也能一次次重播
   * （CSS 动画不会因为 class 没变化而自行重放）。样式见 `styles.css` 的「侧边栏点击 / 一级页切换反馈」段。
   */
  const [navBeat, setNavBeat] = useState<{ key: PageKey; seq: number } | null>(null)
  const navBeatTimer = useRef<number | null>(null)
  /**
   * **赏金新板提示**（船长 2026-09-14：「当任务中心有新的赏金任务时，提示玩家，**玩家进入后消除提示**」）：
   * 判定 = **换板未看**（core `sideTaskBoard().bountyNewCount`，单点）——赏金日板每天本地 0 点整板替换。
   * 徽标在**任务中心页内恒为 0**（进入即消，不必等下一拍）；记账写在下面那个 effect 里。
   * ⚠ 记账**必须挂在 `page` 上**（而不是导航按钮的 onClick）：点导航、通讯「前往」、教程跳转
   * 三条入口都会走到这里，挂在按钮上会漏掉后两条 ⇒ "进了任务中心徽标还在"。
   */
  const bountyNew = page === 'task' ? 0 : engine.bountyNewCount()
  useEffect(() => {
    if (page === 'task') engine.markBountyBoardSeen()
  }, [engine, page])
  // 星图页功能区（页内标签状态；常驻 App，跨页保留；默认「星图·远征」= 玩家查看大地图的主入口）
  const [mapTab, setMapTab] = useState<MapTab>('star')
  const [shipTab, setShipTab] = useState<ShipTab>('fleet')
  // 舰船页"去市场"→ 市场页聚焦该船订单（seq 递增触发一次）
  const [mktFocus, setMktFocus] = useState<{ key: string; seq: number } | null>(null)
  // 舰船页卡片"装配"→ 装配页默认目标船（船长 2026-09-05：入口在舰队卡片；离开装配页即清，再次直进默认当前驾驶船）
  const [fitShipId, setFitShipId] = useState<string | null>(null)
  /**
   * 工业页的**内层段定位**（精炼炉 / 组装机）——「第一次」卡片上的跳转按钮要落到"这件活"那一档
   * （船长 2026-09-18）。一次性：页在切走时重挂载（`key={page}`），故只需给初值。
   */
  const [indFocus, setIndFocus] = useState<'refine' | 'shelf' | 'craft' | 'shipyard' | null>(null)
  // 工业页精炼炉卡「去矿带/去打捞」→ 星图对应卡高亮（seq 递增触发一次；2026-09-09 船长定，与「去市场」同款 seq 机制）
  const [mapGoto, setMapGoto] = useState<MapGotoTarget | null>(null)
  /** 任务中心内层标签定位请求（通讯「前往」与开场信都落在「重要任务」） */
  const [taskFocus, setTaskFocus] = useState<TaskFocusTarget | null>(null)
  /** 通讯页定位：任务中心「第一次」卡片上的「看情报」→ 切到通讯页并选中那封情报信 */
  const [commsFocus, setCommsFocus] = useState<{ id: string; seq: number } | null>(null)
  /**
   * **虫洞面板**（终局玩法 · ✅ 2026-09-14 已上线：入口常驻，玩家侧门槛 = 协会声望 ≥ 40）：
   * 面板挂在 App 这一层、**不依赖星图选中哪个星系**——原先只挂在星图行动区的入口行里，
   * 而行动区要先选中星系才渲染 ⇒ 人在洞里时可能回不到面板（船长 2026-09-13：「活动栏直接开面板」）。
   */
  const [whOpen, setWhOpen] = useState(false)
  /** 从库存进洞：选中的那处（null = 调试入口，直接用游戏随机种子开一趟） */
  const [whStockPick, setWhStockPick] = useState<string | null>(null)
  /** **自动探索模式**要派的那一处库存（2026-09-14 船长：自动探索走同一个准备页） */
  const [whAutoPick, setWhAutoPick] = useState<string | null>(null)
  /**
   * 打开虫洞面板（stockId 给了 = 从「扫描虫洞」页选中的那处库存虫洞开始探索）。
   *
   * ⚠ **不许顺手改星图的标签页**（2026-09-19 船长报障：「关闭虫洞准备界面后，为什么界面会停留在
   * 星图远征界面」）：面板挂在 **App 层**（见本文件底部 `{whOpen ? <WormholePanel …/> : null}`）
   * ⇒ 它**不依赖**底下是哪一页哪一签；这里原先是 `changePage('map') + changeMapTab('star')`，
   * 那句切标签是**面板还住在星图标签里时的遗留**（`f08c76a8` 把面板搬到 App 层后就不需要了）：
   * 从「扫描虫洞」点「返回虫洞 / 探索 / 自动探索」会把标签偷偷切到「星图」⇒ 关掉面板后人被丢在
   * **星图远征页**，回不到刚才那一页。
   * ⇒ 现在**只切页、不动标签**：关掉面板即回到进来时那一页（船长要的"从哪来回哪去"）。
   * 附带修好一条副作用：`page==='map' && mapTab==='star'` 那条「扫描完成高亮 · 看过即收」，
   * 原先会被"开一下虫洞面板"顺手触发——等于玩家没看星图就把高亮收掉了。
   */
  const openWormhole = (stockId?: string): void => {
    setWhStockPick(stockId ?? null)
    setWhAutoPick(null)
    changePage('map')
    setWhOpen(true)
  }
  /** 打开虫洞面板的**自动探索模式**（同一个准备页；按钮写「派队自动探索」）——同样**不动星图标签** */
  const openWormholeAuto = (stockId: string): void => {
    setWhStockPick(null)
    setWhAutoPick(stockId)
    changePage('map')
    setWhOpen(true)
  }
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
  // 性能监测（2026-09-08 诊断工具）：debug 开关在首帧前激活隐形采集；自动采集模式由 main.tsx 预激活
  useState(() => {
    if (perfAutoEnabled()) perfHub.activate()
    return false
  })
  const [perfOpen, setPerfOpen] = useState(false)

  const [toast, setToast] = useState<{ text: string; warn: boolean } | null>(null)
  const toastTimer = useRef<number | null>(null)
  const showToast: ToastFn = (text, warn = false) => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current)
    setToast({ text, warn })
    toastTimer.current = window.setTimeout(() => setToast(null), 3200)
  }
  /**
   * **点击底部提示条立即关闭**（2026-09-13 船长：「屏幕下方的错误提示，允许玩家通过点击快速关闭。」）——
   * 两种底部提示（操作提示 `.app-toast` 与随机事件小弹卡 `.app-event-toast`）**整条可点**：
   * 点一下即消失，并**同时清掉自动隐藏计时器**（否则点掉后旧定时器仍会到点置空一次，无害但语义脏）。
   * **自动隐藏口径不变**（操作 3.2s / 事件 6s）；点击只做关闭，不触发任何其它动作。
   */
  const dismissToast = (): void => {
    if (toastTimer.current !== null) {
      window.clearTimeout(toastTimer.current)
      toastTimer.current = null
    }
    setToast(null)
  }

  // 2026-09-08 引擎系统通知（交付循环终止弹窗）：engine 心跳/离线结算后调用
  useEffect(() => {
    engine.onSystemNotice = (msg) => showToast(msg, true)
    return () => {
      engine.onSystemNotice = null
    }
  }, [engine])

  // ── 弹层：存档管理 / 手册图鉴 / 全屏战斗 ──
  const [showSaveManager, setShowSaveManager] = useState(false)
  const [showHandbook, setShowHandbook] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [battleOpen, setBattleOpen] = useState(false)

  // 顶栏「讨论 QQ 群」：点击复制群号（2026-09-08 船长指示）
  const [qqCopied, setQqCopied] = useState(false)
  const QQ_GROUP = '621172698'
  const copyQqGroup = (): void => {
    void navigator.clipboard
      ?.writeText(QQ_GROUP)
      .then(() => {
        setQqCopied(true)
        window.setTimeout(() => setQqCopied(false), 1600)
      })
      .catch(() => undefined)
  }

  // 交火中（主动进入全屏战斗页；不自动切换页面）
  // 交火中 = 主控远征战斗 **或** 虫洞内的洞内战斗（F2：洞内战斗同样要能进战场观看）
  const inBattle =
    (state.expedition.active && state.expedition.phase === 'battle') || !!state.wormhole.run?.battle

  // V12.3：出发远征到港开战（phase 进入 battle 的上升沿）→ 自动切入全屏战场；
  // 玩家手动退出战场后（battleOpen=false 而 inBattle 仍 true）不会再被自动弹回
  const prevInBattleRef = useRef(false)
  useEffect(() => {
    // 优化：重复清剿自动发起的远征默认最小化战斗界面（仍可用右上角「⚔ 战斗中」主动进入）
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

  /**
   * **通讯「前往」的统一跳转出口**（2026-09-14 抽单点）：通讯页右栏与送达弹窗共用同一套落点规则
   * ——可带星图标签、任务中心内层标签、舰船标签；老数据里 `{page:'map', tab:'task'}` 一并改道任务中心页。
   */
  function gotoFromComms(p: string, tab?: string, shipTab?: string, taskTab?: string): void {
    if (p === 'map' && tab) changeMapTab(tab as MapTab)
    if ((p === 'task' || (p === 'map' && tab === 'task')) && taskTab) focusTaskTab(taskTab)
    if (p === 'ship' && shipTab) changeShipTab(shipTab as ShipTab)
    changePage(p as PageKey)
  }

  /**
   * **需要弹窗的通讯**（船长 2026-09-14 两次裁定）：①「解锁时发送通讯给玩家（**同时也要直接弹窗**）」；
   * ② 同日扩为「**所有除新手教程外的讯息也弹窗**」⇒ 是否弹由 core 的 `advanceComms` 单点决定
   * （`popup ?? kind !== '教程'`），这里只负责渲染**队首那一封**：同一拍送达多封也只弹一张、
   * 点「知道了」换下一张（**不会叠出多窗口**）；离线简报优先，避免两张卡叠着。
   * 弹窗外形 = 通讯页右栏那块屏（同源公共件 `panels/CommsReader.tsx`）。
   */
  const popupId = engine.commsPopups()[0] ?? null
  const popupMsg =
    popupId !== null && !showOfflineReport ? (engine.commsInboxView().find((e) => e.id === popupId) ?? null) : null

  // ── 随机事件小弹卡（在线触发时展示 6 秒；离线触发的不弹，避免启动刷屏） ──
  const [eventToast, setEventToast] = useState<{ id: number; text: string } | null>(null)
  const lastSeenLogId = useRef<number>(state.logs[state.logs.length - 1]?.id ?? 0)
  const eventTimer = useRef<number | null>(null)
  /**
   * ⚠ **effect 依赖 = 日志尾号（单调递增），不能写 `[state.logs]`**（2026-09-13 三号修既有缺陷）：
   * `core.state.addLog` 是**原地 `push` / `splice`**（数组引用永不变）⇒ 依赖数组本身的 effect
   * **挂载后再也不会重跑** ⇒ 小弹卡此前**从不弹出**。真机实测：日志面板里已有「✦ 扫描完成：…」，
   * 而页面全程不存在 `.app-event-toast`。改用尾号做依赖后语义不变（只认"挂载之后新增"的日志）。
   */
  const logTailId = state.logs[state.logs.length - 1]?.id ?? 0
  useEffect(() => {
    const logs = state.logs
    for (let i = logs.length - 1; i >= 0; i--) {
      const l = logs[i]!
      if (l.id <= lastSeenLogId.current) break // 只检查新增日志（id 单调递增）
      if (l.kind === 'event' || l.text.startsWith('✦')) { // 随机事件按类型认；其余「✦ 扫描完成/彩头/高级箱」照旧按前缀认
        setEventToast({ id: l.id, text: l.text })
        if (eventTimer.current !== null) window.clearTimeout(eventTimer.current)
        eventTimer.current = window.setTimeout(() => setEventToast(null), 6000)
        break // 每次最多弹最新一条
      }
    }
    const tail = logs[logs.length - 1]
    if (tail) lastSeenLogId.current = tail.id
  }, [logTailId])

  /** 随机事件小弹卡的「点击关闭」（口径同 `dismissToast`；本卡自动隐藏为 6 秒） */
  const dismissEventToast = (): void => {
    if (eventTimer.current !== null) {
      window.clearTimeout(eventTimer.current)
      eventTimer.current = null
    }
    setEventToast(null)
  }

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

  /**
   * **序章·苏醒只剩"演出"**（2026-09-17 教程重做）：线性七步（采集→交付→出售→修复→试炼→技能→分身）、
   * 步骤白名单锁定、顶部引导条与收尾演出**全部退场**——教程内容改由任务中心的 13 条「第一次」承载，
   * 玩家自由选择；页面/页签的门改由下面的「第一次」前置表（core `FIRST_UNLOCKS`）把守。
   */
  const tutStep = engine.state.onboarding.step
  /**
   * **「第一次」前置锁定**（2026-09-17 教程重做批 · 数据驱动；表在 core 的 `FIRST_UNLOCKS`）：
   * 工业页 ← 第一次采集原矿 · 市场页 ← 第一次生产 · 星图四个页签 ← 第一次扫描。
   * 口径（船长）：「**未解锁的页面与任务都隐藏**」⇒ 导航项与页签直接不渲染；
   * 程序化跳转（活动栏 / 跨页按钮）另在 `changePage` / `changeMapTab` 里拦一道，给一句"先做什么"。
   */
  const tabLocked = (t: MapTab): boolean => {
    const k = TAB_UNLOCK_KEY[t]
    return k !== undefined && !unlocked(state, k)
  }
  /** 页签解锁状态签名（effect 依赖用：解锁只从无到有 ⇒ 签名变了才需要归位一次） */
  const tabLockSig = MAP_TABS.map((t) => (tabLocked(t.key) ? '0' : '1')).join('')
  // 锁上的页签不能停着不动（读档落在其上 / 跳转落点被锁）：退回「星图·远征」
  useEffect(() => {
    if (tabLocked(mapTab)) setMapTab('star')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapTab, tabLockSig])

  /** 播一次"点到了"的脉冲（内容区 + 该导航项图标；220ms 后自动落下）——同页重复点击也照样重播 */
  const pulseNav = (key: PageKey): void => {
    if (navBeatTimer.current !== null) window.clearTimeout(navBeatTimer.current)
    setNavBeat((b) => ({ key, seq: (b?.seq ?? 0) + 1 }))
    navBeatTimer.current = window.setTimeout(() => {
      setNavBeat(null)
      navBeatTimer.current = null
    }, 220)
  }
  // 卸载时收掉未落下的计时器（不给已卸载的组件 setState）
  useEffect(
    () => () => {
      if (navBeatTimer.current !== null) window.clearTimeout(navBeatTimer.current)
    },
    [],
  )
  const changePage = (p: PageKey): void => {

    // 「第一次」前置（工业/市场）：导航项此时不显示，这里拦的是程序化跳转
    if (!unlocked(state, p)) {
      showToast(`尚未解锁：先完成「${unlockNeedTitle(p) ?? '前置任务'}」。`, true)
      return
    }
    /**
     * **点导航的"这一下"必须有反馈**（船长 2026-09-14：「点击左边侧边栏的时候，中间主窗口进行切换时最好
     * 给予玩家一个反馈，**哪怕点的是当前窗口**」）：
     * - **换页**：内容区随 `key={page}` 重挂载 ⇒ 播一次入场淡入（`.app-page-content` 基类），不必另加东西；
     * - **点当前页**：**不重挂载**（页面里的检索词 / 滚动位置 / 弹层状态一律不受打扰），改播一次 220ms 脉冲
     *   （内容区明暗脉冲 + 该导航项图标缩放脉冲）；计时器到点摘掉 class ⇒ 连点也能一次次重播。
     */
    if (p === page) pulseNav(p)
    else setNavBeat(null)
    setPage(p)
  }
  const changeMapTab = (t: MapTab): void => {

    // 「第一次」前置（星图四项：先完成第一次扫描）——页签此时不显示，这里拦的是程序化跳转
    if (tabLocked(t)) {
      const k = TAB_UNLOCK_KEY[t]
      showToast(`尚未解锁：先完成「${(k ? unlockNeedTitle(k) : undefined) ?? '前置任务'}」。`, true)
      return
    }
    setMapTab(t)
  }
  /**
   * **扫描完成的高亮"看过即收"**（船长 2026-09-15：完成后进度条依旧存在并高亮，直到玩家进入星图
   * 界面查看后才移除）：进/留在「星图」页的「星图」标签 = 看过了 ⇒ 收掉高亮。
   * ⚠ 依赖只有 `[page, mapTab]`：完成时人**已经**停在星图页的话，这一拍不会触发 ⇒ 高亮留着，
   * 等他离开再回来（或点一下顶部那条）才收——免得"新点亮的星系还没看见，条就没了"。
   */
  useEffect(() => {
    if (page === 'map' && mapTab === 'star') engine.ackScanView()
  }, [page, mapTab])
  // 工业页 → 星图定位（2026-09-09 船长定）：切页 + 目标标签页 + 卡高亮 seq（MapPage 一次性应用；
  // 标签页切换走 changeMapTab 尊重「第一次」前置锁——被锁时只切页不切签，高亮不触发）
  const gotoMapTab = (tab: 'mine' | 'salvage', ids: string[]): void => {
    changePage('map')
    changeMapTab(tab)
    setMapGoto((p) => ({ tab, ids, seq: (p?.seq ?? 0) + 1 }))
  }
  /**
   * 任务中心**内层**标签定位（2026-09-11 船长：「步骤 2/7 跳转任务中心时，不会切到指定标签页」）：
   * 内层标签会记住玩家上次的选择，故跳转要显式发一次请求；seq 变化即应用（同 mapGoto/commsFocus 套路）。
   */
  const focusTaskTab = (tab: string): void => {
    setTaskFocus((p) => ({ tab, seq: (p?.seq ?? 0) + 1 }))
  }
  const changeShipTab = (t: ShipTab): void => {
    setShipTab(t)
  }
  /**
   * **序章演出结束 ⇒ 落到任务中心「重要任务」**（原收尾演出的落点，2026-09-17 教程重做后由"演出一结束"承接）：
   * 待办清单与开场信都指向这里——先看清单，再决定做哪一件。
   */
  const prevObStep = useRef(engine.state.onboarding.step)
  useEffect(() => {
    const s = engine.state.onboarding.step
    if (prevObStep.current === ONB_AWAKEN && s !== ONB_AWAKEN) {
      try {
        localStorage.setItem('whale-idle:task-tab', 'important')
      } catch {
        // 忽略
      }
      setPage('task')
    }
    prevObStep.current = s
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tutStep])

  return (
    <div ref={rootRef} className={`app-root${mobileRot ? ' is-mobile-rot' : ''}`}>
      {/* 引擎订阅：正常异步渲染；性能监测激活时改 flushSync 同步刷新并实测整树提交耗时 */}
      <PerfListener engine={engine} force={force} />
      {/* ───── 顶栏 ───── */}
      <header className="app-header">
        <div className="app-header-left">
          {/* 游戏名（2026-09-11 船长：「将游戏的名称改为大鲸鱼-深空放置」；
              注意「深空工业协会」是**游戏内势力**、不随游戏名改） */}
          <span className="app-logo">大鲸鱼-深空放置</span>
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
                title="性能监测（诊断工具）：FPS / 引擎推进 / 整树刷新 / React 提交耗时；可一键复制完整快照"
              >
                ⏱ 性能
              </button>
            </>
          ) : null}
          {/**
           * ⚠ **金钱栏已移到左侧栏**（船长 2026-09-13：「将顶部的金钱栏移动到左侧的出港上方」）
           * ⇒ 顶栏这里不再显示余额，只留在线时长与公告/按钮。落点在 `app-nav-side` 首项上方。
           */}
          <span className="app-clock">在线 {formatDurationMs(state.gameMs)}</span>
          <AnnouncementHub engine={engine} />
          <button
            className="app-btn"
            onClick={copyQqGroup}
            title={`游戏讨论 QQ 群：${QQ_GROUP}（点击复制群号，到 QQ 搜索群号即可加入）`}
          >
            {qqCopied ? '✓ 群号已复制' : `💬 QQ群 ${QQ_GROUP}`}
          </button>
          <button className="app-btn" onClick={() => setShowHandbook(true)} title="玩法说明与图鉴">
            {t('手册')}
          </button>
          <button className="app-btn" onClick={() => setShowSettings(true)} title="界面缩放与字体大小">
            {t('设置')}
          </button>
          <button className="app-btn" onClick={() => void handleSave()}>
            保存
          </button>
          <button className="app-btn" title="备份 / 恢复存档" onClick={() => setShowSaveManager(true)}>
            存档管理
          </button>
          <button className="app-btn is-danger" onClick={handleReset}>
            重置档案
          </button>
        </div>
      </header>

      {/* ───── 工作区：左导航栏 + 主窗口（活动窗口置于主列顶部，宽度与主窗口一致）+ 事件日志 ───── */}
      <div className="app-workspace">
        <nav className="app-nav-side">
          <ShipStatusWin engine={engine} />
          {/**
           * **金钱栏**（船长 2026-09-13：「将顶部的金钱栏移动到左侧的**出港上方**」＋
           * 「更换金钱单位为**信用点**」）：位置 = 舰船状态窗之下、**第一个导航项（出港）之上**。
           * ⚠ 显示口径（船长同日二次口径）：「**如果有条件，还是优先显示全额数字**…如果实在显示不下，
           * 采用数量级缩写（**但是仍要尽可能保证数字够长**）」⇒ 值走 `ui/MoneyFit`：
           * **逐候选实测宽度**，档序 = 全额（带单位 → 去掉单位）→ 缩写（带单位 → 去掉单位，长的在前），
           * **精确值恒挂 `title`**。窄栏里优先保住的是**数字**，不是「信用点」三个字。
           */}
          <MoneyFit amount={state.wallet.isk} className="app-isk app-wallet" />
          {NAV_ITEMS.map((item) => {
            // 「第一次」前置未达 ⇒ **该导航项不显示**（船长：未解锁页面与任务都隐藏）
            if (!unlocked(state, item.key)) return null
            // 徽标两族（船长 2026-09-11 / 2026-09-14）：通讯 = 未读条数；任务中心 = 赏金新板条数
            const unreadN = item.key === 'comms' ? commsUnread : item.key === 'task' ? bountyNew : 0
            return (
              <button
                key={item.key}
                className={`app-nav-item${page === item.key ? ' is-active' : ''}${item.key === 'map' ? ' is-featured' : ''}${unreadN > 0 ? ' is-unread' : ''}${navBeat?.key === item.key ? ' is-beat' : ''}`}
                title={
                  unreadN > 0
                    ? item.key === 'task'
                      ? `赏金任务已更新：${unreadN} 条（进任务中心即清除）`
                      : `有 ${unreadN} 条未读通讯`
                    : undefined
                }
                onClick={() => changePage(item.key)}
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
        <main className="app-page-main">
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
          {/* 一级页不滚：已按 docs/design/page-scroll-layout.md 完成转换的页进 no-scroll（整页不滚，滚动在二级窗）。
              `key={page}` ⇒ 换页即重挂载 = 入场淡入（切页反馈）；点当前页不重挂载，走 `is-beat` 的脉冲（见 pulseNav）。 */}
          <div
            className={`app-page-content${PAGE_NO_SCROLL.has(page) ? ' no-scroll' : ''}${navBeat?.key === page ? ' is-beat' : ''}`}
            key={page}
          >
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
            {page === 'market' ? (
              <MarketPage
                {...pageProps}
                focusKey={mktFocus?.key ?? null}
                focusSeq={mktFocus?.seq ?? 0}
                onFocusUsed={() => setMktFocus(null)} // 一次性聚焦：应用后即清，避免每次进市场都带出上次的物品
              />
            ) : null}
            {page === 'industry' ? (
              <IndustryPage
                {...pageProps}
                focusSec={indFocus}
                onGotoMarket={(goodKey) => {
                  setMktFocus((p) => ({ key: goodKey, seq: (p?.seq ?? 0) + 1 }))
                  changePage('market')
                }}
                onGotoMap={gotoMapTab}
                /**
                 * **组装机「去虫洞（遗迹打捞）」**（船长 2026-09-14：虫洞专属图纸市场买不到）⇒
                 * 跳**星图 · 出港 · 扫描虫洞**页（进洞与库存都在那儿）。走既有的 `changePage` + `changeMapTab`
                 * 两个入口，教程锁与标签口径自动跟随（与星图内部跳转同一把尺）。
                 */
                onGotoWormhole={() => {
                  changePage('map')
                  changeMapTab('whscan')
                }}
              />
            ) : null}
            {page === 'skills' ? <SkillsPage {...pageProps} /> : null}
            {page === 'map' ? (
              <MapPage
                {...pageProps}
                mapTab={mapTab}
                onMapTab={changeMapTab}
                mapGoto={mapGoto}
                onOpenWormhole={openWormhole}
                onExploreWormhole={(stockId) => openWormhole(stockId)}
                onAutoExploreWormhole={(stockId) => openWormholeAuto(stockId)}
              />
            ) : null}
            {/* 任务中心（2026-09-14 从星图页搬来的一级页）：内层标签定位仍走 taskFocus */}
            {page === 'task' ? (
              <TaskCenterPage
                {...pageProps}
                taskFocus={taskFocus}
                // 「第一次」卡片上的「看情报」：切到通讯页并选中那封情报信（沿用既有的 commsFocus 定位机制）
                onOpenComms={(messageId) => {
                  setCommsFocus((p) => ({ id: messageId, seq: (p?.seq ?? 0) + 1 }))
                  setPage('comms')
                }}
                /**
                 * 「第一次」卡片的**跳转按钮**（船长 2026-09-18：「所有的'第一次'任务，添加一个跳转界面的按钮」）：
                 * 一律走既有的 `changePage` / `changeMapTab` / `changeShipTab` 三把尺——
                 * 「第一次」前置锁与页签白名单自动跟随（未解锁时给提示而不是硬跳），工业页再带上内层段。
                 */
                onJump={(t) => {
                  if (t.industrySec) setIndFocus(t.industrySec)
                  changePage(t.page as PageKey)
                  if (t.mapTab) changeMapTab(t.mapTab as MapTab)
                  if (t.shipTab) changeShipTab(t.shipTab as ShipTab)
                }}
              />
            ) : null}
            {/* 成就（2026-09-20 一级页）：页内是固定头 + 内容内滚的二级子窗口容器 */}
            {page === 'achieve' ? <AchievementsPage engine={engine} /> : null}
            {page === 'comms' ? (
              <CommsPage
                {...pageProps}
                // 顶部引导条「看详情」的定位请求（seq 变化即重新选中对应那封）
                focus={commsFocus}
                // 消息提示的跳转出口（③ 只给提示 + 跳转）：与弹窗共用同一套落点规则
                onGoto={gotoFromComms}
              />
            ) : null}
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



        {/* 两种底部提示**整条可点 = 立即关闭**（2026-09-13 船长；见 dismissToast 注释） */}
        {toast ? (
          <div
            className={`app-toast${toast.warn ? ' is-warn' : ''}`}
            title="点击关闭提示"
            onClick={dismissToast}
          >
            {toast.text}
          </div>
        ) : null}
        {eventToast ? (
          <div className="app-event-toast" title="点击关闭提示" onClick={dismissEventToast}>
            {eventToast.text}
          </div>
        ) : null}
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
                {moneyDelta(offlineReport.iskDelta)}
              </b>{' '}
              信用点
              {/**
               * ⚠ 这里**保留全精度**（不走万/亿分级）：离线结算报告是"玩家要看清楚这趟挣了多少"的地方，
               * 与左侧栏那个"一眼扫过"的余额栏用途不同（船长 2026-09-13 只要求处理"钱位数过多"的显示）。
               */}
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
            {offlineReport.shipsStored.length > 0 ? (
              <div className="app-report-line"><span className="app-ico"><Glyph name="nav-ship" size={13} color={NAV_TONES["nav-ship"]} /></span>入舰船仓库：{offlineReport.shipsStored.map((s) => `${s.name}×${s.delta}`).join('、')}（到舰船页可转入舰队）</div>
            ) : null}
            {offlineReport.skillsUp.length > 0 ? (
              <div className="app-report-line">技能：{offlineReport.skillsUp.join('、')}</div>
            ) : null}
            {offlineReport.learnedIn.length > 0 ? (
              <div className="app-report-line"><span className="app-ico"><Glyph name="ico-cross" size={13} color={ICO_TONES["ico-cross"]} /></span>学会配方：{offlineReport.learnedIn.join('、')}</div>
            ) : null}
            {offlineReport.coreJobs.length > 0 ? (
              <>
                <div className="app-report-line"><span className="app-ico"><Glyph name="nav-ai" size={13} color={NAV_TONES["nav-ai"]} /></span>AI 核心作业</div>
                {offlineReport.coreJobs.map((row, i) => (
                  <div key={i} className="app-report-line">{row}</div>
                ))}
                <div className="app-dim app-report-tail">AI 核心预估收入按站内收价与市场基准价粗估，实际以成交为准。</div>
              </>
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

      {/* ───── 送达弹窗（船长 2026-09-14：除新手教程外所有通讯都弹；外形 = 通讯页右栏那块屏） ───── */}
      {popupMsg ? (
        <div className="app-ann-mask" onClick={() => engine.dismissCommsPopup(popupMsg.id)}>
          <div className="app-comm-pop" onClick={(e) => e.stopPropagation()}>
            <div className="app-comms-body-col">
              <CommsScreen entry={popupMsg} />
              <CommsEave
                entry={popupMsg}
                onGoto={(p, tab, shipTab, taskTab) => {
                  engine.dismissCommsPopup(popupMsg.id)
                  gotoFromComms(p, tab, shipTab, taskTab)
                }}
                extra={
                  <button className="app-btn is-small" onClick={() => engine.dismissCommsPopup(popupMsg.id)}>
                    知道了
                  </button>
                }
              />
            </div>
          </div>
        </div>
      ) : null}

      {/* ───── 弹层：存档管理 / 手册图鉴 / 全屏战斗 ───── */}
      {/* 虫洞面板（终局玩法 · 已上线）：挂在这一层 ⇒ 不依赖星图选中星系 */}
      {whOpen ? (
          <WormholePanel
            engine={engine}
            onToast={showToast}
            stockId={whStockPick}
            autoStockId={whAutoPick}
            onClose={() => {
              setWhOpen(false)
              setWhStockPick(null)
              setWhAutoPick(null)
            }}
          />
        ) : null}
      {showSaveManager ? <SaveManager engine={engine} onToast={showToast} onClose={() => setShowSaveManager(false)} /> : null}
      {showHandbook ? (
        <Handbook
          engine={engine}
          onClose={() => setShowHandbook(false)}
          /* 图鉴条目 → 市场（2026-09-14 船长）：与舰船页 / 物品页 / 货舱页 / 工业页**同一个入口**
             （一次性聚焦 + 切页），跳过去只展开行情详情、不替玩家下单。 */
          onGotoMarket={(goodKey) => {
            setMktFocus((p) => ({ key: goodKey, seq: (p?.seq ?? 0) + 1 }))
            changePage('market')
          }}
        />
      ) : null}
      {showSettings ? <SettingsPanel root={rootRef} onClose={() => setShowSettings(false)} /> : null}
      {battleOpen ? (
        <BattleScreen
          engine={engine}
          onToast={showToast}
          onClose={() => {
            // 2026-09-10 修复（船长定位）：退出战场 = 仅关闭观看界面——战斗后台照常推进、
            // 重复清剿照常继续（原实现在连击自动发起的战斗中退出会顺手停环，属 bug）；
            // 若要中止战斗请用战场内「⚑ 撤退」（撤退才停环）。
            setBattleOpen(false)
          }}
        />
      ) : null}


      {/* 序章·苏醒：新档演出覆盖层（step 0；演出期间引擎时间冻结） */}
      {engine.state.onboarding.step === 0 ? <PrologueScreen engine={engine} /> : null}

      {/* 手机横屏：自绘下拉选项面板（值写回原生 select 并派发 change，保持各页 onChange 原样生效） */}
      {mobSel ? (
        <div className="app-mob-sel-mask" onClick={() => setMobSel(null)}>
          <div className="app-mob-sel" onClick={(e) => e.stopPropagation()}>
            {mobSel.opts.map((o) => (
              <button
                key={o.value}
                type="button"
                className={`app-mob-sel-opt${o.value === mobSel.sel ? ' is-sel' : ''}`}
                onClick={() => {
                  const cur = mobSel
                  setMobSel(null)
                  if (!cur || !cur.el.isConnected) return
                  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(cur.el, o.value)
                  cur.el.dispatchEvent(new Event('change', { bubbles: true }))
                }}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* 性能监测 HUD（debug 开关下由顶栏「⏱ 性能」唤出） */}
      {perfOpen ? <PerfHud onClose={() => setPerfOpen(false)} /> : null}

      {/* 全局悬停提示层（置于最上） */}
      <TooltipLayer />
    </div>
  )
}
