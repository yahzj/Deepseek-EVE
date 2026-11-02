/** 辅助混编与完整常驻循环校准；不修改游戏数值或读取个人档。
 * node --import tsx tools/enemy-formation-sustain-check.ts [--smoke | --focus] [--render]
 */
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildSimContext } from '@whale/data'
import { DEFENSIVE_MIX_PROFILE, oldFormationContext, runSustainCampaign, SUSTAIN_PROFILES, sustainFixture, withoutSupportTraits,
  type SustainResult } from './enemy-formation-sustain'

const ctx = buildSimContext(), legacy = oldFormationContext(ctx), disabled = withoutSupportTraits(ctx)
const smoke = process.argv.includes('--smoke')
const focus = process.argv.includes('--focus')
const render = process.argv.includes('--render')
assert(!(smoke && focus), '短线与重点复测不能同时指定')
const seeds = smoke ? [1] : focus ? Array.from({ length: 20 }, (_, i) => i + 1) : [1, 7, 13]
const rounds = smoke ? 2 : focus ? 10 : 5
const cards = [...ctx.anomalies.values()].filter(card => !card.hidden
  && (!smoke || ['ano-echo-haunt', 'ano-voidedge-warden'].includes(card.id))
  && (!focus || card.id === 'ano-vault-sentinel'))
