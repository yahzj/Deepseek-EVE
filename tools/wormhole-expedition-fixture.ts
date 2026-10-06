import assert from 'node:assert/strict'
import { buildSimContext } from '@whale/data'
import { createInitialState, type GameState, type WormholeFamily } from '../packages/core/src/state'
import { addShipToFleet } from '../packages/core/src/shipyard'
import { addModule, adjustDroneLoad, fitModule, setAmmoTier } from '../packages/core/src/equipment'
import { advanceSkillQueue, enqueueSkill, prereqNeedLevel } from '../packages/core/src/skillQueue'
import { buySkillLicense, hasSkillLicense } from '../packages/core/src/skillLicense'
import { matterTechNodes, researchMatterTech, MATTER_TECH_ESSENCE_ITEM_ID } from '../packages/core/src/matterTech'
import { wormholePreparationPlan, wormholeEnterPrepared } from '../packages/core/src/wormholePreparation'

export const expeditionContext = buildSimContext()
export const EXPEDITION_FLEETS = ['guns', 'drones', 'cargo', 'mixed'] as const
export type ExpeditionFixtureFleet = typeof EXPEDITION_FLEETS[number] | 'heavy'
const SKILLS = [
  'gunnery', 'advanced-gunnery', 'kinetic-gunnery', 'kinetic-ballistics', 'fire-control', 'fire-control-integration',
  'reload-drills', 'rapid-reload', 'shield-operation', 'shield-tuning', 'armor-tuning', 'hull-upgrades',
  'armed-ops', 'armored-ops', 'drone-warfare', 'drone-strike', 'drone-servicing', 'drone-servicing-integration',
  'drone-durability', 'drone-reinforce', 'drone-recovery', 'drone-evasion', 'repair-engineering',
  'cruiser-ops', 'frigate-ops', 'destroyer-ops', 'battleship-ops',
]

function train(state: GameState, id: string, want: number): void {
  const ctx = expeditionContext
  const def = ctx.skills.get(id)
  assert(def, `skill-missing:${id}`)
  for (const pid of def.prereq ?? []) train(state, pid, Math.max(want, prereqNeedLevel(def, pid)))
  if (!hasSkillLicense(state, def)) assert(buySkillLicense(state, ctx.skills, id).ok, `skill-license:${id}`)
  for (let level = (state.skills.trained[id] ?? 0) + 1; level <= want; level++) {
    const queued = enqueueSkill(state, id, level, ctx.skills)
    assert(queued.ok, `skill-queue:${id}:${queued.error}`)
    advanceSkillQueue(state, 1e12, ctx)
    assert.equal(state.skills.trained[id], level)
  }
}

