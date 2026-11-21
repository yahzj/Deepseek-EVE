import { addLog, shipLockedReason } from './state'
import { shipOperationBlockReason } from './shipActionPolicy'
import type { CommandResult } from './engine'
import type { GameState, ShipFitPreset, WreckLogEntry } from './state'
import type { RackSlot, SimContext } from './types'
import { rackBays, shipSlotsOf } from './labels'
import { isPlugOf, shipSlotsWithPlugsOf } from './plugs'
import { addModule, adjustDroneLoad, countModule, fitModule, trimDroneLoadToBay } from './equipment'
import { addWare } from './inventory'
import { fleetDefOf } from './instances'

export const FIT_PRESET_MAX = 10
export const FIT_PRESET_NAME_MAX = 12
const RACK_ORDER: readonly RackSlot[] = ['high', 'mid', 'low']

export function fitPresetsOf(state: GameState, defId: string): readonly ShipFitPreset[] {
  return state.fitPresets?.[defId] ?? []
}

export function fitPresetBrief(preset: ShipFitPreset): string {
  const count = (a: Array<string | null> | undefined): number => (a ?? []).filter((x) => x !== null && x !== '').length
  const high = count(preset.fitted.high)
  const mid = count(preset.fitted.mid)
  const low = count(preset.fitted.low)
  const load = preset.droneLoad ?? {}
  const drones = Object.values(load).reduce((s, n) => s + n, 0)
  const parts = [`装备 ${high + mid + low} 件（高 ${high} / 中 ${mid} / 低 ${low}）`]
  if (drones > 0) parts.push(`无人机 ${Object.keys(load).length} 型 ${drones} 架`)
  return parts.join(' · ')
}

export interface FitPresetSlotLine {
  rack: RackSlot
  index: number
  id: string | null
  name: string
  missing: boolean
}
export interface FitPresetDroneLine {
  id: string
  name: string
  count: number
  missing: boolean
}
export interface FitPresetDetail {
  slots: FitPresetSlotLine[]
  drones: FitPresetDroneLine[]
  plugs: Array<{ id: string; name: string; missing: boolean }>
  overflow: number
}

export function fitPresetDetailOf(
  preset: ShipFitPreset,
  ctx: SimContext,
  ship: { slots?: import('./types').ShipSlots },
  effSlots?: import('./types').ShipSlots,
): FitPresetDetail {
  const bays = effSlots ?? shipSlotsOf(ship)
  const slots: FitPresetSlotLine[] = []
  let overflow = 0
  for (const rack of RACK_ORDER) {
    const src = preset.fitted[rack] ?? []
    const baysN = bays[rack]
    if (src.length > baysN) overflow += src.length - baysN
    for (let i = 0; i < baysN; i++) {
      const raw = src[i]
      const id = raw === null || raw === undefined || raw === '' ? null : raw
      const def = id === null ? undefined : ctx.modules.get(id)
      slots.push({
        rack,
        index: i + 1,
        id,
        name: id === null ? '空' : (def?.name ?? id),
        missing: id !== null && def === undefined,
      })
    }
  }
  const drones: FitPresetDroneLine[] = Object.entries(preset.droneLoad ?? {})
    .filter(([, n]) => n > 0)
    .map(([id, count]) => {
      const def = ctx.items.get(id)
      return { id, name: def?.name ?? id, count, missing: def === undefined }
    })
  const plugs = (preset.plugs ?? []).map(id => {
    const def = ctx.modules.get(id)
    return { id, name: def?.name ?? id, missing: def === undefined }
  })
  return { slots, drones, plugs, overflow }
}

export function wreckFitDetailOf(ctx: SimContext, entry: WreckLogEntry): FitPresetDetail {
  const ship = ctx.ships.get(entry.defId ?? '')
  const base = shipSlotsOf(ship ?? {})
  const plugDefs = (entry.plugs ?? []).map(id => ctx.modules.get(id)).filter(isPlugOf)
  const fitted = entry.fitted ?? { high: [], mid: [], low: [] }
  const slots = { high: Math.max(base.high, fitted.high.length),
    mid: Math.max(base.mid + plugDefs.reduce((n, p) => n + (p?.midSlotsAdd ?? 0), 0), fitted.mid.length),
    low: Math.max(base.low + plugDefs.reduce((n, p) => n + (p?.lowSlotsAdd ?? 0), 0), fitted.low.length) }
  return fitPresetDetailOf({ name: '', fitted, droneLoad: entry.droneLoad, plugs: entry.plugs }, ctx, ship ?? {}, slots)
}

