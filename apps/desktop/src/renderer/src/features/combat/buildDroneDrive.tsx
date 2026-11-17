















import { DRONE_DWELL_MS, DRONE_SHOW_MAX, DRONE_SORTIE_BACK_MS, DRONE_SORTIE_OUT_MS, droneModelOrFallback, droneRandomOffsets } from './droneArt'
import type { DroneDriveState } from './droneDriveTypes'






export function buildDroneDrive({ arcs, droneSortieRef, now, dronePrevShowRef, visDistRef, visM, droneDriveRef, meAnchorByTag, foeSortieRef, foeSizes, foeTags, meSize, mySizes, farM, nearM }: {
foeSizes: number[]
foeTags: string[]
mySizes?: number[]
meSize: number
farM: number
nearM: number
arcs: NonNullable<ReturnType<typeof import('@whale/core').battleArcsFor>>
droneSortieRef: import('react').MutableRefObject<Map<string, import('../../ui/droneArt').DroneSortie>>
now: number
dronePrevShowRef: import('react').MutableRefObject<Map<string, number>>
visDistRef: import('react').MutableRefObject<number>
visM: number
droneDriveRef: import('react').MutableRefObject<DroneDriveState>
meAnchorByTag: Map<string, import('../../panels/battleViewCore').Anchor>
foeSortieRef: import('react').MutableRefObject<Map<string, import('../../ui/droneArt').DroneSortie>>
}) {
  const droneWings = arcs.myUnits.flatMap((u) =>
    (u.drones ?? []).filter(d => d.artId !== 'drone-repair-mil' && (d.deployed ?? d.count) > 0).map((d) => {
      const key = `${u.tag}:${d.artId}`
      const model = droneModelOrFallback(d.artId)
      const st = droneSortieRef.current.get(key)
      const cycleMs = DRONE_SORTIE_OUT_MS + DRONE_DWELL_MS + DRONE_SORTIE_BACK_MS
      const elapsed = st ? now - st.startAt : Number.POSITIVE_INFINITY
      const phase: 'out' | 'back' | 'deck' = model.resident
        ? 'out'
        : elapsed < DRONE_SORTIE_OUT_MS + DRONE_DWELL_MS
          ? 'out'
          : elapsed < cycleMs
            ? 'back'
            : 'deck'
      const deployed = d.deployed ?? d.count
      const show = model.resident ? 1 : Math.max(1, Math.min(deployed, DRONE_SHOW_MAX))
      dronePrevShowRef.current.set(key, show)
      return {
        key,
        owner: u.tag,
        artId: d.artId,
        model,
        phase,
        elapsed,
        st,
        show,
        total: deployed,
      }
    }),
  );
  const foeWings = (arcs.foeDrones ?? []).filter((w) => w.alive > 0);
  visDistRef.current = visM
  droneDriveRef.current = {
    foeSizes,
    foeTags,
    mySizes,
    meSize,
    farM,
    nearM,
    meAnchors: meAnchorByTag,
    wings: [
      ...droneWings.map((w) => ({
        key: w.key,
        owner: w.owner,
        artId: w.artId,
        model: w.model,
        show: w.show,
        st: w.st,
        deck: w.phase === 'deck',
      })),
      ...foeWings.map((w) => {
        const sk = `${w.tag}:${w.artId}`
        const fcyc0 =
          DRONE_SORTIE_OUT_MS + DRONE_DWELL_MS + DRONE_SORTIE_BACK_MS;
        if (!foeSortieRef.current.get(sk)) {
          foeSortieRef.current.set(sk, {
            startAt: now - fcyc0,
            offs: droneRandomOffsets(DRONE_SHOW_MAX),
          })
        }
        const st = foeSortieRef.current.get(sk)
        const fcyc =
          DRONE_SORTIE_OUT_MS + DRONE_DWELL_MS + DRONE_SORTIE_BACK_MS
        const fel = st ? now - st.startAt : Number.POSITIVE_INFINITY
        return {
          artId: w.artId,
          model: droneModelOrFallback(w.artId),
          show: Math.min(w.alive, DRONE_SHOW_MAX),
          st,
          rangeBuff: w.rangeBuff === true,
          deck: !st || fel >= fcyc,
          foe: w.tag,
        }
      }),
    ],
  }

return { droneWings, foeWings }
}
