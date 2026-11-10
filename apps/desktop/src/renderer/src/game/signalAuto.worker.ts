import { buildSimContext } from '@whale/data'
import { wormholeAutoStart, type GameState } from '@whale/core'
import type { SignalAutoEstimate } from '../../../../../../packages/core/src/signalAuto/types'

const ctx = buildSimContext()
const scope = globalThis as unknown as {
  onmessage: (event: { data: { state: GameState; stockId: string; shipIds: string[] } }) => void
  postMessage(value: { estimate?: SignalAutoEstimate }): void
}
scope.onmessage = ({ data }) => {
  try {
    const result = wormholeAutoStart(data.state, ctx, data.stockId, data.shipIds)
    const estimate = result.ok ? data.state.wormholeAuto?.find(run => run.stockId === data.stockId)?.estimate : undefined
    scope.postMessage({ estimate })
  } catch { scope.postMessage({}) }
}
