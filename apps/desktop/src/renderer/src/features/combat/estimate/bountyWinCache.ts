import type { GameState, SimContext, BountyWinMC } from '@whale/core'
import { buildEvalState } from '@whale/core'
import type { BountyWinDiagnostic, BountyWinWorker } from './bountyWinProtocol'

export interface BountyWinSource {
  state: GameState
  ctx: SimContext
  fingerprint: string
  locale: 'zh' | 'en'
  ids: readonly string[]
}

/** 只负责后台任务生命周期；战斗采样仍在core的唯一评估入口。 */
export class BountyWinCache {
  private source: BountyWinSource | null = null
  private board = ''
  private cache = new Map<string, BountyWinMC>()
  private queue: string[] = []
  private pending: string | null = null
  private worker: BountyWinWorker | null = null
  private generation = 0
  private failed = false

  constructor(private readonly options: {
    createWorker(): BountyWinWorker
    source(): BountyWinSource
    paused(): boolean
    changed(): void
    diagnostic(event: BountyWinDiagnostic): void
    error(message: string): void
    now(): number
  }) {}

  sync(): void {
    const source = this.options.source()
    const board = JSON.stringify(source.ids)
    if (!this.source || this.source.state !== source.state || this.source.ctx !== source.ctx ||
      this.source.fingerprint !== source.fingerprint || this.board !== board || this.source.locale !== source.locale) {
      this.release()
      this.source = source
      this.board = board
      this.cache.clear()
      this.queue = [...new Set(source.ids)]
      this.failed = false
    }
    if (this.options.paused()) this.pause()
  }

  pump(): void {
    this.sync()
    if (this.options.paused() || this.failed || this.pending !== null || this.queue.length === 0 || !this.source) return
    const started = this.options.now()
    try {
      if (!this.worker) {
        const snapshot = buildEvalState(this.source.state, this.source.state.shipId)
        if (!snapshot) { this.queue = []; return }
        const worker = this.options.createWorker()
        this.worker = worker
        const generation = ++this.generation
        worker.onmessage = ({ data }) => {
          if (this.worker !== worker || data.generation !== generation) return
          this.sync()
          if (this.worker !== worker || data.id !== this.pending) return
          if (data.kind === 'error') { this.fail(data.message); return }
          this.cache.set(data.id, data.result)
          this.pending = null
          this.options.diagnostic({ kind: 'result', ms: data.computeMs })
          if (this.queue.length === 0) this.release()
          this.options.changed()
        }
        worker.onerror = event => { event.preventDefault(); if (this.worker === worker) this.fail(event.message) }
        worker.onmessageerror = () => { if (this.worker === worker) this.fail('bounty-worker-message-invalid') }
        worker.postMessage({ kind: 'init', generation, locale: this.source.locale, snapshot })
      }
      this.pending = this.queue.shift()!
      this.worker.postMessage({ kind: 'run', generation: this.generation, id: this.pending })
      this.options.diagnostic({ kind: 'dispatch', ms: this.options.now() - started })
    } catch (error) { this.fail(String(error)) }
  }

  get(id: string): BountyWinMC | null {
    this.sync()
    return this.cache.get(id) ?? null
  }

  pause(): void {
    if (this.pending !== null) this.queue.unshift(this.pending)
    this.release()
  }

  reset(): void {
    this.release()
    this.source = null
    this.board = ''
    this.cache.clear()
    this.queue = []
    this.failed = false
  }

  private release(): void {
    if (this.pending !== null) this.options.diagnostic({ kind: 'cancel', ms: 0 })
    if (this.worker) {
      this.worker.onmessage = null
      this.worker.onerror = null
      this.worker.onmessageerror = null
      this.worker.terminate()
      this.worker = null
    }
    this.pending = null
  }

  private fail(message: string): void {
    this.release()
    this.failed = true
    this.options.diagnostic({ kind: 'error', ms: 0 })
    this.options.error(message)
  }
}