export function makeExpeditionFixture(family: WormholeFamily, seed: number, kind: ExpeditionFixtureFleet, baseline = false) {
  const ctx = expeditionContext
  const state = createInitialState({ nowWallMs: 0, seed })
  state.wallet.isk = 1e12
  state.warehouse.items[MATTER_TECH_ESSENCE_ITEM_ID] = 1_000_000
  const wanted = [...SKILLS, ctx.balance.battle.cpuSkillId, ctx.balance.battle.evasionSkillId, ctx.balance.battle.hitSkillId, ctx.balance.battle.speedSkillId]
  for (const id of new Set(wanted)) train(state, id, baseline ? 3 : 5)
  if (!baseline) for (const node of matterTechNodes(ctx).filter(n => n.branch === 'explore' || n.branch === 'battle')) {
    for (let level = 0; level < node.maxLevel; level++) {
      const result = researchMatterTech(state, ctx, node.id)
      assert(result.ok, `tech:${node.id}:${result.error}`)
    }
  }
  const definitions = kind === 'heavy' ? ['sh-megalodon', 'sh-hammerhead', 'sh-wh-a-frigate', 'sh-wh-g-destroyer'] : kind === 'drones' ? ['sh-nautilus', 'sh-nautilus', 'sh-nautilus', 'sh-nautilus']
    : kind === 'cargo' ? ['sh-hammerhead', 'sh-hammerhead', 'sh-hammerhead', 'sh-manatee']
    : kind === 'mixed' ? ['sh-hammerhead', 'sh-hammerhead', 'sh-wh-a-frigate', 'sh-wh-g-destroyer']
    : ['sh-hammerhead', 'sh-hammerhead', 'sh-hammerhead', 'sh-hammerhead']
  const fleet = definitions.map(id => addShipToFleet(state, id))
  state.shipId = fleet[0]!
  const grade = baseline ? 2 : 3
  const manifest: Record<string, number> = { 'repairkit-mil': 500, 'repairkit-dc': 8 }
  for (const [index, uid] of fleet.entries()) {
    const defId = definitions[index]!
    const gear = defId === 'sh-nautilus'
      ? [`mod-cpu-${grade}`, `mod-dc-${grade}`, 'mod-armor-plate-2', 'mod-cargo-2', `mod-drone-tac-${grade}`, 'mod-drone-relay-2', 'mod-salvager-3', 'mod-hullrep-2', `mod-shieldchg-${grade}`, 'mod-shield-kin-2', 'mod-gyro-2']
      : defId === 'sh-manatee'
        ? [`mod-cpu-${grade}`, `mod-dc-${grade}`, 'mod-cargo-2', 'mod-cargo-2', 'mod-armor-plate-2', 'mod-hullrep-2', `mod-shieldchg-${grade}`, 'mod-shield-kin-2', 'mod-salvager-3', 'mod-miner-3']
        : defId === 'sh-wh-a-frigate'
          ? [`mod-dc-${grade}`, `mod-turret-kin-${grade}`, 'mod-lock-1', 'mod-salvager-3', 'mod-hullrep-2', `mod-shieldchg-${grade}`, 'mod-shield-kin-2', 'mod-gyro-2']
          : defId === 'sh-wh-g-destroyer'
            ? [`mod-cpu-${grade}`, `mod-dc-${grade}`, 'mod-shieldfield-2', `mod-turret-kin-${grade}`, `mod-turret-kin-${grade}`, 'mod-salvager-3', 'mod-hullrep-2', `mod-shieldchg-${grade}`, 'mod-shield-kin-2', 'mod-gyro-2']
            : [`mod-cpu-${grade}`, `mod-dc-${grade}`, `mod-stab-kin-${grade}`, ...Array(4).fill(`mod-turret-kin-${grade}`), 'mod-salvager-3', 'mod-hullrep-2', `mod-shieldchg-${grade}`, 'mod-shield-kin-2', 'mod-track-2']
    for (const moduleId of gear) {
      addModule(state, moduleId)
      const fitted = fitModule(state, moduleId, ctx, { shipId: uid })
      assert(fitted.ok, `fit:${defId}:${moduleId}:${fitted.error}`)
    }
    if (defId === 'sh-nautilus') {
      state.warehouse.items['drone-assault'] = (state.warehouse.items['drone-assault'] ?? 0) + 32
      const loaded = adjustDroneLoad(state, ctx, 'drone-assault', 16, uid)
      assert(loaded.ok, `drone-load:${loaded.error}`)
      manifest['drone-assault'] = (manifest['drone-assault'] ?? 0) + 16
    } else if (defId !== 'sh-manatee') {
      assert(setAmmoTier(state, ctx, 'kinetic', 'ammo-kinetic-2', uid).ok)
      manifest['ammo-kinetic-2'] = (manifest['ammo-kinetic-2'] ?? 0) + 4000
    }
  }
  for (const [id, n] of Object.entries(manifest)) state.warehouse.items[id] = Math.max(state.warehouse.items[id] ?? 0, n)
  state.wormholeStock = [{ id: 'journey', seed, depth: 1, family, archetype: 'balanced', foundAtGameMs: 0, expeditionRules: 2 }]
  const plan = wormholePreparationPlan(state, ctx, fleet, { targets: manifest, unload: [] })
  assert(plan.ok, `preparation:${JSON.stringify(plan.invalid)}:${plan.cells}/${plan.capacity}`)
  const before = structuredClone(state)
  assert(wormholeEnterPrepared(state, ctx, fleet, seed, plan, 'journey', { expeditionRules: 2, goal: 'deep' }).ok)
  return { state, before, fleet, manifest, definitions, skills: { ...state.skills.trained }, research: { ...state.research?.levels } }
}
