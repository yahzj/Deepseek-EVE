/**
 * 敌对派系活跃 · 掉落概率审数（正式工具，2026-09-10 加）：
 * 按**当前真实内容**推算"每天平均能刷几次"，据此给出不同掉落概率下的期望日产出——
 * 2026-09-10 已由船长据本表核定 `FACTION_RARE_DROP_CHANCE`（core/lairs.ts）为 **5%**；
 * 后续若要再调，改常数后复跑本工具即可对照（表内会标出当前值）。
 *
 * 口径（与引擎同源）：
 * - 候选 = 中安/低安星系里"有正经悬赏卡（非隐藏、有核心词、奖金 > 0）"的卡（高安不派发派系活跃）；
 *   **2026-09-10 船长定：已建成副站的星系排除出抽取范围**（尾部"候选池盘点"小节列出全仓建站点与口径）；
 * - 每趟耗时 = 交火 D(威胁) + 胜利返航（去程并入返航 = 2×单程；本地卡固定 120s） + 重复冷却
 *   （bountyCooldownMsFor，受驾驶船扫描属性影响，默认 ≈10s）；
 * - D(T) = 击杀秒数刻度（balance.battle.foeHpCurve*：5s→90s，指数 1.6，与 foeHpOfThreat 同源）；
 * - 返航起点按"母港出发"算（真实玩家多在母港整备）。
 *
 * 用法：npm run faction:audit
 */
import { ANOMALIES_FLAVORED, GALAXIES, buildSimContext } from '@whale/data'
import {
  DEFAULT_BALANCE,
  FACTION_RARE_DROP_CHANCE,
  HOME_GALAXY_ID,
  bountyCooldownMsFor,
  createInitialState,
  factionPoolOf,
  hasLairCore,
  markExplored,
  shortestTravelMinutes,
  travelLegMs,
  travelMinutesEff,
} from '@whale/core'

const ctx = buildSimContext()
const state = createInitialState({ nowWallMs: 0, seed: 1 })
const gName = new Map(GALAXIES.map((g) => [g.id, g.name]))
const gSec = new Map(GALAXIES.map((g) => [g.id, g.security ?? 0.5]))
const bal = DEFAULT_BALANCE.battle

/** 击杀秒数刻度 D(T)：与 combat.foeHpOfThreat 同源（威胁 → 参考火力下的击杀秒数） */
function killSeconds(threat: number): number {
  const t = Math.min(1, Math.max(0, (threat - bal.foeHpCurveFloorThreat) / bal.foeHpCurveSpanThreat))
  return bal.foeHpCurveDMin + bal.foeHpCurveDSpan * Math.pow(t, bal.foeHpCurveExp)
}

interface Row {
  galaxy: string
  zone: string
  card: string
  threat: number
  killS: number
  backS: number
  cdS: number
  tripS: number
  perHour: number
}

const rows: Row[] = []
for (const a of ANOMALIES_FLAVORED) {
  if (!hasLairCore(a) || !(a.rewardIsk > 0)) continue
  const sec = gSec.get(a.galaxyId) ?? 0.5
  if (sec >= 0.5) continue // 高安不派发派系活跃
  const home = a.galaxyId === HOME_GALAXY_ID
  const mins = shortestTravelMinutes(ctx, HOME_GALAXY_ID, a.galaxyId)
  const backS = home ? 120 : Number.isFinite(mins) ? travelLegMs(state, ctx, travelMinutesEff(state, ctx, mins) * 2) / 1000 : NaN
  const cdS = bountyCooldownMsFor(state, ctx) / 1000
  const killS = killSeconds(a.threat)
  const tripS = killS + backS + cdS
  rows.push({
    galaxy: gName.get(a.galaxyId) ?? a.galaxyId,
    zone: sec < 0 ? '低安' : '中安',
    card: a.name,
    threat: a.threat,
    killS: Math.round(killS),
    backS: Math.round(backS),
    cdS: Math.round(cdS),
    tripS: Math.round(tripS),
    perHour: 3600 / tripS,
  })
}

