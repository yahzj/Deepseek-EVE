import type { GameState } from '../state'

const activeScopes = new WeakMap<GameState, string>()

export function activateRelayScope(state: GameState, scope: string): void {
  activeScopes.set(state, scope)
}

export function relayScopeIsActive(state: GameState, scope: string): boolean {
  return activeScopes.get(state) === scope
}
