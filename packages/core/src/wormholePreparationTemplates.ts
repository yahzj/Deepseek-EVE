import type { GameState } from './state'
import type { SimContext } from './types'
import { wormholePreparationPlan } from './wormholePreparation'
import type { WormholePreparationPlan, WormholePreparationRequest } from './wormholePreparation'

export const WORMHOLE_TEMPLATE_MAX = 10
export const WORMHOLE_TEMPLATE_NAME_MAX = 32
export interface WormholePreparationTemplate {
  id: string
  name: string
  targets: Record<string, number>
}
export type WormholeTemplateResult = { ok: true; id: string } | { ok: false; code: 'name-empty' | 'name-duplicate' | 'template-missing' | 'template-limit' | 'invalid-targets' }

function cleanTargets(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).filter(([id, n]) => id.length > 0 && id.length <= 128 && Number.isSafeInteger(n) && (n as number) >= 0)) as Record<string, number>
}

/** 兼容字段缺省为空；坏条目不覆盖同id/同名的合法模板。 */
export function cleanWormholePreparationTemplates(value: unknown): WormholePreparationTemplate[] {
  if (!Array.isArray(value)) return []
  const result: WormholePreparationTemplate[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const id = typeof raw.id === 'string' ? raw.id.trim().slice(0, 64) : ''
    const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, WORMHOLE_TEMPLATE_NAME_MAX) : ''
    if (!id || !name || result.some(t => t.id === id || t.name === name)) continue
    const targets = cleanTargets(raw.targets)
    if (Object.keys(targets).length === 0) continue
    result.push({ id, name, targets })
    if (result.length === WORMHOLE_TEMPLATE_MAX) break
  }
  return result
}

function nameError(state: GameState, name: string, exceptId?: string): WormholeTemplateResult | null {
  if (!name) return { ok: false, code: 'name-empty' }
  if (state.wormholePreparationTemplates?.some(t => t.id !== exceptId && t.name === name)) return { ok: false, code: 'name-duplicate' }
  return null
}

export function wormholeSavePreparationTemplate(state: GameState, name: string, targets: Record<string, number>, replaceId?: string): WormholeTemplateResult {
  const finalName = name.trim().slice(0, WORMHOLE_TEMPLATE_NAME_MAX)
  const list = state.wormholePreparationTemplates ?? []
  const existing = replaceId ? list.find(t => t.id === replaceId) : undefined
  if (replaceId && !existing) return { ok: false, code: 'template-missing' }
  const error = nameError(state, finalName, replaceId)
  if (error) return error
  const clean = cleanTargets(targets)
  if (!Object.keys(clean).length || Object.keys(clean).length !== Object.keys(targets).length) return { ok: false, code: 'invalid-targets' }
  if (!existing && list.length >= WORMHOLE_TEMPLATE_MAX) return { ok: false, code: 'template-limit' }
  let sequence = 1
  while (list.some(t => t.id === `manifest-${sequence}`)) sequence++
  const template = { id: existing?.id ?? `manifest-${sequence}`, name: finalName, targets: clean }
  state.wormholePreparationTemplates = existing ? list.map(t => t.id === replaceId ? template : t) : [...list, template]
  return { ok: true, id: template.id }
}

export function wormholeRenamePreparationTemplate(state: GameState, id: string, name: string): WormholeTemplateResult {
  const template = state.wormholePreparationTemplates?.find(t => t.id === id)
  if (!template) return { ok: false, code: 'template-missing' }
  return wormholeSavePreparationTemplate(state, name, template.targets, id)
}

export function wormholeDeletePreparationTemplate(state: GameState, id: string): WormholeTemplateResult {
  const list = state.wormholePreparationTemplates ?? []
  if (!list.some(t => t.id === id)) return { ok: false, code: 'template-missing' }
  const next = list.filter(t => t.id !== id)
  if (next.length) state.wormholePreparationTemplates = next
  else delete state.wormholePreparationTemplates
  return { ok: true, id }
}

/** 模板只修改总量清单；已有货超目标保留，显式卸港不被取消，现役机群不参与补齐。 */
export function wormholeTemplateFillPlan(state: GameState, ctx: SimContext, fleet: readonly string[], request: WormholePreparationRequest, template: WormholePreparationTemplate): WormholePreparationPlan & { excess: Record<string, number> } {
  const onboard = wormholePreparationPlan(state, ctx, fleet, { targets: {}, unload: request.unload })
  const targets = { ...template.targets }
  const excess: Record<string, number> = {}
  for (const row of onboard.rows) {
    const wanted = targets[row.itemId] ?? 0
    if (row.onboard > wanted) excess[row.itemId] = row.onboard - wanted
    targets[row.itemId] = Math.max(row.onboard, wanted)
  }
  for (const id of request.unload) targets[id] = 0
  return { ...wormholePreparationPlan(state, ctx, fleet, { targets, unload: [...request.unload] }), excess }
}
