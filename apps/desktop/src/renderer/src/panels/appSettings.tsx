/**
 * 主界面 · 设置与日志/性能浮层域（2026-10-02 从 `App.tsx` 拆出 · 批次 4t · 零行为变化）。
 *
 * 本文件 = 事件日志的偏好域（时钟/分类表/过滤偏好，localStorage 落盘）、设置面板（缩放/字号/界面字体/
 * 背景/配色/声音/存档/调试/布局）、许可与授权全文弹窗、性能浮层（PerfListener / PerfHud）。
 * `App.tsx` 借回使用（先例：fitted.ts），本模块不 import App ⇒ 运行期零回边。
 */
import { useEffect, useReducer, useState } from 'react'
import type { RefObject } from 'react'
import { createPortal, flushSync } from 'react-dom'
import type { LogKind } from '@whale/core'
import { perfHub } from '../game/perf'
import type { SaveStorageProbe } from '../game/saveGuard'
import { debugAllowed, setDebugEnabled } from '../panels/DebugPanel'
import { futureWormholeEnabled, setFutureWormholeEnabled } from '../game/debugFlag'
import { THEME_CHOICES, THEME_LABEL_ID, themeUsesSpacePhoto, useTheme } from '../ui/theme'
import { currentSpaceBg, rerollSpaceBg } from '../ui/spaceBg'
import type { SpaceBgInfo } from '../ui/spaceBg'
import type { LayoutKind } from '../ui/AppShell'
import { tr, useL10n } from '../i18n/locale'
/** 声音（2026-11-02）：音量偏好 + 本机音效台入口 */
import { SFX_CATEGORIES, SFX_CATEGORY_NAME_ID } from '../game/audio/cues'
import { useSfxPrefs } from '../game/audio/prefs'
import { SfxConsole } from './SfxConsole'
/** 客户端版本三件套与运行形态（**2026-10-02 船长令**；构建时注入，见 `game/buildInfo.ts`） */
import { BUILD, BUILD_FORM } from '../game/buildInfo'
import type { GameEngine } from '../game/engine'
import './appSettings.css'
/**
 * **界面字体**（**2026-11-02 船长令**：「增加一个字体选择的功能在设置界面……把字体
 * `D:\Downloads\unifont-18.0.01 (1).otf` 嵌入到项目里，作为可选字体之一」）：
 * 偏好读写/应用到 `<html>` 的逻辑收在 `ui/fontChoice.ts`；**启动时应用**在 `game/boot.ts` 的
 * `prebootRenderer()`（两个入口共用的启动点，本文件不碰）。
 */
import { chooseFont, readFontChoice } from '../ui/fontChoice'
import type { FontChoice } from '../ui/fontChoice'
/**
 * **许可与授权全文**（**2026-11-02 船长令**：「这个字体是GNU授权，记得在设置的最最下方增加一个许可按钮
 * 把这些授权书内容统统都写进入」）：`?raw` 由 Vite 内联（桌面/网页两入口同一套），正文照录原文、不译不改。
 * - GNU Unifont 18.0.01 官方授权原文（2026-11-02 取自 <https://unifoundry.com/LICENSE.txt>）；
 * - 根目录 `LICENSE.txt`（项目版权与授权声明）与 `LICENSE`（双许可与商业使用条款，含 AGPLv3 全文）。
 * ⚠ **游戏内不展示「原项目 / 原站」两条外部链接**（船长 2026-11-02 追加要求；连带英文条款里的
 * 原仓库链接）：`assets/licenses/` 内的两份项目声明副本已按令删去这几行，**根目录原文不改**
 * （发行包 / `release-rights` 仍用根目录原文）。字体与 AGPLv3 等许可正文未做任何删改。
 * ⚠ 同一批船长裁定（2026-11-02）：个人主页署名链接**保留**；声明里「请通过原项目联系作者」因链接
 * 删除而指代悬空 ⇒ 游戏内副本改为「请联系作者」（仍只改副本，根目录原文不动）。
 */
import unifontLicenseText from '../assets/licenses/unifont-18.0.01-LICENSE.txt?raw'
import projectLicenseStatement from '../assets/licenses/project-LICENSE-statement.txt?raw'
import projectLicenseDual from '../assets/licenses/project-LICENSE-dual-licensing.txt?raw'
/**
 * **界面缩放 / 字号偏好**（2026-11-02 收成单点）：读取、钳制、应用都在 `ui/uiScale.ts`，
 * 启动应用在 `game/boot.ts` 的 `prebootRenderer()`；本面板只负责「面板显示 + 拖动时写一次」。
 */
import {
  FS_KEY,
  FS_MAX,
  FS_MIN,
  ZOOM_KEY,
  ZOOM_MAX,
  ZOOM_MIN,
  applyFontScale,
  applyZoom,
  readFontScale,
  readZoom,
} from '../ui/uiScale'

/* ═══════════ GNU Unifont 18.0.01 的元信息（2026-11-02 核对） ═══════════
   口径来源：官方发布页 <https://unifoundry.com/unifont/>（18.0.01 / 2026-09-16 发布）与
   字体文件自身的 name 表（版权、许可描述、许可 URL）。下面三条英文**照录字体文件内嵌原文**：
   版权与许可是法律文字，不译、不改写、不缩写（与授权书正文同一条纪律）。 */
const UNIFONT_VERSION = '18.0.01'
const UNIFONT_FONT_FILE = 'unifont-18.0.01.otf'
const UNIFONT_HOME_URL = 'https://unifoundry.com/unifont/'
const UNIFONT_LICENSE_URL = 'https://unifoundry.com/LICENSE.txt'
const UNIFONT_COPYRIGHT =
  'Copyright © 1998-2026 Roman Czyborra, Paul Hardy, Qianqian Fang, Andrew Miller, Johnnie Weaver, David Corbett, Ælla Chiana Moskopp, Rebecca Bettencourt, Ho-Seok Ee, et al.'
