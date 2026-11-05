import type { SimContext } from './types'
import { nextInt } from './rng'
import type { RngState } from './state'

export const ENCRYPTED_FAMILIES = ['A', 'C', 'D', 'E', 'G'] as const
export type EncryptedFamily = typeof ENCRYPTED_FAMILIES[number]
export const ENCRYPTED_BLUEPRINT_COUNT = { min: 1, max: 3 } as const
const PLUGS: Readonly<Record<EncryptedFamily, readonly string[]>> = {
  A: ['bp-once-plug-pirate-raider', 'bp-once-plug-pirate-damage-management'],
  C: ['bp-once-plug-alien-shield-coating', 'bp-once-plug-alien-nanobiomass'],
  D: ['bp-once-plug-gravekeeper-capacitor', 'bp-once-plug-gravekeeper-charge'],
  E: ['bp-once-plug-titan-compression', 'bp-once-plug-titan-drone-command'],
  G: ['bp-once-plug-deadarmy-printing', 'bp-once-plug-deadarmy-reinforced-hull'],
}
const WEAPONS: Readonly<Record<EncryptedFamily, readonly string[]>> = {
  A: ['bp-wh-a-frag'], C: ['bp-wh-c-laser', 'bp-wh-c-missile'], D: ['bp-wh-d-laser', 'bp-wh-d-turret'],
  E: ['bp-wh-e-pd'], G: ['bp-wh-g-turret'],
}
const SHIPS: Readonly<Record<EncryptedFamily, readonly string[]>> = {
  A: ['sbp-wh-a-frigate', 'sbp-wh-a-destroyer', 'sbp-wh-a-cruiser'],
  C: ['sbp-wh-c-frigate', 'sbp-wh-c-destroyer', 'sbp-wh-c-cruiser'],
  D: ['sbp-wh-d-frigate', 'sbp-wh-d-destroyer', 'sbp-wh-d-cruiser'],
  E: ['sbp-wh-e-frigate', 'sbp-wh-e-destroyer', 'sbp-wh-e-carrier'],
  G: ['sbp-wh-g-frigate', 'sbp-wh-g-destroyer', 'sbp-wh-g-cruiser'],
}

export function encryptedFamilyOf(boxId: string): EncryptedFamily | null {
  const id = boxId.toUpperCase()
  return ENCRYPTED_FAMILIES.find(family => id === `BOX-ENCRYPTED-${family}`) ?? null
}

/** 开柜和市场期望估值共用的类别等权奖池。 */
export function encryptedBlueprintPool(family: EncryptedFamily): readonly (readonly string[])[] {
  return [PLUGS[family], WEAPONS[family], SHIPS[family]]
}

/** 显式登记首批一次性池；未来永久蓝图须单独批准后扩展。 */
export function encryptedBlueprintGroups(ctx: SimContext, family: EncryptedFamily): readonly (readonly string[])[] | null {
  const groups = encryptedBlueprintPool(family)
  for (const [index, group] of groups.entries()) for (const id of group) {
    const bp = index === 2 ? ctx.shipBlueprints.get(id) : ctx.blueprints.get(id)
    if (!bp || bp.singleUse !== true || bp.unreleased === true) return null
    if (index === 0 && ctx.modules.get(ctx.blueprints.get(id)!.moduleId ?? '')?.slot !== 'plug') return null
    if (index === 1) {
      const module = ctx.modules.get(ctx.blueprints.get(id)!.moduleId ?? '')
      if (!module || !['turret', 'laser', 'missile'].includes(module.slot)) return null
    }
    if (index === 2 && !ctx.ships.has(ctx.shipBlueprints.get(id)!.shipId)) return null
  }
  return groups
}

export function encryptedBlueprintDraw(ctx: SimContext, family: EncryptedFamily, rng: RngState): string[] | null {
  const groups = encryptedBlueprintGroups(ctx, family)
  if (!groups) return null
  const count = ENCRYPTED_BLUEPRINT_COUNT.min + nextInt(rng, ENCRYPTED_BLUEPRINT_COUNT.max - ENCRYPTED_BLUEPRINT_COUNT.min + 1)
  return Array.from({ length: count }, () => {
    const group = groups[nextInt(rng, groups.length)]!
    return group[nextInt(rng, group.length)]!
  })
}
