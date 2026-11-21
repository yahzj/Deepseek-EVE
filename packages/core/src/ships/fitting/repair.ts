import type { ModuleSlot, RackSlot, SimContext, ModuleDef } from '../../types'
import { type GameState, addLog } from '../../state'
import { fleetDefOf } from '../../instances'
import { rackBays } from '../../labels'
import { moduleAllowedOnShip } from '../../shipFitting'
import { addModule, countModule } from './stock'
import { addWare } from '../../inventory'
import { shipSlotsWithPlugsOf, isPlugOf, plugSlotsOf, plugSlotExpansionBlockedOf, normalizePlugSlotExpansions } from '../../plugs'
import { trimDroneLoadToBay } from './drones'

export const V17_FAMILY_BAYS: Partial<Record<ModuleSlot, { rack: RackSlot; index: number }>> = {
  turret: { rack: 'high', index: 0 },
  miner: { rack: 'high', index: 1 },
  shield: { rack: 'mid', index: 0 },
  propulsion: { rack: 'mid', index: 1 },
  armor: { rack: 'low', index: 0 },
  cargo: { rack: 'low', index: 1 },
}

export const V17_MODULE_MIGRATIONS: Readonly<Record<string, string>> = {
  'mod-shield-1': 'mod-shield-kin-1',
  'mod-shield-2': 'mod-shield-kin-2',
  'mod-shield-3': 'mod-shield-kin-3',
  'mod-armor-1': 'mod-armor-kin-1',
  'mod-armor-2': 'mod-armor-kin-2',
  'mod-armor-3': 'mod-armor-kin-3',
  'mod-turret-1': 'mod-turret-kin-1',
  'mod-turret-2': 'mod-turret-kin-2',
  'mod-turret-3': 'mod-turret-kin-3',
  'mod-turret-exp-1': 'mod-missile-1',
  'mod-turret-exp-2': 'mod-missile-2',
  'mod-turret-exp-3': 'mod-missile-3',
  'mod-turret-pla-1': 'mod-laser-1',
  'mod-turret-pla-2': 'mod-laser-2',
  'mod-turret-pla-3': 'mod-laser-3',
  'mod-turret-proto': 'mod-laser-proto',
}

export function repairCivilianFittings(state: GameState, ctx: SimContext): void {
  const inRun = new Set([...(state.wormhole?.run?.fleet ?? []), ...(state.wormholeAuto ?? []).flatMap((r) => r.shipIds)])
  let modules = 0
  let drones = 0
  for (const [uid, entry] of Object.entries(state.fleet)) {
    if (inRun.has(uid)) continue
    const ship = fleetDefOf(state, ctx, uid)
    if (ship?.civilianFittingOnly !== true) continue
    for (const rack of ['high', 'mid', 'low'] as const) {
      const bays = rackBays(entry.fitted, rack)
      for (let i = 0; i < bays.length; i++) {
        const id = bays[i]
        const actualId = id ? V17_MODULE_MIGRATIONS[id] ?? id : undefined
        const mod = actualId ? ctx.modules.get(actualId) : undefined
        if (!id || !mod || moduleAllowedOnShip(ship, mod)) continue
        addModule(state, actualId!)
        bays[i] = null
        modules++
      }
    }
    for (const [id, n] of Object.entries(entry.droneLoad ?? {})) {
      if (!Number.isFinite(n) || n <= 0) continue
      addWare(state, id, n)
      drones += n
    }
    delete entry.droneLoad
  }
  if (modules + drones > 0) {
    addLog(state, 'fleet', `货舰装配已整理：${modules} 件装备退回装备库，${drones} 架无人机退回物品仓库。`,
      'core.equipment.035', { p1: modules, p2: drones })
  }
}

