import type { SfxCueId } from './audio/cues'

export type SfxKind = SfxCueId

export type SfxPlayer = (kind: SfxKind) => void

let player: SfxPlayer | null = null

export function registerSfxPlayer(fn: SfxPlayer | null): void {
  player = fn
}

export function sfxReady(): boolean {
  return player !== null
}

export function playSfx(kind: SfxKind): void {
  if (player === null) return
  try {
    player(kind)
  } catch {
  }
}