function trimFitted(fitted: { high: Array<string | null>; mid: Array<string | null>; low: Array<string | null> }): ShipFitPreset['fitted'] {
  const trim = (a: Array<string | null>): Array<string | null> => {
    const out = [...a]
    while (out.length > 0 && (out[out.length - 1] === null || out[out.length - 1] === '')) out.pop()
    return out.map((x) => (x === '' ? null : x))
  }
  return { high: trim(fitted.high), mid: trim(fitted.mid), low: trim(fitted.low) }
}

function defaultName(list: readonly ShipFitPreset[]): string {
  const taken = new Set(list.map((p) => p.name))
  for (let i = 1; i <= FIT_PRESET_MAX + 1; i++) {
    const name = `方案 ${i}`
    if (!taken.has(name)) return name
  }
  return `方案 ${list.length + 1}`
}

function captureFit(
  state: GameState,
  ctx: SimContext,
  shipId: string,
  what: string,
): {
  ok: true
  fitted: ShipFitPreset['fitted']
  droneLoad: Record<string, number>
  plugs: string[]
} | { ok: false; error: string; errorId?: string; errorParams?: Readonly<Record<string, string | number>> } {
  const lock = shipLockedReason(state, shipId, what)
  if (lock) return { ok: false, error: lock }
  const shipDef = fleetDefOf(state, ctx, shipId)
  const fleet = state.fleet[shipId]
  if (!shipDef || !fleet) {
    return { ok: false, error: '舰队里找不到该舰船，无法保存装配方案。', errorId: 'core.fitPresets.001' }
  }
  const loadRaw = fleet.droneLoad ?? {}
  const droneLoad: Record<string, number> = {}
  for (const [id, n] of Object.entries(loadRaw)) if (n > 0) droneLoad[id] = n
  const fitted = trimFitted(fleet.fitted)
  const plugs = [...(fleet.plugs ?? [])]
  if (fitted.high.length + fitted.mid.length + fitted.low.length === 0 && Object.keys(droneLoad).length === 0 && !plugs.length) {
    return {
      ok: false,
      error: '这艘船现在没装任何装备、机舱也是空的：先装几件再保存（要清空装配请用「一键卸下全部装备」）。',
      errorId: 'core.fitPresets.004',
    }
  }
  return { ok: true, fitted, droneLoad, plugs }
}

function storeFitPreset(state: GameState, ctx: SimContext, defId: string, source: Omit<ShipFitPreset, 'name'>, name?: string,
  confirm?: { expected?: ShipFitPreset }): WreckFitSaveResult {
  const ship = ctx.ships.get(defId)!
  const list = [...fitPresetsOf(state, defId)]
  const wanted = (name ?? '').trim().slice(0, FIT_PRESET_NAME_MAX)
  const finalName = wanted || defaultName(list)
  const at = list.findIndex(p => p.name === finalName)
  if (confirm?.expected && (at < 0 || JSON.stringify(list[at]) !== JSON.stringify(confirm.expected))) {
    return { ok: false, errorId: 'core.wreckFit.004', error: '目标方案已变化，请重新确认。' }
  }
  if (at >= 0 && confirm && !confirm.expected) {
    return { ok: false, errorId: 'core.wreckFit.003', error: `已有同名方案「${finalName}」，确认后才会覆盖。`,
      errorParams: { name: finalName }, overwrite: structuredClone(list[at]!) }
  }
  if (at < 0 && list.length >= FIT_PRESET_MAX) {
    return { ok: false, error: `「${ship.name}」已有 ${FIT_PRESET_MAX} 套装配方案：先删掉一套，或用一个同名方案覆盖它。`,
      errorId: 'core.fitPresets.005', errorParams: { p1: ship.name, p2: FIT_PRESET_MAX } }
  }
  const preset = { name: finalName, ...source }
  if (at >= 0) list[at] = preset
  else list.push(preset)
  state.fitPresets = { ...(state.fitPresets ?? {}), [defId]: list }
  addLog(state, 'fleet', `已保存装配方案「${finalName}」（${ship.name} · ${fitPresetBrief(preset)}）。`,
    'core.fitPresets.009', { p1: finalName, p2: ship.name, p3: fitPresetBrief(preset) })
  return { ok: true }
}

