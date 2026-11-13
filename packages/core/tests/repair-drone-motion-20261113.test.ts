import { describe, expect, it } from 'vitest'
import type { BattleFx } from '../src/state'
import { newRepairDroneEvents, repairDronePose, REPAIR_DRONE_OUT_MS, REPAIR_DRONE_WORK_MS, REPAIR_DRONE_LIFE_MS } from '../../../apps/desktop/src/renderer/src/features/combat/repairDroneMotion'

const event = (seq: number, atMs = 1000): BattleFx => ({ seq, atMs, side: 'me', tag: 'ally-1', to: 'ally-2',
  type: 'kinetic', hit: true, src: 'drone', artId: 'drone-repair-mil', repair: { armor: 20, hull: 30, droneIndex: 2 } })

describe('修理无人机表现事件与逐舰几何', () => {
  it('只取新有效维修，不重播、不过期补播，倍速折算沿用战斗事件窗口', () => {
    const events = [event(1), event(2, 1100), { ...event(3), repair: undefined },
      { ...event(4), repair: { armor: 0, hull: 0, droneIndex: 0 } }]
    expect(newRepairDroneEvents(events, 1, 1150).map(row => row.seq)).toEqual([2])
    expect(newRepairDroneEvents(events, 4, 1150)).toEqual([])
    expect(newRepairDroneEvents(events, 0, 2000)).toEqual([])
    expect(newRepairDroneEvents([event(1)], 0, 1400, 2)).toHaveLength(1)
  })

  it('起点取所属舰，维修落点取友舰，驻留后返航且最终回到起点', () => {
    const from = { x: 160, y: 180 }, to = { x: 350, y: 320 }
    expect(repairDronePose(from, to, 0)).toMatchObject({ ...from, working: false })
    const working = repairDronePose(from, to, REPAIR_DRONE_OUT_MS + 1)
    expect(working).toMatchObject({ x: to.x - 26, y: to.y - 20, working: true })
    expect(repairDronePose(from, to, REPAIR_DRONE_OUT_MS + REPAIR_DRONE_WORK_MS).working).toBe(false)
    expect(repairDronePose(from, to, REPAIR_DRONE_LIFE_MS)).toMatchObject({ ...from, working: false })
    const moved = repairDronePose({ x: from.x + 20, y: from.y + 30 }, { x: to.x + 20, y: to.y + 30 }, REPAIR_DRONE_OUT_MS + 1)
    expect(moved.x - working.x).toBe(20)
    expect(moved.y - working.y).toBe(30)
  })
})
