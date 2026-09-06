/**
 * 悬赏收益对照工具（2026-09-06 船长需求：初期战斗收益复核——不同星系战斗收益对比
 * + 战斗稳定收益的配置需求依据）。
 *
 * 做法：对每张玩家悬赏（按声望门槛/威胁升序），用"该威胁档的参考装配"（与
 * balance.foeRefFire 同口径：≤16 隼枭+动能MK1 / ≤40 虎鲨+2×动能MK2 / >40 鲸王+3×动能MK3，
 * 无技能）跑 SEEDS 场确定性实战（advanceBattleFor 真实结算），得出：
 *   胜率% / 平均交火秒 / 平均弹药耗（发）
 * 再叠加现行经济口径（2026-09-06 自动返航定稿）：
 *   单局周期 = 交火 + max(返航 2×单程实耗, 重复冷却)——冷却自结算时并行计时；
 *   母港目标无返航段；
 *   净收益 = 奖金期望(±15% jitter 均值=1) − 失局维修费期望(0.5×奖金×(1−胜率))
 *           + 战利品估值(按物品基准价×胜率) − 弹药费(按实耗发数×单价)
 *   实际 ≈ISK/h = 净收益 × 3600 / 周期
 * 对照列：悬赏卡现行"估算 ISK/h"（交火 = 表内标称 combatSeconds，非真实交火时长）——
 * 两列之差即"卡面低估/高估"程度。
 *
 * 尾部附采矿对照行：沙猫级（裸船）在各矿带的每活性小时原矿估值（引擎 getMiningParams
 * 口径，按物品基准价，同矿带卡效率行；不含往返与市场波动）。
 *
 * 运行：npm run bounty:econ （等价 npx tsx tools/bounty-econ.ts）
 */
import { addShipToFleet, createInitialState, repairDeprecatedModules, type GameState, type SimContext } from '@whale/core'
import { ANOMALIES, buildSimContext } from '@whale/data'
import { advanceBattleFor, startBattleFor } from '../packages/core/src/combat'
import { travelLegMs, shortestTravelMinutes } from '../packages/core/src/travel'
import { bountyCooldownMsFor } from '../packages/core/src/expedition'
import { getMiningParams } from '../packages/core/src/mining'
import { BOUNTY_COOLDOWN_BASE_MS } from '../packages/core/src/expedition'
import { fleetDefOf } from '../packages/core/src/instances'

const ctx = buildSimContext()
const HOME = 'galaxy-hub'
const SEEDS = [1, 7, 13, 29, 51]

type Loadout = { name: string; ship: string; high: string[] }
/** 参考装配（= foeRefFire 校准档；无技能档） */
const BAND_FITS: Array<{ upToThreat: number; ld: Loadout }> = [
  { upToThreat: 16, ld: { name: '隼枭+动能MK1', ship: 'sh-falconet', high: ['mod-turret-kin-1'] } },
  { upToThreat: 40, ld: { name: '虎鲨+2×动能MK2', ship: 'sh-tigershark', high: ['mod-turret-kin-2', 'mod-turret-kin-2'] } },
  { upToThreat: 9999, ld: { name: '鲸王+3×动能MK3', ship: 'whale-king', high: ['mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3'] } },
]

const AMMO_PRICE: Record<string, number> = { kin: 6, exp: 7, pla: 8 } // 每发（单档通用弹基准价）

function makeState(shipId: string, ld: Loadout, seed: number): GameState {
  const state = createInitialState({ nowWallMs: 0, seed })
  state.wallet.isk = 500_000_000
  addShipToFleet(state, shipId)
  state.shipId = shipId
  for (const k of ['ammo-kinetic-l', 'ammo-explosive-l', 'ammo-plasma-l']) state.warehouse.items[k] = 20_000
  const entry = state.fleet[shipId]!
  entry.fitted = { high: [...ld.high], mid: [null, null], low: [null, null] }
  repairDeprecatedModules(state, ctx as SimContext)
  return state
}

