/**
 * 点防调参工具（2026-09-10 船长拍板「无人机可被击落」配套；正式工具，可复跑）。
 *
 * 用法：npx tsx tools/pd-tune.ts
 *      （不带参数 = 用 balance.ts 现值；带参数试档：`--rate 0.8 --dmg 12 --range 3500 --acc 0.5 --cap 0.4`，
 *        多组用逗号：`--rate 0.6,1.2,1.8`（其余参数按位对应，缺省取现值））
 *
 * 用途：改 `balance.pdRatePerSec / pdDmg / pdRangeM / pdAcc / pdThreatFloor / pdMaxLossFrac`
 * 后，用真实引擎（满战斗技能 + D3 满编机群 + 支援件）在代表卡上复测：
 * 胜率 / 中位交火秒 / 机群战损架数与机型 / 战损估值（ISK）——用于把"损失量级"锚在
 * 「有痛感但不劝退」的区间（战损估值占该卡奖励的百分之几）。
 *
 * 改数值请直接改 `packages/core/src/balance.ts` 的 `pd*` 参数后复跑本工具。
 */
import { buildSimContext } from '@whale/data'
import { addShipToFleet, createInitialState } from '@whale/core'
import type { SimContext } from '@whale/core'
import { advanceBattleFor, pdRateFor, startBattleFor, waveGapTotalMs } from '../packages/core/src/combat'

const base = buildSimContext()
const SHIP = 'sh-sentinel' // 王鲭 4 高槽 / 机巢 320（无人机专用舰）
const LOAD = { 'drone-heavy': 4, 'drone-sentry': 6 } // D3 满编口径
const CARDS = ['ano-maw-hunt', 'ano-gravekeeper', 'ano-vault-sentinel'] // 威胁 80 / 88 / 96
const SEEDS = [1, 7, 13, 29, 51]
/** 满战斗技能（与 tools/drone-vs-gun.ts 同口径；无技能档机群会被 CPU 裁剪、不代表真实强度） */
const FULL_SKILLS: Record<string, number> = Object.fromEntries(
  [
    'gunnery', 'kinetic-gunnery', 'missile-launching', 'laser-cannon', 'fire-control', 'reload-drills',
    'drone-warfare', 'drone-servicing', 'ammunition-condensing', 'shield-operation', 'energy-management',
    'hull-upgrades', 'shield-tuning', 'armor-tuning', 'armed-ops', 'armored-ops', 'vector-maneuvering',
    'evasion-maneuvering', 'targeting-integration', 'ship-systems-engineering',
  ].map((k) => [k, 5]),
)

function run(c: SimContext, card: string, seed: number, load: Record<string, number> = LOAD) {
  const state = createInitialState({ nowWallMs: 0, seed })
  const uid = addShipToFleet(state, SHIP)
  state.shipId = uid
  for (const [k, v] of Object.entries(FULL_SKILLS)) state.skills.trained[k] = v
  for (const key of ['ammo-kinetic-l', 'ammo-explosive-l', 'ammo-plasma-l']) state.warehouse.items[key] = 5_000
  state.fleet[uid]!.fitted = {
    high: ['mod-drone-rack-3', 'mod-drone-rack-3', 'mod-drone-tac-3', 'mod-drone-tac-3'],
    // 中/低槽按王鲭实际布局（中 2 / 低 2）+ 无人机流派取向：盾容 + 姿态陀螺（减被命中）/
    // 甲容 + 装甲板（生存）——支援件对无人机火力无效（2026-09-10 船长口径），故不走火力向配装
    mid: ['mod-shield-kin-2', 'mod-gyro-2'],
    low: ['mod-armor-kin-2', 'mod-armor-plate-2'],
  }
  state.fleet[uid]!.droneLoad = { ...load }
  for (const [id, n] of Object.entries(load)) state.warehouse.items[id] = n
  const b = startBattleFor(state, c, uid, card, 0)
  if (!b) return null
  state.gameMs = c.balance.battle.maxBattleMs + 5_000 + waveGapTotalMs(c.anomalies.get(card), c.balance.battle)
  advanceBattleFor(state, c, b, uid, card)
  return b
}

type PdPatch = Partial<
  Record<'pdRatePerSec' | 'pdDmg' | 'pdRangeM' | 'pdAcc' | 'pdThreatFloor' | 'pdMaxLossFrac', number>
>
const patched = (pd: PdPatch): SimContext => ({
  ...base,
  balance: { ...base.balance, battle: { ...base.balance.battle, ...pd } },
})