export type WreckFitSaveResult = CommandResult & { overwrite?: ShipFitPreset }

export function saveWreckFitPreset(state: GameState, ctx: SimContext, seq: number, name?: string, expectedOverwrite?: ShipFitPreset): WreckFitSaveResult {
  const entry = state.wreckLog?.find(row => row.seq === seq)
  if (!entry) return { ok: false, errorId: 'core.wreckFit.001', error: '沉船记录已不存在。' }
  if (!entry.defId || !ctx.ships.has(entry.defId)) return { ok: false, errorId: 'core.wreckFit.002', error: '这条记录缺少可识别的船型，无法保存方案。' }
  const fitted = trimFitted(entry.fitted ?? { high: [], mid: [], low: [] })
  const droneLoad = Object.fromEntries(Object.entries(entry.droneLoad ?? {}).filter(([, n]) => Number.isSafeInteger(n) && n > 0))
  const plugs = [...(entry.plugs ?? [])]
  if (!fitted.high.length && !fitted.mid.length && !fitted.low.length && !Object.keys(droneLoad).length && !plugs.length) {
    return { ok: false, errorId: 'core.wreckFit.005', error: '这条记录没有可保存的装配。' }
  }
  return storeFitPreset(state, ctx, entry.defId, { fitted, ...(Object.keys(droneLoad).length ? { droneLoad } : {}),
    ...(plugs.length ? { plugs } : {}) }, name, { expected: expectedOverwrite })
}

export function saveFitPreset(state: GameState, ctx: SimContext, shipId: string, name?: string): CommandResult {
  const shipDef = fleetDefOf(state, ctx, shipId)
  if (!shipDef) {
    return { ok: false, error: '舰队里找不到该舰船，无法保存装配方案。', errorId: 'core.fitPresets.001' }
  }
  const list = [...fitPresetsOf(state, shipDef.id)]
  const wanted = (name ?? '').trim().slice(0, FIT_PRESET_NAME_MAX)
  const finalName = wanted.length > 0 ? wanted : defaultName(list)
  const at = list.findIndex((p) => p.name === finalName)
  if (at < 0 && list.length >= FIT_PRESET_MAX) {
    return {
      ok: false,
      error: `「${shipDef.name}」已有 ${FIT_PRESET_MAX} 套装配方案：先删掉一套，或用一个同名方案覆盖它。`,
      errorId: 'core.fitPresets.005',
      errorParams: { p1: shipDef.name, p2: FIT_PRESET_MAX },
    }
  }
  const cap = captureFit(state, ctx, shipId, '保存它的装配方案')
  if (!cap.ok) return { ok: false, error: cap.error }
  return storeFitPreset(state, ctx, shipDef.id, {
    fitted: cap.fitted,
    ...(Object.keys(cap.droneLoad).length > 0 ? { droneLoad: cap.droneLoad } : {}),
    ...(cap.plugs.length ? { plugs: cap.plugs } : {}),
  }, finalName)
}

export function overwriteFitPreset(state: GameState, ctx: SimContext, shipId: string, index: number): CommandResult {
  const shipDef = fleetDefOf(state, ctx, shipId)
  if (!shipDef) {
    return { ok: false, error: '舰队里找不到该舰船，无法替换装配方案。', errorId: 'core.fitPresets.002' }
  }
  const list = [...fitPresetsOf(state, shipDef.id)]
  const target = list[index]
  if (!target) return { ok: false, error: '找不到这套装配方案（可能已被删除）。', errorId: 'core.fitPresets.006' }
  const cap = captureFit(state, ctx, shipId, '保存它的装配方案')
  if (!cap.ok) return { ok: false, error: cap.error }
  const preset: ShipFitPreset = {
    name: target.name,
    fitted: cap.fitted,
    ...(Object.keys(cap.droneLoad).length > 0 ? { droneLoad: cap.droneLoad } : {}),
    ...(cap.plugs.length ? { plugs: cap.plugs } : {}),
  }
  list[index] = preset
  state.fitPresets = { ...(state.fitPresets ?? {}), [shipDef.id]: list }
  addLog(
    state,
    'fleet',
    `已用当前装配覆盖方案「${target.name}」（${shipDef.name} · ${fitPresetBrief(preset)}）。`,
    'core.fitPresets.013',
    { p1: target.name, p2: shipDef.name, p3: fitPresetBrief(preset) },
  )
  return { ok: true }
}

