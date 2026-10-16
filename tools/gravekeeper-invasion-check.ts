/** 守墓族入侵专项读数与独立合成测试档；不读取、不覆盖个人档。
 * 用法：npx tsx tools/gravekeeper-invasion-check.ts --audit / --sim / --save / --smoke-save。
 * 专项实战可附--card=卡片ID --tier=4 --seeds=11,29,47。
 * 输出：默认tools/_ui-artifacts/gravekeeper-invasion，可用--out=绝对路径另存。
 * v0.1.0/档v31，2026-10-16；基础标尺不包含动态维修/抗性，不代表观感或所有配装胜率。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildSimContext } from '@whale/data'
import { addShipToFleet, createInitialState, serializeSaveFile, fitModule, fleetDefOf, fittedCpuUsed, cpuBudgetOf } from '@whale/core'
import { advanceBattleFor, createFoeSpecs, foeStrengthOf, foeThreatOfAnomaly, startFleetBattleFor, applyFoeOverride } from '../packages/core/src/combat'
import type { AnomalyDef, SimContext } from '../packages/core/src/types'
import { weekendStartFlagshipBattle } from '../packages/core/src/weekendLaunch'
import { applyFoeUnitDamage } from '../packages/core/src/combat'
import { loadSaveFile } from '../packages/core/src/save'
import type { GameState } from '../packages/core/src/state'

const ctx = buildSimContext()
const ids = ['gravekeeper-drift', 'gravekeeper-line', 'gravekeeper-main', 'gravekeeper-flagship']
const output = resolve(process.argv.find(arg => arg.startsWith('--out='))?.slice(6) ?? 'tools/_ui-artifacts/gravekeeper-invasion')
function readingsOf(card: AnomalyDef) {
  const strength = foeStrengthOf(card, ctx.balance.battle)
  const flagship = card.id.endsWith('flagship')
  const built = flagship ? applyFoeOverride(card, {
    bossShipId: 'foe-d-invasion-eternal-tomb', bossHp: 300000, bossHpMax: 300000,
    bossHpLayers: { s: 135000, a: 90000, h: 75000 },
  }) : card
  const full = foeStrengthOf(built, ctx.balance.battle)
  return {
    id: card.id, name: card.name, threat: card.threat,
    measuredThreat: foeThreatOfAnomaly(card, flagship ? 10 : 3, ctx.balance.battle),
    baseHp: strength.hp, actualHp: full.hp, peakDps: full.dps,
    fullPoolComparisonThreat: foeThreatOfAnomaly(built, flagship ? 10 : 3, ctx.balance.battle),
    waves: (built.waves ?? [{ units: 1 }]).map((_, wave) => {
      const specs = createFoeSpecs(built, ctx.balance.battle, { tagPrefix: wave ? `w${wave}-` : '' })
      return {
        wave: wave + 1, hp: specs.reduce((n, f) => n + f.hp.s + f.hp.a + f.hp.h, 0),
        dps: specs.reduce((n, f) => n + f.weapons.reduce((m, w) => m + (w.shotDmg ?? 0) * (w.count ?? 1) * 1000 / Math.max(1, w.reloadMs), 0), 0),
        ships: specs.map(f => ({ id: f.foeShipId, name: f.name, hp: f.hp,
          shot: f.weapons[0]?.shotDmg ?? 0, reloadSeconds: (f.weapons[0]?.reloadMs ?? 0) / 1000,
          range: [f.weapons[0]?.minRangeM ?? 0, f.weapons[0]?.maxRangeM ?? 0],
          gunCount: f.weapons[0]?.gunCount ?? 1, damageMix: f.weapons[0]?.shotsByType,
          falloff: f.weapons[0]?.falloff, blindDmgMul: f.weapons[0]?.blindDmgMul,
          speed: f.speedMps, evasion: f.evasion, resists: f.resists,
          mounts: f.foeMountNames ?? [],
        })),
      }
    }),
  }
}
function world(seed: number, tier: 2 | 3 | 4, squad: number, laser = false) {
  const s = createInitialState({ nowWallMs: Date.now(), seed })
  s.debugQuick = false
  s.wallet.isk = 1e9
  s.standings.dsi = 100
  s.standingsEarned = { dsi: 100 }
  s.exploredGalaxies = [...ctx.galaxies.keys()]
  for (const skill of ctx.skills.keys()) s.skills.trained[skill] = 3
  const ships = Array.from({ length: squad }, () => addShipToFleet(s, tier === 4 ? 'sh-megalodon' : 'sh-thresher'))
  s.shipId = ships[0]!
  const weapon = laser ? `mod-laser-${tier === 4 ? 3 : tier}` : `mod-turret-kin-${tier === 4 ? 3 : tier}`
  for (const item of ctx.items.values()) if (item.kind === 'ammo') s.warehouse.items[item.id] = 100000
  for (const mod of ctx.modules.keys()) s.moduleBay[mod] = 24
  for (const sid of ships) {
    const entry = s.fleet[sid]!
    const def = fleetDefOf(s, ctx, sid)!
    for (const [rack, mods] of [
      ['high', Array(def.slots?.high ?? 4).fill(weapon)],
      ['mid', Array(Math.min(2, def.slots?.mid ?? 1)).fill('mod-shield-pla-2')],
      ['low', Array(Math.min(2, def.slots?.low ?? 1)).fill('mod-armor-plate-2')],
    ] as const) for (const mod of mods) {
      const result = fitModule(s, mod, ctx, { shipId: sid, rack })
      if (!result.ok) throw new Error(`配装拒绝:${sid}:${mod}:${result.error}`)
    }
    if (fittedCpuUsed(entry.fitted, ctx, def) > cpuBudgetOf(s, ctx, sid)) throw new Error(`装配超载:${sid}`)
  }
  s.weekendPrepSquad = ships
  const coreId = 'galaxy-maw'
  s.weekendEvent = { seq: 901, family: 'D', coreId, peripheryIds: ['galaxy-cinder'],
    startedAtWallMs: Date.now(), contributed: { [coreId]: 1, 'galaxy-cinder': 1 } }
  return { s, ships }
}

export function injectGravekeeperFixture(state: GameState): string[] {
  Object.assign(state, world(11, 4, 4).s)
  return ['独立合成守墓者入侵档，四艘合法MK3动能巨齿鲨、战斗技能3级、备件与弹药。', '核心已收复但未代开战；星图选择旗舰挑战，四舰出击。新族不覆盖个人档。']
}

function main(): void {
mkdirSync(output, { recursive: true })
const rows = ids.map(id => readingsOf(ctx.anomalies.get(id)!))
console.log(JSON.stringify(rows, null, 2))
if (process.argv.includes('--audit')) {
  const fmt = (n: number) => Number(n.toFixed(2)).toLocaleString('zh-CN', { maximumFractionDigits: 2 })
  const lines = [
    '# 守墓入侵实际建档属性', '',
    '基础威胁按普通单舰系数3、旗舰小队系数10反算；永陵最后按完整30万共享池覆写。满池对照威胁不是第二个卡面标签。', '',
    '血量含现行容量提升与陵墓装甲减半，不含苏生恢复折算。伤害为单舰整组齐射，已含多舰补偿与越线折扣，未算距离、目标抗性及蓄能。', '',
    '王座舰保留支援呼叫装置；本批尚未配置入侵条件援军条目，因此下表只含固定编队，不宣称已有援军到场。', '',
    '| 卡片 | 威胁／反算 | 基础定价总血 | 实战满池总血 | 峰值每秒伤害 | 满池公式对照 |',
    '|---|---|---:|---:|---:|---:|',
    ...rows.map(r => `| ${r.name} | ${r.threat}／${r.measuredThreat} | ${fmt(r.baseHp)} | ${fmt(r.actualHp)} | ${fmt(r.peakDps)} | ${r.fullPoolComparisonThreat} |`), '',
  ]
  for (const card of rows) {
    lines.push(`## ${card.name}`, '',
      '| 波次 | 舰型 | 数量 | 单舰护盾／装甲／结构 | 单舰整组齐射／装填秒 | 射程米 | 速度m/s | 回避 | 挂载 |',
      '|---|---|---:|---|---|---|---:|---|---|')
    for (const wave of card.waves) {
      const groups = new Map<string, { count: number; unit: typeof wave.ships[number] }>()
      for (const unit of wave.ships) {
        const group = groups.get(unit.id!)
        if (group) group.count++
        else groups.set(unit.id!, { count: 1, unit })
      }
      for (const { count, unit: u } of groups.values()) {
        lines.push(`| ${wave.wave} | ${u.name} | ${count} | ${fmt(u.hp.s)}／${fmt(u.hp.a)}／${fmt(u.hp.h)} | ${u.shot}／${u.reloadSeconds} | ${u.range.join('~')} | ${u.speed} | ${fmt(u.evasion * 100)}% | ${u.mounts.join('、') || '无'} |`)
      }
      lines.push(`| ${wave.wave}合计 | | | 总血${fmt(wave.hp)} | 每秒伤害${fmt(wave.dps)} | | | | |`)
    }
    lines.push('')
  }
  lines.push('## 挂载与抗性', '',
    '- 巡陵苏生：首次致命攻击后1秒结构保底1，5秒内分别修复最大装甲与结构各100%，每场一次。',
    '- 碑卫陵墓装甲：装甲和结构容量各乘0.5，两层全抗75%；护盾不变。',
    '- 守誓同时挂载苏生与陵墓装甲。',
    '- 永陵镀层：实际装甲损失后每层装甲全抗增加5个百分点，各层5秒，最高90%；护盾、结构无该加成。',
    '- 永陵蓄能：空盾后本场永久启用，射程加50%；每次成功攻击后，该武器伤害乘1.15、间隔乘1.1，无上限。',
    '- 其他单位无额外基础层抗；静滞卫舰保留受击远距观瞄，王座舰保留支援挂载。', '',
    '## 通用武器与战术', '',
    '- 全部为能量主系必中光束；巡哨与守备为能量80%/动能20%，主力与旗舰为能量60%/动能40%。混伤只拆伤害，不额外掷动能命中。',
    '- 全部远端伤害倍率0.2，近盲伤害倍率0.3；均无舰载无人机。静滞卫舰与守誓为风筝战术，其他为环绕。',
    '- 巡陵3炮，碑卫/长舰/静滞各4炮，守誓/王座各6炮，永陵8炮；整组齐射在各炮口之间分摊，不乘炮口数。', '')
  writeFileSync(resolve(output, 'attribute-audit.json'), JSON.stringify(rows, null, 2), 'utf8')
  writeFileSync(resolve(output, 'attribute-audit.md'), lines.join('\n'), 'utf8')
  console.log(`属性表：${resolve(output, 'attribute-audit.md')}`)
}

if (process.argv.includes('--save')) {
  const { s } = world(11, 4, 4)
  const file = resolve(output, 'test-save-gravekeeper-20261016.json')
  const text = serializeSaveFile(s)
  const read = loadSaveFile(text).state
  if (read.weekendEvent?.family !== 'D' || read.weekendPrepSquad?.length !== 4) throw new Error('测试档往返不一致')
  writeFileSync(file, text, 'utf8')
  console.log(`独立合成门槛档：${file}`)
}
if (process.argv.includes('--smoke-save')) {
  const { s, ships } = world(11, 4, 4)
  s.weekendEvent!.flagshipHpMax = 300000
  s.weekendEvent!.flagshipHpDone = 135000
  const b = weekendStartFlagshipBattle(s, ctx, Date.now(), ships)!
  b.waveIdx = 3
  s.gameMs = 10
  advanceBattleFor(s, ctx, b, ships[0]!, 'gravekeeper-flagship')
  const boss = Object.values(b.units).find(u => u.foeShipId === 'foe-d-invasion-eternal-tomb')!
  const specs = createFoeSpecs(ctx.anomalies.get('gravekeeper-flagship')!, ctx.balance.battle, { tagPrefix: 'w3-' })
  const bossSpec = specs.find(f => f.foeShipId === boss.foeShipId)!
  applyFoeUnitDamage(b, bossSpec, 10, 'plasma')
  s.encounter = {active:true,shipId:ships[0]!,galaxyId:'galaxy-maw',name:'守墓者永陵舰队',threat:ctx.anomalies.get('gravekeeper-flagship')!.threat,anomalyId:'gravekeeper-flagship',origin:'入侵',invitedAtGameMs:0,deadlineGameMs:999999,battle:b}
  writeFileSync(resolve(output, 'smoke-save.json'), serializeSaveFile(s), 'utf8')
}
if (process.argv.includes('--sim')) {
  const readings: unknown[] = []
  const cardFilter = process.argv.find(arg => arg.startsWith('--card='))?.slice(7)
  const tierFilter = process.argv.find(arg => arg.startsWith('--tier='))?.slice(7)
  const seedArg = process.argv.find(arg => arg.startsWith('--seeds='))?.slice(8)
  const seeds = seedArg ? seedArg.split(',').map(Number) : [11, 29, 47]
  if (seeds.length === 0 || seeds.some(seed => !Number.isSafeInteger(seed))) throw new Error('种子须为逗号分隔的整数')
  if (cardFilter && !ids.includes(cardFilter)) throw new Error('未知守墓入侵卡')
  if (tierFilter && !['2', '3', '4'].includes(tierFilter)) throw new Error('测试舰级须为2、3或4')
  for (const laser of [false, true]) for (const tier of [2, 3, 4] as const) for (const cardId of ids) {
    if (cardFilter && cardId !== cardFilter || tierFilter && String(tier) !== tierFilter) continue
    const squad = cardId.endsWith('flagship') ? 4 : 1
    const results: Array<{ win: boolean; seconds: number; healed: number; remaining: number }> = []
    for (const seed of seeds) {
      const { s, ships } = world(seed, tier, squad, laser)
      const card = ctx.anomalies.get(cardId)!
      const patched: AnomalyDef = cardId.endsWith('flagship')
        ? applyFoeOverride(card, { bossShipId: 'foe-d-invasion-eternal-tomb', bossHp: 300000, bossHpMax: 300000, bossHpLayers: { s: 135000, a: 90000, h: 75000 } }) : card
      const anomalies = new Map(ctx.anomalies); anomalies.set(cardId, patched)
      const useCtx: SimContext = { ...ctx, anomalies }
      const b = startFleetBattleFor(s, useCtx, ships, cardId, 0, null)!
      for (let t = 250; !b.ended && t <= 660000; t += 250) { s.gameMs = t; advanceBattleFor(s, useCtx, b, ships[0]!, cardId) }
      const ours = Object.values(b.units).filter(u => u.side === 'me')
      results.push({ win: b.ended === 'me', seconds: b.lastTickGameMs / 1000,
        healed: Object.values(b.foeRebirths ?? {}).reduce((n, r) => n + r.armorHealed + r.hullHealed, 0),
        remaining: ours.reduce((n,u) => n+u.hp.s+u.hp.a+u.hp.h,0)/ours.reduce((n,u) => n+(u.hpMax?.s??0)+(u.hpMax?.a??0)+(u.hpMax?.h??0),0) })
    }
    readings.push({ cardId, tier, weapon: laser ? '激光' : '动能', squad, wins: results.filter(r => r.win).length, trials: results.length,
      avgSeconds: results.reduce((n,r) => n+r.seconds,0)/results.length,
      avgHealed: results.reduce((n,r) => n+r.healed,0)/results.length,
      remaining: results.reduce((n,r) => n+r.remaining,0)/results.length })
  }
  writeFileSync(resolve(output, 'combat-readings.json'), JSON.stringify(readings, null, 2), 'utf8')
  console.table(readings)
}
}
if (/gravekeeper-invasion-check\.(ts|js)$/.test(process.argv[1] ?? '')) main()