const output = resolve('tools/_ui-artifacts/enemy-formation-20261031')
const results: SustainResult[] = [], supportDisabled: SustainResult[] = []
const activeProfiles = focus ? [...SUSTAIN_PROFILES, DEFENSIVE_MIX_PROFILE] : SUSTAIN_PROFILES
const profiles = activeProfiles.map(profile => {
  const fixture = sustainFixture(ctx, profile, 1)
  return { ...profile, cost: fixture.budget.cost, capacity: fixture.budget.capacity, assetValues: fixture.assetValues }
})
const jsonPath = resolve(output, smoke ? 'sustain-smoke.json' : focus ? 'sustain-focus.json' : 'sustain.json')
if (render) {
  const saved = JSON.parse(readFileSync(jsonPath, 'utf8')) as { seeds: number[]; rounds: number; results: SustainResult[]; supportDisabled: SustainResult[] }
  assert.deepEqual(saved.seeds, seeds)
  assert.equal(saved.rounds, rounds)
  assert.equal(saved.results.length, profiles.length * cards.length * seeds.length * 4)
  assert.equal(saved.supportDisabled.length, cards.length * seeds.length * 2)
  results.push(...saved.results)
  supportDisabled.push(...saved.supportDisabled)
}
if (!render) for (const profile of activeProfiles) for (const policy of ['port', 'continuous'] as const) {
  for (const card of cards) for (const seed of seeds) for (const version of [0, 1] as const) {
    results.push(runSustainCampaign(version === 0 ? legacy : ctx, profile, card.id, seed, version, policy, rounds))
  }
  console.log(JSON.stringify({ phase: '常驻完整循环', profile: profile.id, policy, campaigns: results.length,
    battles: results.reduce((sum, row) => sum + row.rounds, 0) }))
}
// 保留同一船体、装配、成本与种子，仅在隔离上下文关闭两项船体特性，观察辅助的实际贡献。
if (!render) for (const card of cards) for (const seed of seeds) for (const policy of ['port', 'continuous'] as const) {
  supportDisabled.push(runSustainCampaign(disabled, SUSTAIN_PROFILES.find(profile => profile.id === 'mixed')!, card.id, seed, 1, policy, rounds))
}
const sum = (rows: SustainResult[], key: 'rounds' | 'wins' | 'seconds' | 'net' | 'lootValue' | 'repairDebt' | 'portRepair' | 'supplyCost' | 'replacement') => rows.reduce((n, row) => n + row[key], 0)
function aggregate(rows: SustainResult[]) {
  return { campaigns: rows.length, battles: sum(rows, 'rounds'), wins: sum(rows, 'wins'),
    stopped: rows.filter(row => row.stopped).length, sunk: rows.reduce((n, row) => n + row.sunk.length, 0),
    seconds: sum(rows, 'seconds'), net: sum(rows, 'net'), lootValue: sum(rows, 'lootValue'),
    portRepair: sum(rows, 'portRepair'), repairDebt: sum(rows, 'repairDebt'), supplyCost: sum(rows, 'supplyCost'), replacement: sum(rows, 'replacement'),
    netPerHour: sum(rows, 'net') * 3600 / Math.max(1, sum(rows, 'seconds')),
    withLootPerHour: (sum(rows, 'net') + sum(rows, 'lootValue')) * 3600 / Math.max(1, sum(rows, 'seconds')) }
}
const fmt = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 1 })
const ratio = (old: number, current: number) => old > 0 && current >= 0 ? `${((current / old - 1) * 100).toFixed(1)}%` : '见原值'
const lines = [focus ? '# 穹顶守卫持续作战重点复测' : '# 辅助混编与常驻完整循环校准', '',
  '> 状态：合成实战读数，待船长实机验收；二号工作区，2026-10-31。', '',
  '船长批准继续补辅助混编持续战损和完整收益循环校准。本次只增加校准工具、确定性用例和报告，不改敌卡、报酬或其他玩法。', '',
  `- 覆盖${cards.length}张常驻卡，固定种子${seeds.join('/')}，每条路线最多${rounds}轮；${profiles.length}套满技能MK2舰队，新旧敌卡同配装同初始种子。每张卡独立起档，同路线各轮继承损伤、库存、随机序列和距离记忆。`,
  '- 港内全面维修：每轮正式结算返航后付费修复全部幸存舰。连续作战：调用正式重复清剿入口和安全阀，跨场保留损伤，不代修满、不补回沉船、不强行续开停环。',
  '- 所有舰队容量上限125，实际成本不同，不能把跨舰队结果当成同造价对决。满技能、舰船、地图与充足初始补给预置，不代表60声望初次养成。',
  ...(focus ? ['- “辅助加防护”仅为后勤舰和电子舰各加一件MK2护盾扩展、MK2装甲板，使用原空余槽位，船体、队员与90点指挥成本不变；装配和CPU走正式校验，增加的装备估值随沉船计损。不改装备或敌人数值。'] : []),
  '- 周期包含实际战斗、返航与未结束的冷却；奖金走正式结算，逐项扣实际消耗弹药、军用组件、永久无人机损失、港内维修及失利费用。沉船船体和装配按目录价计损；连续路线末尾未修损伤计维修负债。',
  '- 净收益为奖金现金减上述成本；另列战利品按基准卖价估值，尚未实际出售。补给按目录购买基价估值，不包含税费、供货等待与市场波动。不折现残骸、稀有掉落、黑匣或未实现的未来收益。',
  '- 新旧首轮使用同一初始种子，但新增敌舰会改变后续随机消耗，不能保证逐发命中和15%概率的情报彩头同步；小幅收益上升不代表敌舰被削弱。胜场不等于无战损，另查沉船与停线。',
  '- 战斗与远征走正式入口，校准直接推进领域时钟；未并跑矿业、训练、世界事件和残骸衰减，不计这些活动的收入。默认换波演出在线/离线时序差异仍是已知边界。', '',
  '## 舰队与总体结果', '',
  '| 舰队 | 成本/容量 | 方式 | 旧胜场/实际场数 | 新胜场/实际场数 | 旧→新沉船 | 旧→新净收益/小时 | 变化 |',
  '|---|---:|---|---:|---:|---:|---:|---:|']