const UNIFONT_EMBEDDED_LICENSE =
  'Dual license: SIL Open Font License version 1.1, and GNU GPL version 2 or later with the GNU Font Embedding Exception.'
const UNIFONT_LICENSE_URLS = 'https://gnu.org/licenses/gpl.html, https://scripts.sil.org/OFL'

/** 游戏内时钟（HH:MM，日志前缀用） */
export function gameClock(gameMs: number): string {
  const totalMin = Math.floor(gameMs / 60_000)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return `${h}:${String(m).padStart(2, '0')}`
}

/* ═══════════════ 日志面板偏好（折叠 + 类型过滤，存 localStorage） ═══════════════ */

/**
 * 日志分类**展示顺序**（2026-09-26 船长令重新分类）：战斗 / 工业 / 舰队 / 打捞四条新线在前，其余沿用。
 * ⚠ `queue` **不进本表**（它已并入 `levelup`；类型里留着只为读老日志，见 `kindOf`）。
 */
export const LOG_KINDS: readonly LogKind[] = ['combat', 'industry', 'fleet', 'salvage', 'trade', 'levelup', 'event', 'system', 'warn', 'info']

/** 老日志兼容：`queue` 一律按 `levelup`（升级）显示与筛选 */
export function kindOf(k: LogKind): LogKind {
  return k === 'queue' ? 'levelup' : k
}
export const KIND_LABEL: Record<LogKind, string> = {
  get system() { return tr("ui.App.029") },
  get info() { return tr("ui.App.030") },
  get queue() { return tr("ui.App.027") }, // 老日志兼容（新日志不再写 queue；见 state.LogKind 注释）
  get levelup() { return tr("ui.App.031") },
  get warn() { return tr("ui.App.032") },
  get trade() { return tr("ui.App.033") },
  get event() { return tr("ui.App.034") },
  // 2026-09-26 船长令新增四类
  get combat() { return tr("ui.App.154") },
  get industry() { return tr("ui.App.155") },
  get fleet() { return tr("ui.App.156") },
  get salvage() { return tr("ui.App.157") },
}

/** 分类语义（T6：与 ui index.css 的 wui-log-* 色值保持同步） */
export const KIND_DESC: Record<LogKind, string> = {
  get system() { return tr("ui.App.035") },
  get info() { return tr("ui.App.036") },
  get queue() { return tr("ui.App.037") },
  get levelup() { return tr("ui.App.038") },
  get warn() { return tr("ui.App.039") },
  get trade() { return tr("ui.App.040") },
  get event() { return tr("ui.App.041") },
  // 2026-09-26 船长令新增四类
  get combat() { return tr("ui.App.159") },
  get industry() { return tr("ui.App.160") },
  get fleet() { return tr("ui.App.161") },
  get salvage() { return tr("ui.App.162") },
}

/** 开关色点（图例）：与 `ui/index.css` 的 `--wui-log-*` 同一批 token（2026-09-22 起不再各写一份色值） */
export const KIND_DOT: Record<LogKind, string> = {
  system: 'rgb(var(--wui-purple))',
  levelup: 'rgb(var(--wui-log-levelup))',
  warn: 'rgb(var(--wui-log-warn))',
  queue: 'rgb(var(--wui-log-queue))',
  info: 'rgb(var(--wui-log-info))',
  // 色板里没有 --wui-log-trade（其余六种 log 色都有）⇒ 用既有的「贸易」色调，2026-09-24 由 token 契约抓出
  trade: 'rgb(var(--wui-tone-group-trade))',
  event: 'rgb(var(--wui-log-event))',
  // 2026-09-26 新增四类的色 token（深/浅两套见 index.css）
  combat: 'rgb(var(--wui-log-combat))',
  industry: 'rgb(var(--wui-log-industry))',
  fleet: 'rgb(var(--wui-log-fleet))',
  salvage: 'rgb(var(--wui-log-salvage))',
}

export const PREFS_KEY = 'whale-idle:log-prefs'

/**
 * **单选取值**（2026-09-26 船长令：「事件日志上方的筛选，玩家点击哪一个筛选就**只显示该筛选的内容**」）
 * —— `'all'` = 全部（默认）。
 */
export type LogFilter = LogKind | 'all'

export interface LogPrefs {
  collapsed: boolean
  /** 当前选中的筛选（旧版是"多开关 kinds" ⇒ 读档时迁移成单选，见 `readLogPrefs`） */
  filter: LogFilter
}

function defaultLogPrefs(): LogPrefs {
  return { collapsed: false, filter: 'all' }
}

/** 读取本地偏好（容错：坏了就回默认；**兼容旧版多开关** `kinds` ⇒ 迁移成单选） */
export function readLogPrefs(): LogPrefs {
  const fallback = defaultLogPrefs()
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as { collapsed?: unknown; filter?: unknown; kinds?: Record<string, boolean> }
    // 迁移：旧版只有 `kinds`（多开关）⇒ 若恰好只剩一个开着，就沿用那个作为单选；否则回「全部」
    let filter: LogFilter = 'all'
    if (typeof parsed.filter === 'string' && (parsed.filter === 'all' || LOG_KINDS.includes(parsed.filter as LogKind))) {
      filter = parsed.filter as LogFilter
    } else if (parsed.kinds && typeof parsed.kinds === 'object') {
      const on = LOG_KINDS.filter((k) => parsed.kinds?.[k] === true)
      if (on.length === 1) filter = on[0]!
    }
    return { collapsed: parsed.collapsed === true, filter }
  } catch {
    return fallback
  }
}

