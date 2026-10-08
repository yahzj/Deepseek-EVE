/** 异形入侵真实战斗校准与合成验收档，不访问个人存档。
 * 用法：npx tsx tools/alien-invasion-check.ts [--seeds=8] [--save] [--audit]
 * 报告写tools/_ui-artifacts/alien-invasion；--save只生成仓库合成测试档，不改个人档或正式数值。
 * 版本自检：游戏v0.1.0、存档v31；2026-10-06核对并执行。
 */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildSimContext } from '@whale/data'
import { serializeSaveFile } from '@whale/core'
import { advanceBattleFor, startBattleFor, flagshipBattleLedger, applyFoeOverride, foeRepairDiscountedShot, foeNominalDpsOf } from '../packages/core/src/combat'
import { weekendStartFlagshipBattle } from '../packages/core/src/weekendLaunch'
import { createFoeSpecs, foeStrengthOf, foeThreatOfAnomaly } from '../packages/core/src/foeSpecs'
import { ALIEN_TEST_PROFILES, alienFixture } from './alien-invasion-fixture'
import { weekendFlagshipSlotOf, weekendFlagshipLayerCaps, weekendFlagshipLayersOf, WEEKEND_FLAGSHIP_POOL_HP } from '../packages/core/src/weekendEvent'
import { foeDroneRangeOf } from '../packages/core/src/foeRange'
import { resolveFoeMounts } from '../packages/core/src/foeMounts'
import { volleyDamageShareOf } from '../packages/core/src/combatVolley'
import type { AnomalyDef } from '@whale/core'

const ctx = buildSimContext()
const seeds = Number(process.argv.find(a => a.startsWith('--seeds='))?.slice(8) ?? 8)
assert(Number.isInteger(seeds) && seeds > 0 && seeds <= 40)
const now = new Date(2026, 9, 9, 20).getTime()
const targets = ['alien-vanguard', 'alien-escort', 'alien-main', 'ink-harass', 'ink-raid', 'ink-main', 'corona-drift', 'corona-split', 'corona-converge']
const rows: object[] = []

