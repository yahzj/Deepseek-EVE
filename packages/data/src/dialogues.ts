/**
 * T9 通讯剧本（对话系统 v1：线性文本流；一次性完整呈现，逐句镜像进事件日志）。
 * 触发：建站点首次抵达自动播放介绍（D3甲：已读后不再自动触发；任务卡可随时重看）。
 *
 * 2026-09-11 通讯 v2：剧本也**挂靠势力 + 部门**（`commsFactionId` / `commsDeptId` / `commsSigner`），
 * 于是收件箱里的立场小片、发件说明与数据消息同一套口径；`title` 保留为原文兜底（未挂靠时显示它）。
 */
import type { DialogueScriptDef } from '@whale/core'
import { L10N } from './l10n/table'
// ⟪文案调整 2026-10-04⟫ 四份剧本逐篇重写，角色、行数与触发不变。

/** 全量剧本（id 稳定；重看/已读按 id 记录） */
export const DIALOGUES: readonly DialogueScriptDef[] = [
  {
    id: 'dlg-redring-intro',
    title: '深空工业协会 · 基建部',
    commsFactionId: 'dshi',
    commsDeptId: 'dept-infra',
    commsSigner: '柯岚',
    // 2026-09-11 通讯系统：剧本与消息同处一个收件箱，故各给一条主题（通讯页列表主行用）
    subject: L10N['ui.commsDialogue.001']!.zh,
    lines: [
      { speaker: L10N['ui.commsSpeaker.001']!.zh, text: L10N['ui.commsRedintro.001']!.zh },
      { speaker: L10N['ui.commsSpeaker.001']!.zh, text: L10N['ui.commsRedintro.002']!.zh },
      { speaker: L10N['ui.commsSpeaker.001']!.zh, text: L10N['ui.commsRedintro.003']!.zh },
      { speaker: L10N['ui.commsSpeaker.001']!.zh, text: L10N['ui.commsRedintro.004']!.zh },
      { speaker: L10N['ui.commsSpeaker.001']!.zh, text: L10N['ui.commsRedintro.005']!.zh },
    ],
  },
  {
    id: 'dlg-redring-done',
    title: '深空工业协会 · 基建部',
    commsFactionId: 'dshi',
    commsDeptId: 'dept-infra',
    commsSigner: '柯岚',
    subject: L10N['ui.commsDialogue.002']!.zh,
    lines: [
      { speaker: L10N['ui.commsSpeaker.001']!.zh, text: L10N['ui.commsReddone.001']!.zh },
      { speaker: L10N['ui.commsSpeaker.001']!.zh, text: L10N['ui.commsReddone.002']!.zh },
      { speaker: L10N['ui.commsSpeaker.001']!.zh, text: L10N['ui.commsReddone.003']!.zh },
      { speaker: L10N['ui.commsSpeaker.001']!.zh, text: L10N['ui.commsReddone.004']!.zh },
      { speaker: L10N['ui.commsSpeaker.001']!.zh, text: L10N['ui.commsReddone.005']!.zh },
      { speaker: L10N['ui.commsSpeaker.001']!.zh, text: L10N['ui.commsReddone.006']!.zh },
    ],
  },
  {
    id: 'dlg-cinder-intro',
    title: '深空工业协会 · 基建部',
    commsFactionId: 'dshi',
    commsDeptId: 'dept-infra',
    commsSigner: '沈灼',
    subject: L10N['ui.commsDialogue.003']!.zh,
    lines: [
      { speaker: L10N['ui.commsSpeaker.002']!.zh, text: L10N['ui.commsCinderintro.001']!.zh },
      { speaker: L10N['ui.commsSpeaker.002']!.zh, text: L10N['ui.commsCinderintro.002']!.zh },
      { speaker: L10N['ui.commsSpeaker.002']!.zh, text: L10N['ui.commsCinderintro.003']!.zh },
      { speaker: L10N['ui.commsSpeaker.002']!.zh, text: L10N['ui.commsCinderintro.004']!.zh },
    ],
  },
  {
    id: 'dlg-cinder-done',
    title: '深空工业协会 · 基建部',
    commsFactionId: 'dshi',
    commsDeptId: 'dept-infra',
    commsSigner: '沈灼',
    subject: L10N['ui.commsDialogue.004']!.zh,
    lines: [
      { speaker: L10N['ui.commsSpeaker.002']!.zh, text: L10N['ui.commsCinderdone.001']!.zh },
      { speaker: L10N['ui.commsSpeaker.002']!.zh, text: L10N['ui.commsCinderdone.002']!.zh },
      { speaker: L10N['ui.commsSpeaker.002']!.zh, text: L10N['ui.commsCinderdone.003']!.zh },
      { speaker: L10N['ui.commsSpeaker.002']!.zh, text: L10N['ui.commsCinderdone.004']!.zh },
      { speaker: L10N['ui.commsSpeaker.002']!.zh, text: L10N['ui.commsCinderdone.005']!.zh },
      { speaker: L10N['ui.commsSpeaker.002']!.zh, text: L10N['ui.commsCinderdone.006']!.zh },
    ],
  },
]

/** 剧本目录 */
export function buildDialogueCatalog(): ReadonlyMap<string, DialogueScriptDef> {
  return new Map(DIALOGUES.map((d) => [d.id, d]))
}
