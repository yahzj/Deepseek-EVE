/**
 * **本机音效台**（2026-11-02 船长令：「留一个后台我可以快速添加音效的入口」）。
 *
 * 只在本机调试门禁放行时出现（入口在设置 →「声音」分组；打包版/公网版不渲染入口）。
 * 能力：
 * - 列出全部语义事件与当前来源（本机覆盖 / 仓库内置 / 未接入）；
 * - 逐条试听（绕过节流与静音，按当前音量）；
 * - **拖入或选择音频文件即生效**：文件名 = 语义 id（`invasion-alarm.mp3`，变体 `invasion-alarm.1.mp3`），
 *   多个文件一次拖入会逐个自动配对，配对不上的会列出来；
 * - 逐条清除 / 全部清除（回到仓库内置；仓库也没有 = 静音）；
 * - **导出正式入库包**（2026-11-04）：把当前本机覆盖按语义 id 打成 zip，下载后在仓库根运行
 *   `npm run audio:install` 校验并写入 `assets/{sfx,bgm,ambient}`，成为随构建发布的正式素材。
 *
 * 存储：本机覆盖进 IndexedDB（`game/audio/overrides.ts`），**不进存档、不进 git、不随发布**；
 * 存储不可用时退化为本次会话有效，面板底部会如实标注。
 */
import { useEffect, useRef, useState } from 'react'
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
import { isAudioFileName, matchSfxFileName } from '../game/audio/rules'
import { previewCue, previewLoopCue, sfxStatusList } from '../game/audio/player'
import type { SfxCueStatus } from '../game/audio/player'
import { buildSfxPack } from '../game/audio/sfxPack'
import { useL10n } from '../i18n/locale'

const SOURCE_LABEL_ID: Record<SfxCueStatus['source'], string> = {
  override: 'ui.sfx.047',
  builtin: 'ui.sfx.046',
  fallback: 'ui.sfx.046',
  none: 'ui.sfx.048',
}

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

type ExportResult = { readonly ok: true; readonly fileName: string; readonly count: number } | { readonly ok: false; readonly message: string }

export function SfxConsole({ onClose }: { onClose: () => void }) {
  const { t } = useL10n()
  const [rows, setRows] = useState<SfxCueStatus[]>(() => sfxStatusList())
  const [unmatched, setUnmatched] = useState<string[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [pendingCue, setPendingCue] = useState<SfxCueId | null>(null)
  const [mode, setMode] = useState<'indexeddb' | 'memory'>(() => sfxOverrideStorageMode())
  const [exporting, setExporting] = useState(false)
  const [exportResult, setExportResult] = useState<ExportResult | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const refresh = (): void => {
    setRows(sfxStatusList())
    setMode(sfxOverrideStorageMode())
  }

  useEffect(() => subscribeSfxOverrides(refresh), [])

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

  /** 把当前本机覆盖打成正式入库包并下载（只读覆盖层，不改任何本机状态） */
  async function exportPack(): Promise<void> {
    const overrides = listSfxOverrideFiles()
    if (overrides.length === 0 || exporting) {
      setExportResult({ ok: false, message: t('ui.sfx.073') })
      return
    }
    setExporting(true)
    setExportResult(null)
    try {
      const sources = await Promise.all(
        overrides.map(async (override) => ({
          cueId: override.cueId,
          fileName: override.fileName,
          updatedAt: override.updatedAt,
          data: new Uint8Array(await override.blob.arrayBuffer()),
        })),
      )
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

  return (
    <div className="app-modal-mask" onClick={onClose}>
      <div className="app-modal app-sfx-modal" onClick={(e) => e.stopPropagation()}>
        <div className="app-modal-head">
          <span className="app-report-title">{t('ui.sfx.040')}</span>
          <button className="app-btn is-small" onClick={onClose}>{t('ui.sfx.051')}</button>
        </div>
        <div className="app-modal-body app-sfx-body">
          <div className="app-note">{t('ui.sfx.041')}</div>
          <div
            className={`app-sfx-drop${dragOver ? ' is-over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragOver(false)
              void importFiles([...e.dataTransfer.files], null)
            }}
          >
            {t('ui.sfx.049')}
          </div>
          {unmatched.length > 0 ? (
            <div className="app-sfx-warn">{t('ui.sfx.050', { p1: unmatched.join('、') })}</div>
          ) : null}
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
          <div className="app-note">{t('ui.sfx.071')}</div>
          {exportResult !== null ? (
            <div className={exportResult.ok ? 'app-note' : 'app-sfx-warn'}>
              {exportResult.ok
                ? t('ui.sfx.072', { p1: exportResult.fileName, p2: exportResult.count })
                : t('ui.sfx.074', { p1: exportResult.message })}
            </div>
          ) : null}
          <div className="app-sfx-foot">
            <span className="app-dim">
              {t('ui.sfx.052')}
              {mode === 'memory' ? ` · ${t('ui.sfx.054')}` : ''}
            </span>
            <span className="app-settings-btns">
              <button
                className="app-btn is-small"
                disabled={overrideCount === 0 || exporting}
                title={overrideCount === 0 ? t('ui.sfx.073') : t('ui.sfx.070')}
                onClick={() => void exportPack()}
              >
                {exporting ? t('ui.sfx.075') : t('ui.sfx.070')}
              </button>
              <button className="app-btn is-small" onClick={() => void clearSfxOverrides()}>
                {t('ui.sfx.045')}
              </button>
              <button className="app-btn is-small is-primary" onClick={onClose}>{t('ui.sfx.051')}</button>
            </span>
          </div>
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

/** 语义 id 是否都已登记（音效台自检用；工具侧另有 `audio-check`） */
export function sfxConsoleCueCount(): number {
  return SFX_CUE_IDS.length
}