/**
 * **界面缩放 / 字号偏好**：读写与应用的单点统一在 `ui/uiScale.ts`（启动时由 `game/boot.ts` 的
 * `prebootRenderer()` 应用，设置面板挂载/拖动时再写一次）。本文件不再自带 `readNum` 与键名常量
 * —— 2026-11-02 之前这里另有一份实现，和启动路径各写各的，正是"字号重启后不生效"的温床。
 */

/** 设置面板（船长 2026-09-05）：界面缩放 = 整窗 zoom；字体大小 = 字号族 CSS 系数 --ui-fs；
 *  宇宙背景（2026-09-10 船长）：铺在界面最底层的无缝星图，可在此换一张；
 *  界面配色（2026-09-22 船长令）：深空/亮白/跟随系统，存本机、即时生效 */
export function SettingsPanel({
  root,
  onClose,
  engine,
  onSave,
  onReset,
  onOpenSaveManager,
  debugOnState,
  layoutKind,
  onLayoutChange,
  layoutPending,
  onApplyLayoutReload,
  onCancelLayout,
  onDebugChange,
  saveState,
  storageProbe,
  onAllowSave,
  saveFileStatus,
  saveFileBusy,
  onBindSaveFile,
  onReconnectSaveFile,
  onUnbindSaveFile,
  onRefreshSaveFileStatus,
}: {
  root: RefObject<HTMLDivElement>
  onClose: () => void
  engine: GameEngine
  /** 2026-09-25 船长令：存档三按钮移入设置 ⇒ 由 App 传入这两个动作 */
  onSave: () => void
  onReset: () => void
  onOpenSaveManager: () => void
  /** 设置里的「开发者：调试模式」开关（2026-09-25） */
  debugOnState: boolean
  onDebugChange: (on: boolean) => void
  /** 设置里的「界面布局」开关（2026-09-25 船长令：两套外壳允许在设置内切换） */
  layoutKind: LayoutKind
  onLayoutChange: (k: LayoutKind) => void
  /** 玩家已点选、但还没重启的布局（null = 没有待应用项）；设置里那个确认弹框据此显示 */
  layoutPending: LayoutKind | null
  /** 确认重开：写盘 + 存档 + 关游戏（实现在 App 层） */
  onApplyLayoutReload: () => void
  /** 取消重开：清掉待应用项 */
  onCancelLayout: () => void
  /** 存档存储状态（2026-09-25 船长令 · 甲/丁）：`paused` = 旧档读不出来、写入已挂起 */
  saveState: 'ok' | 'paused' | 'unavailable'
  storageProbe: SaveStorageProbe | null
  /** 丁：放行写入（会另起新档） */
  onAllowSave: () => void
  /** 网页版「本地存档文件」绑定状态（桌面端 ⇒ null；2026-09-25 船长令） */
  saveFileStatus: SaveFileStatus | null
  saveFileBusy: boolean
  onBindSaveFile: () => void
  onReconnectSaveFile: () => void
  onUnbindSaveFile: () => void
  /** 打开设置时自报一次绑定状态（权限可能被浏览器收回） */
  onRefreshSaveFileStatus: () => void
}) {
  const { locale, setLocale, t } = useL10n()
  const [zoom, setZoom] = useState(readZoom)
  const [fs, setFs] = useState(readFontScale)
  /**
   * **界面字体**（**2026-11-02 船长令**）：本机偏好、即时生效、不进存档。
   * 挂载时读一次（`readFontChoice`），切换时写一次（`selectFont` ⇒ `chooseFont` 落盘 + 应用）；
   * 启动时的应用由 `game/boot.ts` 的 `prebootRenderer()` 统一接线，这里不重复。
   */
  const [font, setFont] = useState<FontChoice>(() => readFontChoice())
  /** 「许可与授权」全文弹窗（2026-11-02 船长令：设置最下方一枚按钮 ⇒ 完整授权书） */
  const [licenseOpen, setLicenseOpen] = useState(false)
  /** 声音（2026-11-02 船长令）：总音量/静音/分类音量，本机偏好、即时生效、不进存档 */
  const sfx = useSfxPrefs()
  const [sfxConsoleOpen, setSfxConsoleOpen] = useState(false)
  /* 界面配色（2026-09-22 船长令「添加几套配色供玩家切换」）：存本机、即时生效、支持跟随系统 */
  const [theme, setTheme, effectiveTheme] = useTheme()
  /**
   * **弹药 / 修理组件取用来源**（**2026-09-23 船长令**：「做一个开关，开启时，所有船的弹药和修理组件
   * 直接从仓库取用。关闭后只从舰队内舰船的货仓取用。」）。
   * ⚠ 这是**随档**开关（写进 `state` 并落档），不是本机偏好——洞内取料要用它。
   */
  const [resupply, setResupply] = useState(() => engine.state.resupplyFromWarehouse !== false)
  function toggleResupply(next: boolean): void {
    setResupply(next)
    engine.state.resupplyFromWarehouse = next
    void engine.persist()
  }
  /** 点选界面字体：先更新面板显示，再走 `ui/fontChoice.ts` 的「落盘 + 即时应用」单点 */
  function selectFont(next: FontChoice): void {
    setFont(next)
    chooseFont(next)
  }

  /** 打开设置时自报一次「本地存档文件」绑定状态（浏览器可能已收回权限 ⇒ 界面要如实显示） */
  useEffect(() => {
    onRefreshSaveFileStatus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  /** 当前宇宙底图（模块级状态：关闭设置再打开仍是同一张） */
  const [bg, setBg] = useState<SpaceBgInfo | null>(() => currentSpaceBg())
  /**
   * **客户端版本行**（**2026-10-02 船长令**「版本号可以落码」）：值与形态由构建时注入，
   * 这里只负责拼那一行 + 一键复制（复制成功的提示复用 `ui.App.044`，1.8 秒后自己变回来）。
   */
  const [copiedVersion, setCopiedVersion] = useState(false)
  function clientVersionLine(): string {
    return tr('ui.App.169', {
      p1: BUILD.version,
      p2: BUILD.time,
      p3: BUILD.sha,
      p4: BUILD_FORM === 'web' ? tr('ui.App.172') : tr('ui.App.173'),
    })
  }
  async function copyClientVersion(): Promise<void> {
    const text = clientVersionLine()
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      /** 兜底（与性能 HUD 的「复制报告」同一套：剪贴板 API 不可用时走 execCommand） */
      const ta = document.createElement('textarea')
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
    }
    setCopiedVersion(true)
    window.setTimeout(() => setCopiedVersion(false), 1800)
  }
  /**
   * 整窗缩放写在 `.app-root` 上；**字号系数 `--ui-fs` 必须落在 `<html>`（`:root`）**——
   * 2026-11-02 起 `--wui-fs-*` 字阶令牌改成 `calc(Npx * var(--ui-fs, 1))`，变量要在令牌声明处
   * （`:root`）能解析；写在 `.app-root` 上解析不到，字号滑块会失效。两处写法都收在 `ui/uiScale.ts`。
   */
  useEffect(() => {
    const el = root.current
    applyFontScale(fs)
    if (!el) return
    applyZoom(el, zoom)
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
        <div className="app-settings-title">{t('ui.App.010')}</div>
        <div className="app-settings-sub">
          {t('ui.App.011')}
        </div>
        <div className="app-settings-list">
          {/**
           * **客户端版本**（**2026-10-02 船长令**：「**建议在设置里给游戏添加版本号，否则无法判断玩家
           * 当前版本**」）—— 船长三问裁定：值 = 版本号 · 构建 sha · 构建日期 · 运行形态；本批只做显示；
           * 命名用「客户端版本」（避开游戏内已有的「版本号」＝铁人档世代号）；**放最上方**（第一眼就能读到）。
           * 值由构建时注入（`game/buildInfo.ts` 读、`tools/build-info.ts` 注入）；
           * 「复制」走与性能 HUD 同一套写法（`navigator.clipboard` ＋ execCommand 兜底），
           * 复制成功的提示**复用 `ui.App.044`「✓ 已复制」**（不新造同义串）。
           */}
          <div className="app-settings-row">
            <div className="app-settings-head">
              <span className="app-settings-label">{t('ui.App.168')}</span>
              <span className="app-settings-val">{clientVersionLine()}</span>
            </div>
            <div className="app-settings-btns">
              <button className="app-btn is-small" onClick={() => void copyClientVersion()}>
                {copiedVersion ? tr('ui.App.044') : tr('ui.App.171')}
              </button>
            </div>
            <div className="app-settings-desc">{t('ui.App.170')}</div>
          </div>
          {/* 语言（2026-09-19 船长令「英语本地化」）：默认跟随系统，这里可随时覆盖；语言不进存档 */}
          <div className="app-settings-row">
            <div className="app-settings-head">
              <span className="app-settings-label">{t('ui.App.025')}</span>
              <span className="app-settings-val">{locale === 'zh' ? tr("ui.App.042") : 'English'}</span>
            </div>
            <div className="app-settings-btns">
              <button
                className={`app-btn is-small${locale === 'zh' ? ' is-primary' : ''}`}
                onClick={() => setLocale('zh')}
              >
                {tr("ui.App.042")}
              </button>
              <button
                className={`app-btn is-small${locale === 'en' ? ' is-primary' : ''}`}
                onClick={() => setLocale('en')}
              >
                English
              </button>
            </div>
            <div className="app-settings-desc">{t('ui.App.026')}</div>
          </div>
          {/* 界面布局（2026-09-25 船长令；2026-11-02 优化：新版全面升级为科幻未来）：本机偏好、即时生效、不进存档 */}
          <div className="app-settings-row">
            <div className="app-settings-head">
              <span className="app-settings-label">{t('ui.App.146')}</span>
              <span className="app-settings-val">{layoutKind === 'classic' ? tr('ui.App.148') : tr('ui.App.177')}</span>
            </div>
            <div className="app-settings-btns">
              <button
                className={`app-btn is-small${layoutKind === 'modern' || layoutKind === 'cosmic' ? ' is-primary' : ''}`}
                onClick={() => onLayoutChange('modern')}
              >
                {tr('ui.App.177')}
              </button>
              <button
                className={`app-btn is-small${layoutKind === 'classic' ? ' is-primary' : ''}`}
                onClick={() => onLayoutChange('classic')}
              >
                {tr('ui.App.148')}
              </button>
            </div>
            <div className="app-settings-desc">{t('ui.App.149')}</div>
          </div>
          {/* 弹药 / 修理组件取用来源（2026-09-23 船长令）：随档开关，洞内同理 */}
          <div className="app-settings-row">
            <div className="app-settings-head">
              <span className="app-settings-label">{t('ui.App.137')}</span>
              <span className="app-settings-val">{resupply ? tr('ui.App.138') : tr('ui.App.139')}</span>
            </div>
            <div className="app-settings-btns">
              <button
                className={`app-btn is-small${resupply ? ' is-primary' : ''}`}
                onClick={() => toggleResupply(true)}
              >
                {tr('ui.App.138')}
              </button>
              <button
                className={`app-btn is-small${!resupply ? ' is-primary' : ''}`}
                onClick={() => toggleResupply(false)}
              >
                {tr('ui.App.139')}
              </button>
            </div>
            <div className="app-settings-desc">{t('ui.App.140')}</div>
          </div>
          <div className="app-settings-row">
            <div className="app-settings-head">
              <span className="app-settings-label">{t('ui.App.012')}</span>
              <span className="app-settings-val">{Math.round(zoom * 100)}%</span>
            </div>
            <input className="app-settings-slider" type="range" min={ZOOM_MIN} max={ZOOM_MAX} step={0.05} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
            <div className="app-settings-desc">{t('ui.App.013')}</div>
          </div>
          <div className="app-settings-row">
            <div className="app-settings-head">
              <span className="app-settings-label">{t('ui.App.014')}</span>
              <span className="app-settings-val">{Math.round(fs * 100)}%</span>
            </div>
            <input className="app-settings-slider" type="range" min={FS_MIN} max={FS_MAX} step={0.05} value={fs} onChange={(e) => setFs(Number(e.target.value))} />
            <div className="app-settings-desc">{t('ui.App.015')}</div>
          </div>
          {/**
           * **界面字体**（**2026-11-02 船长令**：「增加一个字体选择的功能在设置界面」）：放「字体大小」正下方，
           * 交互与同页「语言 / 界面布局 / 界面配色」三行一致（`app-settings-row` ＋ `app-btn is-small`，
           * 选中项 `is-primary`）。两项：默认（现有系统字体栈，行为与改动前一致）与 GNU Unifont
           * （内嵌像素点阵全字库，授权全文见本页最下方「许可与授权」）。本机偏好、即时生效、不进存档。
           */}
          <div className="app-settings-row">
            <div className="app-settings-head">
              <span className="app-settings-label">{t('ui.App.178')}</span>
              <span className="app-settings-val">{font === 'unifont' ? 'GNU Unifont' : t('ui.App.179')}</span>
            </div>
            <div className="app-settings-btns">
              <button
                className={`app-btn is-small${font === 'default' ? ' is-primary' : ''}`}
                onClick={() => selectFont('default')}
              >
                {t('ui.App.179')}
              </button>
              <button
                className={`app-btn is-small${font === 'unifont' ? ' is-primary' : ''}`}
                onClick={() => selectFont('unifont')}
              >
                GNU Unifont
              </button>
            </div>
            <div className="app-settings-desc">{t('ui.App.180')}</div>
          </div>
          {/* 界面配色（2026-09-22 船长令）：与上一行「语言」同款按钮组；三套主题见 ui/theme.ts */}
          <div className="app-settings-row">
            <div className="app-settings-head">
              <span className="app-settings-label">{t('ui.App.127')}</span>
              <span className="app-settings-val">{t(THEME_LABEL_ID[theme])}</span>
            </div>
            <div className="app-settings-btns">
              {THEME_CHOICES.map((c) => (
                <button
                  key={c}
                  className={`app-btn is-small${theme === c ? ' is-primary' : ''}`}
                  onClick={() => setTheme(c)}
                >
                  {t(THEME_LABEL_ID[c])}
                </button>
              ))}
            </div>
            <div className="app-settings-desc">{t('ui.App.132')}</div>
          </div>
          {/**
           * **声音**（**2026-11-02 船长令**：「现在这个项目没有声音介入…方便我接入我做的音效」）：
           * 总音量 + 一键静音 + 四类分类音量；本机偏好（`localStorage`，与语言/缩放/主题同族），
           * **不进存档**。本机调试门禁放行时多一枚「音效台」入口（拖入素材即生效，见 `SfxConsole`）。
           */}
          <div className="app-settings-row">
            <div className="app-settings-head">
              <span className="app-settings-label">{t('ui.sfx.030')}</span>
              <span className="app-settings-val">
                {sfx.prefs.muted ? t('ui.sfx.033') : `${Math.round(sfx.prefs.master * 100)}%`}
              </span>
            </div>
            <div className="app-settings-btns">
              <button
                className={`app-btn is-small${sfx.prefs.muted ? ' is-warn' : ''}`}
                onClick={() => sfx.setMuted(!sfx.prefs.muted)}
              >
                {t('ui.sfx.032')}
              </button>
              {debugAllowed() ? (
                <button className="app-btn is-small" onClick={() => setSfxConsoleOpen(true)}>
                  {t('ui.sfx.037')}
                </button>
              ) : null}
            </div>
            <div className="app-settings-desc">{t('ui.sfx.036')}</div>
          </div>
          <div className="app-settings-row">
            <div className="app-settings-head">
              <span className="app-settings-label">{t('ui.sfx.031')}</span>
              <span className="app-settings-val">{Math.round(sfx.prefs.master * 100)}%</span>
            </div>
            <input
              className="app-settings-slider"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={sfx.prefs.master}
              disabled={sfx.prefs.muted}
              onChange={(e) => sfx.setMaster(Number(e.target.value))}
            />
            <div className="app-settings-desc">{t('ui.sfx.035')}</div>
          </div>
          {SFX_CATEGORIES.map((cat) => (
            <div className="app-settings-row" key={cat}>
              <div className="app-settings-head">
                <span className="app-settings-label">{t(SFX_CATEGORY_NAME_ID[cat])}</span>
                <span className="app-settings-val">{Math.round(sfx.prefs.categories[cat] * 100)}%</span>
              </div>
              <input
                className="app-settings-slider"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={sfx.prefs.categories[cat]}
                disabled={sfx.prefs.muted}
                onChange={(e) => sfx.setCategory(cat, Number(e.target.value))}
              />
            </div>
          ))}
          {/**
           * **战斗音效音高随机**（**2026-11-02 追加批 · 船长口径**：「1200 音分的八度里上下浮动 100 音分」）：
           * 只作用于战斗里重复发生的音效（开火 / 命中 / 受击 / 未命中 / 敌方开火 / 机群击落）；
           * 一次性重音与 BGM/环境不抖。0 = 关闭，默认 ±100 音分（= ±1 个半音），滑条可调小。
           */}
          <div className="app-settings-row">
            <div className="app-settings-head">
              <span className="app-settings-label">{t('ui.sfx.060')}</span>
              <span className="app-settings-val">
                {sfx.prefs.pitchJitterCents > 0
                  ? t('ui.sfx.065', { p1: sfx.prefs.pitchJitterCents, p2: (sfx.prefs.pitchJitterCents / 100).toFixed(2) })
                  : t('ui.sfx.063')}
              </span>
            </div>
            <div className="app-settings-btns">
              <button
                className={`app-btn is-small${sfx.prefs.pitchJitterCents > 0 ? ' is-primary' : ''}`}
                onClick={() => sfx.setPitchJitter(100)}
              >
                {t('ui.sfx.062')}
              </button>
              <button
                className={`app-btn is-small${sfx.prefs.pitchJitterCents === 0 ? ' is-primary' : ''}`}
                onClick={() => sfx.setPitchJitter(0)}
              >
                {t('ui.sfx.063')}
              </button>
            </div>
            <input
              className="app-settings-slider"
              type="range"
              min={0}
              max={100}
              step={5}
              value={sfx.prefs.pitchJitterCents}
              disabled={sfx.prefs.muted}
              onChange={(e) => sfx.setPitchJitter(Number(e.target.value))}
            />
            <div className="app-settings-desc">{t('ui.sfx.061')}</div>
          </div>
          <div className="app-settings-row">
            <div className="app-settings-head">
              <span className="app-settings-label">{t('ui.App.016')}</span>
              <span className="app-settings-val">{bg ? currentSpaceBg()?.label : t('ui.App.017')}</span>
            </div>
            <div className="app-settings-btns">
              <button
                className="app-btn is-small"
                onClick={() => setBg(rerollSpaceBg())}
                disabled={!bg || !themeUsesSpacePhoto(effectiveTheme)}
                title={t('ui.App.019')}
              >
                {t('ui.App.018')}
              </button>
            </div>
            <div className="app-settings-desc">
              {!themeUsesSpacePhoto(effectiveTheme)
                ? t('ui.App.133')
                : bg
                  ? t('ui.App.020', { n: bg.total })
                  : t('ui.App.021')}
            </div>
          </div>
          {/*
           * **开发者：调试模式**（2026-09-25 加）：船长反馈「已开启调试模式，调试按钮依旧不可见」
           * —— 根因是开关设在**另一个 origin**（DevTools 里那行 localStorage 落在浏览器侧，桌面端读不到）。
           * 这里给一个**不依赖 DevTools** 的开关：改完立即生效（顶栏出现「⇄ 调试」「⏱ 性能」），无需重开。
           *
           * ⚠ **只有本机才渲染这一行**（2026-09-25 船长令：「只有本地开启，上传后的版本都是关闭隐藏的」）：
           * 门禁见 `game/debugFlag.ts` + `@whale/core` 的 `isLocalDebugOrigin`（公网域名与桌面打包版的
           * `file:` 一律算发布版）⇒ 发布版里这一行根本不出现，顶栏那两枚按钮也不会出现。
           */}
          {debugAllowed() ? (
            <div className="app-settings-row">
              <div className="app-settings-head">
                <span className="app-settings-label">{tr('ui.App.141')}</span>
                <span className="app-settings-btns">
                  <button
                    className={`app-btn is-small${debugOnState ? ' is-warn' : ''}`}
                    onClick={() => {
                      const next = !debugOnState
                      setDebugEnabled(next)
                      onDebugChange(next)
                    }}
                  >
                    {debugOnState ? tr('ui.App.143') : tr('ui.App.142')}
                  </button>
                </span>
              </div>
              <div className="app-settings-desc">{tr('ui.App.144')}</div>
            </div>
          ) : null}
          {debugAllowed() && debugOnState ? <div className="app-settings-row"><div className="app-settings-head"><label className="app-settings-label"><input type="checkbox" checked={futureWormholeEnabled()} onChange={e => { setFutureWormholeEnabled(e.target.checked); onDebugChange(debugOnState) }} />{tr('ui.explorationName.019')}</label></div><div className="app-settings-desc">{tr('ui.explorationName.018')}</div></div> : null}
          {/**
           * **存档一组**（2026-09-25 船长令：「将存档管理，重置档案，保存移动到设置内」）
           * —— 这三个按钮原先在顶栏右侧，与本组功能同类（都作用于存档）⇒ 归到设置里。
           *
           * 2026-09-25 追加（船长令 · 甲/丁）：本组顶部加一行**存储状态**——网页版的存档在浏览器里，
           * 浏览器不给写时必须让玩家看见（MacBook · Safari 报障那批）；旧档读不出来时在这里放行写入。
           */}
          <div className="app-settings-row">
            <div className="app-settings-head">
              <span className="app-settings-label">{tr('ui.saveGuard.001')}</span>
              <span className="app-settings-btns">
                {saveState === 'paused' ? (
                  <button className="app-btn is-small is-warn" onClick={onAllowSave}>
                    {tr('ui.saveGuard.011')}
                  </button>
                ) : null}
                {/* 网页版「本地存档文件」（2026-09-25 船长令）：绑定一次后每次落盘都写进那个文件；
                    本浏览器不支持（Safari/Firefox 没有 File System Access）⇒ 按钮禁用、说明写在悬停里。 */}
                {saveFileStatus !== null ? (
                  !saveFileStatus.supported ? (
                    <button className="app-btn is-small" disabled title={tr('ui.saveGuard.020')}>
                      {tr('ui.saveGuard.015')}
                    </button>
                  ) : !saveFileStatus.bound ? (
                    <button className="app-btn is-small" disabled={saveFileBusy} onClick={onBindSaveFile} title={tr('ui.saveGuard.027')}>
                      {tr('ui.saveGuard.015')}
                    </button>
                  ) : (
                    <>
                      {!saveFileStatus.connected ? (
                        <button className="app-btn is-small is-warn" disabled={saveFileBusy} onClick={onReconnectSaveFile}>
                          {tr('ui.saveGuard.016')}
                        </button>
                      ) : null}
                      <button className="app-btn is-small" disabled={saveFileBusy} onClick={onUnbindSaveFile}>
                        {tr('ui.saveGuard.017')}
                      </button>
                    </>
                  )
                ) : null}
              </span>
            </div>
            <div className="app-settings-desc">
              {storageProbe === null
                ? tr('ui.saveGuard.003')
                : `${storageProbe.kind === 'file' ? tr('ui.saveGuard.002') : tr('ui.saveGuard.003')} · ${
                    storageProbe.ok ? tr('ui.saveGuard.004') : tr('ui.saveGuard.005')
                  }${
                    storageProbe.kind === 'browser' && storageProbe.ok && storageProbe.persisted !== null
                      ? ` · ${storageProbe.persisted ? tr('ui.saveGuard.006') : tr('ui.saveGuard.007')}`
                      : ''
                  }${saveState === 'paused' ? ` · ${tr('ui.saveGuard.012')}` : ''}`}
              {saveFileStatus !== null
                ? ` · ${tr('ui.saveGuard.013')} ${
                    !saveFileStatus.supported
                      ? tr('ui.saveGuard.020')
                      : !saveFileStatus.bound
                        ? tr('ui.saveGuard.014')
                        : `${saveFileStatus.name ?? ''} · ${
                            saveFileStatus.connected ? tr('ui.saveGuard.018') : tr('ui.saveGuard.019')
                          }`
                  }`
                : ''}
            </div>
          </div>
          <div className="app-settings-row">
            <div className="app-settings-head">
              <span className="app-settings-label">{tr('ui.App.063')}</span>
            </div>
            <div className="app-settings-btns">
              <button className="app-btn is-small" onClick={onSave}>
                {tr('ui.App.063')}
              </button>
              <button
                className="app-btn is-small"
                title={tr('ui.App.064')}
                onClick={() => {
                  onOpenSaveManager()
                  onClose()
                }}
              >
                {tr('ui.App.065')}
              </button>
              <button
                className="app-btn is-small is-danger"
                onClick={() => {
                  onClose()
                  onReset()
                }}
              >
                {tr('ui.App.066')}
              </button>
            </div>
          </div>
        </div>
        {/* **切换界面布局 ⇒ 提示重开**（2026-09-25 船长令）：确认后存档并关游戏；取消则什么都不做 */}
        {layoutPending !== null ? (
          <div className="app-modal-mask" onClick={onCancelLayout}>
            <div className="app-modal" style={{ width: 460 }} onClick={(e) => e.stopPropagation()}>
              <div className="app-modal-head">
                <span className="app-report-title">{t('ui.App.150')}</span>
              </div>
              <div className="app-modal-body">
                <div className="app-note">{t('ui.App.151')}</div>
                <div className="app-wh-actions">
                  <button className="app-btn is-primary" onClick={onApplyLayoutReload}>
                    {tr('ui.App.152')}
                  </button>
                  <button className="app-btn is-small" onClick={onCancelLayout}>
                    {tr('ui.App.100')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}
        <div className="app-settings-foot">
          <span className="app-dim">{t('ui.App.022')}</span>
          <span className="app-settings-btns">
            {/* 许可与授权（2026-11-02 船长令：设置最下方一枚按钮，弹窗列出授权书全文） */}
            <button className="app-btn is-small" onClick={() => setLicenseOpen(true)}>
              {t('ui.App.181')}
            </button>
            <button className="app-btn is-small" onClick={() => { setZoom(1); setFs(1); selectFont('default') }}>
              {t('ui.App.023')}
            </button>
            <button
              className="app-btn is-small is-primary"
              onClick={() => {
                persist()
                onClose()
              }}
            >
              {t('ui.App.024')}
            </button>
          </span>
        </div>
        {/**
         * 本机音效台（2026-11-02）：仅本机调试门禁放行时才有入口（`debugAllowed()`），发布版不渲染。
         * ⚠ **必须用 Portal 挂到 `document.body`**：设置弹窗在「科幻未来 / 宇宙」布局下有 `clip-path`
         * （见 `styles.css` 的 `.app-root.is-layout-modern .app-settings-modal`），嵌套的 fixed 弹层
         * 会被父级裁掉 ⇒ 同款问题另一批的许可全文弹窗已踩过（`appSettings.css` 头注）。
         */}
        {sfxConsoleOpen ? createPortal(<SfxConsole onClose={() => setSfxConsoleOpen(false)} />, document.body) : null}
      </div>
      {/**
       * 许可与授权全文弹窗（2026-11-02 船长令）：渲染在设置弹窗**之外的兄弟层**（仍在本遮罩内），
       * 避免「科幻未来」布局给 `.app-settings-modal` 加的 `clip-path` 把嵌套弹层裁掉；
       * 点击遮罩先 `stopPropagation`，否则会顺带把设置面板一起关掉。
       */}
      {licenseOpen ? <LicenseModal onClose={() => setLicenseOpen(false)} /> : null}
    </div>
  )
}

/* ═══════════════ 许可与授权（2026-11-02 船长令：设置最下方按钮 ＋ 授权书全文弹窗） ═══════════════ */

/**
 * **许可与授权全文弹窗**（只读；内容可滚动、不塞摘要、不拿外链顶替正文）。
 *
 * 船长原话：「这个字体是GNU授权，记得在设置的最最下方增加一个许可按钮把这些授权书内容统统都写进入」。
 * 正文**照录原文**（法律文字不译、不改写、不缩写）；中文只用于小节标题与「版本 / 来源 URL / 日期」。
 *
 * 采用的授权口径（2026-11-02 核实）：
 * ① **GNU Unifont 18.0.01**（内嵌 `unifont-18.0.01.otf`）——编译字体为**双许可**：
 *    SIL Open Font License 1.1 ＋ GNU GPL 第 2 版或更高版本（附 GNU 字体嵌入例外）。
 *    依据：官方发布页 <https://unifoundry.com/unifont/> 与官方授权原文
 *    <https://unifoundry.com/LICENSE.txt>（该文件同时收录 GPLv2 全文、字体嵌入例外与 OFL 1.1 全文，
 *    本弹窗整份照录）；字体文件 name 表内嵌的版权与许可描述也一并在弹窗里给出（见常量）。
 * ② **本项目自身**：根目录 `LICENSE.txt`（版权与授权声明）与根目录 `LICENSE`
 *    （双许可与商业使用条款：AGPLv3 开源 ＋ 商业许可，含 AGPLv3 全文）。
 *    ⚠ 按船长 2026-11-02 追加要求，游戏内这两份声明的**副本**不展示「原项目 / 原站」外部链接
 *    （含英文条款里的原仓库链接），其余照录；根目录原文不改，发行包仍用原文。
 *    ⚠ 同批裁定：个人主页署名链接保留；声明里指代「原项目」的那句改为「请联系作者」（只改副本）。
 * ③ 第三方组件（React、React DOM、Scheduler、Lucide、PixelPlanets 素材等）分别遵循各自的许可证。
 *
 * 文本以 `?raw` 内联（Vite 会随桌面/网页两个入口一起打包），不额外发网络请求。
 */
function LicenseModal({ onClose }: { onClose: () => void }) {
  const { t } = useL10n()
  return (
    <div
      className="app-modal-mask app-license-mask"
      onClick={(e) => {
        e.stopPropagation()
        onClose()
      }}
    >
      <div className="app-modal app-license-modal" onClick={(e) => e.stopPropagation()}>
        <div className="app-modal-head">
          <span className="app-report-title">{t('ui.App.181')}</span>
          <button className="app-btn is-small" onClick={onClose}>
            {t('ui.App.183')}
          </button>
        </div>
        <div className="app-modal-body app-license-body">
          <div className="app-license-intro">{t('ui.App.182')}</div>
          <section className="app-license-section">
            <h3 className="app-license-h">{t('ui.App.184')}</h3>
            <div className="app-license-meta">
              {t('ui.App.185', {
                p1: UNIFONT_VERSION,
                p2: UNIFONT_FONT_FILE,
                p3: UNIFONT_COPYRIGHT,
                p4: UNIFONT_HOME_URL,
                p5: UNIFONT_LICENSE_URL,
              })}
            </div>
            <h4 className="app-license-subh">{t('ui.App.186')}</h4>
            <pre className="app-license-pre">{`${UNIFONT_EMBEDDED_LICENSE}\n${UNIFONT_LICENSE_URLS}`}</pre>
            <h4 className="app-license-subh">{t('ui.App.187')}</h4>
            <pre className="app-license-pre">{unifontLicenseText}</pre>
          </section>
          <section className="app-license-section">
            <h3 className="app-license-h">{t('ui.App.188')}</h3>
            <h4 className="app-license-subh">{t('ui.App.189')}</h4>
            <pre className="app-license-pre">{projectLicenseStatement}</pre>
            <h4 className="app-license-subh">{t('ui.App.190')}</h4>
            <pre className="app-license-pre">{projectLicenseDual}</pre>
            <div className="app-license-note">{t('ui.App.191')}</div>
          </section>
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
export function PerfListener({ engine, force }: { engine: GameEngine; force: () => void }) {
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
export function PerfHud({ onClose }: { onClose: () => void }) {
  const [, bump] = useReducer((n: number) => n + 1, 0)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    const iv = window.setInterval(bump, 1_000)
    return () => window.clearInterval(iv)
  }, [])
  function fmtBox(b?: { n: number; sumMs: number; maxMs: number }): string {
    if (!b || b.n === 0) return '—'
    return tr("ui.App.105", { p1: (b.sumMs / b.n).toFixed(2), p2: b.maxMs.toFixed(1), p3: b.n })
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
        {tr("ui.App.043")} {wallS}s · FPS ≈{fps}
        <button className="app-btn is-small" onClick={() => void doCopy()}>
          {copied ? tr("ui.App.044") : tr("ui.App.045")}
        </button>
        <button className="app-btn is-small" onClick={onClose}>
          ✕
        </button>
      </div>
      {t ? (
        <>
          <div className="app-perf-hud-line">
            <span>{tr("ui.App.046")}</span>
            <span>{fmtBox(t.adv.idle)}</span>
          </div>
          <div className="app-perf-hud-line">
            <span>{tr("ui.App.047")}</span>
            <span>{fmtBox(t.adv.battle)}</span>
          </div>
          <div className="app-perf-hud-line">
            <span>{tr("ui.App.048")}</span>
            <span>{fmtBox(t.notify.idle)}</span>
          </div>
          <div className="app-perf-hud-line">
            <span>{tr("ui.App.049")}</span>
            <span>{fmtBox(t.notify.battle)}</span>
          </div>
          <div className="app-perf-hud-line">
            <span>{tr("ui.App.050")}</span>
            <span>{fmtBox(t.commit)}</span>
          </div>
          <div className="app-perf-hud-line">
            <span>{tr("ui.App.051")}</span>
            <span>{tr('ui.App.101', { n: t.long.n })}{t.long.n > 0 ? tr('ui.App.102', { ms: t.long.maxMs.toFixed(0) }) : ''}</span>
          </div>
        </>
      ) : null}
      <div className="app-dim app-perf-hud-tip">{tr("ui.App.052")}</div>
    </div>
  )
}

