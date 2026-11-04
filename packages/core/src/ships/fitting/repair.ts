/** 功能域职责拆分，保持原计算与顺序。 */
import type { ModuleSlot, RackSlot, SimContext, ModuleDef } from '../../types'
import { type GameState, addLog } from '../../state'
import { fleetDefOf } from '../../instances'
import { rackBays } from '../../labels'
import { moduleAllowedOnShip } from '../../shipFitting'
import { addModule, countModule } from './stock'
import { addWare } from '../../inventory'
import { shipSlotsWithPlugsOf, isPlugOf, plugSlotsOf, plugSlotExpansionBlockedOf, normalizePlugSlotExpansions } from '../../plugs'
import { trimDroneLoadToBay } from './drones'

/** v17 六槽 → v18 位映射（迁移与旧语义共用；新家族无映射位） */
export const V17_FAMILY_BAYS: Partial<Record<ModuleSlot, { rack: RackSlot; index: number }>> = {
  turret: { rack: 'high', index: 0 },
  miner: { rack: 'high', index: 1 },
  shield: { rack: 'mid', index: 0 },
  propulsion: { rack: 'mid', index: 1 },
  armor: { rack: 'low', index: 0 },
  cargo: { rack: 'low', index: 1 },
}

/**
 * 下架型号迁移表（V17 装备改版起沿用）：旧"通用全系"战斗装备 id → 新分系专精款
 * （动能款归位）；V18B-1：高爆炮台 → 同档导弹架（爆炸系武器形态归位）；
 * V18B-2：能量炮台 + 异星原型 → 同档激光炮（能量 = 激光形态归位）。
 * 本表供 repairDeprecatedModules 使用。
 */
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
  // V18B-1：高爆炮台退役 → 导弹架（爆炸 = 导弹形态）
  'mod-turret-exp-1': 'mod-missile-1',
  'mod-turret-exp-2': 'mod-missile-2',
  'mod-turret-exp-3': 'mod-missile-3',
  // V18B-2：能量炮台 + 异星原型退役 → 激光炮（能量 = 激光形态；异星原型 → 原型激光）
  'mod-turret-pla-1': 'mod-laser-1',
  'mod-turret-pla-2': 'mod-laser-2',
  'mod-turret-pla-3': 'mod-laser-3',
  'mod-turret-proto': 'mod-laser-proto',
}

/** 纯货舰旧装配无损退库；在途虫洞编队保持本趟规格，结束后再整理，重复调用不增发。 */
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