export function repairDeprecatedModules(state: GameState, ctx: SimContext): void {
  repairCivilianFittings(state, ctx)
  repairSlotExpansionPlugs(state, ctx)
  let fittedMoved = 0
  let slotEmptied = 0
  let bayMoved = 0
  let aligned = 0
  let rackMoved = 0
  let rackFreed = 0
  let bayRackMoved = 0
  let bayRackFreed = 0
  const inRun = new Set<string>([...(state.wormhole?.run?.fleet ?? []), ...(state.wormholeAuto ?? []).flatMap((r) => r.shipIds)])
  for (const [uid, ship] of Object.entries(state.fleet)) {
    const fitted = ship?.fitted
    if (!fitted) continue
    const shipDef = fleetDefOf(state, ctx, uid)
    for (const rack of ['high', 'mid', 'low'] as const) {
      const bays = rackBays(fitted, rack)
      for (let i = 0; i < bays.length; i++) {
        const id = bays[i]
        if (!id) continue
        if (!ctx.modules.get(id)) {
          const next = V17_MODULE_MIGRATIONS[id]
          if (next && ctx.modules.get(next)) {
            bays[i] = next
            fittedMoved += 1
          } else {
            bays[i] = null
            state.moduleBay[id] = countModule(state, id) + 1
            slotEmptied += 1
          }
        }
      }
    }
    if (shipDef) {
      const target = shipSlotsWithPlugsOf(state, ctx, uid) as Record<RackSlot, number>
      for (const rack of ['high', 'mid', 'low'] as const) {
        const bays = rackBays(fitted, rack)
        const want = target[rack]
        if (bays.length > want) {
          for (let i = want; i < bays.length; i++) {
            const id = bays[i]
            if (id) {
              state.moduleBay[id] = countModule(state, id) + 1
              aligned += 1
            }
          }
          bays.length = want
        } else if (bays.length < want) {
          while (bays.length < want) bays.push(null)
        }
      }
    }
    if (!inRun.has(uid)) {
      const highBays = rackBays(fitted, 'high')
      for (const from of ['mid', 'low'] as const) {
        const bays = rackBays(fitted, from)
        for (let i = 0; i < bays.length; i++) {
          const id = bays[i]
          if (!id) continue
          const slot = ctx.modules.get(id)?.slot
          if (slot !== 'miner' && slot !== 'salvager') continue
          let free = highBays.findIndex((x) => x === null)
          if (free < 0) {
            for (let j = highBays.length - 1; j >= 0; j--) {
              const occupant = highBays[j]
              if (!occupant) continue
              const occSlot = ctx.modules.get(occupant)?.slot
              if (occSlot === 'miner' || occSlot === 'salvager') continue
              highBays[j] = null
              state.moduleBay[occupant] = countModule(state, occupant) + 1
              rackFreed += 1
              free = j
              break
            }
          }
          if (free < 0) break
          highBays[free] = id
          bays[i] = null
          rackMoved += 1
        }
      }
    }
    if (!inRun.has(uid)) {
      const lowBays = rackBays(fitted, 'low')
      for (const from of ['high', 'mid'] as const) {
        const bays = rackBays(fitted, from)
        for (let i = 0; i < bays.length; i++) {
          const id = bays[i]
          if (!id) continue
          if (ctx.modules.get(id)?.slot !== 'drone-rack') continue
          let free = lowBays.findIndex((x) => x === null)
          if (free < 0) {
            for (let j = lowBays.length - 1; j >= 0; j--) {
              const occupant = lowBays[j]
              if (!occupant) continue
              if (ctx.modules.get(occupant)?.slot === 'drone-rack') continue
              lowBays[j] = null
              state.moduleBay[occupant] = countModule(state, occupant) + 1
              bayRackFreed += 1
              free = j
              break
            }
          }
          if (free < 0) break
          lowBays[free] = id
          bays[i] = null
          bayRackMoved += 1
        }
      }
    }
  }
  for (const [id, n] of Object.entries(state.moduleBay)) {
    const next = V17_MODULE_MIGRATIONS[id]
    if (!next || !ctx.modules.get(next)) continue
    state.moduleBay[next] = (state.moduleBay[next] ?? 0) + n
    delete state.moduleBay[id]
    bayMoved += n
  }
  const total = fittedMoved + slotEmptied + bayMoved + aligned + rackMoved + rackFreed + bayRackMoved + bayRackFreed
  if (total > 0) {
    addLog(
      state,
      'fleet',
      `装备修复：旧件按动能款迁移 ${fittedMoved + bayMoved} 件；悬空退回 ${slotEmptied} 件；` +
        (aligned > 0 ? `槽位数与船布局对齐，溢出件退回装备库 ${aligned} 件。` : '') +
        (rackMoved > 0 ? `作业装备（采集器 / 打捞器）归位到高槽 ${rackMoved} 件。` : '') +
        (rackFreed > 0 ? `高槽已满，为归位腾出的 ${rackFreed} 件已退回装备库（随时可装回）。` : '') +
        (bayRackMoved > 0 ? `无人机甲板扩展归位到低槽 ${bayRackMoved} 件。` : '') +
        (bayRackFreed > 0 ? `低槽已满，为归位腾出的 ${bayRackFreed} 件已退回装备库（随时可装回）。` : ''),
    )
  }
  const dupReturned: string[] = []
  const inRunFleet = inRun
  for (const [uid, ship] of Object.entries(state.fleet)) {
    if (inRunFleet.has(uid)) continue
    const fitted = ship?.fitted
    if (!fitted) continue
    let seen: ModuleDef | undefined
    for (const rack of ['high', 'mid', 'low'] as const) {
      const bays = rackBays(fitted, rack)
      for (let i = 0; i < bays.length; i += 1) {
        const id = bays[i]
        if (!id) continue
        const def = ctx.modules.get(id)
        if (def?.unique !== true) continue
        if (seen === undefined) {
          seen = def
          continue
        }
        bays[i] = null
        state.moduleBay[id] = countModule(state, id) + 1
        dupReturned.push(def.name)
      }
    }
  }
  if (dupReturned.length > 0) {
    addLog(
      state,
      'fleet',
      `同舰唯一归正：每舰只留一件损伤管制装置，退回装备库 ${dupReturned.length} 件（${dupReturned.join('、')}）。`,
      'core.equipment.029',
      { p1: dupReturned.length, p2: dupReturned.join('、') },
    )
  }
  const plugFixed: string[] = []
  const plugReturned: string[] = []
  for (const [uid, ship] of Object.entries(state.fleet)) {
    if (inRunFleet.has(uid)) continue
    const fitted = ship?.fitted
    if (!fitted) continue
    for (const rack of ['high', 'mid', 'low'] as const) {
      const bays = rackBays(fitted, rack)
      for (let i = 0; i < bays.length; i += 1) {
        const id = bays[i]
        if (!id) continue
        const def = ctx.modules.get(id)
        if (!def || !isPlugOf(def)) continue
        bays[i] = null
        const have = ship.plugs ?? []
        if (have.length < plugSlotsOf(state, ctx, uid) && !plugSlotExpansionBlockedOf(state, ctx, uid, def)) {
          ship.plugs = [...have, id]
          plugFixed.push(def.name)
        } else {
          state.moduleBay[id] = countModule(state, id) + 1
          plugReturned.push(def.name)
        }
      }
    }
  }
  if (plugFixed.length + plugReturned.length > 0) {
    const parts = [
      ...(plugFixed.length > 0 ? [`装回插件槽 ${plugFixed.length} 件（${plugFixed.join('、')}）`] : []),
      ...(plugReturned.length > 0 ? [`退回装备库 ${plugReturned.length} 件（${plugReturned.join('、')}）`] : []),
    ]
    addLog(
      state,
      'fleet',
      `舰船插件归正：${parts.join('；')}——插件只占插件槽，不占高/中/低槽。`,
      'core.equipment.031',
      { p1: plugFixed.length, p2: plugReturned.length, p3: [...plugFixed, ...plugReturned].join('、') },
    )
  }
  for (const uid of Object.keys(state.fleet)) {
    if (state.fleet[uid]?.defId) trimDroneLoadToBay(state, ctx, uid)
  }
}

