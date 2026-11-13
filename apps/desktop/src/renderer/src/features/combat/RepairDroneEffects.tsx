import { useEffect, useRef, useState } from 'react'
import type { BattleFx, BattleState } from '@whale/core'
import { newRepairDroneEvents, repairDronePose, REPAIR_DRONE_LIFE_MS } from './repairDroneMotion'
import { droneModelOrFallback } from './droneArt'
import './repairDroneEffects.css'

type Flight = { event: BattleFx; elapsed: number; lane: number }
type Props = { battle: BattleState; anchors: Map<string, { x: number; y: number }>; dims: { W: number; H: number }; paused?: boolean }

/** 纯表现层：跟踪真实修理事件，不参与选靶、扣料或回血。 */
export function RepairDroneEffects({ battle, anchors, dims, paused = false }: Props) {
  const input = useRef({ battle, anchors, paused })
  input.current = { battle, anchors, paused }
  const [flights, setFlights] = useState<Flight[]>([])
  const nodes = useRef(new Map<number, SVGGElement>())
  useEffect(() => {
    let seq = battle.fx.at(-1)?.seq ?? -1
    let active: Flight[] = []
    let previous = performance.now()
    let frame = 0
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    const tick = (now: number) => {
      const current = input.current
      const delta = Math.min(100, Math.max(0, now - previous))
      previous = now
      let changed = false
      if (!current.paused && !document.hidden) {
        for (const flight of active) flight.elapsed += delta * Math.max(1, current.battle.speedX ?? 1)
        const fresh = newRepairDroneEvents(current.battle.fx, seq, current.battle.lastTickGameMs, current.battle.speedX)
        seq = current.battle.fx.at(-1)?.seq ?? seq
        for (const event of fresh) {
          // 事件已经在真实修理成功后写入；同一拍随后被点防击落也不能抹掉这次修理的表现。
          if (!current.anchors.has(event.tag) || !current.anchors.has(event.to!)) continue
          active.push({ event, elapsed: 0, lane: event.repair!.droneIndex })
          changed = true
        }
      } else {
        // 最小化、后台或暂停不补播期间的旧脉冲。
        seq = current.battle.fx.at(-1)?.seq ?? seq
      }
      // 事件已经代表一次真实完成的修理；即使无人机在返航途中被击落，也把这次动画播完。
      const live = active.filter(flight => flight.elapsed < REPAIR_DRONE_LIFE_MS)
      if (live.length !== active.length) changed = true
      active = live.slice(-24)
      for (const flight of active) {
        const node = nodes.current.get(flight.event.seq)
        const from = current.anchors.get(flight.event.tag), to = current.anchors.get(flight.event.to!)
        if (!node || !from || !to) continue
        const pose = repairDronePose(from, to, flight.elapsed, flight.lane)
        const opacity = Math.min(1, flight.elapsed / 100, (REPAIR_DRONE_LIFE_MS - flight.elapsed) / 140)
        node.style.opacity = String(Math.max(0, opacity))
        const craft = node.querySelector<SVGGElement>('[data-repair-craft]')!
        craft.setAttribute('transform', `translate(${reduced.matches ? to.x - 26 : pose.x} ${reduced.matches ? to.y - 20 : pose.y}) rotate(${reduced.matches ? 0 : pose.angle})`)
        const work = node.querySelector<SVGGElement>('[data-repair-work]')!
        work.style.opacity = pose.working || reduced.matches ? '1' : '0'
        work.setAttribute('transform', `translate(${to.x} ${to.y})`)
      }
      if (changed) setFlights([...active])
      frame = requestAnimationFrame(tick)
    }
    setFlights([])
    frame = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(frame); nodes.current.clear() }
  }, [battle])

  return <svg className="app-bts-repair-flight-layer" viewBox={`0 0 ${dims.W} ${dims.H}`} preserveAspectRatio="none" aria-hidden="true">
    {flights.map(({ event }) => <g key={event.seq} data-repair-from={event.tag} data-repair-to={event.to}
      style={{ opacity: 0 }} ref={node => { if (node) nodes.current.set(event.seq, node); else nodes.current.delete(event.seq) }}>
      <g data-repair-craft="" className="app-bts-repair-craft">
        {droneModelOrFallback(event.artId).art}
      </g>
      <g data-repair-work="" style={{ opacity: 0 }}>
        <path className="app-bts-repair-beam" d="M-25-20 L-2-2 M-27-16 L-3 3" />
        <circle className="app-bts-repair-pulse" r="18" />
        <text className="app-bts-repair-number" x="0" y="-32">+{Math.ceil(event.repair!.armor + event.repair!.hull)}</text>
      </g>
    </g>)}
  </svg>
}
