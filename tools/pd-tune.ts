/**
 * 点防调参工具（2026-09-10 船长拍板「无人机可被击落」配套；正式工具，可复跑）。
 *
 * 用法：npx tsx tools/pd-tune.ts
 *      （不带参数 = 用 balance.ts 现值；试档：`--acc 0.55,0.4 --dmg 3,8 [--period 500]`）
 *
 * 机制（2026-09-10 船长口径）：威胁 ≥ pdThreatFloor(60) 的敌舰各装一台近防炮，
 * **每 pdJudgementMs(500ms) 独立判定一次**：随机挑一架**正在攻击的放飞无人机**（哨戒机不被打）
 * → `pdAcc − 机型闪避` 掷命中 → 命中按 `pdDmg` 走机型三层抗性；血量打空即击落（战后永久损失）。
 * 近防炮不看距离、也不参与敌舰对玩家的常规攻击。
 *
 * 本工具用真实引擎（满战斗技能 + D3 满编机群 + 合法流派配装）复测：
 * 胜率 / 中位交火秒 / 机群战损架数与机型 / 战损估值（ISK）——用于定 pdAcc 与 pdDmg。
 */
import { buildSimContext } from '@whale/data'
import { addShipToFleet, createInitialState } from '@whale/core'
import type { SimContext } from '@whale/core'
import { advanceBattleFor, pdEnabledFor, startBattleFor, waveGapTotalMs } from '../packages/core/src/combat'

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

type PdPatch = Partial<Record<'pdAcc' | 'pdDmg' | 'pdJudgementMs' | 'pdThreatFloor', number>>
const patched = (pd: PdPatch): SimContext => ({
  ...base,
  balance: { ...base.balance, battle: { ...base.balance.battle, ...pd } },
})

/**
 * 命令行传参（不改源码试档，按位配对）：
 *   npx tsx tools/pd-tune.ts --acc 0.55,0.4,0.25 --dmg 3,8,14 [--period 500]
 * 不给参数 = 用 balance.ts 现值。
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
  const accs = nums('--acc')
  const dmgs = nums('--dmg') ?? []
  const periods = nums('--period') ?? []
  if (!accs && dmgs.length === 0) return [{ label: '现值', pd: {} }]
  const rows = Math.max(accs?.length ?? 0, dmgs.length)
  const at = <T>(arr: T[], i: number): T | undefined =>
    arr.length === 0 ? undefined : arr[Math.min(i, arr.length - 1)]
  const out: Array<{ label: string; pd: PdPatch }> = []
  for (let i = 0; i < rows; i++) {
    const acc = accs ? accs[Math.min(i, accs.length - 1)]! : undefined
    const dmg = dmgs.length > 0 ? dmgs[Math.min(i, dmgs.length - 1)]! : undefined
    const pd: PdPatch = {}
    if (acc !== undefined) pd.pdAcc = acc
    if (dmg !== undefined) pd.pdDmg = dmg
    const per = at(periods, i)
    if (per !== undefined) pd.pdJudgementMs = per
    out.push({
      label: `acc${pd.pdAcc ?? base.balance.battle.pdAcc} d${pd.pdDmg ?? base.balance.battle.pdDmg}${per !== undefined ? ` ${per}ms` : ''}`,
      pd,
    })
  }
  return out
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
  `\n机制换算：威胁门槛 ${base.balance.battle.pdThreatFloor}（低于此值无敌近防炮）｜判定周期 ${base.balance.battle.pdJudgementMs}ms/舰｜` +
    `命中 = acc − 机型闪避｜**战斗内可 100% 损坏**（无单场上限）｜战后按回收率找回（基础 10%，回收学满级 50%）｜` +
    `哨戒机默认不被打、**非哨戒机全灭后转打哨戒机**\n` +
    `代表卡是否有点防：噬口(80)=${pdEnabledFor(80, base.balance.battle)}、坟场(88)=${pdEnabledFor(88, base.balance.battle)}、穹顶(96)=${pdEnabledFor(96, base.balance.battle)}`,
)
