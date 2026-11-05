/**
 * **本机音效台 / 声音调试台**（2026-11-02 船长令：「留一个后台我可以快速添加音效的入口」；
 * 2026-11-04 调试批：放大成居中大窗 + 页签，增加场景预演 / 实时触发 / 一键入库）。
 *
 * 只在本机调试门禁放行时出现（入口：设置 →「声音」分组，以及调试模式顶栏「♪ 声音」）。
 * 页签：
 * - **素材清单**：列出全部语义事件与当前来源（本机覆盖 / 仓库内置 / 未接入），逐条试听、导入、清除；
 * - **场景预演**：五个场景卡片（BGM / 环境底噪 / 相关事件），可「切到此场景的声音」（只切音频，
 *   不动存档与画面）与「恢复真实场景」；
 * - **实时触发**：滚动显示最近真实触发的语义 id（试听不算），可暂停/继续/清空，边看画面边锚定声音；
 * - **入库**：桌面开发版「一键入库」直接写仓库 assets（成功后自动清掉已入库的本机覆盖），
 *   网页版保留「导出正式入库包」+ 仓库根 `npm run audio:install`。
 *
 * 存储：本机覆盖进 IndexedDB（`game/audio/overrides.ts`），**不进存档、不进 git、不随发布**；
 * 存储不可用时退化为本次会话有效，面板底部会如实标注。
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { SfxCueId } from '../game/audio/cues'
import {
  clearSfxOverrides,
  deleteSfxOverride,
  listSfxOverrideFiles,
  putSfxOverride,
  sfxOverrideStorageMode,
  subscribeSfxOverrides,
} from '../game/audio/overrides'
import {
  SFX_CATEGORY_NAME_ID,
  SFX_CONSOLE_GROUPS,
  SFX_CUES,
  SFX_CUE_IDS,
  sfxConsoleGroupOf,
} from '../game/audio/cues'
import {
  playCue,
  previewCue,
  previewLoopCue,
  sfxStatusList,
} from '../game/audio/player'
import type { SfxCueStatus } from '../game/audio/player'
import { isAudioFileName, matchSfxFileName } from '../game/audio/rules'
import { buildSfxPack } from '../game/audio/sfxPack'
import {
  AMBIENT_BLIP_IDS,
  SCENE_RELATED_CUES,
  SFX_SCENE_NAME_ID,
  SFX_SCENE_ORDER,
  sceneAmbientOf,
  sceneBgmOf,
} from '../game/audio/scene'
import type { SfxScene } from '../game/audio/scene'
import {
  activeSfxScene,
  clearForcedSfxScene,
  forceSfxScene,
  forcedSfxScene,
  realSfxScene,
  subscribeSfxScene,
} from '../game/audio/sceneSwitch'
import { readSfxPrefs, subscribeSfxPrefs, writeSfxPrefs } from '../game/audio/prefs'
import { restartMusic } from '../game/audio/music'
import {
  clearSfxPlayLog,
  setSfxPlayLogPaused,
  sfxPlayLog,
  sfxPlayLogPaused,
  subscribeSfxPlayLog,
} from '../game/audio/playLog'
import { useL10n } from '../i18n/locale'

const SOURCE_LABEL_ID: Record<SfxCueStatus['source'], string> = {
  override: 'ui.sfx.047',
  builtin: 'ui.sfx.046',
  fallback: 'ui.sfx.046',
  none: 'ui.sfx.048',
}

const TABS = [
  { key: 'assets', labelId: 'ui.sfx.098' },
  { key: 'scenes', labelId: 'ui.sfx.099' },
  { key: 'log', labelId: 'ui.sfx.100' },
  { key: 'ingest', labelId: 'ui.sfx.101' },
] as const

type TabKey = (typeof TABS)[number]['key']

/** 入库包文件名（本地时间；只用于下载名，故不进 l10n） */
function packFileName(now: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `whale-sfx-pack-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.zip`
}

