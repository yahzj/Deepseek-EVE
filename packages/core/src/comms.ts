import { ONB_DONE } from './onboarding'
import { isSiteBuilt } from './state'
import { blackboxSeenOf } from './blackbox'
import { addLog } from './state'
import { noteIndustrialFleetRisk } from './preparationSquads'
import type { GameState } from './state'
import type {
  CommsEntryView,
  CommsInstanceEntry,
  CommsMessageDef,
  CommsTrigger,
  SimContext,
} from './types'
import { deliver, resolveCommsSender } from './commsDelivery'
export { commsDialogueKey, resolveCommsSender } from './commsDelivery'

export const COMMS_DAY_MS = 24 * 3_600_000

export const COMMS_REPLIES_ENABLED = false

export function commsGameClock(gameMs: number): string {
  const t = Math.max(0, Math.floor(gameMs))
  const day = Math.floor(t / COMMS_DAY_MS) + 1
  const rest = t % COMMS_DAY_MS
  const hh = Math.floor(rest / 3_600_000)
  const mm = Math.floor((rest % 3_600_000) / 60_000)
  return `第 ${day} 天 ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

export function commsPopupQueue(state: GameState): string[] {
  return state.commsPopups ?? []
}

export function dismissCommsPopup(state: GameState, id: string): boolean {
  const list = state.commsPopups ?? []
  if (!list.includes(id)) return false
  state.commsPopups = list.filter((x) => x !== id)
  markCommsRead(state, id)
  return true
}

export function commsTriggerMet(state: GameState, ctx: SimContext, trigger: CommsTrigger): boolean {
  switch (trigger.kind) {
    case 'industrialFleetRisk': return state.industrialFleetRiskSeen === true
    case 'foeShipSeen':
      return state.foeShipSeen?.[trigger.shipId] === true
    case 'blackboxSeen':
      return blackboxSeenOf(state)
    case 'firstTask':
      return state.importantTasks[trigger.taskId]?.done === true
    case 'start':
      return state.onboarding.step >= ONB_DONE
    case 'labOpened':
      return state.labOpened === true
    case 'day':
      return state.gameMs >= trigger.days * COMMS_DAY_MS
    case 'explored':
      return state.exploredGalaxies.length >= trigger.count
    case 'galaxy':
      return state.exploredGalaxies.includes(trigger.galaxyId)
    case 'skill':
      return (state.skills.trained[trigger.skillId] ?? 0) >= trigger.level
    case 'isk':
      return state.wallet.isk >= trigger.amount
    case 'standing':
      return (state.standingsEarned?.[trigger.factionId] ?? state.standings[trigger.factionId] ?? 0) >= trigger.min
    case 'siteBuilt': {
      const site = ctx.stations.get(trigger.siteId)
      return site !== undefined && isSiteBuilt(state, site)
    }
    case 'lowSec':
      return state.exploredGalaxies.some(
        (galaxyId) => (ctx.galaxies.get(galaxyId)?.security ?? 1) <= ctx.balance.encounter.lowSecMax,
      )
    case 'foeFamily': {
      for (const anomaly of ctx.anomalies.values()) {
        if (anomaly.hidden === true) continue
        if (anomaly.foeFamily !== trigger.family) continue
        if (state.exploredGalaxies.includes(anomaly.galaxyId)) return true
      }
      return false
    }
    case 'wormholeNebula':
      return state.wormhole.nebulaHintShown === true
    case 'wormholeSiege':
      return state.wormhole.siegeHintShown === true
    case 'ambushRetreat': {
      if (state.ambushRetreatSeen === true) return true
      if (state.ambushRetreatSeen === false) return false
      return Object.keys(state.encounterZoneCooldown).length > 0
    }
    case 'shipBuilt':
      return state.firstShipBuilt === true
    default:
      return false
  }
}

function deliveryLogText(ctx: SimContext, msg: CommsMessageDef): string {
  const sender = resolveCommsSender(ctx, msg.factionId, msg.deptId, msg.kind, msg.signer)
  return `[通讯] 收到 ${sender.from} 的一条消息：《${msg.subject}》——导航「通讯」可查看。`
}

function commsBusy(state: GameState): boolean {
  if (state.wormhole.run != null) return true
  return state.expedition?.battle != null
}

export function advanceComms(state: GameState, ctx: SimContext): void {
  noteIndustrialFleetRisk(state, ctx)
  if (ctx.commsMessages.size === 0) return
  let popupUsed = false
  for (const msg of ctx.commsMessages.values()) {
    if (msg.unreleased === true) continue
    if (!commsTriggerMet(state, ctx, msg.trigger)) continue
    if (msg.holdWhenBusy === true && commsBusy(state)) continue
    if (!deliver(state, msg.id)) continue
    addLog(state, 'info', deliveryLogText(ctx, msg))
    const wantPopup = msg.popup ?? msg.kind !== '教程'
    if (wantPopup && !popupUsed) {
      const list = state.commsPopups ?? []
      if (!list.includes(msg.id)) state.commsPopups = [...list, msg.id]
      popupUsed = true
    }
  }
}

export function commsInbox(state: GameState, ctx: SimContext): CommsEntryView[] {
  const out: CommsEntryView[] = []
  const FALLBACK_SENDER = { factionName: '', alignment: '', kind: '', tone: '', glyph: '' } as const
  const delivered: Record<string, number> = state.commsDelivered ?? {}
  for (const [id, at] of Object.entries(delivered)) {
    const atMs = Number.isFinite(at) ? Math.max(0, Math.floor(at)) : 0
    if (id.startsWith('dlg:')) {
      const script = ctx.dialogues.get(id.slice(4))
      if (!script) continue
      const sender = script.commsFactionId
        ? resolveCommsSender(ctx, script.commsFactionId, script.commsDeptId, undefined, script.commsSigner)
        : { from: script.title, ...FALLBACK_SENDER }
      out.push({
        id,
        source: 'dialogue',
        from: sender.from,
        factionName: sender.factionName,
        alignment: sender.alignment,
        kind: sender.kind,
        signer: sender.signer,
        fromBrief: sender.fromBrief,
        tone: sender.tone,
        glyph: sender.glyph,
        subject: script.subject ?? script.title,
        paragraphs: script.lines.map((l) => `${l.speaker}：${l.text}`),
        deliveredAtGameMs: atMs,
        read: state.commsRead?.[id] === true,
      })
      continue
    }
    const msg = ctx.commsMessages.get(id)
    if (!msg) continue
    const sender = resolveCommsSender(ctx, msg.factionId, msg.deptId, msg.kind, msg.signer)
    out.push({
      id,
      source: 'message',
      from: sender.from,
      factionName: sender.factionName,
      alignment: sender.alignment,
      kind: sender.kind,
      signer: sender.signer,
      fromBrief: sender.fromBrief,
      tone: sender.tone,
      glyph: sender.glyph,
      subject: msg.subject,
      paragraphs: msg.body,
      highlight: msg.highlight,
      deliveredAtGameMs: atMs,
      read: state.commsRead?.[id] === true,
      hint: msg.hint,
      ...(msg.hint?.action !== undefined ? { action: msg.hint.action } : {}),
      replies: msg.replies,
    })
  }
  for (const [id, e] of Object.entries(state.commsInstance ?? {})) {
    const at = delivered[id]
    if (at === undefined) continue
    const instSender = resolveCommsSender(ctx, e.factionId, e.deptId, e.kind)
    out.push({
      id,
      source: 'message',
      from: instSender.from,
      factionName: instSender.factionName,
      alignment: instSender.alignment,
      kind: instSender.kind,
      signer: instSender.signer,
      fromBrief: instSender.fromBrief,
      tone: instSender.tone,
      glyph: instSender.glyph,
      subject: e.subject,
      paragraphs: e.paragraphs,
      deliveredAtGameMs: Math.max(0, Math.floor(at)),
      read: state.commsRead?.[id] === true,
      ...(e.hint !== undefined
        ? { hint: { text: e.hint.text, ...(e.hint.page !== undefined ? { page: e.hint.page } : {}) } }
        : {}),
      subjectId: e.subjectId,
      bodyIds: e.bodyIds,
      ...(e.params !== undefined ? { textParams: e.params } : {}),
      ...(e.hint?.action !== undefined ? { action: e.hint.action } : {}),
      ...(e.rewards !== undefined ? { rewards: e.rewards } : {}),
    })
  }
  out.sort((a, b) => (b.deliveredAtGameMs - a.deliveredAtGameMs) || a.id.localeCompare(b.id))
  return out
}

export function deliverCommsInstance(state: GameState, ctx: SimContext, entry: CommsInstanceEntry): boolean {
  const at = Math.max(0, Math.floor(state.gameMs))
  const prev = state.commsInstance?.[entry.id]
  state.commsInstance = { ...(state.commsInstance ?? {}), [entry.id]: { ...entry, atGameMs: at } }
  state.commsDelivered = { ...(state.commsDelivered ?? {}), [entry.id]: at }
  if (state.commsRead?.[entry.id] === true) {
    const next = { ...state.commsRead }
    delete next[entry.id]
    state.commsRead = next
  }
  const list = state.commsPopups ?? []
  if (!list.includes(entry.id)) state.commsPopups = [...list, entry.id]
  const sender = resolveCommsSender(ctx, entry.factionId, entry.deptId, entry.kind)
  addLog(state, 'info', `[通讯] 收到 ${sender.from} 的一条消息：《${entry.subject}》——导航「通讯」可查看。`, 'core.comms.001', {
    p1: sender.from,
    p2: entry.subject,
  })
  return prev !== undefined
}

export function commsUnreadCount(state: GameState, ctx: SimContext): number {
  return commsInbox(state, ctx).filter((e) => !e.read).length
}

export function markCommsRead(
  state: GameState,
  id: string,
): { ok: boolean; error?: string; errorId?: string; errorParams?: Readonly<Record<string, string | number>> } {
  if (state.commsDelivered?.[id] === undefined) {
    return { ok: false, error: '没有这封通讯（可能已被撤销）。', errorId: 'core.comms.002' }
  }
  state.commsRead ??= {}
  state.commsRead[id] = true
  return { ok: true }
}

export function markAllCommsRead(state: GameState, ctx: SimContext): number {
  let n = 0
  state.commsRead ??= {}
  for (const e of commsInbox(state, ctx)) {
    if (e.read) continue
    state.commsRead[e.id] = true
    n += 1
  }
  return n
}

