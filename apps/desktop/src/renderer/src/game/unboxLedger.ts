import type { GameState, UnboxResultRow } from '@whale/core'

export interface UnboxBatchRecord {
  readonly boxes: number
  readonly outputs: readonly { itemId: string; units: number }[]
}

/** 只绑定当前内存档；换档或重启后不恢复上一批记录。 */
export class UnboxSessionLedger {
  private state: GameState | null = null
  private batches = new Map<string, UnboxBatchRecord>()

  private bind(state: GameState): void {
    if (this.state === state) return
    this.state = state
    this.batches.clear()
  }

  begin(state: GameState, boxItemId: string): void {
    this.bind(state)
    this.batches.set(boxItemId, { boxes: 0, outputs: [] })
  }

  record(state: GameState, result: UnboxResultRow): void {
    this.bind(state)
    const previous = this.batches.get(result.boxItemId)
    const units = new Map(previous?.outputs.map(row => [row.itemId, row.units]))
    for (const row of result.grants) {
      if (!Number.isSafeInteger(row.units) || row.units <= 0) continue
      units.set(row.itemId, (units.get(row.itemId) ?? 0) + row.units)
    }
    this.batches.set(result.boxItemId, {
      boxes: (previous?.boxes ?? 0) + 1,
      outputs: [...units].map(([itemId, quantity]) => ({ itemId, units: quantity })),
    })
  }

  get(state: GameState, boxItemId: string): UnboxBatchRecord | undefined {
    this.bind(state)
    return this.batches.get(boxItemId)
  }

  clear(): void {
    this.state = null
    this.batches.clear()
  }
}