export function repairSlotExpansionPlugs(state: GameState, ctx: SimContext): void {
  for (const shipId of normalizePlugSlotExpansions(state, ctx)) trimDroneLoadToBay(state, ctx, shipId)
}

export const HEAVY_TO_LIGHT: Record<string, string> = {
  'ammo-kinetic-h': 'ammo-kinetic-l',
  'ammo-explosive-h': 'ammo-explosive-l',
  'ammo-plasma-h': 'ammo-plasma-l',
}

export function migrateDeprecatedAmmo(state: GameState): number {
  let converted = 0
  for (const [id, n] of Object.entries(state.warehouse.items)) {
    const next = HEAVY_TO_LIGHT[id]
    if (!next) continue
    state.warehouse.items[next] = (state.warehouse.items[next] ?? 0) + n
    delete state.warehouse.items[id]
    converted += n
  }
  for (const ship of Object.values(state.fleet)) {
    const cargo = ship?.cargo
    if (!cargo) continue
    for (const id of Object.keys(cargo)) {
      const next = HEAVY_TO_LIGHT[id]
      if (!next) continue
      const n = cargo[id]!
      cargo[next] = (cargo[next] ?? 0) + n
      delete cargo[id]
      converted += n
    }
  }
  state.orders = state.orders.filter((o) => {
    if (o.side === 'sell' && o.good && HEAVY_TO_LIGHT[o.good]) {
      const locked = state.escrowItems[o.good] ?? 0
      const take = Math.min(locked, o.qty)
      if (take > 0) {
        state.escrowItems[o.good] = locked - take
        if (state.escrowItems[o.good] === 0) delete state.escrowItems[o.good]
        const next = HEAVY_TO_LIGHT[o.good]!
        state.warehouse.items[next] = (state.warehouse.items[next] ?? 0) + take
        converted += take
      }
      return false
    }
    return true
  })
  for (const id of Object.keys(state.escrowItems)) {
    const next = HEAVY_TO_LIGHT[id]
    if (!next) continue
    const n = state.escrowItems[id]!
    state.warehouse.items[next] = (state.warehouse.items[next] ?? 0) + n
    delete state.escrowItems[id]
    converted += n
  }
  if (converted > 0) {
    addLog(
      state,
      'fleet',
      `弹药改版：旧重型弹已按 1:1 并入通用弹（共 ${converted} 发），相关挂单已撤销。`,
      'core.equipment.026',
      { p1: converted },
    )
  }
  return converted
}
