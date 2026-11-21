import { addLog } from './state'
import type { GameState } from './state'
import type { CommsFactionAlignment, CommsKind, SimContext } from './types'

export interface CommsSenderView {
  from: string
  factionName: string
  alignment: CommsFactionAlignment | ''
  kind: CommsKind | ''
  signer?: string
  fromBrief?: string
  tone: string
  glyph: string
}

export function resolveCommsSender(
  ctx: SimContext,
  factionId: string,
  deptId?: string,
  kind?: CommsKind,
  signer?: string,
): CommsSenderView {
  const faction = ctx.commsFactions?.get(factionId)
  if (!faction) {
    return {
      from: deptId ? `${factionId} · ${deptId}` : factionId,
      factionName: '',
      alignment: '',
      kind: '',
      signer,
      tone: '',
      glyph: '',
    }
  }
  const dept = deptId ? faction.departments.find((d) => d.id === deptId) : undefined
  const briefs = [faction.brief, dept?.brief].filter((b): b is string => Boolean(b))
  return {
    from: dept ? `${faction.name} · ${dept.name}` : faction.name,
    factionName: faction.name,
    alignment: faction.alignment,
    kind: kind ?? '',
    signer,
    fromBrief: briefs.length > 0 ? briefs.join(' ') : undefined,
    tone: faction.tone,
    glyph: faction.glyph,
  }
}

export function commsDialogueKey(scriptId: string): string {
  return `dlg:${scriptId}`
}

export function deliver(state: GameState, id: string): boolean {
  const map = (state.commsDelivered ??= {})
  if (map[id] !== undefined) return false
  map[id] = Math.max(0, Math.floor(state.gameMs))
  return true
}

export function deliverDialogueToComms(state: GameState, ctx: SimContext, scriptId: string): void {
  const script = ctx.dialogues.get(scriptId)
  if (!script) return
  const key = commsDialogueKey(scriptId)
  if (!deliver(state, key)) return
  const sender = script.commsFactionId
    ? resolveCommsSender(ctx, script.commsFactionId, script.commsDeptId, undefined, script.commsSigner)
    : undefined
  const from = sender?.from ?? script.title
  addLog(
    state,
    'info',
    `[通讯] 收到 ${from} 的一条消息：《${script.subject ?? script.title}》——导航「通讯」可查看。`,
    'core.comms.001',
    { p1: from, p2: script.subject ?? script.title },
  )
}
