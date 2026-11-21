import { battleArcsFor } from '@whale/core'

import type { DamageType } from '@whale/core'

import { mountsOf } from '../../ui/shipMounts'

import { DRONE_DWELL_MS, DRONE_SHOW_MAX, DRONE_SORTIE_BACK_MS, DRONE_SORTIE_OUT_MS, DRONE_STYLE, droneArcHeight, droneModelOrFallback, dronePathPos, droneRandomOffsets, droneStationFrom, droneTakeoff } from './droneArt'
import type { DroneSortie } from './droneArt'
import { BOLT_LOOK, DMG_COLOR, noseOf, layout, boltGeom, resolveBoltAnchors, droneOwnerAnchor, residentDroneFrom } from './battleViewCore'
import type { Dims, Anchor, BoltV, FlashV } from './battleViewCore'

import type { AcidFx } from './battleAcidFx'

import { dronePoseAt, oneThirdToward, foeDroneStation, foePoseAt } from './battleDrones'

export function consumeBattleEvents({
    arrivals, meAnchorByTag, layFx, battle, lastHitTypeRef, acidDeathsRef,
    deadRef, corpseAtRef, now, acidFxRef, keyRef, foeSizeOf,
    meSizeByTag, meSize, popupAccRef, arcs, blinkRef, dims,
    foeSizesFor, rowFxTags, visDistRef, farM, nearM, foeSortieRef,
    droneDownRef, dronePrevShowRef, droneSortieRef, foeAliveTags, droneSlotRef, foeDroneAliveOf,
    droneCountOf, droneOutward, foeDroneBuffedOf, meShip, foeKey, muzzleCountRef,
    boltsRef, flashRef,
  }: {
arrivals: import('@whale/core').BattleFx[]
meAnchorByTag: Map<string, Anchor>
layFx: { meLeft: number; foeLeft: number; me: Anchor; my: Anchor[]; foe: Anchor[]; sizes: number[]; foeBottom: number; formation: import('./battleViewCore').FoeFormation; usable: number; myBarW?: number; }
battle: import('@whale/core').BattleState
lastHitTypeRef: import('react').MutableRefObject<Map<string, DamageType>>
acidDeathsRef: import('react').MutableRefObject<Set<string>>
deadRef: import('react').MutableRefObject<Set<string>>
corpseAtRef: import('react').MutableRefObject<Map<string, number>>
now: number
acidFxRef: import('react').MutableRefObject<AcidFx[]>
keyRef: import('react').MutableRefObject<number>
foeSizeOf: (tag: string) => number
meSizeByTag: Map<string, number>
meSize: number
popupAccRef: import('react').MutableRefObject<Map<string, { x: number; y: number; amount: number; type: DamageType; miss: boolean; }>>
arcs: NonNullable<ReturnType<typeof battleArcsFor>>
blinkRef: import('react').MutableRefObject<Map<string, { side: "foe" | "me"; vanish: number; move: number; appear: number; segMs: number; }>>
dims: Dims
foeSizesFor: (tags: readonly string[]) => number[]
rowFxTags: string[]
visDistRef: import('react').MutableRefObject<number>
farM: number
nearM: number
foeSortieRef: import('react').MutableRefObject<Map<string, DroneSortie>>
droneDownRef: import('react').MutableRefObject<{ key: number; artId: string; x: number; y: number; tx: number; ty: number; born: number; foe?: boolean; }[]>
dronePrevShowRef: import('react').MutableRefObject<Map<string, number>>
droneSortieRef: import('react').MutableRefObject<Map<string, DroneSortie>>
foeAliveTags: string[]
droneSlotRef: import('react').MutableRefObject<Map<string, number>>
foeDroneAliveOf: (tag: string, artId: string) => number
droneCountOf: Map<string, number>
droneOutward: number
foeDroneBuffedOf: (tag: string) => boolean
meShip: import('@whale/core').ShipDef | undefined
foeKey: string
muzzleCountRef: import('react').MutableRefObject<Map<string, number>>
boltsRef: import('react').MutableRefObject<BoltV[]>
flashRef: import('react').MutableRefObject<FlashV[]>
}) {
if (arrivals.length > 0) {
    const downCursor = new Map<string, number>()
    for (const fx of arrivals) {
      if (fx.repair) continue
      if (fx.acidBurst) {
        const anchors = resolveBoltAnchors({ side: 'foe', tag: fx.tag, to: fx.to, rowFxTags,
          meAnchors: meAnchorByTag, meFallback: layFx.me, foeAnchors: layFx.foe })
        const cause = battle.acidBursts?.[fx.tag]?.cause
        const delay = cause === 'killed' ? BOLT_LOOK[lastHitTypeRef.current.get(fx.tag) ?? 'kinetic'].fly : 0
        acidDeathsRef.current.add(fx.tag)
        deadRef.current.add(fx.tag)
        corpseAtRef.current.set(fx.tag, now + delay)
        if (anchors) {
          acidFxRef.current.push({ key: keyRef.current++, tag: fx.tag, kind: 'burst',
            ...anchors.src, size: foeSizeOf(fx.tag), born: now, delay })
          if (fx.to && fx.hit) acidFxRef.current.push({ key: keyRef.current++, tag: fx.to, kind: 'impact',
            ...anchors.dst, size: meSizeByTag.get(fx.to) ?? meSize, born: now, delay })
          if (fx.to) {
            const prev = popupAccRef.current.get(fx.to)
            popupAccRef.current.set(fx.to, { ...anchors.dst, amount: (prev?.amount ?? 0) + (fx.dmg ?? 0),
              type: 'kinetic', miss: (prev?.miss ?? false) || !fx.hit })
          }
        }
        for (const unit of arcs.myUnits.filter(unit => unit.alive)) {
          const anchor = meAnchorByTag.get(unit.tag) ?? layFx.me
          acidFxRef.current = acidFxRef.current.filter(effect => effect.kind !== 'coating' || effect.tag !== unit.tag)
          acidFxRef.current.push({ key: keyRef.current++, tag: unit.tag, kind: 'coating',
            ...anchor, size: meSizeByTag.get(unit.tag) ?? meSize, born: now, delay })
        }
        continue
      }
      if (fx.blink) {
        const side: 'foe' | 'me' = fx.side === 'me' ? 'me' : 'foe'
        const seg = (side === 'me' ? battle.meBlinkQueue : battle.foeBlinkQueue)?.[fx.tag]
        if (seg) {
          const toReal = (gameMs: number): number =>
            (gameMs - (battle.lastTickGameMs ?? fx.atMs)) / Math.max(0.01, fx.speedX ?? 1)
          const segMs = (seg.appearMs - seg.vanishMs) / Math.max(0.01, fx.speedX ?? 1)
          blinkRef.current.set(fx.tag, {
            side,
            vanish: now + toReal(seg.vanishMs),
            move: now + toReal(seg.moveAtMs),
            appear: now + toReal(seg.appearMs),
            segMs,
          })
        }
        continue
      }
      if (fx.droneDown) {
        const model = droneModelOrFallback(fx.artId)
        if (model) {
          const artId = fx.artId!
          const layDown = layout(dims, foeSizesFor(rowFxTags), visDistRef.current, farM, nearM, meSize)
          if (fx.side === 'foe') {
            const st = foeSortieRef.current.get(`${fx.tag}:${artId}`)
            const elapsed = st ? now - st.startAt : Number.POSITIVE_INFINITY
            const alive =
              arcs?.foeDrones?.find(
                (w) => w.tag === fx.tag && w.artId === artId,
              )?.alive ?? 0
            const rangeBuff =
              arcs?.foeDrones?.find(
                (w) => w.tag === fx.tag && w.artId === artId,
              )?.rangeBuff === true
            const lane = Math.max(0, Math.min(alive, DRONE_SHOW_MAX - 1))
            const pose = foePoseAt(model, lane, st, layDown, elapsed, rangeBuff)
            const off = st?.offs[lane % Math.max(1, st.offs.length)] ?? {
              x: 52,
              y: 0,
            }
            const station = foeDroneStation(
              layDown.me,
              layDown.foe[0] ?? layDown.me,
              off,
              rangeBuff,
            )
            const tk = droneTakeoff(lane)
            const home = {
              x: (layDown.foe[0]?.x ?? layDown.me.x) - tk.x,
              y: (layDown.foe[0]?.y ?? layDown.me.y) + tk.y,
            }
            droneDownRef.current.push({
              key: keyRef.current++,
              artId,
              x: pose.x,
              y: pose.y,
              ...oneThirdToward(station, home),
              born: now,
              foe: true,
            })
          } else {
            const meKey = `${fx.tag ?? 'player'}:${artId}`
            const prevShow =
              downCursor.get(meKey) ?? dronePrevShowRef.current.get(meKey) ?? 1
            const lane = Math.max(0, Math.min(prevShow, DRONE_SHOW_MAX) - 1)
            downCursor.set(meKey, lane)
            const st = droneSortieRef.current.get(meKey);
            const off = st?.offs[lane % Math.max(1, st.offs.length)] ?? {
              x: 46,
              y: 0,
            }
            const foeA = layDown.foe[0] ?? layDown.me
            const station = { x: foeA.x - off.x, y: foeA.y + off.y }
            const tk = droneTakeoff(lane)
            const ownAnchor = droneOwnerAnchor({
              ...(fx.tag !== undefined ? { tag: fx.tag } : {}),
              meAnchors: meAnchorByTag,
              meFallback: layDown.me,
            })
            const home = { x: ownAnchor.x + tk.x, y: ownAnchor.y + tk.y }
            droneDownRef.current.push({
              key: keyRef.current++,
              artId,
              x: station.x,
              y: station.y,
              ...oneThirdToward(station, home),
              born: now,
            })
          }
        }
        continue
      }
      const isMeShot = fx.side === 'me'
      const aimTag = isMeShot ? (fx.to ?? foeAliveTags[0]) : fx.to ?? 'player'
      const aimRowIdx = rowFxTags.indexOf(aimTag)
      const mySrc = isMeShot ? meAnchorByTag.get(fx.tag) : undefined
      const shooterRowIdx = isMeShot ? -1 : rowFxTags.indexOf(fx.tag)
      const aimMeAnchor = isMeShot ? undefined : fx.to !== undefined ? meAnchorByTag.get(fx.to) : undefined
      let src: Anchor | undefined
      let dst: Anchor | undefined
      {
        const r = resolveBoltAnchors({
          side: isMeShot ? 'me' : 'foe',
          tag: fx.tag,
          ...(fx.to !== undefined ? { to: fx.to } : {}),
          rowFxTags,
          meAnchors: meAnchorByTag,
          meFallback: layFx.me,
          foeAnchors: layFx.foe,
        })
        if (r) {
          src = isMeShot ? (mySrc ?? r.src) : r.src
          dst = isMeShot ? r.dst : (aimMeAnchor ?? r.dst)
        }
      }
      if (!src || !dst) continue
      if (isMeShot && fx.hit) lastHitTypeRef.current.set(aimTag, fx.type)
      const aimSize = isMeShot
        ? ((aimRowIdx >= 0 ? layFx.sizes[aimRowIdx] : undefined) ?? foeSizeOf(aimTag))
        : ((fx.to !== undefined ? meSizeByTag.get(fx.to) : undefined) ?? meSize)
      const myShooterSize = isMeShot ? meSizeByTag.get(fx.tag) : undefined
      const shooterSize =
        myShooterSize ?? ((shooterRowIdx >= 0 ? layFx.sizes[shooterRowIdx] : undefined) ?? foeSizeOf(fx.tag))
      const srcNose = noseOf(isMeShot ? (myShooterSize ?? meSize) : shooterSize)
      const dstNose = noseOf(aimSize)
      const dm = fx.src === 'drone' ? droneModelOrFallback(fx.artId) : undefined
      const artW = isMeShot ? (myShooterSize ?? meSize) : shooterSize
      let mounts: ReturnType<typeof mountsOf>
      let muzzlePt: Anchor | null = null
      let from: Anchor | null = null
      let droneDelay = 0
      if (dm) {
        const key = dm.resident ? `res:${fx.artId}` : `fly:${fx.artId}`
        const n = droneSlotRef.current.get(key) ?? 0
        droneSlotRef.current.set(key, n + 1)
        const foeA = layFx.foe[0] ?? layFx.me;
        const anchor = isMeShot ? foeA : layFx.me
        const dir = isMeShot ? 1 : -1;
        const foeDrone = !isMeShot
        const skey = `${fx.tag}:${fx.artId}`
        const smap = foeDrone ? foeSortieRef.current : droneSortieRef.current
        const layOwner = foeDrone
          ? layFx
          : fx.tag && fx.tag !== 'player'
            ? { foe: layFx.foe, me: meAnchorByTag.get(fx.tag) ?? layFx.me }
            : layFx
        if (DRONE_STYLE === 'sortie' && !dm.resident) {
          const count = foeDrone
            ? Math.max(
                1,
                Math.min(foeDroneAliveOf(fx.tag!, fx.artId!), DRONE_SHOW_MAX),
              )
            : Math.max(
                1,
                Math.min(droneCountOf.get(skey) ?? 1, DRONE_SHOW_MAX),
              )
          const lane = n % count
          const prev = smap.get(skey)
          const cycleMs =
            DRONE_SORTIE_OUT_MS + DRONE_DWELL_MS + DRONE_SORTIE_BACK_MS
          const st =
            !prev || now - prev.startAt >= cycleMs + 40
              ? { startAt: now, offs: droneRandomOffsets(DRONE_SHOW_MAX, droneOutward) }
              : prev
          smap.set(skey, st)
          const off = st.offs[lane % st.offs.length]!
          const elapsed = now - st.startAt
          const station = foeDrone
            ? foeDroneStation(layFx.me, foeA, off, foeDroneBuffedOf(fx.tag!))
            : droneStationFrom(anchor, dir, off)
          if (elapsed < DRONE_SORTIE_OUT_MS) {
            from = station
            droneDelay = Math.round(DRONE_SORTIE_OUT_MS - elapsed)
          } else if (elapsed < DRONE_SORTIE_OUT_MS + DRONE_DWELL_MS) {
            from = station
          } else if (isMeShot) {
            from = dronePoseAt(dm, lane, st, layOwner, elapsed)
          } else {
            const t2 = Math.min(
              1,
              Math.max(
                0,
                (elapsed - DRONE_SORTIE_OUT_MS - DRONE_DWELL_MS) /
                  DRONE_SORTIE_BACK_MS,
              ),
            )
            const tk = droneTakeoff(lane)
            const deckAbs = { x: foeA.x - tk.x, y: foeA.y + tk.y };
            from = dronePathPos(
              t2,
              station,
              deckAbs,
              droneArcHeight(lane),
              true,
            )
          }
        } else {
          from = residentDroneFrom({
            ...(fx.tag !== undefined ? { tag: fx.tag } : {}),
            meAnchors: meAnchorByTag,
            meFallback: layFx.me,
            slot: dm.slots[0] ?? { x: 0, y: 0 },
          })
        }
      } else {
        mounts = isMeShot ? mountsOf(meShip?.id, undefined) : mountsOf(undefined, foeKey)
        const mz = mounts?.muzzles
        if (mz && mz.length > 0) {
          const k = isMeShot ? 'me' : fx.tag
          const n = muzzleCountRef.current.get(k) ?? 0
          muzzleCountRef.current.set(k, n + 1)
          muzzlePt = mz[n % mz.length]!
        }
      }
      const g = boltGeom(
        fx.side,
        src,
        dst,
        srcNose,
        dm ? 0 : dstNose,
        muzzlePt,
        artW,
        from,
      );
      if (!fx.pd)
        boltsRef.current.push({
          key: keyRef.current++,
          color: DMG_COLOR[fx.type],
          type: fx.type,
          hit: fx.hit,
          x1: g.x1,
          y1: g.y1,
          len: g.len,
          angDeg: g.angDeg,
          born: now,
          ...(dm ? { drone: fx.artId } : {}),
          ...(droneDelay > 0 ? { delay: droneDelay } : {}),
        })
      flashRef.current.push({
        key: keyRef.current++,
        at: now,
        color: DMG_COLOR[fx.type],
        x: g.x1,
        y: g.y1,
        ...(dm ? { small: true } : {}),
        ...(droneDelay > 0 ? { delay: droneDelay } : {}),
      })
      {
        const tx = g.x1 + Math.cos((g.angDeg * Math.PI) / 180) * g.len
        const ty = g.y1 + Math.sin((g.angDeg * Math.PI) / 180) * g.len
        const tkey = fx.to ?? `${Math.round(tx)},${Math.round(ty)}`
        const dmg = typeof fx.dmg === 'number' && Number.isFinite(fx.dmg) ? Math.max(0, fx.dmg) : 0
        const prev = popupAccRef.current.get(tkey)
        popupAccRef.current.set(tkey, {
          x: tx,
          y: ty,
          amount: (prev?.amount ?? 0) + dmg,
          type: fx.type,
          miss: (prev?.miss ?? false) || fx.hit === false,
        })
      }
    }
    if (flashRef.current.length > 6) flashRef.current.splice(0, flashRef.current.length - 6)
  }

}