/**
 * 命令行传参（不改源码试档）：
 *   npx tsx tools/pd-tune.ts --rate 0.8 --dmg 12 --range 3500 --acc 0.5 --cap 0.4
 * 可给多组（用 `;` 分隔），例如 `--rate 0.8,1.2,1.8`（其余参数取现值）。
 */
function parseArgs(): Array<{ label: string; pd: PdPatch }> {
  const argv = process.argv.slice(2)
  const pick = (flag: string): string | undefined => {
    const i = argv.indexOf(flag)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const nums = (flag: string): number[] | undefined => {
    const raw = pick(flag)
    if (!raw) return undefined
    const vals = raw.split(',').map((v) => Number(v)).filter((v) => Number.isFinite(v))
    return vals.length > 0 ? vals : undefined
  }
  const rates = nums('--rate')
  if (!rates) return [{ label: '现值', pd: {} }] // 无参数 = 用 balance.ts 现值
  const dmgs = nums('--dmg') ?? []
  const ranges = nums('--range') ?? []
  const accs = nums('--acc') ?? []
  const caps = nums('--cap') ?? []
  const at = <T>(arr: T[], i: number): T | undefined => (arr.length === 0 ? undefined : arr[Math.min(i, arr.length - 1)])
  return rates.map((rate, i) => {
    const pd: PdPatch = { pdRatePerSec: rate }
    const d = at(dmgs, i)
    const rg = at(ranges, i)
    const ac = at(accs, i)
    const cp = at(caps, i)
    if (d !== undefined) pd.pdDmg = d
    if (rg !== undefined) pd.pdRangeM = rg
    if (ac !== undefined) pd.pdAcc = ac
    if (cp !== undefined) pd.pdMaxLossFrac = cp
    return {
      label: `r${rate}${d !== undefined ? ` d${d}` : ''}${rg !== undefined ? ` rng${rg}` : ''}${ac !== undefined ? ` acc${ac}` : ''}`,
      pd,
    }
  })
}

const SWEEP = parseArgs()

console.log('组合\t卡\t胜率%(5种子)\t中位秒\t损失合计(机型)\t平均损失架\t战损估值(ISK)\t卡奖励(ISK)\t占比%')
for (const combo of SWEEP) {
  const c = patched(combo.pd)
  for (const card of CARDS) {
    const rows: Array<{ win: boolean; sec: number; lost: Record<string, number> }> = []
    for (const seed of SEEDS) {
      const b = run(c, card, seed)
      if (!b) continue
      rows.push({
        win: b.ended === 'me',
        sec: Math.round((b.lastTickGameMs - b.startedAtGameMs) / 1000),
        lost: b.droneLost ?? {},
      })
    }
    if (rows.length === 0) continue
    const secs = rows.map((r) => r.sec).sort((a, b) => a - b)
    const agg: Record<string, number> = {}
    let total = 0
    let cost = 0
    for (const r of rows) {
      for (const [k, v] of Object.entries(r.lost)) {
        agg[k] = (agg[k] ?? 0) + v
        total += v
        cost += (c.items.get(k)?.baseSellPriceIsk ?? 0) * v
      }
    }
    const avgCost = Math.round(cost / rows.length)
    const anomaly = c.anomalies.get(card)!
    console.log(
      `${combo.label}\t${anomaly.name}(${anomaly.threat})\t${Math.round((rows.filter((r) => r.win).length / rows.length) * 100)}%\t` +
        `${secs[Math.floor(secs.length / 2)]}s\t${JSON.stringify(agg)}\t${(total / rows.length).toFixed(1)} 架\t` +
        `${avgCost.toLocaleString('zh-CN')}\t${anomaly.rewardIsk.toLocaleString('zh-CN')}\t${((avgCost / anomaly.rewardIsk) * 100).toFixed(1)}%`,
    )
  }
}
console.log(
  `\n射速换算：pdRateFor(威胁 80)=${pdRateFor(80, base.balance.battle).toFixed(2)}/s、` +
    `88=${pdRateFor(88, base.balance.battle).toFixed(2)}/s、96=${pdRateFor(96, base.balance.battle).toFixed(2)}/s` +
    `（floor=${base.balance.battle.pdThreatFloor} span=${base.balance.battle.pdThreatSpan} 满档=${base.balance.battle.pdRatePerSec}/s；低于 floor 的敌舰无点防）`,
)
