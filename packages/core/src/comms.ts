/**
 * 通讯（收件箱）系统（2026-09-11 船长定：NPC 通过"给玩家发消息"补充剧情或发布任务提示）。
 *
 * 口径（详见 `docs/design/comms-20260911.md`，六条裁决全为「甲」）：
 * - 消息来自 `data/src/messages.ts` 的数据表 + **触发条件**；本模块每帧廉价判定、条件满足一次即送达（幂等）。
 * - 送达记账 = `state.commsDelivered[id] = gameMs`；已读 = `state.commsRead[id] = true`（两字段可选、零迁移）。
 * - **合并**：T9 建站剧本（介绍/庆贺）在送达或播放时也镜像进同一收件箱（键 `dlg:<剧本 id>`），
 *   于是"通讯页"是玩家侧唯一的 NPC 通信记录；剧本原有的弹层行为不变。
 * - **只给提示 + 跳转**：消息可带 `hint`，但通讯页不接取/不完成任何任务。
 * - **回复接口预留但不启用**：见 `COMMS_REPLIES_ENABLED`（玩家侧不出现任何回复控件）。
 */
import { ONB_EPILOGUE } from './onboarding'
import { isSiteBuilt } from './station'
import { addLog } from './state'
import type { GameState } from './state'
import type { CommsEntryView, CommsMessageDef, CommsTrigger, SimContext } from './types'

/** 通讯里的"天"（游戏内时间；与赏金日板的 24 小时同口径） */
export const COMMS_DAY_MS = 24 * 3_600_000

/**
 * 回复选项开关（2026-09-11 船长定：**预留接口，目前不启用**）。
 * 置 true 时通讯页才渲染 `CommsMessageDef.replies` 对应按钮；本期保持 false（不出现空按钮）。
 */
export const COMMS_REPLIES_ENABLED = false

/** 剧本镜像到收件箱的键（与数据消息 id 区分；`id` 里的 `dlg:` 前缀是稳定约定） */
export function commsDialogueKey(scriptId: string): string {
  return `dlg:${scriptId}`
}

/** 游戏内时钟文本（收件箱时间列：第 N 天 hh:mm；day 从 1 起） */
export function commsGameClock(gameMs: number): string {
  const t = Math.max(0, Math.floor(gameMs))
  const day = Math.floor(t / COMMS_DAY_MS) + 1
  const rest = t % COMMS_DAY_MS
  const hh = Math.floor(rest / 3_600_000)
  const mm = Math.floor((rest % 3_600_000) / 60_000)
  return `第 ${day} 天 ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

/** 送达记账（幂等）：未送达则写入时间并返回 true */
function deliver(state: GameState, id: string): boolean {
  const map = (state.commsDelivered ??= {})
  if (map[id] !== undefined) return false
  map[id] = Math.max(0, Math.floor(state.gameMs))
  return true
}

/** 单条触发条件是否达成（新增 kind 时须同步 content-check 的「通讯消息契约」） */
export function commsTriggerMet(state: GameState, ctx: SimContext, trigger: CommsTrigger): boolean {
  switch (trigger.kind) {
    case 'start':
      // 序章引导（采矿→交付→出售→修复→试炼→技能→分身）期间导航被教程锁定，通讯页打不开；
      // 故开局信等引导走完（收尾演出起）再送，玩家收得到、也点得开。
      return state.onboarding.step >= ONB_EPILOGUE
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
    case 'siteBuilt': {
      const site = ctx.stations.get(trigger.siteId)
      return site !== undefined && isSiteBuilt(state, site)
    }
    default:
      return false
  }
}

/** 送达文案（事件日志一行；玩家可见文案，禁开发腔） */
function deliveryLogText(msg: CommsMessageDef): string {
  return `[通讯] 收到 ${msg.from} 的一条消息：《${msg.subject}》——导航「通讯」可查看。`
}

/**
 * 引擎内部：推进通讯收件箱（每次时间推进后调用）。
 * 廉价：表为空或全部已送达时立即返回；触发判定只读 state 字段。
 */
export function advanceComms(state: GameState, ctx: SimContext): void {
  if (ctx.commsMessages.size === 0) return
  for (const msg of ctx.commsMessages.values()) {
    if (!commsTriggerMet(state, ctx, msg.trigger)) continue
    if (deliver(state, msg.id)) addLog(state, 'info', deliveryLogText(msg))
  }
}

/**
 * 剧本镜像进收件箱（幂等；未知剧本直接跳过）。
 * 调用点：`station.ts` 挂起待播通讯时、`playDialogue` 登记已读时（两处都调，谁先到都只记一次）。
 */
export function deliverDialogueToComms(state: GameState, ctx: SimContext, scriptId: string): void {
  const script = ctx.dialogues.get(scriptId)
  if (!script) return
  const key = commsDialogueKey(scriptId)
  if (!deliver(state, key)) return
  addLog(state, 'info', `[通讯] 收到 ${script.title} 的一条消息：《${script.subject ?? script.title}》——导航「通讯」可查看。`)
}

/**
 * 收件箱视图（全部已送达消息，按送达时间倒序）。
 * 已送达但当前数据表里查不到（消息被撤下/剧本改名）→ 跳过不显示，但保留记账（不重复送）。
 */
export function commsInbox(state: GameState, ctx: SimContext): CommsEntryView[] {
  const out: CommsEntryView[] = []
  const delivered: Record<string, number> = state.commsDelivered ?? {}
  for (const [id, at] of Object.entries(delivered)) {
    const atMs = Number.isFinite(at) ? Math.max(0, Math.floor(at)) : 0
    if (id.startsWith('dlg:')) {
      const script = ctx.dialogues.get(id.slice(4))
      if (!script) continue
      out.push({
        id,
        source: 'dialogue',
        from: script.title,
        subject: script.subject ?? script.title,
        paragraphs: script.lines.map((l) => `${l.speaker}：${l.text}`),
        deliveredAtGameMs: atMs,
        read: state.commsRead?.[id] === true,
      })
      continue
    }
    const msg = ctx.commsMessages.get(id)
    if (!msg) continue
    out.push({
      id,
      source: 'message',
      from: msg.from,
      subject: msg.subject,
      paragraphs: msg.body,
      deliveredAtGameMs: atMs,
      read: state.commsRead?.[id] === true,
      hint: msg.hint,
      replies: msg.replies,
    })
  }
  // 送达时间倒序（同刻按 id 稳定排序，避免刷新顺序跳动）
  out.sort((a, b) => (b.deliveredAtGameMs - a.deliveredAtGameMs) || a.id.localeCompare(b.id))
  return out
}

/** 未读条数（导航徽标 / 闪烁判定） */
export function commsUnreadCount(state: GameState, ctx: SimContext): number {
  return commsInbox(state, ctx).filter((e) => !e.read).length
}

/** 标记单条已读（点开即读） */
export function markCommsRead(state: GameState, id: string): { ok: boolean; error?: string } {
  if (state.commsDelivered?.[id] === undefined) return { ok: false, error: '没有这封通讯（可能已被撤销）。' }
  state.commsRead ??= {}
  state.commsRead[id] = true
  return { ok: true }
}

/** 全部标记已读：返回本次新标记的条数（0 = 本来就没有未读） */
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