rows.sort((x, y) => x.tripS - y.tripS)
console.log('星系\t分区\t悬赏\t威胁\t交火秒\t返航秒\t冷却秒\t每趟秒\t趟/小时\t趟/4h\t趟/8h')
for (const r of rows) {
  console.log(
    `${r.galaxy}\t${r.zone}\t${r.card}\t${r.threat}\t${r.killS}\t${r.backS}\t${r.cdS}\t${r.tripS}\t` +
      `${r.perHour.toFixed(1)}\t${((4 * 3600) / r.tripS).toFixed(1)}\t${((8 * 3600) / r.tripS).toFixed(1)}`,
  )
}

const n = Math.max(1, rows.length)
const avgPerHour = rows.reduce((s, r) => s + r.perHour, 0) / n
const avg4h = rows.reduce((s, r) => s + (4 * 3600) / r.tripS, 0) / n
console.log(
  `\n均值：${avgPerHour.toFixed(1)} 趟/时 → 4 小时 ≈${avg4h.toFixed(1)} 趟、8 小时 ≈${((avg4h / 4) * 8).toFixed(1)} 趟` +
    `（最快 ${rows[0]?.perHour.toFixed(1)} / 最慢 ${rows[rows.length - 1]?.perHour.toFixed(1)} 趟/时）`,
)
console.log(`\n对照：当日 5 席常规赏金若全清 = 档位件数（外围 1 / 核心 2 / 深层 3 各按抽到的档位）→ 约 8~11 件/天`)
console.log(`当前值 FACTION_RARE_DROP_CHANCE = ${Math.round(FACTION_RARE_DROP_CHANCE * 100)}%（船长 2026-09-10 核定）`)
for (const p of [0.05, 0.1, 0.15, 0.2, 0.3, 0.4]) {
  const mark = Math.abs(p - FACTION_RARE_DROP_CHANCE) < 1e-9 ? ' ← 当前' : ''
  console.log(
    `  P=${String(Math.round(p * 100)).padStart(2)}% → 期望日产出：4h 刷 ≈${(avg4h * p).toFixed(1)} 件 · ` +
      `2h 刷 ≈${((avg4h / 2) * p).toFixed(1)} 件 · 1h 刷 ≈${((avg4h / 4) * p).toFixed(1)} 件${mark}`,
  )
}

/* ── 候选池盘点（2026-09-10 船长定：已建成副站的星系排除出抽取范围） ── */
// 口径 = 全图已探索（与本工具其余小节同法：审计看"最终形态"，不按新档的未探索状态算）
for (const g of ctx.galaxies.values()) markExplored(state, g.id)
const pool = factionPoolOf(state, ctx)
const siteGalaxies = new Set([...ctx.stations.values()].map((s) => s.galaxyId))
console.log(`\n候选池：${pool.length} 个中安/低安星系（已探索口径、每星系一席）`)
console.log(`  其中有建站点的星系 **${pool.filter((a) => siteGalaxies.has(a.galaxyId)).length}** 个：`)
for (const s of ctx.stations.values()) {
  const inPool = pool.some((a) => a.galaxyId === s.galaxyId)
  console.log(
    `    · ${gName.get(s.galaxyId) ?? s.galaxyId} → ${s.name}（${s.tiers.length} 档）` +
      `${inPool ? '〔**建成后即被排除**；本工具按"全未建成"的新档口径统计，故仍在池内〕' : '〔不在候选池〕'}`,
  )
}
console.log('  口径 = **已建成**（stage ≥ 档位数）才排除；在建/未开工的工地仍可当选；抽取只在日板刷新时发生 ⇒ 次日起生效。')
console.log('  候选全被排除时：当日不发派系活跃（`spawnFactionActivity` 里 pool 空即 return）。')
