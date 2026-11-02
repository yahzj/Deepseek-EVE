/**
 * **本机音效台**（2026-11-02 船长令：「留一个后台我可以快速添加音效的入口」）。
 *
 * 只在本机调试门禁放行时出现（入口在设置 →「声音」分组；打包版/公网版不渲染入口）。
 * 能力：
 * - 列出全部语义事件与当前来源（本机覆盖 / 仓库内置 / 未接入）；
 * - 逐条试听（绕过节流与静音，按当前音量）；
 * - **拖入或选择音频文件即生效**：文件名 = 语义 id（`invasion-alarm.mp3`，变体 `invasion-alarm.1.mp3`），
 *   多个文件一次拖入会逐个自动配对，配对不上的会列出来；
 * - 逐条清除 / 全部清除（回到仓库内置；仓库也没有 = 静音）。
 *
 * 存储：本机覆盖进 IndexedDB（`game/audio/overrides.ts`），**不进存档、不进 git、不随发布**；
 * 存储不可用时退化为本次会话有效，面板底部会如实标注。
 */
import { useEffect, useRef, useState } from 'react'
import type { SfxCueId } from '../game/audio/cues'
import {
  clearSfxOverrides,
  deleteSfxOverride,
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
import { useL10n } from '../i18n/locale'

const SOURCE_LABEL_ID: Record<SfxCueStatus['source'], string> = {
  override: 'ui.sfx.047',
  builtin: 'ui.sfx.046',
  fallback: 'ui.sfx.046',
  none: 'ui.sfx.048',
}

export function SfxConsole({ onClose }: { onClose: () => void }) {
  const { t } = useL10n()
  const [rows, setRows] = useState<SfxCueStatus[]>(() => sfxStatusList())
  const [unmatched, setUnmatched] = useState<string[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [pendingCue, setPendingCue] = useState<SfxCueId | null>(null)
  const [mode, setMode] = useState<'indexeddb' | 'memory'>(() => sfxOverrideStorageMode())
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
          <div className="app-sfx-foot">
            <span className="app-dim">
              {t('ui.sfx.052')}
              {mode === 'memory' ? ` · ${t('ui.sfx.054')}` : ''}
            </span>
            <span className="app-settings-btns">
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
