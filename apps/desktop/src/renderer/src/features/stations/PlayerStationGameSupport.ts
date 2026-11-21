import type { DevelopmentAction } from '../../../../../../../packages/core/src/playerStation/development'
import type { StationAcademyAction } from '../../../../../../../packages/core/src/playerStation/academy'
import type { StationManufacturingAction } from '../../../../../../../packages/core/src/playerStation/manufacturing'
import type { StationCrewAction } from '../../../../../../../packages/core/src/playerStation/crew'
import type { StationSecurityAction } from '../../../../../../../packages/core/src/playerStation/security'
import type { PlayerStationText } from './PlayerStationPanel'
import { PLAYER_STATION_TEXT_IDS } from '../../../../../../../packages/data/src/playerStationText'
import { tr } from '../../i18n/locale'

export const stationText: PlayerStationText = (id, params) => tr(PLAYER_STATION_TEXT_IDS[id] ?? id, params)

export interface StationGameCommand {
  (domain: 'development', action: DevelopmentAction): void
  (domain: 'academy', action: StationAcademyAction): void
  (domain: 'manufacturing', action: StationManufacturingAction): void
  (domain: 'crew', action: StationCrewAction): void
  (domain: 'security', action: StationSecurityAction): void
  (domain: 'declare', action: Record<string, never>): void
}

const STATUS_KEYS = new Set([
  'idle', 'qualifying', 'training', 'mission', 'guard', 'fire-control', 'damage-control', 'drones',
  'fireControl', 'piloting', 'engineering', 'command', 'patrol', 'clear', 'escort', 'outbound', 'operation', 'returning',
  'victory', 'defeat', 'stopped', 'supplies', 'person', 'ship', 'busy', 'facility', 'power', 'requirements', 'completed',
  'materials', 'points', 'opportunity', 'attributes', 'invalid-action', 'team', 'tier', 'course', 'skill', 'choice', 'name',
  'teams', 'source', 'cleared', 'facilities', 'unassigned', 'paused', 'harassment', 'engineer', 'research', 'recipe',
  'batches', 'no-run', 'no-plan', 'invalid-count', 'body-required', 'invalid-state', 'occupied', 'cell', 'kind',
  'undiscovered', 'inactive', 'raid', 'returned', 'seat', 'capacity', 'no-project', 'invalid-cell',
])

export function stationGameLabel(text: PlayerStationText, key: string): string {
  return text(STATUS_KEYS.has(key) ? `ui.playerStationGame.status.${key}` : 'ui.playerStationGame.commandFailed')
}

export function stationGameFailure(text: PlayerStationText, domain: string, reason?: string): string {
  if (!reason) return text('ui.playerStationGame.commandFailed')
  const specific: Record<string, readonly string[]> = {
    training: ['invalid-action', 'queue-full', 'no-course', 'invalid-index'],
    refining: ['person', 'facility', 'recipe', 'busy', 'no-run', 'invalid-action'],
    mining: ['person', 'ship', 'belt', 'facilities', 'busy', 'no-run', 'invalid-action'],
    research: ['project', 'queued', 'invalid-index', 'busy', 'person', 'facility', 'completed', 'unassigned', 'invalid-action'],
  }
  const section = domain === 'research' ? 'science' : domain
  return specific[domain]?.includes(reason) ? text(`ui.playerStation.${section}.error.${reason}`) : stationGameLabel(text, reason)
}

export const trReason = (domain: string, reason?: string): string => stationGameFailure(stationText, domain, reason)