const summaries = []
for (const profile of profiles) for (const policy of ['port', 'continuous'] as const) {
  const before = aggregate(results.filter(row => row.profile === profile.id && row.policy === policy && row.version === 0))
  const after = aggregate(results.filter(row => row.profile === profile.id && row.policy === policy && row.version === 1))
  summaries.push({ profile: profile.id, policy, before, after })
  lines.push(`| ${profile.name} | ${profile.cost}/${profile.capacity} | ${policy === 'port' ? '港内全修' : '连续作战'} | ${before.wins}/${before.battles} | ${after.wins}/${after.battles} | ${before.sunk}→${after.sunk} | ${fmt(before.netPerHour)}→${fmt(after.netPerHour)} | ${ratio(before.netPerHour, after.netPerHour)} |`)
}
lines.push('', '总体每小时数值 = 所有路线净额之和 / 所有路线实际时间之和，不是逐卡每小时读数的平均；失败提前停下的路线仍计全部已发生亏损，不能解读为可持续挂机收入。', '',
  '## 逐卡结果', '')
for (const profile of profiles) for (const policy of ['port', 'continuous'] as const) {
  lines.push(`### ${profile.name} · ${policy === 'port' ? '港内全修' : '连续作战'}`, '',
    '| 目标 | 旧→新胜场/场数 | 旧→新停线数 | 旧→新沉船 | 旧→新净收益/小时 | 新含战利品估值/小时 | 旧→新平均周期秒 |',
    '|---|---:|---:|---:|---:|---:|---:|')
  for (const card of cards) {
    const before = aggregate(results.filter(row => row.profile === profile.id && row.policy === policy && row.cardId === card.id && row.version === 0))
    const after = aggregate(results.filter(row => row.profile === profile.id && row.policy === policy && row.cardId === card.id && row.version === 1))
    lines.push(`| ${card.name} | ${before.wins}/${before.battles}→${after.wins}/${after.battles} | ${before.stopped}→${after.stopped} | ${before.sunk}→${after.sunk} | ${fmt(before.netPerHour)}→${fmt(after.netPerHour)} | ${fmt(after.withLootPerHour)} | ${fmt(before.seconds / Math.max(1, before.battles))}→${fmt(after.seconds / Math.max(1, after.battles))} |`)
  }
  lines.push('')
}
lines.push('## 辅助能力隔离对照', '',
  '同一套“三炮击＋后勤＋电子”舰队、相同新敌卡、配装与种子；隔离上下文关闭后勤跨舰维修和电子射程压制，自修装置、船体、武器、成本与库存保持一致。两项能力一起关闭，本表不拆分两者各自贡献。', '',
  '| 方式 | 有辅助胜场/场数 | 关闭后胜场/场数 | 有辅助→关闭后沉船 | 有辅助→关闭后净收益/小时 |',
  '|---|---:|---:|---:|---:|')
for (const policy of ['port', 'continuous'] as const) {
  const enabled = aggregate(results.filter(row => row.profile === 'mixed' && row.policy === policy && row.version === 1))
  const off = aggregate(supportDisabled.filter(row => row.policy === policy))
  lines.push(`| ${policy === 'port' ? '港内全修' : '连续作战'} | ${enabled.wins}/${enabled.battles} | ${off.wins}/${off.battles} | ${enabled.sunk}→${off.sunk} | ${fmt(enabled.netPerHour)}→${fmt(off.netPerHour)} |`)
}
assert(results.every(row => Number.isFinite(row.netPerHour) && row.records.every(record => record.cycleSeconds > 0)))
mkdirSync(output, { recursive: true })
const reportPath = resolve(focus ? 'docs/design/enemy-fleet-vault-focus-20261031.md' : 'docs/design/enemy-fleet-sustain-20261031.md')
if (!render) writeFileSync(jsonPath, JSON.stringify({ smoke, focus, seeds, rounds, profiles, summaries, results, supportDisabled }, null, 2), 'utf8')
if (!smoke) writeFileSync(reportPath, lines.join('\n') + '\n', 'utf8')
console.log(JSON.stringify({ phase: '完成', smoke, campaigns: results.length + supportDisabled.length,
  battles: [...results, ...supportDisabled].reduce((n, row) => n + row.rounds, 0), summaries, reportPath }))
