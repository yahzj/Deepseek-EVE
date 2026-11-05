import { useEffect, useState } from 'react'
import type { GameEngine } from '../../../game/engine'
import { MarketRelayRuntime } from './runtime'

export function useMarketRelay(engine: GameEngine): void {
  const [runtime] = useState(() => new MarketRelayRuntime(engine))
  useEffect(() => runtime.mount(), [runtime])
}
