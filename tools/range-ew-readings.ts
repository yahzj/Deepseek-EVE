/** 射程电子战读数：npx tsx tools/range-ew-readings.ts [--save]。
 * 固定种子、独立合成、正式装配与引擎；不读个人档或Git历史，不改生产参数。
 * 常驻卡走完整返航结算，旗舰与信号只测战斗，不能用其读数推算每小时收益。
 */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildSimContext } from '@whale/data'
import { sustainFixture, runSustainCampaign, type SustainProfile } from './enemy-formation-sustain'
import { startFleetBattleFor } from '../packages/core/src/combat/startFleet'
import { advanceBattleFor } from '../packages/core/src/combat/advance'
import { resolvedBattleAnomaly } from '../packages/core/src/combat/cards'
import { rangeEwBattleView } from '../packages/core/src/combat/rangeEwPreview'
import { waveGapTotalMs } from '../packages/core/src/combat/combatMath'
import { sunkShipIdsOfBattle } from '../packages/core/src/combat/combatReport'
import { weekendFlagshipSlotOf, WEEKEND_FLAGSHIP_POOL_HP } from '../packages/core/src/weekendEvent'
import { createInitialState } from '../packages/core/src/state'
import { serializeSaveFile, loadSaveFile } from '../packages/core/src/save'
import { fitModule, unfitAt } from '../packages/core/src/equipment'
import { injectCommandFleetAllShipsFixture, assertCommandFleetAllShipsFixture } from './command-fleet-all-ships-fixture'

const ctx = buildSimContext()
const profiles: SustainProfile[] = [
  { id: 'plain', name: '五巡洋，无专用电子舰', fleet: Array(5).fill('sh-hammerhead') },
  { id: 'single', name: '四巡洋＋一电子舰', fleet: [...Array(4).fill('sh-hammerhead'), 'sh-wh-d-frigate'] },
  { id: 'double', name: '三巡洋＋两电子舰', fleet: [...Array(3).fill('sh-hammerhead'), 'sh-wh-d-frigate', 'sh-wh-d-frigate'] },
  { id: 'equipment', name: '四巡洋＋一电子舰与电子舱', fleet: [...Array(4).fill('sh-hammerhead'), 'sh-wh-d-frigate'], rangeEwModules: 1 },
]
const seeds = [1, 7, 13]
const output = resolve('tools/_ui-artifacts/range-ew')
mkdirSync(output, { recursive: true })
const economies = profiles.flatMap(profile => ['ano-voidedge-warden', 'ano-vault-sentinel'].flatMap(cardId =>
  seeds.map(seed => runSustainCampaign(ctx, profile, cardId, seed, 1, 'port', 1))))
