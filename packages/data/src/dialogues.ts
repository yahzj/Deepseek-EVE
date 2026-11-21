import type { DialogueScriptDef } from '@whale/core'
import { L10N } from './l10n/table'

export const DIALOGUES: readonly DialogueScriptDef[] = [
  {
    id: 'dlg-redring-intro',
    title: '深空工业协会 · 基建部',
    commsFactionId: 'dshi',
    commsDeptId: 'dept-infra',
    commsSigner: '柯岚',
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

export function buildDialogueCatalog(): ReadonlyMap<string, DialogueScriptDef> {
  return new Map(DIALOGUES.map((d) => [d.id, d]))
}
