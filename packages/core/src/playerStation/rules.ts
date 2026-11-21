import type { PlayerFacilityKind } from './types'
import { ANCIENT_STATION_GALAXY_ID } from './discovery'

export const PLAYER_STATION_SITE_ID = 'site-player-home'
export const PLAYER_STATION_GALAXY_ID = ANCIENT_STATION_GALAXY_ID
/** 经船长授权的可调测试基准，非发布平衡。 */
export const PLAYER_STATION_BODY_MS = 120 * 60_000
export const PLAYER_STATION_BODY_BILL: Readonly<Record<string, number>> = {
  'min-tritanium': 1_250_000, 'part-frame': 75_000, 'part-armor-plate': 46_500,
  'part-cable': 37_500, 'part-circuit': 37_500, 'part-coolant': 37_500,
  'part-gyro': 6_250, 'part-lens': 6_250,
}
export const PLAYER_FACILITIES: Readonly<Record<PlayerFacilityKind, {
  nameId: string; descriptionId: string; durationMs: number; power: number; capacity: number;
  engineers?: number; workPower?: number; bill: Readonly<Record<string, number>>
}>> = {
  power: { nameId: 'ui.playerStation.power', descriptionId: 'ui.playerStation.powerDescription', durationMs: 45 * 60_000, power: 0, capacity: 24,
    bill: { 'min-tritanium': 100_000, 'part-frame': 2_000, 'part-armor-plate': 2_000, 'part-cable': 4_000, 'part-circuit': 2_000, 'part-coolant': 4_000 } },
  'life-support': { nameId: 'ui.playerStation.life', descriptionId: 'ui.playerStation.lifeDescription', durationMs: 60 * 60_000, power: 6, capacity: 6,
    bill: { 'min-tritanium': 100_000, 'part-frame': 3_000, 'part-armor-plate': 4_000, 'part-cable': 2_000, 'part-circuit': 4_000, 'part-coolant': 6_000 } },
  service: { nameId: 'ui.playerStation.service', descriptionId: 'ui.playerStation.serviceDescription', durationMs: 30 * 60_000, power: 2, capacity: 0,
    bill: { 'min-tritanium': 50_000, 'part-frame': 2_000, 'part-armor-plate': 1_000, 'part-cable': 2_000, 'part-circuit': 5_000, 'part-coolant': 1_000, 'part-lens': 1_000 } },
  refinery: { nameId: 'ui.playerStation.refinery', descriptionId: 'ui.playerStation.refineryDescription', durationMs: 60 * 60_000,
    power: 1, workPower: 6, capacity: 0, engineers: 1,
    bill: { 'min-tritanium': 150_000, 'part-frame': 4_000, 'part-armor-plate': 4_000, 'part-cable': 3_000, 'part-circuit': 2_000, 'part-coolant': 8_000, 'part-gyro': 1_000 } },
  research: { nameId: 'ui.playerStation.research', descriptionId: 'ui.playerStation.researchDescription', durationMs: 90 * 60_000,
    power: 1, workPower: 4, capacity: 0, engineers: 1,
    bill: { 'min-tritanium': 50_000, 'part-frame': 3_000, 'part-armor-plate': 2_000, 'part-cable': 3_000, 'part-circuit': 8_000, 'part-coolant': 5_000, 'part-gyro': 1_000, 'part-lens': 2_000 } },
  manufacturing: { nameId: 'ui.playerStation.manufacturing', descriptionId: 'ui.playerStation.manufacturingDescription', durationMs: 90 * 60_000,
    power: 1, workPower: 5, capacity: 0, engineers: 1,
    bill: { 'min-tritanium': 150_000, 'part-frame': 6_000, 'part-armor-plate': 3_000, 'part-cable': 4_000, 'part-circuit': 4_000, 'part-coolant': 6_000, 'part-gyro': 2_000 } },
  training: { nameId: 'ui.playerStation.trainingFacility', descriptionId: 'ui.playerStation.trainingDescription', durationMs: 90 * 60_000,
    power: 1, workPower: 5, capacity: 0, engineers: 1,
    bill: { 'min-tritanium': 50_000, 'part-frame': 4_000, 'part-armor-plate': 2_000, 'part-cable': 3_000, 'part-circuit': 6_000, 'part-coolant': 4_000, 'part-lens': 2_000 } },
  warning: { nameId: 'ui.playerStation.warning', descriptionId: 'ui.playerStation.warningDescription', durationMs: 60 * 60_000,
    power: 2, capacity: 0, engineers: 1,
    bill: { 'min-tritanium': 50_000, 'part-frame': 3_000, 'part-cable': 4_000, 'part-circuit': 5_000, 'part-coolant': 2_000, 'part-lens': 3_000 } },
}