/** 触发浏览器下载（网页开发版与桌面开发版同一套；打包版不渲染音效台） */
function downloadPack(bytes: Uint8Array, fileName: string): void {
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/zip' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // 立刻 revoke 会让部分浏览器下载失败；留足时间由 GC 兜底
  window.setTimeout(() => {
    try {
      URL.revokeObjectURL(url)
    } catch {
      /* 忽略 */
    }
  }, 10_000)
}

/** 安装器 `--json` 输出（`tools/audio-install.ts` 的 InstallReport 子集；面板只读用） */
interface InstallReportLike {
  written?: string[]
  overwritten?: string[]
  skipped?: string[]
  removedVariants?: string[]
  warnings?: string[]
  coverage?: { covered: number; total: number }
}

type ExportResult =
  | { readonly ok: true; readonly fileName: string; readonly count: number }
  | { readonly ok: false; readonly message: string }

type InstallResult =
  | { readonly ok: true; readonly report: InstallReportLike; readonly cleared: number }
  | { readonly ok: false; readonly message: string }

function logTime(atMs: number): string {
  const d = new Date(atMs)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 桌面开发版一键入库桥（网页版没有；由 preload 暴露） */
function installBridge(): WhaleApi['audio'] {
  try {
    return typeof window !== 'undefined' ? window.whale?.audio : undefined
  } catch {
    return undefined
  }
}

export function SfxConsole({ onClose }: { onClose: () => void }) {
  const { t } = useL10n()
  const [rows, setRows] = useState<SfxCueStatus[]>(() => sfxStatusList())
  const [tab, setTab] = useState<TabKey>('assets')
  const [collapsed, setCollapsed] = useState(false)
  const [unmatched, setUnmatched] = useState<string[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [pendingCue, setPendingCue] = useState<SfxCueId | null>(null)
  const [mode, setMode] = useState<'indexeddb' | 'memory'>(() => sfxOverrideStorageMode())
  const [exporting, setExporting] = useState(false)
  const [exportResult, setExportResult] = useState<ExportResult | null>(null)
  const [installing, setInstalling] = useState(false)
  const [installResult, setInstallResult] = useState<InstallResult | null>(null)
  const [muted, setMuted] = useState(() => readSfxPrefs().muted)
  const [, setSceneVersion] = useState(0)
  const [, setLogVersion] = useState(0)
  const [, setPrefsVersion] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)

  const refresh = (): void => {
    setRows(sfxStatusList())
    setMode(sfxOverrideStorageMode())
  }

  useEffect(() => subscribeSfxOverrides(refresh), [])
  useEffect(() => subscribeSfxScene(() => setSceneVersion((v) => v + 1)), [])
  useEffect(() => subscribeSfxPlayLog(() => setLogVersion((v) => v + 1)), [])
  useEffect(() => {
    setMuted(readSfxPrefs().muted)
    return subscribeSfxPrefs(() => {
      setMuted(readSfxPrefs().muted)
      setPrefsVersion((v) => v + 1)
    })
  }, [])

  async function importFiles(files: File[], target: SfxCueId | null): Promise<void> {
    const bad: string[] = []
    let first: SfxCueId | null = null
    for (const file of files) {
      const cueId = target ?? matchSfxFileName(file.name)
      if (cueId === null || !isAudioFileName(file.name)) {
        bad.push(file.name)
        continue
      }
      await putSfxOverride(cueId, file)
      if (first === null) first = cueId
    }
    setUnmatched(bad)
    refresh()
    if (first !== null) {
      if (SFX_CUES[first].loop === true) previewLoopCue(first)
      else previewCue(first)
    }
  }

  async function collectPackSources(): Promise<
    { cueId: SfxCueId; fileName: string; updatedAt: number; data: Uint8Array }[]
  > {
    const overrides = listSfxOverrideFiles()
    return Promise.all(
      overrides.map(async (override) => ({
        cueId: override.cueId,
        fileName: override.fileName,
        updatedAt: override.updatedAt,
        data: new Uint8Array(await override.blob.arrayBuffer()),
      })),
    )
  }

  /** 把当前本机覆盖打成正式入库包并下载（只读覆盖层，不改任何本机状态） */
  async function exportPack(): Promise<void> {
    if (exporting) return
    setExporting(true)
    setExportResult(null)
    try {
      const sources = await collectPackSources()
      if (sources.length === 0) {
        setExportResult({ ok: false, message: t('ui.sfx.073') })
        return
      }
      const bytes = buildSfxPack(sources, { createdAt: new Date().toISOString() })
      const fileName = packFileName(new Date())
      downloadPack(bytes, fileName)
      setExportResult({ ok: true, fileName, count: sources.length })
    } catch (err) {
      setExportResult({ ok: false, message: err instanceof Error ? err.message : String(err) })
    } finally {
      setExporting(false)
    }
  }

  /** 桌面开发版一键入库：IPC 让主进程调现有安装器写仓库，成功后清掉已入库的本机覆盖 */
  async function installPack(): Promise<void> {
    if (installing) return
    const api = installBridge()
    const overrides = listSfxOverrideFiles()
    setInstallResult(null)
    if (overrides.length === 0) {
      setInstallResult({ ok: false, message: t('ui.sfx.073') })
      return
    }
    if (api === undefined) {
      setInstallResult({ ok: false, message: t('ui.sfx.130') })
      return
    }
    setInstalling(true)
    try {
      const sources = await collectPackSources()
      const bytes = buildSfxPack(sources, { createdAt: new Date().toISOString() })
      const result = await api.installPack(bytes.slice().buffer as ArrayBuffer)
      let report: InstallReportLike | null = null
      // 安装器在 --json 模式额外打一行标记 JSON（人读日志照旧保留，失败时可直接显示原因）
      const marker = '@@WHALE_SFX_REPORT@@'
      const reportLine = result.output.split('\n').find((line) => line.startsWith(marker))
      if (reportLine !== undefined) {
        try {
          report = JSON.parse(reportLine.slice(marker.length)) as InstallReportLike
        } catch {
          report = null
        }
      }
      if (!result.ok || report === null) {
        const detail = result.output.trim().split('\n').slice(-3).join(' ') || `exit ${String(result.code)}`
        setInstallResult({ ok: false, message: t('ui.sfx.124', { p1: detail }) })
        return
      }
      // 已写入仓库 ⇒ 本机覆盖优先会继续盖住新内置素材，自动清掉（船长 2026-11-04 口径）
      for (const override of overrides) await deleteSfxOverride(override.cueId)
      refresh()
      setInstallResult({ ok: true, report, cleared: overrides.length })
    } catch (err) {
      setInstallResult({ ok: false, message: err instanceof Error ? err.message : String(err) })
    } finally {
      setInstalling(false)
    }
  }

  function pickFileFor(cueId: SfxCueId): void {
    setPendingCue(cueId)
    fileRef.current?.click()
  }

  function onFileInput(e: React.ChangeEvent<HTMLInputElement>): void {
    const files = e.target.files !== null ? [...e.target.files] : []
    const target = pendingCue
    setPendingCue(null)
    e.target.value = ''
    if (files.length > 0) void importFiles(files, target)
  }

  const overrideCount = rows.filter((row) => row.source === 'override').length
  const builtinCount = rows.filter((row) => row.builtinCount > 0).length
  const canOneClick = installBridge() !== undefined
  const forced = forcedSfxScene()
  const real = realSfxScene()
  const activeScene = activeSfxScene()
  const sceneName = (scene: SfxScene): string => t(SFX_SCENE_NAME_ID[scene])

  if (collapsed) {
    return createPortal(
      <div className="app-sfx-bar">
        <span className="app-dim">{t('ui.sfx.040')}</span>
        <button className="app-btn is-small" onClick={() => setCollapsed(false)}>{t('ui.sfx.110')}</button>
        <button className="app-btn is-small" onClick={onClose}>{t('ui.sfx.051')}</button>
      </div>,
      document.body,
    )
  }

  const assetsPanel = (
    <>
      <div className="app-note">{t('ui.sfx.041')}</div>
      <div
        className={`app-sfx-drop${dragOver ? ' is-over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          void importFiles([...e.dataTransfer.files], null)
        }}
      >
        {t('ui.sfx.049')}
      </div>
      {unmatched.length > 0 ? <div className="app-sfx-warn">{t('ui.sfx.050', { p1: unmatched.join('、') })}</div> : null}
      <div className="app-sfx-list">
        {SFX_CONSOLE_GROUPS.map((group) => {
          const groupRows = rows.filter((r) => sfxConsoleGroupOf(r.category) === group.key)
          if (groupRows.length === 0) return null
          return (
            <div key={group.key}>
              <div className="app-dim">{t(group.labelId)}</div>
              {groupRows.map((row) => (
                <div className="app-sfx-row" key={row.id}>
                  <div className="app-sfx-name">
                    <span>
                      {t(SFX_CATEGORY_NAME_ID[row.category])} · {t(row.nameId)}
                      {row.pitchCents > 0 ? ` · ${t('ui.sfx.069', { p1: row.pitchCents })}` : ''}
                    </span>
                    <span className="app-dim">{row.id}</span>
                  </div>
                  <span className={`app-sfx-badge is-${row.source}`}>
                    {t(SOURCE_LABEL_ID[row.source])}
                    {row.source === 'builtin' && row.builtinCount > 1 ? ` ×${row.builtinCount}` : ''}
                  </span>
                  <div className="app-sfx-actions">
                    <button
                      className="app-btn is-small"
                      disabled={row.source === 'none'}
                      title={row.source === 'none' ? t('ui.sfx.048') : t('ui.sfx.042')}
                      onClick={() => {
                        if (row.loop) previewLoopCue(row.id)
                        else previewCue(row.id)
                      }}
                    >
                      {t('ui.sfx.042')}
                    </button>
                    <button className="app-btn is-small" onClick={() => pickFileFor(row.id)}>
                      {t('ui.sfx.043')}
                    </button>
                    {row.source === 'override' ? (
                      <button className="app-btn is-small" onClick={() => void deleteSfxOverride(row.id)}>
                        {t('ui.sfx.044')}
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </>
  )

  const scenesPanel = (
    <>
      <div className="app-note">
        {forced !== null
          ? t('ui.sfx.116', { p1: sceneName(forced) })
          : t('ui.sfx.115', { p1: sceneName(real) })}
        {activeScene !== null && activeScene !== real ? ` · ${sceneName(activeScene)}` : ''}
      </div>
      {forced !== null ? (
        <button className="app-btn is-small" onClick={() => clearForcedSfxScene()}>{t('ui.sfx.108')}</button>
      ) : null}
      <div className="app-sfx-scene-grid">
        {SFX_SCENE_ORDER.map((scene) => {
          const bgm = sceneBgmOf(scene)
          const ambient = sceneAmbientOf(scene)
          const related = SCENE_RELATED_CUES[scene]
          return (
            <div className={`app-sfx-card${forced === scene ? ' is-forced' : ''}`} key={scene}>
              <div className="app-sfx-card-title">{sceneName(scene)}</div>
              <div className="app-dim">{t('ui.sfx.119')}</div>
              <div className="app-sfx-card-meta">{t(SFX_CUES[bgm].nameId)} <span className="app-dim">{bgm}</span></div>
              <div className="app-sfx-card-meta">{t(SFX_CUES[ambient].nameId)} <span className="app-dim">{ambient}</span></div>
              <div className="app-sfx-card-cues">
                {related.slice(0, 6).map((id) => (
                  <span className="app-sfx-card-cue" key={id}>{t(SFX_CUES[id].nameId)}</span>
                ))}
              </div>
              <div className="app-sfx-actions">
                <button className="app-btn is-small" onClick={() => forceSfxScene(scene)}>{t('ui.sfx.107')}</button>
                {forced === scene ? (
                  <button className="app-btn is-small" onClick={() => clearForcedSfxScene()}>{t('ui.sfx.108')}</button>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )

  const logs = [...sfxPlayLog()].reverse()
  const logPanel = (
    <>
      <div className="app-note">{t('ui.sfx.117')}</div>
      <div className="app-sfx-log-actions">
        <button
          className="app-btn is-small"
          onClick={() => setSfxPlayLogPaused(!sfxPlayLogPaused())}
        >
          {sfxPlayLogPaused() ? t('ui.sfx.113') : t('ui.sfx.112')}
        </button>
        <button className="app-btn is-small" onClick={() => clearSfxPlayLog()}>{t('ui.sfx.111')}</button>
      </div>
      {logs.length === 0 ? (
        <div className="app-dim">{t('ui.sfx.118')}</div>
      ) : (
        <div className="app-sfx-log">
          {logs.map((entry, index) => (
            <div className="app-sfx-log-row" key={`${entry.atMs}-${entry.cueId}-${index}`}>
              <span className="app-sfx-log-time">{logTime(entry.atMs)}</span>
              <span>{t(SFX_CUES[entry.cueId].nameId)}</span>
              <span className="app-dim">{t(SFX_CATEGORY_NAME_ID[entry.category])} · {entry.cueId}</span>
            </div>
          ))}
        </div>
      )}
    </>
  )

  const ingestPanel = (
    <>
      <div className="app-note">{t('ui.sfx.071')}</div>
      <div className="app-dim">{t('ui.sfx.120', { p1: overrideCount })}</div>
      <div className="app-dim">{t('ui.sfx.129', { p1: builtinCount, p2: rows.length })}</div>
      <div className="app-sfx-install-actions">
        <button
          className="app-btn is-small is-primary"
          disabled={!canOneClick || overrideCount === 0 || installing}
          title={canOneClick ? t('ui.sfx.121') : t('ui.sfx.130')}
          onClick={() => void installPack()}
        >
          {installing ? t('ui.sfx.122') : t('ui.sfx.121')}
        </button>
        <button
          className="app-btn is-small"
          disabled={overrideCount === 0 || exporting}
          title={overrideCount === 0 ? t('ui.sfx.073') : t('ui.sfx.070')}
          onClick={() => void exportPack()}
        >
          {exporting ? t('ui.sfx.075') : t('ui.sfx.070')}
        </button>
      </div>
      {!canOneClick ? <div className="app-sfx-warn">{t('ui.sfx.130')}</div> : null}
      {installResult !== null ? (
        installResult.ok ? (
          <div className="app-note">
            {t('ui.sfx.123', {
              p1: installResult.report.written?.length ?? 0,
              p2: installResult.report.overwritten?.length ?? 0,
              p3: installResult.report.skipped?.length ?? 0,
              p4: installResult.cleared,
            })}
            {installResult.report.warnings !== undefined && installResult.report.warnings.length > 0 ? (
              <div className="app-sfx-warn">{installResult.report.warnings.join('；')}</div>
            ) : null}
          </div>
        ) : (
          <div className="app-sfx-warn">{installResult.message}</div>
        )
      ) : null}
    </>
  )

  const panel = tab === 'assets' ? assetsPanel : tab === 'scenes' ? scenesPanel : tab === 'log' ? logPanel : ingestPanel

  return (
    <div className="app-modal-mask" onClick={onClose}>
      <div className="app-modal app-sfx-modal" onClick={(e) => e.stopPropagation()}>
        <div className="app-modal-head app-sfx-head">
          <span className="app-report-title">{t('ui.sfx.040')}</span>
          <span className="app-dim app-sfx-scene-chip">
            {forced !== null
              ? t('ui.sfx.116', { p1: sceneName(forced) })
              : t('ui.sfx.115', { p1: sceneName(real) })}
          </span>
          <span className="app-sfx-head-actions">
            <button className="app-btn is-small" onClick={() => setCollapsed(true)}>{t('ui.sfx.109')}</button>
            <button className="app-btn is-small" onClick={onClose}>{t('ui.sfx.051')}</button>
          </span>
        </div>
        <div className="app-sfx-tabs">
          {TABS.map((item) => (
            <button
              key={item.key}
              className={`app-sfx-tab${tab === item.key ? ' is-active' : ''}`}
              onClick={() => setTab(item.key)}
            >
              {t(item.labelId)}
            </button>
          ))}
        </div>
        <div className="app-sfx-panels">{panel}</div>
        {exportResult !== null ? (
          <div className={exportResult.ok ? 'app-note app-sfx-result' : 'app-sfx-warn app-sfx-result'}>
            {exportResult.ok
              ? t('ui.sfx.072', { p1: exportResult.fileName, p2: exportResult.count })
              : exportResult.message}
          </div>
        ) : null}
        <div className="app-sfx-toolbar">
          <span className="app-dim">
            {t('ui.sfx.052')}
            {mode === 'memory' ? ` · ${t('ui.sfx.054')}` : ''}
          </span>
          <span className="app-settings-btns">
            <button className="app-btn is-small" onClick={refresh}>{t('ui.sfx.114')}</button>
            <button
              className="app-btn is-small"
              onClick={() => {
                writeSfxPrefs({ ...readSfxPrefs(), muted: !muted })
                setMuted(!muted)
              }}
            >
              {muted ? t('ui.sfx.126') : t('ui.sfx.125')}
            </button>
            <button className="app-btn is-small" onClick={() => restartMusic()}>{t('ui.sfx.127')}</button>
            <button
              className="app-btn is-small"
              onClick={() => {
                const ids = AMBIENT_BLIP_IDS
                const id = ids[Math.floor(Math.random() * ids.length)] ?? ids[0]!
                playCue(id)
              }}
            >
              {t('ui.sfx.128')}
            </button>
            <button
              className="app-btn is-small"
              disabled={overrideCount === 0 || exporting}
              title={overrideCount === 0 ? t('ui.sfx.073') : t('ui.sfx.070')}
              onClick={() => void exportPack()}
            >
              {exporting ? t('ui.sfx.075') : t('ui.sfx.070')}
            </button>
            <button className="app-btn is-small" onClick={() => void clearSfxOverrides()}>{t('ui.sfx.045')}</button>
            <button className="app-btn is-small is-primary" onClick={onClose}>{t('ui.sfx.051')}</button>
          </span>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".mp3,.ogg,.wav,.m4a"
          multiple
          style={{ display: 'none' }}
          onChange={onFileInput}
        />
      </div>
    </div>
  )
}

/** 调试模式顶栏「♪ 声音」入口：自带开关与 portal，不改 AppShell 的状态 */
export function SfxConsoleButton() {
  const { t } = useL10n()
  const [open, setOpen] = useState(false)
  if (typeof document === 'undefined') return null
  return (
    <>
      <button className="app-btn" onClick={() => setOpen(true)} title={t('ui.sfx.040')}>
        ♪ {t('ui.sfx.030')}
      </button>
      {open ? createPortal(<SfxConsole onClose={() => setOpen(false)} />, document.body) : null}
    </>
  )
}

/** 语义 id 是否都已登记（音效台自检用；工具侧另有 `audio-check`） */
export function sfxConsoleCueCount(): number {
  return SFX_CUE_IDS.length
}
