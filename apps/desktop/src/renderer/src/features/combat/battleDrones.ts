import type { DroneModel, DroneSortie } from './droneArt'
import {
  DRONE_SHOW_MAX,
  DRONE_STYLE,
  DRONE_SORTIE_OUT_MS,
  DRONE_DWELL_MS,
  DRONE_SORTIE_BACK_MS,
  droneTakeoff,
  droneArcHeight,
  droneStationFrom,
  dronePathPos,
} from './droneArt'
import type { Anchor } from './battleViewCore'

export function droneHomeStation(model: DroneModel, lane: number, lay: { me: Anchor; foe: Anchor[] }): Anchor {
  const slot = model.slots[lane % Math.max(1, Math.min(model.slots.length, DRONE_SHOW_MAX))] ?? model.slots[0]!
  return { x: lay.me.x + slot.x, y: lay.me.y + slot.y }
}

export function dronePoseAt(
  model: DroneModel,
  lane: number,
  st: DroneSortie | undefined,
  lay: { me: Anchor; foe: Anchor[] },
  elapsed: number,
): { x: number; y: number; heading: number } {
  const base = DRONE_STYLE === 'sortie' && !model.resident ? droneTakeoff(lane) : model.slots[lane % model.slots.length]!
  const baseAbs = { x: lay.me.x + base.x, y: lay.me.y + base.y }
  const arc = droneArcHeight(lane)
  const foeA = lay.foe[0] ?? lay.me
  const off = st?.offs[lane % (st.offs.length || 1)] ?? { x: 46, y: 0 }
  const station =
    DRONE_STYLE === 'sortie' && !model.resident ? droneStationFrom(foeA, 1, off) : droneHomeStation(model, lane, lay)
  if (DRONE_STYLE === 'sortie' && !model.resident) {
    if (elapsed < DRONE_SORTIE_OUT_MS) {
      const t = Math.min(1, Math.max(0, elapsed / DRONE_SORTIE_OUT_MS))
      const p = dronePathPos(t, baseAbs, station, arc, false)
      return { x: p.x, y: p.y, heading: 1 }
    }
    if (elapsed < DRONE_SORTIE_OUT_MS + DRONE_DWELL_MS) return { x: station.x, y: station.y, heading: 1 }
    const t = Math.min(1, Math.max(0, (elapsed - DRONE_SORTIE_OUT_MS - DRONE_DWELL_MS) / DRONE_SORTIE_BACK_MS))
    const p = dronePathPos(t, station, baseAbs, arc, true)
    return { x: p.x, y: p.y, heading: -1 }
  }
  return { x: station.x, y: station.y, heading: 1 }
}

export const DRONE_DOWN_FREEZE_MS = Math.round(DRONE_SORTIE_BACK_MS / 3)

export function oneThirdToward(
  from: { x: number; y: number },
  home: { x: number; y: number },
): { tx: number; ty: number } {
  return {
    tx: from.x + (home.x - from.x) / 3,
    ty: from.y + (home.y - from.y) / 3,
  }
}

export function foeDroneStation(
  me: Anchor,
  foeA: Anchor,
  off: { x: number; y: number },
  rangeBuff: boolean,
): { x: number; y: number } {
  const base = { x: me.x + off.x, y: me.y + off.y }
  if (!rangeBuff) return base
  const dx = foeA.x - me.x
  const dy = foeA.y - me.y
  const len = Math.hypot(dx, dy) || 1
  const step = Math.min(260, len * 0.55)
  return { x: base.x + (dx / len) * step, y: base.y + (dy / len) * step }
}

export function foePoseAt(
  _model: DroneModel,
  lane: number,
  st: DroneSortie | undefined,
  lay: { me: Anchor; foe: Anchor[] },
  elapsed: number,
  rangeBuff = false,
): { x: number; y: number; heading: number } {
  const foeA = lay.foe[0] ?? lay.me
  const tk = droneTakeoff(lane)
  const deck = { x: foeA.x - tk.x, y: foeA.y + tk.y }
  const off = st?.offs[lane % (st.offs.length || 1)] ?? { x: 52, y: 0 }
  const station = foeDroneStation(lay.me, foeA, off, rangeBuff)
  const arc = droneArcHeight(lane)
  if (elapsed < DRONE_SORTIE_OUT_MS) {
    const t = Math.min(1, Math.max(0, elapsed / DRONE_SORTIE_OUT_MS))
    return { ...dronePathPos(t, deck, station, arc, false), heading: -1 }
  }
  if (elapsed < DRONE_SORTIE_OUT_MS + DRONE_DWELL_MS)
    return { x: station.x, y: station.y, heading: -1 }
  const t = Math.min(
    1,
    Math.max(
      0,
      (elapsed - DRONE_SORTIE_OUT_MS - DRONE_DWELL_MS) / DRONE_SORTIE_BACK_MS,
    ),
  )
  return { ...dronePathPos(t, station, deck, arc, true), heading: 1 }
}
