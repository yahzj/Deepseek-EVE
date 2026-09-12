/**
 * **星图航行 / 长途运输 换算矩阵**（正式工具；2026-09-12「删除下限」批配套）。
 *
 * 把「船跃迁速度 × 航行技能族 → 实际航程/运输时长/时薪」的整条链一次打出来，供改数值前后对照：
 *   航段时间 = round(标称分钟 × HAUL_LEG_TIME_MUL(15)) × 60s × travelTimeFactor
 *   travelTimeFactor = (warpRefAus 3.0 ÷ 船跃迁) × ∏(1 − 4%×航行技能) × (1 − 2%×操控学)   ← **无下限**
 *
 * 用法：
 *   npx tsx tools/travel-matrix.ts              # 4 组技能档 × 4 艘船（货舰/快运线对照）
 *   npm run travel:matrix
 *
 * 起因（船长 2026-09-12）：「为什么剑鱼级跃迁速度是皇带鱼级速度的一倍以上，但是在长途运输中时间相差不大」
 * ⇒ 实测根因 = 时间因子下限 `minFactor 0.35` **只卡快船**（航行族 3 级起飞鱼级 7.4 与剑鱼级 6.2
 * 的单程时间完全相同；满技能时 剑鱼 ÷ 皇带鱼 从 2.21× 被削到 1.41×）⇒ 船长裁定**删除下限**。
 * 本工具即当时的取证脚本（原 `_travel-probe.ts`），保留以备后续调参复核。
 */
import { buildSimContext, SHIPS } from '@whale/data'
import { createInitialState, addShipToFleet } from '@whale/core'
import type { GameState, SimContext } from '@whale/core'
import {
  shortestTravelMinutes,
  travelLegMs,
  travelMinutesEff,
  travelTimeFactor,
  warpSpeedAus,
} from '../packages/core/src/travel'
import { haulLegMinutesOf, HAUL_LEG_TIME_MUL } from '../packages/core/src/hauling'

const ctx = buildSimContext() as SimContext
const bal = ctx.balance.travel

/** 技能档：真档现值（航行族与操控学都 0）/ 中段 / 满技能 / 满技能 + 操控学 */
const SKILL_SETS: Array<{ label: string; skills: Record<string, number> }> = [
  { label: '航行族 0 · 操控学 0', skills: {} },
  { label: '航行族 3 · 操控学 0', skills: { navigation: 3, 'warp-drive-operation': 3, 'acceleration-control': 3 } },
  { label: '航行族 5 · 操控学 0', skills: { navigation: 5, 'warp-drive-operation': 5, 'acceleration-control': 5 } },
  {
    label: '航行族 5 · 操控学 5',
    skills: {
      navigation: 5,
      'warp-drive-operation': 5,
      'acceleration-control': 5,
      'spaceship-command': 5,
    },
  },
]

/** 四条对照线：两艘货舰（慢而大 / 快而中）+ 快运舰 + 重载货舰 */
const SHIP_IDS = ['sh-colossal', 'sh-swordfish', 'sh-flyingfish', 'sh-manta']

function makeState(skills: Record<string, number>, shipId: string): { state: GameState; uid: string } {
  const state = createInitialState({ nowWallMs: 0, seed: 7 })
  const uid = addShipToFleet(state, shipId)
  state.shipId = uid
  for (const [k, v] of Object.entries(skills)) state.skills.trained[k] = v
  return { state, uid }
}

/** 最长标称航线（星系图里最远的一对星系）——"长途"的代表 */
function longestRoute(): { from: string; to: string; minutes: number } {
  const ids = new Set<string>()
  for (const e of ctx.galaxyEdges) {
    ids.add(e.from)
    ids.add(e.to)
  }
  let best = { from: '', to: '', minutes: 0 }
  for (const a of ids)
    for (const b of ids) {
      if (a === b) continue
      const m = shortestTravelMinutes(ctx, a, b)
      if (Number.isFinite(m) && m > best.minutes) best = { from: a, to: b, minutes: m }
    }
  return best
}

const route = longestRoute()
const legMinutes = haulLegMinutesOf(route.minutes)
console.log('══ 星图航行 / 长途运输 换算矩阵（真引擎）══')
console.log(
  `基准 warpRefAus=${bal.warpRefAus} · **无下限**（原 minFactor 0.35 已按船长 2026-09-12「删除下限」移除）\n` +
    `航行技能每级 −${bal.cutPerLevel * 100}%（${bal.skillIds.join(' / ')}）· 舰船操控学每级 −2%\n` +
    `长途运输航段倍率 HAUL_LEG_TIME_MUL=${HAUL_LEG_TIME_MUL}\n` +
    `最长标称航线：${route.from} → ${route.to} = **${route.minutes} 分钟** ⇒ 运输航段标称 **${legMinutes} 分钟**（×15）\n`,
)

for (const set of SKILL_SETS) {
  console.log(`── ${set.label}`)
  const rows: Array<{ name: string; warp: number; f: number; min: number; ms: number; cap: number; hourly: number }> = []
  for (const id of SHIP_IDS) {
    const def = SHIPS.find((s) => s.id === id)
    if (!def) continue
    const { state, uid } = makeState(set.skills, id)
    const ms = travelLegMs(state, ctx, legMinutes, uid)
    const cap = def.cargoM3 ?? 0
    // 时薪：单段报酬 = 货仓 × 0.6 × **标称**航程分钟（Hauling 口径，不含行情倍率）÷ 实际耗时
    const rewardPerLeg = cap * 0.6 * route.minutes
    rows.push({
      name: def.name,
      warp: warpSpeedAus(state, ctx, uid),
      f: travelTimeFactor(state, ctx, uid),
      min: travelMinutesEff(state, ctx, legMinutes, uid),
      ms,
      cap,
      hourly: rewardPerLeg / (ms / 3_600_000),
    })
  }
  for (const r of rows)
    console.log(
      `  ${r.name.padEnd(12, '　')} 跃迁 ${r.warp} AU/s（基准/它=${(bal.warpRefAus / r.warp).toFixed(3)}）` +
        ` × 技能 ⇒ 因子 **${r.f.toFixed(3)}** ⇒ 单程 **${r.min} 分钟**（${(r.ms / 3_600_000).toFixed(2)} 小时）` +
        `｜货仓 ${r.cap.toLocaleString('zh-CN')} m³ ⇒ 时薪 ≈ ${Math.round(r.hourly).toLocaleString('zh-CN')} ISK（不含行情倍率）`,
    )
  const byName = (kw: string): (typeof rows)[number] | undefined => rows.find((r) => r.name.includes(kw))
  const fast = byName('剑鱼')
  const slow = byName('皇带鱼')
  if (fast && slow)
    console.log(
      `  ⇒ **剑鱼 ÷ 皇带鱼**：时长比 **${(slow.ms / fast.ms).toFixed(2)}×**（跃迁速度比 ${(slow.warp / fast.warp).toFixed(2)}×` +
        ` ⇒ 无下限时应恒等于它）｜时薪比 ${(fast.hourly / slow.hourly).toFixed(2)}×\n`,
    )
}
