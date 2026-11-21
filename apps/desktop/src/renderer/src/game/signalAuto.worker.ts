import { buildSimContext } from '@whale/data'
import { wormholeAutoStart, type GameState, type CommandResult } from '@whale/core'
import type { SignalAutoEstimate } from '../../../../../../packages/core/src/signalAuto/types'

const ctx = buildSimContext()
const scope = globalThis as unknown as {
  onmessage: (event: { data: { state: GameState; stockId: string; shipIds: string[] } }) => void
  postMessage(value: { estimate?: SignalAutoEstimate; failure?: CommandResult }): void
}
scope.onmessage = ({ data }) => {
  try {
    const result = wormholeAutoStart(data.state, ctx, data.stockId, data.shipIds)
    const estimate = result.ok ? data.state.wormholeAuto?.find(run => run.stockId === data.stockId)?.estimate : undefined
    scope.postMessage(result.ok ? { estimate } : { failure: result })
  } catch { scope.postMessage({ failure: { ok: false, errorId: 'core.signalDispatch.004' } }) }
}