function simulate(state: GameState, anomalyId: string): { win: boolean; durMs: number; shots: number } {
  const battle = startBattleFor(state, ctx as SimContext, state.shipId, anomalyId, 0)
  if (!battle) return { win: false, durMs: 0, shots: 0 }
  state.gameMs = ctx.balance.battle.maxBattleMs + 5_000
  advanceBattleFor(state, ctx as SimContext, battle, state.shipId, anomalyId)
  const durMs = Math.min(ctx.balance.battle.maxBattleMs, Math.max(0, battle.lastTickGameMs - battle.startedAtGameMs))
  return { win: battle.ended === 'me', durMs, shots: battle.stats.meShots }
}

function fmt(n: number): string {
  return n >= 100_000 ? `${Math.round(n / 1000)}k` : Math.round(n).toLocaleString('zh-CN')
}

/** 采矿基准表：沙猫裸船每活性小时原矿估值（引擎 getMiningParams × 物品基准价，同矿带卡口径） */
function miningBench(): Array<{ stand: number; id: string; galaxy: string; iskH: number }> {
  const st = createInitialState({ nowWallMs: 0, seed: 1 })
  st.wallet.isk = 100_000_000
  addShipToFleet(st, 'sandcat')
  st.shipId = 'sandcat'
  const rows: Array<{ stand: number; id: string; galaxy: string; iskH: number }> = []
  for (const b of ctx.belts.values()) {
    const p = getMiningParams(st, ctx as SimContext, { shipId: 'sandcat', beltId: b.id })
    if (!p) continue
    const outputs = b.outputs?.length ? b.outputs : [{ itemId: b.oreId, weight: 1 }]
    const wSum = outputs.reduce((s, o) => s + o.weight, 0)
    const valPerCycle = outputs.reduce((s, o) => {
      const it = ctx.items.get(o.itemId)
      return s + ((it?.baseSellPriceIsk ?? 0) * o.weight) / wSum
    }, 0)
    const cyclesH = (3_600_000 / p.cycleMs) * 1.01 // 富矿脉期望 +1%
    rows.push({ stand: b.standingReq ?? 0, id: b.id, galaxy: b.galaxyId ? ctx.galaxies.get(b.galaxyId)?.name ?? b.galaxyId : '本地', iskH: Math.round(cyclesH * p.unitsPerCycle * valPerCycle) })
  }
  rows.sort((x, y) => y.iskH - x.iskH)
  return rows
}