export function renameFitPreset(state: GameState, defId: string, index: number, name: string): CommandResult {
  const list = [...fitPresetsOf(state, defId)]
  const preset = list[index]
  if (!preset) return { ok: false, error: '找不到这套装配方案（可能已被删除）。', errorId: 'core.fitPresets.006' }
  const finalName = name.trim().slice(0, FIT_PRESET_NAME_MAX)
  if (finalName.length === 0) return { ok: false, error: '方案名不能为空。', errorId: 'core.fitPresets.007' }
  if (list.some((p, i) => i !== index && p.name === finalName)) {
    return {
      ok: false,
      error: `已有同名方案「${finalName}」：换个名字，或直接覆盖那一条。`,
      errorId: 'core.fitPresets.008',
      errorParams: { p1: finalName },
    }
  }
  const old = preset.name
  list[index] = { ...preset, name: finalName }
  state.fitPresets = { ...(state.fitPresets ?? {}), [defId]: list }
  addLog(state, 'fleet', `装配方案「${old}」已改名为「${finalName}」。`, 'core.fitPresets.010', { p1: old, p2: finalName })
  return { ok: true }
}

export function deleteFitPreset(state: GameState, defId: string, index: number): CommandResult {
  const list = [...fitPresetsOf(state, defId)]
  const preset = list[index]
  if (!preset) return { ok: false, error: '找不到这套装配方案（可能已被删除）。', errorId: 'core.fitPresets.006' }
  list.splice(index, 1)
  const next = { ...(state.fitPresets ?? {}) }
  if (list.length > 0) next[defId] = list
  else delete next[defId]
  state.fitPresets = Object.keys(next).length > 0 ? next : undefined
  addLog(state, 'fleet', `已删除装配方案「${preset.name}」。`, 'core.fitPresets.011', { p1: preset.name })
  return { ok: true }
}

export interface UnfitAllResult {
  ok: boolean
  error?: string
  errorId?: string
  errorParams?: Readonly<Record<string, string | number>>
  removed: number
}

export function unfitAllModules(state: GameState, ctx: SimContext, shipId: string, quiet = false): UnfitAllResult {
  const blocked = shipOperationBlockReason(state, ctx, shipId, 'configure')
  if (blocked) return { ok: false, ...blocked, removed: 0 }
  const lock = shipLockedReason(state, shipId, '卸下它的装备')
  if (lock) return { ok: false, error: lock, removed: 0 }
  const fleet = state.fleet[shipId]
  const fitted = fleet?.fitted
  if (!fitted) return { ok: true, removed: 0 }
  let removed = 0
  for (const rack of RACK_ORDER) {
    const bays = rackBays(fitted, rack)
    for (let i = 0; i < bays.length; i++) {
      const id = bays[i]
      if (id === null || id === undefined || id === '') continue
      bays[i] = null
      addModule(state, id)
      removed += 1
    }
  }
  if (removed > 0) {
    trimDroneLoadToBay(state, ctx, shipId)
    if (!quiet) {
      addLog(
        state,
        'fleet',
        `已卸下全部装备 ${removed} 件（放回装备库），甲板扩容器一并卸下。`,
        'core.fitPresets.012',
        { p1: removed },
      )
    }
  }
  return { ok: true, removed }
}

export function clearDroneLoad(state: GameState, ctx: SimContext, shipId: string): number {
  if (shipOperationBlockReason(state, ctx, shipId, 'configure')) return 0
  const fleet = state.fleet[shipId]
  const load = fleet?.droneLoad ?? {}
  let out = 0
  for (const [id, n] of Object.entries(load)) {
    if (n > 0) {
      addWare(state, id, n)
      out += n
    }
  }
  if (fleet && out > 0) fleet.droneLoad = undefined
  return out
}

