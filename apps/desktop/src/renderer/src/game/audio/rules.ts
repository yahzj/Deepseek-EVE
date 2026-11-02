/**
 * **音效纯规则**（不碰 DOM、不碰存储；`tools/audio-check.ts` 直接跑这些函数的确定性用例）。
 *
 * 分三块：
 * 1. 音量与偏好：总音量 × 分类音量 × 单音效增益；被静音时恒 0；
 * 2. 触发匹配：`state.logs` 的 `(kind, textId)` → 语义 id；素材文件名 → 语义 id；
 * 3. 生产进度：只读精炼炉 `batchesDone` / 实验室 `finishAtGameMs` 的增量（本批"批次完成"音效来源）。
 */
import { SFX_CATEGORIES, SFX_CUES, SFX_CUE_IDS } from './cues'
import type { SfxCategory, SfxCueId } from './cues'

/* ═══════════════ 音量与偏好 ═══════════════ */

export interface SfxCategoryVolumes {
  alarm: number
  combat: number
  progress: number
  ui: number
}

export interface SfxPrefs {
  muted: boolean
  master: number
  categories: SfxCategoryVolumes
}

/** 默认偏好（船长 2026-11-02 确认：总音量 70%、初始不静音） */
export function defaultSfxPrefs(): SfxPrefs {
  return { muted: false, master: 0.7, categories: { alarm: 1, combat: 0.6, progress: 0.7, ui: 0.5 } }
}

/** 音量钳制（0～1；非有限数按 0 处理，避免 NaN 静默污染） */
export function clampVolume(v: number): number {
  if (!Number.isFinite(v)) return 0
  return Math.min(1, Math.max(0, v))
}

/** 宽容读取本机存下的 JSON（坏了按默认；逐字段钳制，不因一个坏字段整份作废） */
export function parseSfxPrefs(raw: string | null | undefined): SfxPrefs {
  const def = defaultSfxPrefs()
  if (typeof raw !== 'string' || raw === '') return def
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return def
  }
  if (typeof parsed !== 'object' || parsed === null) return def
  const o = parsed as Record<string, unknown>
  const rawCats = (typeof o.categories === 'object' && o.categories !== null ? o.categories : {}) as Record<string, unknown>
  const categories = { ...def.categories }
  for (const c of SFX_CATEGORIES) {
    const v = rawCats[c]
    if (typeof v === 'number') categories[c] = clampVolume(v)
  }
  return {
    muted: o.muted === true,
    master: typeof o.master === 'number' ? clampVolume(o.master) : def.master,
    categories,
  }
}

/** 实际播放增益 = 总音量 × 分类音量 × 单音效增益（静音恒 0；音量都为 0 时也是 0） */
export function effectiveGain(cueId: SfxCueId, prefs: SfxPrefs): number {
  if (prefs.muted) return 0
  const cue = SFX_CUES[cueId]
  if (!cue) return 0
  const cat = clampVolume(prefs.categories[cue.category])
  const master = clampVolume(prefs.master)
  return clampVolume(master * cat * cue.gain)
}

/** 同一音效的最短间隔判定（上次播放时刻缺省 = 可以播） */
export function shouldPlay(lastAtMs: number | undefined, nowMs: number, minGapMs: number): boolean {
  if (lastAtMs === undefined) return true
  return nowMs - lastAtMs >= Math.max(0, minGapMs)
}

/** 分类名 id（音效台/设置展示用） */
export function categoryIds(): readonly SfxCategory[] {
  return SFX_CATEGORIES
}

/* ═══════════════ 触发匹配：日志 ═══════════════ */

/**
 * 日志 → 音效的**精确 id 规则**（2026-11-02 按现实日志核实；只读日志，不改 core）。
 *
 * ⚠ 加规则前先确认这条日志真的会在该事件发生：日志 id 的中文文案见
 * `packages/data/src/l10n/table.ts`，写入点用 `rg "core\.⟨域⟩\.⟨号⟩" packages/core/src` 定位。
 */
const LOG_CUE_RULES: Readonly<Record<string, SfxCueId>> = {
  // 训练完成（core/engine.ts 的训练队列）
  'core.engine.002': 'skill-done',
  // 星系扫描完成（首次 / 补扫）与发现信号空间
  'core.explore.008': 'scan-done',
  'core.explore.009': 'scan-done',
  'core.explorationStatus.001': 'scan-done',
  // 建成：首座空间站并网 / 副站建成档 / 星球环境改造完成
  'core.station.014': 'build-done',
  'core.location.052': 'build-done',
  'core.planet.004': 'build-done',
  // 制造完成（装备库 / 物品仓库）
  'core.manufacturing.014': 'industry-done',
  'core.manufacturing.015': 'industry-done',
}

