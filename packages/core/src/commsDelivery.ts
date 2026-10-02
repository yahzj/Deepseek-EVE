/**
 * 通讯「送达账本 + 发件方解析 + 剧本进收件箱」（2026-10-02 从 `comms.ts` 拆出，破 `station → comms` 环）。
 *
 * 原状：`comms` 借 `state.siteProgress`（纯读数）而 `station` 借 `comms.deliverDialogueToComms`
 * ⇒ `station → comms` 与 `comms → station` 双向成环。拆法：把"送达账本 + 发件方解析 + 剧本镜像"
 * 这几件搬到本文件；`comms` 改从本文件借回（单向边，不成环）。只依赖 `state` / `types`，不 import 业务模块。
 */
import { addLog } from './state'
import type { GameState } from './state'
import type { CommsFactionAlignment, CommsKind, SimContext } from './types'

/**
 * 解析发件方（2026-09-11 通讯 v2：消息/剧本都挂靠「势力 + 部门」）。
 *
 * 显示口径：**玩家看到的发件人写法不变**，仍是 `势力名 · 部门名`（缺部门 = 只显示势力名）；
 * 解析不到势力/部门时**降级显示原文 id**（界面不崩——数据改漏了只会看到 id，不会白屏）。
 */
export interface CommsSenderView {
  /** 发件人写法（`势力名 · 部门名`；降级时 = 原文 id） */
  from: string
  /** 势力名（未解析到 = 空串） */
  factionName: string
  /** 立场（未解析到 = 空串） */
  alignment: CommsFactionAlignment | ''
  /** 内容类型（未挂靠 = 空串） */
  kind: CommsKind | ''
  /** 具名联系人（悬停说明用） */
  signer?: string
  /** 发件方说明「这是谁」（势力 brief + 部门 brief；悬停用） */
  fromBrief?: string
  /** 势力主题色（未解析到 = 空串，界面回落默认色） */
  tone: string
  /** 势力图标名（未解析到 = 空串） */
  glyph: string
}

/** 发件方解析（势力 + 部门 + 可选内容类型 + 可选具名联系人；缺数据一律降级不抛错） */
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

/**
 * 剧本镜像到收件箱的键（与数据消息 id 区分；`id` 里的 `dlg:` 前缀是稳定约定）
 */
export function commsDialogueKey(scriptId: string): string {
  return `dlg:${scriptId}`
}

/** 送达记账（幂等）：未送达则写入时间并返回 true */
export function deliver(state: GameState, id: string): boolean {
  const map = (state.commsDelivered ??= {})
  if (map[id] !== undefined) return false
  map[id] = Math.max(0, Math.floor(state.gameMs))
  return true
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