export interface FitPresetApplyResult {
  ok: boolean
  error?: string
  errorId?: string
  errorParams?: Readonly<Record<string, string | number>>
  summary: string
}

export function applyFitPreset(state: GameState, ctx: SimContext, shipId: string, index: number): FitPresetApplyResult {
  const operationBlock = shipOperationBlockReason(state, ctx, shipId, 'configure')
  if (operationBlock) return { ok: false, ...operationBlock, summary: '' }
  const lock = shipLockedReason(state, shipId, '换装')
  if (lock) return { ok: false, error: lock, summary: '' }
  const shipDef = fleetDefOf(state, ctx, shipId)
  if (!shipDef) return { ok: false, error: '舰队里找不到该舰船，无法套用装配方案。', errorId: 'core.fitPresets.003', summary: '' }
  const preset = fitPresetsOf(state, shipDef.id)[index]
  if (!preset) {
    return { ok: false, error: '找不到这套装配方案（可能已被删除）。', errorId: 'core.fitPresets.006', summary: '' }
  }

  const removed = unfitAllModules(state, ctx, shipId, true).removed
  const dronesOut = clearDroneLoad(state, ctx, shipId)

  const slots = shipSlotsWithPlugsOf(state, ctx, shipId)
  const jobs: Array<{ rack: RackSlot; index: number; moduleId: string }> = []
  for (const rack of RACK_ORDER) {
    const src = preset.fitted[rack] ?? []
    const want = Math.min(src.length, slots[rack])
    for (let i = 0; i < want; i++) {
      const id = src[i]
      if (id !== null && id !== undefined && id !== '') jobs.push({ rack, index: i, moduleId: id })
    }
  }
  const boost = (j: { moduleId: string }): number => ((ctx.modules.get(j.moduleId)?.cpuBonus ?? 0) > 0 ? 1 : 0)
  jobs.sort(
    (a, b) =>
      boost(b) - boost(a) ||
      RACK_ORDER.indexOf(a.rack) - RACK_ORDER.indexOf(b.rack) ||
      a.index - b.index,
  )

  const missing: string[] = []
  const blocked: string[] = []
  let installed = 0
  for (const j of jobs) {
    const def = ctx.modules.get(j.moduleId)
    if (!def) {
      blocked.push(`未知装备（${j.moduleId}）`)
      continue
    }
    if (countModule(state, j.moduleId) < 1) {
      missing.push(def.name)
      continue
    }
    const res = fitModule(state, j.moduleId, ctx, { rack: j.rack, index: j.index, shipId })
    if (res.ok) installed += 1
    else blocked.push(`${def.name}：${res.error ?? '未能装上'}`)
  }

  let dronesIn = 0
  const droneFail: string[] = []
  for (const [droneId, n] of Object.entries(preset.droneLoad ?? {})) {
    if (n <= 0) continue
    const def = ctx.items.get(droneId)
    if (!def) {
      droneFail.push(`未知机型（${droneId}）×${n}`)
      continue
    }
    const res = adjustDroneLoad(state, ctx, droneId, n, shipId)
    if (res.ok) dronesIn += n
    else droneFail.push(`${def.name}×${n}：${res.error ?? '未能装入'}`)
  }

  const bits = [`卸下 ${removed} 件`, `装上 ${installed} 件`]
  if (dronesOut > 0) bits.push(`退回无人机 ${dronesOut} 架`)
  if (dronesIn > 0) bits.push(`装入无人机 ${dronesIn} 架`)
  if (missing.length > 0) bits.push(`装备库缺 ${missing.length} 件（${missing.join('、')}）`)
  if (blocked.length > 0) bits.push(`${blocked.length} 件未装（${blocked.join('；')}）`)
  if (droneFail.length > 0) bits.push(`无人机未装（${droneFail.join('；')}）`)
  const summary = `已套用「${preset.name}」（${shipDef.name}）：${bits.join(' · ')}`
  const imperfect = missing.length > 0 || blocked.length > 0 || droneFail.length > 0
  addLog(state, imperfect ? 'warn' : 'info', `${summary}。`)
  return { ok: true, summary }
}