const battles = profiles.flatMap(profile => ['ink-flagship', 'gravekeeper-flagship', 'wh-grave-throne'].flatMap(cardId =>
  seeds.map(seed => {
    const { state, roster, budget } = sustainFixture(ctx, profile, seed)
    const base = ctx.anomalies.get(cardId)!
    const boss = cardId.endsWith('flagship') ? weekendFlagshipSlotOf(base) : undefined
    const wormhole = cardId.startsWith('wh-') ? { depth: 4, kind: 'boss' as const, waves: 1 } : undefined
    const battle = startFleetBattleFor(state, ctx, roster, cardId, 0, null, wormhole,
      boss ? { bossShipId: boss.ship.id, bossHp: WEEKEND_FLAGSHIP_POOL_HP } : undefined)!
    assert(battle, `${profile.id}/${cardId}`)
    const card = resolvedBattleAnomaly(ctx, battle, cardId)!
    const view = rangeEwBattleView(state, ctx, battle, card)!
    const opening = { meStrength: view.meStrength, foeStrength: view.foeStrength, net: view.net,
      meCut: view.meCut, foeCut: view.foeCut, weapons: view.weapons }
    state.gameMs = ctx.balance.battle.maxBattleMs + 30000 + waveGapTotalMs(card, ctx.balance.battle)
    advanceBattleFor(state, ctx, battle, roster[0]!, cardId)
    assert(battle.ended, `${profile.id}/${cardId}/未收束`)
    return { profile: profile.id, cardId, seed, cost: budget.cost, capacity: budget.capacity,
      won: battle.ended === 'me', seconds: (battle.lastTickGameMs - battle.startedAtGameMs) / 1000,
      shipsLost: sunkShipIdsOfBattle(battle, roster[0]!), droneLost: battle.droneLost ?? {},
      ammoUsed: Object.fromEntries(Object.entries(battle.ammoLoaded ?? {}).map(([key, count]) =>
        [key, count - battle.ammo[key as keyof typeof battle.ammo]])),
      layers: (battle.myFleet ?? []).map(row => ({ shipId: row.shipId, hp: battle.units[row.tag]!.hp,
        hpMax: battle.units[row.tag]!.hpMax })), opening }
  })))
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length
const rows = profiles.flatMap(profile => {
  const economic = ['ano-voidedge-warden', 'ano-vault-sentinel'].map(cardId => {
    const data = economies.filter(row => row.profile === profile.id && row.cardId === cardId)
    return { profile: profile.id, target: cardId, kind: '完整结算', wins: data.reduce((sum, row) => sum + row.wins, 0), samples: data.length,
      seconds: mean(data.map(row => row.seconds)), lost: data.reduce((sum, row) => sum + row.sunk.length, 0),
      net: mean(data.map(row => row.net)), supplyCost: mean(data.map(row => row.supplyCost)), cost: data[0]!.cost }
  })
  return [...economic, ...['ink-flagship', 'gravekeeper-flagship', 'wh-grave-throne'].map(cardId => {
    const data = battles.filter(row => row.profile === profile.id && row.cardId === cardId)
    return { profile: profile.id, target: cardId, kind: '仅战斗', wins: data.filter(row => row.won).length, samples: data.length,
      seconds: mean(data.map(row => row.seconds)), lost: data.reduce((sum, row) => sum + row.shipsLost.length, 0),
      net: null, supplyCost: null, cost: data[0]!.cost }
  })]
})
const report = { assumptions: { seeds, profiles, fullSkills: true, syntheticOnly: true,
  limits: '固定MK2配装，非等成本或最优配装；电子舱替换一门武器，全部舰船仍有基础电子战强度。常驻卡完成结算返航及港内全修；旗舰用满30万共享池规格但仅单场，信号空间为第4层守卫，仅记录战斗，不推算其收益。3种子不是总体胜率。' },
  rows, economies, battles }
writeFileSync(resolve(output, 'calibration.json'), JSON.stringify(report, null, 2), 'utf8')
const markdown = ['# 射程电子战固定种子读数', '', report.assumptions.limits, '',
  '|配置|目标|指挥成本|胜场/样本|总沉船|平均周期/战斗秒|平均净额|',
  '|---|---|---:|---:|---:|---:|---:|', ...rows.map(row =>
    `|${row.profile}|${row.target}|${row.cost}/125|${row.wins}/${row.samples}|${row.lost}|${row.seconds.toFixed(1)}|${row.net === null ? '不计' : row.net.toFixed(0)}|`)]
writeFileSync(resolve(output, 'calibration.md'), markdown.join('\n') + '\n', 'utf8')
console.log(markdown.join('\n'))

if (process.argv.includes('--save')) {
  const now = Date.now(), state = createInitialState({ nowWallMs: now, seed: 20261101 })
  injectCommandFleetAllShipsFixture(state)
  const shipId = 'sh-wh-d-frigate', moduleId = 'mod-lair-ecm-h', rack = ctx.modules.get(moduleId)!.rack!
  assert(unfitAt(state, rack, 0, shipId, ctx))
  assert(fitModule(state, moduleId, ctx, { shipId }).ok)
  const text = serializeSaveFile(state, now), back = loadSaveFile(text).state
  assertCommandFleetAllShipsFixture(back, ctx)
  assert(back.fleet[shipId]!.fitted[rack]?.includes(moduleId))
  const stamp = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(now).replace(/[^0-9]/g, '')
  const target = resolve(output, `test-save-range-ew-${stamp}.json`)
  writeFileSync(target, text, { encoding: 'utf8', flag: 'wx' })
  console.log(`独立测试档（未开战）：${target}`)
}