/** 日志 → 语义 id；先查精确 id，再按分类兜底（`trade` = 成交/收益类）。无匹配返回 null（静默） */
export function matchLogCue(kind: string, textId?: string): SfxCueId | null {
  if (typeof textId === 'string') {
    const exact = LOG_CUE_RULES[textId]
    if (exact !== undefined) return exact
  }
  if (kind === 'trade') return 'trade-done'
  return null
}

/* ═══════════════ 触发匹配：素材文件名 ═══════════════ */

const AUDIO_EXT = /\.(mp3|ogg|wav|m4a)$/i

/** 是不是音频文件（音效台拖入时先过滤） */
export function isAudioFileName(fileName: string): boolean {
  return AUDIO_EXT.test(fileName)
}

/** 去扩展名后的小写基名 */
export function sfxFileBase(fileName: string): string {
  return fileName.replace(/\.[^./\\]+$/, '').trim().toLowerCase()
}

/**
 * 素材文件名 → 语义 id：`invasion-alarm.mp3` → `invasion-alarm`；
 * 变体 `invasion-alarm.1.mp3` / `invasion-alarm.2.ogg` → 同一条语义 id（播放时随机取一份）。
 * 对不上（拼错/未知事件）返回 null，由音效台提示。
 */
export function matchSfxFileName(fileName: string): SfxCueId | null {
  if (!isAudioFileName(fileName)) return null
  const base = sfxFileBase(fileName)
  if ((SFX_CUE_IDS as readonly string[]).includes(base)) return base as SfxCueId
  const variant = /^(.+)\.\d+$/.exec(base)
  if (variant && (SFX_CUE_IDS as readonly string[]).includes(variant[1]!)) return variant[1] as SfxCueId
  return null
}

/** 从若干候选里随机取一份（空表 = null；随机源可注入，便于确定性用例） */
export function pickVariant<T>(items: readonly T[], random: () => number): T | null {
  if (items.length === 0) return null
  const raw = random()
  const i = Math.floor((Number.isFinite(raw) ? raw : 0) * items.length)
  return items[Math.min(items.length - 1, Math.max(0, i))] ?? null
}

/* ═══════════════ 触发匹配：生产进度 ═══════════════ */

/** 只读投影：精炼炉的已完成批数（按台 id）与实验室当前批的到点时刻（按台 id） */
export interface ProductionSnapshot {
  refine: Record<string, number>
  lab: Record<string, number>
}

interface RefineRunLike {
  id: number
  batchesDone?: number
}

interface LabRunLike {
  id: number
  finishAtGameMs?: number
}

/** 从引擎状态取生产进度快照（只读；不认识的形状按空表） */
export function productionSnapshot(state: {
  refineRuns?: readonly RefineRunLike[]
  labRuns?: readonly LabRunLike[]
}): ProductionSnapshot {
  const refine: Record<string, number> = {}
  for (const run of state.refineRuns ?? []) {
    if (typeof run?.id === 'number') refine[String(run.id)] = typeof run.batchesDone === 'number' ? run.batchesDone : 0
  }
  const lab: Record<string, number> = {}
  for (const run of state.labRuns ?? []) {
    if (typeof run?.id === 'number') lab[String(run.id)] = typeof run.finishAtGameMs === 'number' ? run.finishAtGameMs : 0
  }
  return { refine, lab }
}

/**
 * 上一拍 → 这一拍新增的"批次完成"次数：
 * - 精炼炉：同一台 `batchesDone` 变大；
 * - 实验室：同一台 `finishAtGameMs` 变大（一批交付后重新排下一批的时刻）。
 * 新台/停台都不算完成；返回值 = 本拍应播几次（调用方通常会合并成一次）。
 */
export function productionCompletedCount(prev: ProductionSnapshot | null, next: ProductionSnapshot): number {
  if (prev === null) return 0
  let n = 0
  for (const [id, batches] of Object.entries(next.refine)) {
    const before = prev.refine[id]
    if (before !== undefined && batches > before) n += 1
  }
  for (const [id, finishAt] of Object.entries(next.lab)) {
    const before = prev.lab[id]
    if (before !== undefined && finishAt > before) n += 1
  }
  return n
}
