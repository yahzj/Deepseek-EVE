/** 候选源码内运行的真实引擎读数，不写静态参数或玩家存档。 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { FOE_SHIPS, FOE_DRONES, ANOMALIES, buildSimContext } from '@whale/data'
import { FOE_MOUNTS, createFoeSpecs, resolveFoeMounts, weekendFlagshipWavesOf } from '@whale/core'
import { activeFoeSpecsOf, applyFoeOverride, wormholeDerivedAnomaly } from '../packages/core/src/combat'
import { nominalWeaponDps } from '../packages/core/src/foeSpecs'
import { WEEKEND_AMBUSH_STRENGTH_MUL, WEEKEND_FLAGSHIP_POOL_HP, weekendFlagshipSlotOf } from '../packages/core/src/weekendEvent'
import { ENEMY_FIELDS, ENEMY_TABLES } from './data-editor-enemy-schema'
import type { AnomalyDef } from '@whale/core'
import type { UnitSpec } from '../packages/core/src/combat'
import type { EnemyDataTable, EnemyPreviewRequest, EnemyPreviewResult } from './data-editor-contract'

const cards = ANOMALIES
const cardTable = (card: AnomalyDef): EnemyDataTable => ENEMY_FIELDS.invasionFleets.some(row => row.id === card.id) ? 'invasionFleets' : card.id.startsWith('wh-') ? 'wormholeFleets' : 'bounties'
export function enemyEnginePreview(request: EnemyPreviewRequest): EnemyPreviewResult {
  if (!request || !ENEMY_TABLES.includes(request.table) || !ENEMY_FIELDS[request.table].some(row => row.id === request.id) ||
    !['base', 'assault', 'ambush', 'flagship', 'signal', 'wormhole'].includes(request.mode) ||
    !Number.isSafeInteger(request.depth) || request.depth < 1 || request.depth > 100 ||
    !['ordinary', 'elite', 'guard', 'patrol', 'event'].includes(request.role) ||
    request.kind !== undefined && !['node', 'boss', 'extract', 'ruins', 'spawn'].includes(request.kind)) throw new Error('敌人预览请求无效')
  const ctx = buildSimContext()
  const result: EnemyPreviewResult = { ok: true, message: '真实引擎候选读数', rows: [], notes: [], references: [], entries: [] }
  const affectedShips = FOE_SHIPS.filter(ship => request.table === 'foeShips' ? ship.id === request.id || request.id === 'c-family-resists' && ship.family === 'C'
    : request.table === 'foeDrones' ? ship.drones?.some(slot => slot.drone.id === request.id || request.id === 'g-bee-shared' && slot.drone.id.startsWith('foe-drone-g-bee-'))
      : request.table === 'foeMounts' && ship.mounts?.some(id => id === request.id))
  const affected = cards.filter(card => request.id === 'alien-common' && card.id.startsWith('alien-') || request.id === 'wormhole-anchor' && card.id.startsWith('wh-') || card.id === request.id || card.ships?.some(slot => affectedShips.includes(slot.ship) ||
    request.table === 'foeMounts' && (slot.mounts ?? slot.ship.mounts)?.some(id => id === request.id)))
  result.references = affected.map(card => ({ table: cardTable(card), id: card.id, name: card.name }))
  const pushSpecs = (specs: UnitSpec[], wave: number, prefix = ''): void => {
    for (const spec of specs) {
      const dps = spec.weapons.filter(w => !w.reserve).reduce((sum, w) => sum + nominalWeaponDps(w), 0)
      const weapons = spec.weapons.filter(w => !w.reserve)
      const range = [...new Set(weapons.map(w => `${w.minRangeM ?? 0}-${w.maxRangeM} m`))].join(' / ')
      const row = { name: prefix + spec.name, wave, units: 1, hp: spec.hp.s + spec.hp.a + spec.hp.h, dps, speed: `${spec.speedMps} m/s`, range }
      if (![row.hp, row.dps, spec.speedMps].every(Number.isFinite)) throw new Error('引擎派生出现非有限读数')
      const same = result.rows.find(old => old.name === row.name && old.wave === wave && old.speed === row.speed && old.range === row.range && old.hp / old.units === row.hp && old.dps / old.units === row.dps)
      if (same) { same.units++; same.hp += row.hp; same.dps += row.dps }
      else result.rows.push(row)
    }
  }
  if (request.table === 'foeDrones') {
    for (const drone of FOE_DRONES.filter(drone => drone.id === request.id || request.id === 'g-bee-shared' && drone.id.startsWith('foe-drone-g-bee-'))) {
      result.rows.push({ name: drone.name + ` (${drone.damageType})`, wave: 1, units: 1,
        hp: drone.defense.shieldHp + drone.defense.armorHp + drone.defense.hullHp,
        dps: nominalWeaponDps({ kind: 'fixed', label: drone.name, shotDmg: drone.dmg, reloadMs: drone.reloadMs, maxRangeM: drone.maxRangeM, minRangeM: 1, hitRate: drone.hitRate, falloff: drone.falloff }), speed: '-', range: `${drone.maxRangeM} m` })
    }
  } else if (request.table === 'foeShips' || request.table === 'foeMounts') {
    const ships = request.table === 'foeMounts' ? [...new Map([...affectedShips, ...affected.flatMap(card => (card.ships ?? []).filter(slot => (slot.mounts ?? slot.ship.mounts)?.some(id => id === request.id)).map(slot => slot.ship))].map(ship => [ship.id, ship])).values()] : affectedShips
    for (const ship of ships) {
      const use = affected.find(card => card.ships?.some(slot => slot.ship.id === ship.id))
      const mountSlot = request.table === 'foeMounts' ? use?.ships?.find(slot => slot.ship.id === ship.id && (slot.mounts ?? slot.ship.mounts)?.some(id => id === request.id)) : undefined
      const card = { ...(use ?? cards[0]!), id: `editor-base-${ship.id}`, ships: [{ ship, ...(mountSlot?.mounts ? { mounts: mountSlot.mounts } : {}) }], waves: undefined }
      pushSpecs(createFoeSpecs(card, ctx.balance.battle), 1)
      result.entries!.push({ name: ship.name, source: '舰级基础，单舰无条目覆写', values: `血型 ${JSON.stringify(ship.split)}；挂载 ${resolveFoeMounts(ship.mounts).names.join('、') || '无'}；机群 ${(ship.drones ?? []).map(d => `${d.drone.name} ×${d.count}`).join('、') || '无'}` })
    }
    if (request.table === 'foeMounts') result.entries!.unshift({ name: FOE_MOUNTS[request.id as keyof typeof FOE_MOUNTS]?.name ?? request.id, source: '挂载件原始参数', values: JSON.stringify(FOE_MOUNTS[request.id as keyof typeof FOE_MOUNTS], (key, value) => ['note', 'en', 'name', 'id'].includes(key) ? undefined : value) })
  } else {
    let card = cards.find(card => card.id === request.id)
    if (!card) {
      result.notes.push('共用参数影响列出的编队；请选择具体编队查看实际派生。')
      return result
    }
    for (const slot of card.ships ?? []) result.entries!.push({ name: slot.ship.name, source: `波次 ${(slot.wave ?? 0) + 1}；${slot.count ?? 1} 艘；挂载 ${slot.mounts === undefined ? '继承舰级' : '条目替换'}`, values: JSON.stringify(slot, (key, value) => key === 'ship' ? value.id : key === 'foeMountNamePairs' ? undefined : value) })
    if (request.table === 'invasionFleets') {
      if (!['base', 'assault', 'ambush', 'flagship'].includes(request.mode)) throw new Error('入侵编队不支持此预览用途')
      if (request.mode === 'ambush') card = applyFoeOverride(card, { strengthMul: WEEKEND_AMBUSH_STRENGTH_MUL })
      if (request.mode === 'flagship') {
        const boss = weekendFlagshipSlotOf(card)
        if (!boss) throw new Error('此编队没有旗舰条目')
        card = applyFoeOverride(card, { waves: weekendFlagshipWavesOf(), bossShipId: boss.ship.id, bossHp: WEEKEND_FLAGSHIP_POOL_HP })
        result.notes.push(`旗舰共享血池满血预览 ${WEEKEND_FLAGSHIP_POOL_HP}；存档中的已扣血与排期不参与本次预览。`)
      }
    } else if (request.table === 'wormholeFleets' && request.mode !== 'base') {
      if (!['signal', 'wormhole'].includes(request.mode)) throw new Error('探索模板不支持此预览用途')
      card = wormholeDerivedAnomaly(ctx, card, { depth: request.depth, kind: request.kind ?? 'node', waves: 1,
        ...(request.mode === 'wormhole' ? { expeditionRules: 2, expeditionRole: request.role } : {}) })
      result.notes.push(request.mode === 'wormhole' ? '未来虫洞按势力/用途挑选代表模板并重新分配预算，选中模板的编成不保证沿用。' : '信号空间层级预算由旧玩法引擎派生。')
    }
    for (let wave = 0; wave < Math.max(1, card.waves?.length ?? 1); wave++) pushSpecs(activeFoeSpecsOf(card, ctx.balance.battle, wave), wave + 1)
  }
  result.notes.push('总血与名义每秒伤害按真实建档汇总；备用机不计当前火力。命中、距离衰减、抗性、触发后的聚焦/叠光/支援不折算为持续战斗伤害。')
  return result
}

if (process.argv[1]?.endsWith('data-editor-enemy-preview.ts')) {
  const request = JSON.parse(readFileSync(resolve(process.cwd(), 'enemy-preview-request.json'), 'utf8')) as EnemyPreviewRequest
  process.stdout.write('WHALE_ENEMY_PREVIEW=' + JSON.stringify(enemyEnginePreview(request)) + '\n')
}
