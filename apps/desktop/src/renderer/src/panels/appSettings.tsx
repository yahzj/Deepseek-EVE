/**
 * 主界面 · 设置与日志/性能浮层域（2026-10-02 从 `App.tsx` 拆出 · 批次 4t · 零行为变化）。
 *
 * 本文件 = 事件日志的偏好域（时钟/分类表/过滤偏好，localStorage 落盘）、设置面板（缩放/字号/背景/配色/
 * 存档/调试/布局）、性能浮层（PerfListener / PerfHud）。`App.tsx` 借回使用（先例：fitted.ts），
 * 本模块不 import App ⇒ 运行期零回边。
 */
import { useEffect, useReducer, useState } from 'react'
import type { RefObject } from 'react'
import { flushSync } from 'react-dom'
import type { LogKind } from '@whale/core'
import { perfHub } from '../game/perf'
import type { SaveStorageProbe } from '../game/saveGuard'
import { debugAllowed, setDebugEnabled } from '../panels/DebugPanel'
import { THEME_CHOICES, THEME_LABEL_ID, themeUsesSpacePhoto, useTheme } from '../ui/theme'
import { currentSpaceBg, rerollSpaceBg } from '../ui/spaceBg'
import type { SpaceBgInfo } from '../ui/spaceBg'
import type { LayoutKind } from '../ui/AppShell'
import { tr, useL10n } from '../i18n/locale'
import type { GameEngine } from '../game/engine'

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
  system: tr("ui.App.029"),
  info: tr("ui.App.030"),
  queue: tr("ui.App.027"), // 老日志兼容（新日志不再写 queue；见 state.LogKind 注释）
  levelup: tr("ui.App.031"),
  warn: tr("ui.App.032"),
  trade: tr("ui.App.033"),
  event: tr("ui.App.034"),
  // 2026-09-26 船长令新增四类
  combat: tr("ui.App.154"),
  industry: tr("ui.App.155"),
  fleet: tr("ui.App.156"),
  salvage: tr("ui.App.157"),
}

/** 分类语义（T6：与 ui index.css 的 wui-log-* 色值保持同步） */
export const KIND_DESC: Record<LogKind, string> = {
  system: tr("ui.App.035"),
  info: tr("ui.App.036"),
  queue: tr("ui.App.037"),
  levelup: tr("ui.App.038"),
  warn: tr("ui.App.039"),
  trade: tr("ui.App.040"),
  event: tr("ui.App.041"),
  // 2026-09-26 船长令新增四类
  combat: tr("ui.App.159"),
  industry: tr("ui.App.160"),
  fleet: tr("ui.App.161"),
  salvage: tr("ui.App.162"),
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
/** 字号上限（2026-09-22 船长令「按推荐来」：读数显示 82% 的文字 ≤12px，先把上限从 125% 放到 150%，
 *  **不动默认字号** ⇒ 排版与"一级页不滚"零风险） */
const ZOOM_MAX_FS = 1.5

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
  onBindSaveFile: () => void
  onReconnectSaveFile: () => void
  onUnbindSaveFile: () => void
  /** 打开设置时自报一次绑定状态（权限可能被浏览器收回） */
  onRefreshSaveFileStatus: () => void
}) {
  const { locale, setLocale, t } = useL10n()
  const [zoom, setZoom] = useState(() => readNum(ZOOM_KEY, 1, 0.8, 1.25))
  const [fs, setFs] = useState(() => readNum(FS_KEY, 1, 0.85, ZOOM_MAX_FS))
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

  /** 打开设置时自报一次「本地存档文件」绑定状态（浏览器可能已收回权限 ⇒ 界面要如实显示） */
  useEffect(() => {
    onRefreshSaveFileStatus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
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
        <div className="app-settings-title">{t('ui.App.010')}</div>
        <div className="app-settings-sub">
          {t('ui.App.011')}
        </div>
        <div className="app-settings-list">
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
          {/* 界面布局（2026-09-25 船长令：新旧两套界面允许玩家在设置内切换）：本机偏好、即时生效、不进存档 */}
          <div className="app-settings-row">
            <div className="app-settings-head">
              <span className="app-settings-label">{t('ui.App.146')}</span>
              <span className="app-settings-val">{layoutKind === 'classic' ? tr('ui.App.148') : tr('ui.App.147')}</span>
            </div>
            <div className="app-settings-btns">
              <button
                className={`app-btn is-small${layoutKind === 'modern' ? ' is-primary' : ''}`}
                onClick={() => onLayoutChange('modern')}
              >
                {`${tr('ui.App.147')}${tr('ui.App.153')}`}
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
            <input className="app-settings-slider" type="range" min={0.8} max={1.25} step={0.05} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
            <div className="app-settings-desc">{t('ui.App.013')}</div>
          </div>
          <div className="app-settings-row">
            <div className="app-settings-head">
              <span className="app-settings-label">{t('ui.App.014')}</span>
              <span className="app-settings-val">{Math.round(fs * 100)}%</span>
            </div>
            <input className="app-settings-slider" type="range" min={0.85} max={ZOOM_MAX_FS} step={0.05} value={fs} onChange={(e) => setFs(Number(e.target.value))} />
            <div className="app-settings-desc">{t('ui.App.015')}</div>
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
          <div className="app-settings-row">
            <div className="app-settings-head">
              <span className="app-settings-label">{t('ui.App.016')}</span>
              <span className="app-settings-val">{bg ? bg.label : t('ui.App.017')}</span>
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
                    <button className="app-btn is-small" onClick={onBindSaveFile} title={tr('ui.saveGuard.027')}>
                      {tr('ui.saveGuard.015')}
                    </button>
                  ) : (
                    <>
                      {!saveFileStatus.connected ? (
                        <button className="app-btn is-small is-warn" onClick={onReconnectSaveFile}>
                          {tr('ui.saveGuard.016')}
                        </button>
                      ) : null}
                      <button className="app-btn is-small" onClick={onUnbindSaveFile}>
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
            <button className="app-btn is-small" onClick={() => { setZoom(1); setFs(1) }}>
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