/** 审核取数只调用实际建档；不改变正式配置或补损规则。 */
function audit() {
  const ids = targets.filter(id => id.startsWith('alien')).concat('alien-broodmother')
  const fmt = (value: number) => Number(value.toFixed(3)).toLocaleString('zh-CN', { maximumFractionDigits: 3 })
  const numeric = (value: number) => Number(value.toFixed(6))
  const histogram = (values: number[]) => [...values.reduce((map, value) => map.set(value, (map.get(value) ?? 0) + 1), new Map<number, number>())].map(([value, count]) => `${value}×${count}`).join(' + ') || '无'
  const actual = (card: AnomalyDef) => {
    const slot = weekendFlagshipSlotOf(card)
    if (!slot) return card
    const caps = weekendFlagshipLayerCaps(WEEKEND_FLAGSHIP_POOL_HP, slot.ship.split)
    return applyFoeOverride(card, { bossShipId: slot.ship.id, bossHp: WEEKEND_FLAGSHIP_POOL_HP, bossHpLayers: weekendFlagshipLayersOf(WEEKEND_FLAGSHIP_POOL_HP, caps) })
  }
  const auditCards = ids.map(id => {
    const card = ctx.anomalies.get(id)!
    const priced = foeStrengthOf(card, ctx.balance.battle)
    const built = actual(card)
    const waves = (card.waves ?? [{ units: 1, hpShare: 1 }]).map((_, index) => {
      const units = createFoeSpecs(built, ctx.balance.battle, { tagPrefix: index === 0 ? '' : `w${index}-` })
      const unitRows = [...new Set(units.map(unit => unit.foeShipId))].map(shipId => {
        const group = units.filter(unit => unit.foeShipId === shipId)
        const unit = group[0]!
        const weapon = unit.weapons[0]!
        const gunShot = foeRepairDiscountedShot(unit, weapon.shotDmg ?? 0)
        const guns = unit.acidBurst ? 0 : weapon.gunCount ?? 1
        const drones = unit.weapons.filter(weapon => weapon.src === 'drone' && weapon.reserve !== true)
        const gunDps = gunShot * 1000 / weapon.reloadMs
        const droneDps = drones.reduce((total, drone) => total + (drone.shotDmg ?? 0) * 1000 / drone.reloadMs, 0)
        const hp = unit.hp.s + unit.hp.a + unit.hp.h
        return {
          shipId, name: unit.name, count: group.length, hp: numeric(hp), layers: unit.hp,
          guns, gunShot, gunPerPort: histogram(Array.from({ length: guns }, (_, port) => volleyDamageShareOf(gunShot, guns, port))),
          gunReloadSec: weapon.reloadMs / 1000, gunDps: numeric(gunDps), gunRangeM: weapon.maxRangeM,
          drones: drones.length, dronePerUnit: histogram(drones.map(weapon => weapon.shotDmg ?? 0)),
          droneShot: drones.reduce((total, drone) => total + (drone.shotDmg ?? 0), 0),
          droneReloadSec: drones[0] ? drones[0].reloadMs / 1000 : 0,
          droneRangeM: drones[0] ? foeDroneRangeOf({} as never, drones[0]) : 0,
          droneDps: numeric(droneDps), shotDps: numeric(gunDps + droneDps),
          repairPer5: numeric(foeNominalDpsOf(unit) * (unit.repairPct ?? 0) * 5),
          speedMps: unit.speedMps, chargeMul: unit.foeChargeMul,
          hatcheryCycleSec: unit.foeHatchery ? unit.foeHatchery.cycleMs / 1000 : 0,
          currentReserve: unit.foeHatchery?.stock ?? 0,
          burstDamage: unit.acidBurst?.damage ?? 0,
          adultSummonSec: (unit.foeSummonEscort?.everyMs ?? 0) / 1000,
          adultSummonCount: unit.foeSummonEscort?.count ?? 0,
          speedRampSec: unit.foeFleetSpeedRamp ? unit.foeFleetSpeedRamp.rampMs / 1000 : 0,
          speedMaxBonusPct: (unit.foeFleetSpeedRamp?.maxBonusPct ?? 0) * 100,
        }
      })
      return {
        wave: index + 1, units: unitRows,
        hp: numeric(unitRows.reduce((total, unit) => total + unit.hp * unit.count, 0)),
        gunDps: numeric(unitRows.reduce((total, unit) => total + unit.gunDps * unit.count, 0)),
        droneDps: numeric(unitRows.reduce((total, unit) => total + unit.droneDps * unit.count, 0)),
        shotDps: numeric(unitRows.reduce((total, unit) => total + unit.shotDps * unit.count, 0)),
        repairPer5: numeric(unitRows.reduce((total, unit) => total + unit.repairPer5 * unit.count, 0)),
        burstDamage: unitRows.reduce((total, unit) => total + unit.burstDamage * unit.count, 0),
      }
    })
    return { id, name: card.name, threat: card.threat, wreckThreat: card.wreckThreat, naturalHp: numeric(priced.hp), pricingDps: numeric(priced.dps), actualHp: numeric(waves.reduce((total, wave) => total + wave.hp, 0)), firingPeakDps: Math.max(...waves.map(wave => wave.shotDps)), waves }
  })
  const shipIds = [...new Set(auditCards.flatMap(card => card.waves.flatMap(wave => wave.units.map(unit => unit.shipId))))]
  const baseUnits = shipIds.map(id => {
    const ship = ctx.foeShips!.get(id!)!
    const anchor = id === 'foe-alien-hiveback' ? 228 : id === 'foe-alien-broodmother' ? 558 : undefined
    const card = { ...ctx.anomalies.get('alien-vanguard')!, waves: undefined, ships: [{ ship, count: 1, ...(anchor ? { firepowerAnchor: anchor } : {}) }] }
    const unit = createFoeSpecs(card, ctx.balance.battle)[0]!
    const gun = unit.weapons[0]!
    const droneWeapons = unit.weapons.filter(weapon => weapon.src === 'drone' && !weapon.reserve)
    const shot = foeRepairDiscountedShot(unit, gun.shotDmg ?? 0)
    const mounts = resolveFoeMounts(ship.mounts)
    return { id, name: ship.name, tier: ship.hullClassTier, hp: ship.hp, speed: unit.speedMps, charge: unit.foeChargeMul, burstDamage: unit.acidBurst?.damage ?? 0, gunCount: ship.acidBurst ? 0 : ship.gunCount ?? 1, gunShot: shot, reloadSec: gun.reloadMs / 1000, range: gun.maxRangeM, droneCount: droneWeapons.length, droneShots: histogram(droneWeapons.map(weapon => weapon.shotDmg ?? 0)), droneDps: numeric(droneWeapons.reduce((n, weapon) => n + (weapon.shotDmg ?? 0) * 1000 / weapon.reloadMs, 0)), repairPer5: numeric(foeNominalDpsOf(unit) * (unit.repairPct ?? 0) * 5), split: ship.split, resists: { shield: ship.shieldResist, armor: ship.armorResist, hull: ship.hullResist }, mounts }
  })
  const out = resolve('tools/_ui-artifacts/alien-invasion')
  mkdirSync(out, { recursive: true })
  const lines = [
    '# C族入侵卡与敌舰输出审核', '',
    '> 当前代码取数：2026-10-08。新波次、群体补损、无限巢母、成虫召唤、渐增加速和爆虫动能爆发已接入；验证状态见本批工作文档。', '',
    '## 读数说明', '',
    '- 主列为单个单位、所有炮口合计的每轮伤害；每秒输出按配置攻击间隔计算，尚未乘命中、距离衰减、守方抗性及层位克制，不等于实际扣血。',
    '- 已包含卡倍率、编成补偿、越线折扣、0.4炮伤、1.5机群伤害以及工虫的护理折减；不应再乘炮数或卡倍率。',
    '- 火力均按满编存活计算；伤亡、自毁和机群损失会降低实时输出，护理和群体补损会延长火力持续时间。',
    '- 爆虫为一次性单目标动能爆发，独立列原始伤害，不除以4秒伪装成持续输出。普通炮台均为等离子80%/爆炸20%；颚钳动能，旧孢群机等离子。',
    '- 当前定价函数未折掉转护理的火力，也不计爆发、腐蚀、护理累积或补损深度；下表把现有定价峰值与射击峰值分开，标签按新编成建档重算，特殊机制强度另由实战校准。',
    '- 巢母自然卡舰体72,800只是定价锚点；真实旗舰满池150,000、三层30,000/82,500/37,500，后续挑战继承池剩余，工虫不护理共享池巢母。', '',
    '## 群体补损与巢母指挥', '',
    '| 载体 | 周期 | 初始出战 | 后备 | 补损范围 |',
    '|---|---:|---:|---|---|',
    '| 背巢巨兽 | 12秒 | 8 | 每艘32架 | 到点补齐当前波存活舰船的损失机位，每架扣1储备 |',
    '| 巢母巨兽 | 9秒 | 12 | 无限 | 到点补齐当前波存活舰船的全部损失机位 |', '',
    '后备不提高同时在场上限，巢母末波最多20架颚钳。没有战损不积蓄周期；活机不回血；有限后备不足时按队列补到用完，不透支。载体死亡停止自身孵化，不为死亡舰船补机，不恢复上一波机群。', '',
    '巢母每30秒召唤最多3架星髓成虫，计入本波4艘编队上限，满编跳过且不积累；规格沿用本场第二波成虫，不继承巢母专用厚血或共享血池。存活时每秒全队速度增加1.5个百分点，120秒达到+180%即2.8倍，与各舰冲锋相乘；死亡解除，重载继续有效时长。', '',
    '多载体同拍先处理无限巢母，有限背巢重新读取空槽，不重复复活或白扣后备。储备和跨舰队列分别随档；成虫召唤沿用支援入场时钟与装填窗口。', '',
    '## 卡片总览', '',
    '| 卡片 | 标签 | 波数/舰体总数 | 实战全波总血 | 射击峰值/秒 | 现有定价峰值/秒 |',
    '|---|---:|---|---:|---:|---:|',
    ...auditCards.map(card => `| ${card.name} | ${card.threat} | ${card.waves.length}/${card.waves.reduce((n, wave) => n + wave.units.reduce((n, unit) => n + unit.count, 0), 0)} | ${fmt(card.actualHp)} | ${fmt(card.firingPeakDps)} | ${fmt(card.pricingDps)} |`), '',
    '前三卡为单舰内容，旗舰最多四舰；外围前锋/护卫，核心护卫/主力。卡片回收体量保持90/108/129/170，不跟输出标签漂移。旗舰全波血包括150,000巢母池，不包括无人机和护理修复。', '',
    '## 基础敌舰', '',
    '| 敌舰 | 档位 | 基础总血 | 速度/冲锋 | 炮口 | 本体总齐射/4秒 | 机群单发分摊 | 机群输出/秒 | 护理/5秒 | 一次爆发 |',
    '|---|---|---:|---|---:|---:|---|---:|---:|---:|',
    ...baseUnits.map(unit => `| ${unit.name} | T${unit.tier} | ${fmt(unit.hp)} | ${unit.speed}m/s×${unit.charge} | ${unit.gunCount} | ${unit.gunShot} | ${unit.droneShots} | ${fmt(unit.droneDps)} | ${fmt(unit.repairPer5)} | ${unit.burstDamage} |`), '',
    '此表仅基础倍率1，用于对照，不是实际入侵卡数值。两载体采用确认的加成前预算228/558，再施加0.4炮伤和1.5机群伤害。爆虫无循环炮台；工虫基础124先折成62射击。所有机群间隔4.4秒。', '',
    '常规本体基础命中95%，远端衰减系数0.5，吃玩家回避；旧孢群机命中78%、颚钳89%，无距离衰减但有射程门。C舰体闪避12%，三层爆炸抗性25%、动能/等离子0；爆虫伤害基础命中95%扣回避，范围内不衰减，腐蚀触发不掷命中。', '',
  ]
  for (const card of auditCards) {
    lines.push(`## ${card.name}`, '', `内容标识：\`${card.id}\`；标签${card.threat}，自然卡总血${fmt(card.naturalHp)}，实际满池总血${fmt(card.actualHp)}。`, '')
    for (const wave of card.waves) {
      lines.push(`### 第${wave.wave}波`, '',
        '| 单位 | 数量 | 每体血量 | 本体齐射 | 炮口分摊 | 本体射击/秒 | 机群分摊 | 机群射击/秒 | 护理/5秒 | 一次爆发 | 本体/机群射程 |',
        '|---|---:|---:|---:|---|---:|---|---:|---:|---:|---|',
        ...wave.units.map(unit => `| ${unit.name} | ${unit.count} | ${fmt(unit.hp)} | ${unit.gunShot} | ${unit.gunPerPort} | ${fmt(unit.gunDps)} | ${unit.dronePerUnit} | ${fmt(unit.droneDps)} | ${fmt(unit.repairPer5)} | ${unit.burstDamage} | ${unit.gunRangeM}/${unit.droneRangeM || '-'}m |`), '',
        `本波合计：舰体血${fmt(wave.hp)}；本体${fmt(wave.gunDps)}点/秒＋机群${fmt(wave.droneDps)}点/秒＝**${fmt(wave.shotDps)}点/秒**；护理${fmt(wave.repairPer5)}点/5秒；一次性原始爆发合计${wave.burstDamage}。`, '')
    }
  }
  lines.push('## 机群生存与增程', '', '颚钳每架护盾6/装甲12/结构20，总血38、闪避45%、无额外抗性；旧孢群机15/28/45，总血88、闪避8%、装甲/结构全抗20%。这些血不吃敌卡舰体倍率。', '', '颚钳基础射程6000，载体加50%后9000；旧孢群机6000。玩家电子压制仍与增程加算抵消，15%压制时颚钳8100，60%压制时5400。', '', '巡游遇袭另按现有0.75强度缩放并逐条取整；不是本审核表再乘0.75即可逐项准确复现。群体复活只延长满编火力持续时间，不直接抬高满编峰值。', '')
  const header = ['卡片ID', '卡名', '波次', '舰级ID', '敌舰名', '数量', '每体总血', '护盾', '装甲', '结构', '炮口数', '本体总齐射', '每炮分摊', '本体间隔秒', '本体每秒输出', '本体射程米', '无人机数量', '无人机单发分摊', '机群总齐射', '无人机间隔秒', '机群每秒输出', '机群射程米', '每体射击合计每秒', '护理每5秒', '速度米每秒', '冲锋倍率', '孵化周期秒', '现行储备', '一次爆发原伤', '成虫召唤周期秒', '成虫每批数量', '加速封顶秒', '最大速度加成百分比']
  const csvRows = auditCards.flatMap(card => card.waves.flatMap(wave => wave.units.map(unit => [card.id, card.name, wave.wave, unit.shipId, unit.name, unit.count, unit.hp, numeric(unit.layers.s), numeric(unit.layers.a), numeric(unit.layers.h), unit.guns, unit.gunShot, unit.gunPerPort, unit.gunReloadSec, unit.gunDps, unit.gunRangeM, unit.drones, unit.dronePerUnit, unit.droneShot, unit.droneReloadSec, unit.droneDps, unit.droneRangeM, unit.shotDps, unit.repairPer5, unit.speedMps, unit.chargeMul, unit.hatcheryCycleSec, unit.currentReserve, unit.burstDamage, unit.adultSummonSec, unit.adultSummonCount, unit.speedRampSec, unit.speedMaxBonusPct])))
  const quote = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`
  writeFileSync(resolve(out, 'enemy-output-audit.json'), JSON.stringify({ scope: '当前新编成实战满池建档，循环射击、一次爆发、护理与定价输出分开', cards: auditCards, baseUnits }, null, 2), 'utf8')
  writeFileSync(resolve(out, 'enemy-output-audit.md'), lines.join('\n'), 'utf8')
  writeFileSync(resolve(out, 'enemy-output-audit.csv'), '\uFEFF' + [header, ...csvRows].map(row => row.map(quote).join(',')).join('\r\n') + '\r\n', 'utf8')
  console.log(lines.slice(0, 41).join('\n'))
  console.log(`完整审核表：${resolve(out, 'enemy-output-audit.md')}`)
  console.log(`逐舰CSV：${resolve(out, 'enemy-output-audit.csv')}`)
}

function run(profile: string, target: string, seed: number, boss = false) {
  const { state, ships, desire } = alienFixture(ctx, profile, seed, boss ? 4 : 1)
  if (boss) state.weekendEvent = { seq: 81, family: target.startsWith('alien') ? 'C' : target.startsWith('ink') ? 'H' : 'R', startedAtWallMs: now, coreId: 'galaxy-kor', peripheryIds: [], contributed: { 'galaxy-kor': 1 }, flagshipAtWallMs: now, flagshipHpMax: 150_000, flagshipHpDone: 0 }
  const battle = boss ? weekendStartFlagshipBattle(state, ctx, now, ships) : startBattleFor(state, ctx, state.shipId, target, 0, desire)
  assert(battle)
  const initialHp = Object.values(battle.units).filter(u => u.side === 'me').reduce((n, u) => n + u.hp.s + u.hp.a + u.hp.h, 0)
  let droneDown = 0, seq = -1
  for (let time = 100; time <= ctx.balance.battle.maxBattleMs + 5000; time += 100) {
    state.gameMs = time
    advanceBattleFor(state, ctx, battle, state.shipId, target)
    for (const fx of battle.fx) { if (fx.seq <= seq) continue; seq = fx.seq; if (fx.droneDown && fx.side === 'foe') droneDown++ }
    if (battle.ended) break
  }
  assert(battle.ended, '模拟必须正常结束')
  const hp = Object.values(battle.units).filter(u => u.side === 'me').reduce((n, u) => n + u.hp.s + u.hp.a + u.hp.h, 0)
  const healed = battle.foeRepair?.healed ?? 0
  return { win: Number(battle.ended === 'me'), seconds: (battle.lastTickGameMs - battle.startedAtGameMs) / 1000, hpFraction: hp / initialHp, acid: Number(!!battle.alienCorrosion), revived: Object.values(battle.foeHatcheries ?? {}).reduce((n, l) => n + l.revived, 0), summoned: battle.foeReviveCount ?? 0, droneDown, healed, sunk: Object.values(battle.units).filter(u => u.side === 'me' && u.hp.s + u.hp.a + u.hp.h <= 0).length, bossDamage: boss ? flagshipBattleLedger(battle, [battle.foeOverride!.bossShipId!]).rawDmg : 0 }
}

if (process.argv.includes('--audit')) {
  audit()
  process.exit(0)
}

if (!process.argv.includes('--save')) {
  for (const profile of ALIEN_TEST_PROFILES) for (const target of targets) {
    const readings = Array.from({ length: seeds }, (_, index) => run(profile.id, target, 611 + index * 73))
    const mean = Object.fromEntries(Object.keys(readings[0]!).map(key => [key, readings.reduce((n, r) => n + Number(r[key as keyof typeof r]), 0) / seeds]))
    rows.push({ profile: profile.id, target, seeds, mean, readings })
    console.log(`${profile.id} ${target}：胜率${(Number(mean.win) * 100).toFixed(0)}%，${Number(mean.seconds).toFixed(1)}秒，腐蚀${Number(mean.acid).toFixed(2)}，补回${Number(mean.revived).toFixed(1)}`)
  }
  for (const profile of ['heavy', 'aa', 'drones', 'small']) for (const target of ['alien-broodmother', 'ink-flagship', 'corona-nexus']) {
    const readings = Array.from({ length: seeds }, (_, index) => run(profile, target, 611 + index * 73, true))
    const mean = Object.fromEntries(Object.keys(readings[0]!).map(key => [key, readings.reduce((n, r) => n + Number(r[key as keyof typeof r]), 0) / seeds]))
    rows.push({ profile, target, squad: 4, seeds, mean, readings })
    assert(Object.values(mean).every(Number.isFinite), '报告不得包含无效数值')
    console.log(`四舰 ${profile} ${target}：进池${Number(mean.bossDamage).toFixed(0)}，沉船${Number(mean.sunk).toFixed(1)}，补机${Number(mean.revived).toFixed(1)}，支援${Number(mean.summoned).toFixed(1)}`)
  }
}
const out = resolve('tools/_ui-artifacts/alien-invasion')
mkdirSync(out, { recursive: true })
const cards = targets.filter(id => id.startsWith('alien')).concat('alien-broodmother').map(id => {
  const card = ctx.anomalies.get(id)!
  const threat = foeThreatOfAnomaly(card, id === 'alien-broodmother' ? 10 : 3, ctx.balance.battle)
  assert.equal(card.threat, threat, '卡面价必须跟真实建档同源')
  return { id, threat, ...foeStrengthOf(card, ctx.balance.battle) }
})
if (!process.argv.includes('--save')) writeFileSync(resolve(out, 'report.json'), JSON.stringify({ cards, rows, scope: '新档合法配装；A0至A2为L3、A3六项L3，其余满技能，真实战斗；不是自然成长或观感验收。' }, null, 2), 'utf8')
if (process.argv.includes('--save')) {
  const { state, ships } = alienFixture(ctx, 'heavy', 611, 4)
  state.modeChosen = true
  state.onboarding = { ...state.onboarding, step: 99 }
  state.weekendEvent = { seq: 81, family: 'C', startedAtWallMs: Date.now(), coreId: 'galaxy-kor', peripheryIds: ['galaxy-redring'], contributed: { 'galaxy-kor': 1, 'galaxy-redring': 1 }, flagshipAtWallMs: Date.now(), flagshipHpMax: 150_000, flagshipHpDone: 120_000 }
  const battle = weekendStartFlagshipBattle(state, ctx, Date.now(), ships)
  assert(battle)
  state.encounter = { ...state.encounter, active: true, shipId: ships[0]!, galaxyId: 'galaxy-kor', anomalyId: 'alien-broodmother', name: ctx.anomalies.get('alien-broodmother')!.name, threat: ctx.anomalies.get('alien-broodmother')!.threat, origin: '测试', battle, invitedAtGameMs: 0, deadlineGameMs: 0 }
  const savePath = resolve('docs/test-saves/test-save-alien-invasion-20261006.json')
  mkdirSync(resolve('docs/test-saves'), { recursive: true })
  writeFileSync(savePath, serializeSaveFile(state), 'utf8')
  console.log(`合成验收档：${savePath}`)
}
