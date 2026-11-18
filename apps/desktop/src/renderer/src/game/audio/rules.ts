import { SFX_CATEGORIES, SFX_CUES, SFX_CUE_IDS } from './cues'
import type { SfxCategory, SfxCueId } from './cues'


export interface SfxCategoryVolumes {
  alarm: number
  combat: number
  progress: number
  ui: number
  music: number
  ambient: number
}

export interface SfxPrefs {
  muted: boolean
  master: number
  categories: SfxCategoryVolumes
  pitchJitterCents: number
}

export const PITCH_JITTER_MAX_CENTS = 100

export const DEFAULT_PITCH_JITTER_CENTS = 50

export const BGM_CROSSFADE_MS = 2500
export const AMBIENT_CROSSFADE_MS = 1500
export const VOLUME_FADE_MS = 250

export function defaultSfxPrefs(): SfxPrefs {
  return {
    muted: false,
    master: 1,
    categories: { music: 0.25, ambient: 0.55, alarm: 0.7, combat: 1, progress: 0.5, ui: 0.5 },
    pitchJitterCents: DEFAULT_PITCH_JITTER_CENTS,
  }
}

export function clampVolume(v: number): number {
  if (!Number.isFinite(v)) return 0
  return Math.min(1, Math.max(0, v))
}

export function clampPitchJitter(v: number): number {
  if (!Number.isFinite(v)) return 0
  return Math.min(PITCH_JITTER_MAX_CENTS, Math.max(0, Math.round(v)))
}

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
    pitchJitterCents:
      typeof o.pitchJitterCents === 'number' ? clampPitchJitter(o.pitchJitterCents) : def.pitchJitterCents,
  }
}

export function effectiveGain(cueId: SfxCueId, prefs: SfxPrefs): number {
  if (prefs.muted) return 0
  const cue = SFX_CUES[cueId]
  if (!cue) return 0
  const cat = clampVolume(prefs.categories[cue.category])
  const master = clampVolume(prefs.master)
  return clampVolume(master * cat * cue.gain)
}

export function pitchRateFor(cents: number, random: () => number): number {
  const limit = clampPitchJitter(cents)
  if (limit <= 0) return 1
  const raw = random()
  const unit = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) * 2 - 1 : 0
  return Math.pow(2, (unit * limit) / 1200)
}

export function shouldPlay(lastAtMs: number | undefined, nowMs: number, minGapMs: number): boolean {
  if (lastAtMs === undefined) return true
  return nowMs - lastAtMs >= Math.max(0, minGapMs)
}

export function shouldPlayClickCue(
  clickAtMs: number,
  lastErrorAtMs: number | undefined,
  lastActionAtMs?: number,
): boolean {
  if (lastErrorAtMs !== undefined && !(lastErrorAtMs < clickAtMs)) return false
  if (lastActionAtMs !== undefined && !(lastActionAtMs < clickAtMs)) return false
  return true
}

export function clickCueFor(declared: string | null, successOnly: boolean): SfxCueId | null {
  if (successOnly) return null
  if (declared !== null && Object.prototype.hasOwnProperty.call(SFX_CUES, declared)) return declared as SfxCueId
  return 'ui-click'
}

export function categoryIds(): readonly SfxCategory[] {
  return SFX_CATEGORIES
}


export interface LogCueRule {
  cue: SfxCueId
  minParam?: string
}

export const LOG_CUE_RULES: Readonly<Record<string, LogCueRule>> = {
  'core.engine.002': { cue: 'skill-done' },
  'core.explore.008': { cue: 'scan-done' },
  'core.explore.009': { cue: 'scan-done' },
  'core.explorationStatus.001': { cue: 'scan-done' },
  'core.station.014': { cue: 'build-done' },
  'core.location.052': { cue: 'build-done' },
  'core.manufacturing.014': { cue: 'industry-done' },
  'core.manufacturing.015': { cue: 'industry-done' },
  'core.lab.023': { cue: 'industry-done' },
  'core.industry.072': { cue: 'industry-done', minParam: 'p2' },
  'core.industry.075': { cue: 'industry-done', minParam: 'p2' },
  'core.industry.076': { cue: 'industry-done', minParam: 'p2' },
  'core.industry.077': { cue: 'industry-done', minParam: 'p2' },
  'core.industry.074': { cue: 'industry-done', minParam: 'p5' },
  'core.industry.083': { cue: 'industry-done', minParam: 'p5' },
  'core.ai.009': { cue: 'trade-done' },
  'core.blackMarket.008': { cue: 'trade-done' },
  'core.expedition.038': { cue: 'trade-done' },
  'core.expedition.047': { cue: 'trade-done' },
  'core.industrial.004': { cue: 'trade-done' },
  'core.market.022': { cue: 'trade-done' },
  'core.market.023': { cue: 'trade-done' },
  'core.market.024': { cue: 'trade-done' },
  'core.market.027': { cue: 'trade-done' },
  'core.market.029': { cue: 'trade-done' },
  'core.market.031': { cue: 'trade-done' },
  'core.shipyard.025': { cue: 'trade-done' },
  'core.skillLicense.006': { cue: 'trade-done' },
  'core.weekend.001': { cue: 'trade-done' },
  'core.weekend.002': { cue: 'trade-done' },
  'core.weekend.043': { cue: 'trade-done' },
  'core.engine.009': { cue: 'ui-error' },
  'core.engine.010': { cue: 'ui-error' },
  'core.skillLicense.005': { cue: 'ui-error' },
  'core.industry.003': { cue: 'ui-error' },
  'core.industry.005': { cue: 'ui-error' },
  'core.manufacturing.001': { cue: 'ui-error' },
}

export function matchLogCue(
  kind: string,
  textId?: string,
  textParams?: Readonly<Record<string, unknown>>,
): SfxCueId | null {
  void kind
  if (typeof textId !== 'string') return null
  const rule = LOG_CUE_RULES[textId]
  if (rule === undefined) return null
  if (rule.minParam !== undefined) {
    const raw = textParams?.[rule.minParam]
    const value = typeof raw === 'number' ? raw : Number(raw)
    if (!(Number.isFinite(value) && value > 0)) return null
  }
  return rule.cue
}


const AUDIO_EXT = /\.(mp3|ogg|wav|m4a)$/i

export function isAudioFileName(fileName: string): boolean {
  return AUDIO_EXT.test(fileName)
}

export function sfxFileBase(fileName: string): string {
  return fileName.replace(/\.[^./\\]+$/, '').trim().toLowerCase()
}

export function matchSfxFileName(fileName: string): SfxCueId | null {
  if (!isAudioFileName(fileName)) return null
  const base = sfxFileBase(fileName)
  if ((SFX_CUE_IDS as readonly string[]).includes(base)) return base as SfxCueId
  const variant = /^(.+)\.\d+$/.exec(base)
  if (variant && (SFX_CUE_IDS as readonly string[]).includes(variant[1]!)) return variant[1] as SfxCueId
  return null
}

export function pickVariant<T>(items: readonly T[], random: () => number): T | null {
  if (items.length === 0) return null
  const raw = random()
  const i = Math.floor((Number.isFinite(raw) ? raw : 0) * items.length)
  return items[Math.min(items.length - 1, Math.max(0, i))] ?? null
}

export function pickOtherVariant<T>(
  items: readonly T[],
  current: T | null,
  random: () => number = Math.random,
): T | null {
  if (items.length === 0) return null
  if (items.length === 1) return items[0] ?? null
  const index = current === null ? -1 : items.indexOf(current)
  const pool = index >= 0 ? items.filter((_, i) => i !== index) : items
  return pickVariant(pool, random)
}


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