/**
 * 载入存档后的装备修复（V17/V18；幂等）：把装配中/装备库里的已下架型号替换为迁移款、
 * 悬空件退回；把每船位数组长度与船槽布局对齐（超长尾件退库、短位补空——含 v17 档
 * 六槽→18 位数组迁移后的 2/2/2 过渡形状）；并把停在**中/低槽的作业装备**（采集器 / 打捞器）
 * 归位高槽（船长 2026-09-14「改回高槽」；高槽满则把最后装上的那件退回装备库腾位；在洞编队跳过）。
 * 应在 ctx 就绪后、离线结算前调用。
 */
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
  /** 在洞编队（uid）——与「进洞船只所有行为都锁定（含改装）」同口径：归位时跳过，出洞后再载入即归位 */
  const inRun = new Set<string>([...(state.wormhole?.run?.fleet ?? []), ...(state.wormholeAuto ?? []).flatMap((r) => r.shipIds)])
  for (const [uid, ship] of Object.entries(state.fleet)) {
    const fitted = ship?.fitted
    if (!fitted) continue
    const shipDef = fleetDefOf(state, ctx, uid)
    // 1) 逐位：目录外 id → 迁移替换，否则卸下退回
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
    /**
     * 2) V18 槽位数对齐：长度 = **实际可用槽位**（船型布局 ＋ 插件扩槽；目标短 → 尾件退库；目标长 → 补空）
     *
     * 🔴 **2026-09-28 玩家报障修**：目标长度原先直接取 `shipDef.slots`（**船型基础布局**，**不含插件扩槽**）
     * ⇒ 装了「中层舱段插件 `midSlotsAdd`」「下层舱段插件 `lowSlotsAdd`」的船，**每次读档**都把
     * `fitted.mid` / `fitted.low` 截回基础长度，**扩出来的那一格连同装在里面的装备一起被退回装备库**
     * （玩家报障原话：「**船插增加的中槽和低槽上的装备无法保存进配置，重启游戏后会丢失**」）。
     * ⇒ 改走**槽位单点** `plugs.shipSlotsWithPlugsOf`（与装配校验 `wantedBaysOf`、装配页格数、
     * `ensureRackBays` 同一把尺；2026-09-27 那次只改了两处，漏了这一处与 `fitPresets.applyFitPreset`）。
     */
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
    // 2.5) **作业装备归位高槽**（船长 2026-09-14「改回高槽」）：2026-09-13～09-14 短暂的低槽口径下
    //      存下的档，采集器 / 打捞器可能停在中/低槽 ⇒ 搬回高槽（幂等）。三条口径：
    //      · 高槽有空位 ⇒ 直接搬；高槽满 ⇒ 把**最后装上的那件**（跳过作业装备本身、跳过空位）
    //        退回装备库腾位（船长 2026-09-14 裁定：「**自动归位，被挤掉的炮退回装备库**」——
    //        件不丢、随时可装回，日志写明件数）；
    //      · **只管作业装备两族**（不做通用归位，免得动别的件）；
    //      · **在洞编队跳过**（`inRun`）：进洞后改装是锁的，归位也不该在途改战力 ⇒ 出洞后再载入即归位。
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
            // 高槽满：腾出最后一个"非作业装备"的已装件（退回装备库）
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
          if (free < 0) break // 整个高槽都是作业装备/空位异常 ⇒ 无处可搬，留着不错位更多
          highBays[free] = id
          bays[i] = null
          rackMoved += 1
        }
      }
    }
    /**
     * 2.6) **无人机甲板扩展归位低槽**（**2026-09-27 船长令**：「将扩大无人机舱的装备从高槽移动到低槽」）：
     *      与 2.5 同款口径的镜像 —— 旧档里停在高/中槽的甲板扩展搬回**低槽**（幂等）。三条口径同 2.5：
     *      · 低槽有空位 ⇒ 直接搬；低槽满 ⇒ 把**最后装上的那件**（跳过甲板扩展本身、跳过空位）
     *        退回装备库腾位（船长 2026-09-27 认可「件不丢、随时可装回，日志写明件数」）；
     *      · **只管甲板扩展一族**（slot === 'drone-rack'；战术导控 / 中继天线仍归高槽，不动）；
     *      · **在洞编队跳过**（inRun）——进洞后改装是锁的，出洞后再载入即归位。
     */
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
            // 低槽满：腾出最后一个"非甲板扩展"的已装件（退回装备库）
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
          if (free < 0) break // 低槽全是甲板扩展/空位异常 ⇒ 无处可搬，留着不错位更多
          lowBays[free] = id
          bays[i] = null
          bayRackMoved += 1
        }
      }
    }
  }
  // 3) 装备库：有迁移的已下架型号 → 计数并入迁移款后删除旧键（无迁移的保留不丢资产）
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
  /**
   * **同舰唯一归正**（**2026-09-26 玩家报障「可以装多个损管」**）：报障期间换装路径漏查 ⇒
   * 已有存档里可能真的躺着两件损管。这里按"**保留靠前那一件**"（高→中→低、位序小的优先）
   * 把多余件**退回装备库**（不销毁资产），并写一条日志让玩家知道。
   *
   * ⚠ **在洞编队跳过**：与上面对齐/归位同口径（进洞船只所有行为锁定，含改装）⇒ 出洞后载入即归正。
   */
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
  /**
   * **插件归正**（**2026-09-27 船长报障**「有部分船插会在装备栏显示」⇒ 船长裁决**甲**：
   * 「读档自动搬回插件槽／退回装备库」）。
   *
   * 病根：插件在数据里为过体检契约声明了 `rack: 'low'`，而 `rackOf()` 优先返回 `def.rack` ⇒ 装配页的
   * 低槽候选把它列出来、点下去真写进 `fitted.low`（插件因此变成可卸下，破了「不可拆卸、不可替换」）。
   * 入口已按 `isRackModule` 堵住；这里收存量：**先搬回插件槽**（有空位），**槽满或没插件槽就退回装备库**
   * （**不销毁资产**）。判据走单点 `isPlugOf`，不自己比字符串。
   *
   * ⚠ 与上面那条同舰唯一归正同口径：**在洞编队跳过**（进洞锁定改装）⇒ 出洞后载入即归正。
   */
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
  // 槽位对齐可能裁掉甲板扩展 → 机舱变小：超出容量的无人机同样自动卸下（2026-09-10 船长口径）
  for (const uid of Object.keys(state.fleet)) {
    if (state.fleet[uid]?.defId) trimDroneLoadToBay(state, ctx, uid)
  }
}

/** 缩槽退回机舱装备后，超出容量的无人机也沿既有入口完整退库。 */
export function repairSlotExpansionPlugs(state: GameState, ctx: SimContext): void {
  for (const shipId of normalizePlugSlotExpansions(state, ctx)) trimDroneLoadToBay(state, ctx, shipId)
}

/**
 * V18 口径取消（船长 2026-09-04）：弹药每型只留单档（-l），把 -h 重弹按 1:1 并入对应
 * 通用弹（货仓/仓库/escrow）；挂着 -h 的玩家卖单撤销。幂等：跑过即无 -h 键。
 */
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
