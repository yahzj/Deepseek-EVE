import type { GameState, BountyWinMC } from '@whale/core'

export type BountyWinRequest =
  | { kind: 'init'; generation: number; locale: 'zh' | 'en'; snapshot: { ev: GameState; uid: string } }
  | { kind: 'run'; generation: number; id: string }

export type BountyWinResponse =
  | { kind: 'result'; generation: number; id: string; result: BountyWinMC; computeMs: number }
  | { kind: 'error'; generation: number; id: string; message: string }

export interface BountyWinWorker {
  onmessage: ((event: { data: BountyWinResponse }) => void) | null
  onerror: ((event: { message: string; preventDefault(): void }) => void) | null
  onmessageerror: (() => void) | null
  postMessage(request: BountyWinRequest): void
  terminate(): void
}

export type BountyWinDiagnostic = { kind: 'dispatch' | 'result' | 'cancel' | 'error'; ms: number }