function main(): void {
  const anoms = [...ANOMALIES]
    .filter((a) => !a.hidden)
    .sort((a, b) => a.standingReq - b.standingReq || a.threat - b.threat)
  const mineAll = miningBench()
  // 各声望档可解锁的最佳矿带（含本地/异地带往返前的原矿上限）
  const bestAt = (stand: number): { id: string; iskH: number } => {
    const ok = mineAll.filter((r) => r.stand <= stand)
    const top = ok.reduce((m, r) => (r.iskH > m.iskH ? r : m), ok[0] ?? { id: '-', iskH: 0 })
    return top
  }

  console.log('══ 悬赏收益对照（参考装配 × 现行经济口径；5 种子实战平均）══')
  console.log('参考装配按威胁档：≤16 隼枭+动能MK1 / ≤40 虎鲨+2×动能MK2 / >40 鲸王+3×动能MK3（无技能）')
  console.log('单局周期 = 交火 + max(返航2×单程, 重复冷却)；冷却与返航并行计时（冷却基数 10s，随船扫描属性缩短）')
  console.log(
    [
      '目标'.padEnd(14),
      '星系'.padEnd(10),
      '声望'.padEnd(4),
      'T'.padEnd(4),
      '奖金'.padEnd(9),
      '胜率'.padEnd(5),
      '交火s'.padEnd(6),
      '周期s'.padEnd(7),
      '实际ISK/h'.padEnd(10),
      '卡面/h'.padEnd(10),
      '采矿参照',
    ].join(' '),
  )
  for (const a of anoms) {
    const fit = BAND_FITS.find((f) => a.threat <= f.upToThreat)!.ld
    let wins = 0
    let durSum = 0
    let durEnds = 0
    let shotsSum = 0
    for (const seed of SEEDS) {
      const state = makeState(fit.ship, fit, seed)
      const r = simulate(state, a.id)
      if (r.win) wins++
      if (r.durMs > 0) {
        durSum += r.durMs
        durEnds++
      }
      shotsSum += r.shots
    }
    const pWin = wins / SEEDS.length
    const fightSec = durEnds > 0 ? durSum / durEnds / 1000 : 0
    const shots = shotsSum / SEEDS.length
    // 经济口径
    const st = makeState(fit.ship, fit, 1)
    const mins = shortestTravelMinutes(ctx, HOME, a.galaxyId)
    const oneLegMs = Number.isFinite(mins) && mins > 0 ? travelLegMs(st, ctx as SimContext, mins, fit.ship) : 0
    const backMs = a.galaxyId === HOME ? 0 : oneLegMs * 2
    const cdMs = bountyCooldownMsFor(st, ctx as SimContext)
    const periodSec = fightSec + Math.max(backMs, cdMs) / 1000
    const ammoCost = shots * AMMO_PRICE.kin
    let lootVal = 0
    for (const row of a.loot) {
      lootVal += (ctx.items.get(row.itemId)?.baseSellPriceIsk ?? 0) * row.units
    }
    const gross = a.rewardIsk
    const lossCost = (1 - pWin) * gross * 0.5
    const netPerClear = gross * pWin - lossCost + lootVal * pWin - ammoCost
    const actualIskH = periodSec > 0 ? (netPerClear * 3600) / periodSec : 0
    // 卡面口径：交火 = 标称 combatSeconds；返航 = 2×单程实耗；无弹药/维修/战利
    const cardMs = a.combatSeconds * 1000 + (a.galaxyId === HOME ? 0 : oneLegMs * 2)
    const cardIskH = (gross * 3600) / Math.max(1, cardMs / 1000)
    const galaxyName = ctx.galaxies.get(a.galaxyId)?.name ?? a.galaxyId
    const ref = bestAt(a.standingReq)
    const gap = actualIskH > 0 ? actualIskH / cardIskH : 0
    const actTxt = pWin >= 1 ? fmt(actualIskH) : pWin >= 0.5 ? fmt(actualIskH) + '?' : '—(不可刷)'
    console.log(
      [
        a.name.slice(0, 13).padEnd(14),
        galaxyName.slice(0, 9).padEnd(10),
        String(a.standingReq).padEnd(4),
        String(a.threat).padEnd(4),
        fmt(gross).padEnd(9),
        `${Math.round(pWin * 100)}%`.padEnd(5),
        `${fightSec.toFixed(1)}`.padEnd(6),
        `${Math.round(periodSec)}`.padEnd(7),
        actTxt.padEnd(10),
        fmt(cardIskH).padEnd(10),
        gap >= 1.5 ? `≈${gap.toFixed(1)}×` : '≈同',
        `| 采矿≤声望${a.standingReq} 最佳 ${ref.id} ≈${fmt(ref.iskH)}/h`,
      ].join(' '),
    )
  }

  // ── 采矿对照行（沙猫级裸船；每活性小时原矿估值，按物品基准价） ──
  console.log('\n══ 采矿对照（沙猫级·裸船 每活性小时原矿估值；本地带无往返；异地带另计返航）══')
  for (const r of mineAll) {
    const oreDef = (() => {
      const b = [...ctx.belts.values()].find((x) => x.id === r.id)
      return b ? ctx.items.get(b.oreId)?.name ?? b.oreId : ''
    })()
    console.log(
      `${r.id.padEnd(18)} ${r.galaxy.padEnd(10)} 声望${String(r.stand).padEnd(3)} ${oreDef.padEnd(10)} → 沙猫裸船 ≈${fmt(r.iskH)} ISK/h`,
    )
  }
  void BOUNTY_COOLDOWN_BASE_MS
  void fleetDefOf
  void HOME
}

main()
