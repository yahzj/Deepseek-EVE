/**
 * **周末入侵 · 单场推进量的影响读数**（正式工具 · **2026-10-01 入库**）。
 *
 * 用途：改 `WEEKEND_GAIN_PERIPHERY_WIN`（或核心/击退那几档）**之前**，先算清"改了会怎样"——
 * 回答三类问题：
 * ① 集中打一处外围，**夺回需要几场、耗时多久**；
 * ② 夺回那一刻玩家的**投入比例**（台账 `contributed`）是多少；
 * ③ 结算时刻的**清缴占比**与**贡献奖档位**会怎么变。
 *
 * **为什么需要它**（2026-10-01 那批的来路）：外围推进量 10% → 5% 看着只是"场次翻倍"，
 * 但奖励比例是按 `contributed` 缩水的（2026-09-29 船长令乙案），而 **NPC 铺底那 48 小时窗口一秒没变**
 * ⇒ 玩家多花一倍时间才打得满，就必然被铺底抢走更大一份。**这个连带改前看不出来**
 * （roadmap 当时只记了"每场收入减半"）⇒ 本工具就是把它**现算出来**；
 * 读数只在运行输出里、**不写死在注释**（约定 §十五之二之5）。
 *
 * 模型（数一律从生产代码现取，不另抄一份）：
 * - 进度 = `clamp01(NPC 铺底 t/48h ＋ 台账 contributed)`（`weekendPeripheryProgressAt` 同款算式）；
 * - 玩家自 T0 起**集中打同一处**、单场周期固定；
 * - 进度满 100% ⇒ 夺回 ⇒ 该星系**照旧能打**（`weekendZoneLiveAt` 仍为真；**2026-10-02 船长令**：
 *   「我希望的是 100% 后能够继续刷，但是掉落残骸数量需要减半作为惩罚」），但 `contributed` 被
 *   `clamp01` 钉在 1 ⇒ **再多打也不涨进度、不再产生额外进度收入**（这正是奖励比例下滑的机制）；
 * - 夺回奖与进度收入都按那一刻的 `contributed` 算（`weekendReclaimAwardOf` 同款）。
 *
 * 用法：`npm run weekend:gain`
 * - `--was=10`        加一列对比基准（旧的每场推进量，写**百分点**；不给就只出当前值）
 * - `--cycle=0.5,2`   单场周期档（小时；默认 `0.25,0.5,1,2,4`）
 * - `--sites=4`       占领区总数（核心 ＋ 外围；默认 4，只用于算清缴占比）
 *
 * 输出：六段读数（场次/投入比例 · 夺回奖与进度收入 · 每场收入 · 打满一处的总收入 ·
 * 清缴占比与贡献奖档位 · 遇袭概率表）。
 * **只读**：不读存档、不写盘，全部为合成参数在内存里推。
 *
 * **版本自检**：游戏版本 v0.1.0 · 存档结构 v31（`CURRENT_STATE_VERSION`）· 最后核对 2026-10-01 · 最后跑过 2026-10-01
 */
import {
  WEEKEND_CONTRIBUTION_BOSS_WEIGHT,
  WEEKEND_GAIN_CORE_WIN,
  WEEKEND_GAIN_OFFLINE_REPEL,
  WEEKEND_GAIN_PERIPHERY_WIN,
  WEEKEND_GAIN_REPEL,
  WEEKEND_NPC_PERIPHERY_MS,
  WEEKEND_PROGRESS_ISK_PER_PCT,
  weekendContributionTier,
} from '../packages/core/src/weekendEvent'
import {
  WEEKEND_ALL_CLEAR_ISK,
  WEEKEND_RECLAIM_ISK,
  weekendReclaimAwardOf,
} from '../packages/core/src/weekendBattle'
import type { WeekendEventState } from '../packages/core/src/weekendEvent'

const H = 3_600_000
/** NPC 铺底速率（百分点/时）—— 48 小时铺满，纯时间函数 */
const NPC_PCT_PER_H = 100 / (WEEKEND_NPC_PERIPHERY_MS / H)

/** 千分位（不依赖 locale，避免把语言焊死） */
const fmt = (n: number): string => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
const pct = (v: number): string => `${(v * 100).toFixed(1)}%`

/** 取 `--名字=a,b,c` 这类数字列表参数 */
function numList(name: string, dflt: number[]): number[] {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  if (hit === undefined) return dflt
  const out = hit
    .slice(name.length + 3)
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0)
  return out.length > 0 ? out : dflt
}

/** 取 `--名字=N` 这类单值参数；没给返回 null */
function numOne(name: string): number | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  if (hit === undefined) return null
  const n = Number(hit.slice(name.length + 3).trim())
  return Number.isFinite(n) && n > 0 ? n : null
}

const CYCLES = numList('cycle', [0.25, 0.5, 1, 2, 4])
/** 对比基准（百分点）；null = 只出当前值这一列 */
const WAS = numOne('was')
const SITES = numOne('sites') ?? 4

/**
 * 玩家从 T0 起**集中打同一处外围**、单场周期 `cycleH` 小时，一场一场推下去。
 * 返回夺回那一刻的：场次 · 耗时 · 该处的玩家投入比例。
 */
function sim(gainPct: number, cycleH: number): { n: number; hours: number; put: number } {
  const g = gainPct / 100
  let put = 0
  for (let n = 1; n <= 2000; n++) {
    put = Math.min(1, put + g)
    const npc = Math.min(1, (n * cycleH) / (WEEKEND_NPC_PERIPHERY_MS / H))
    if (npc + put >= 1) return { n, hours: n * cycleH, put }
  }
  return { n: 2000, hours: 2000 * cycleH, put }
}

/** 造一份最小事件态，让夺回奖走生产代码那个单点（不另抄公式） */
function evWith(put: number): WeekendEventState {
  return {
    seq: 1,
    startedAtWallMs: 0,
    coreId: 'core',
    peripheryIds: ['p1'],
    family: 'H',
    contributed: put > 0 ? { p1: put } : {},
  } as WeekendEventState
}

const col = (r: { n: number; hours: number; put: number }): string =>
  `${String(r.n).padStart(3)} 场 · ${r.hours.toFixed(1).padStart(5)} 时 · ${pct(r.put).padStart(6)}`

const reward = (put: number): string => {
  const a = weekendReclaimAwardOf(evWith(put), 'p1')
  return `${fmt(a.isk)} / ${fmt(a.wreck)} m³ · ${fmt(put * 100 * WEEKEND_PROGRESS_ISK_PER_PCT)}`
}

console.log('══ 周末入侵 · 单场推进量的影响读数（weekend:gain）══')
console.log(
  `单点：外围每场 +${WEEKEND_GAIN_PERIPHERY_WIN * 100}% · 核心 +${WEEKEND_GAIN_CORE_WIN * 100}% · ` +
    `击退遇袭 +${WEEKEND_GAIN_REPEL * 100}% · 离线击退 +${WEEKEND_GAIN_OFFLINE_REPEL * 100}% · ` +
    `NPC 铺底 ${NPC_PCT_PER_H.toFixed(3)}%/时（${WEEKEND_NPC_PERIPHERY_MS / H}h 满）`,
)
console.log(`进度收入单价：${fmt(WEEKEND_PROGRESS_ISK_PER_PCT)} 信用点 / 每 1%`)

const head = WAS === null ? '当前值' : `对比基准 +${WAS}%`
const headCur = `当前 +${WEEKEND_GAIN_PERIPHERY_WIN * 100}%`

console.log('\n=== ① 集中打一处外围：夺回所需场次与那一刻的投入比例 ===')
console.log(`单场周期 | ${head} 场次/耗时/投入比例${WAS === null ? '' : ` | ${headCur} 场次/耗时/投入比例`}`)
for (const c of CYCLES) {
  const parts = [`${String(c).padStart(6)} 时 | ${col(sim(WAS ?? WEEKEND_GAIN_PERIPHERY_WIN * 100, c))}`]
  if (WAS !== null) parts.push(col(sim(WEEKEND_GAIN_PERIPHERY_WIN * 100, c)))
  console.log(parts.join(' | '))
}

console.log('\n=== ② 夺回奖与进度收入（都按那一刻的投入比例缩水）===')
console.log(`单场周期 | ${head} 夺回奖(信用点) / 残骸 / 进度收入${WAS === null ? '' : ` | ${headCur} 夺回奖 / 残骸 / 进度收入`}`)
for (const c of CYCLES) {
  const parts = [`${String(c).padStart(6)} 时 | ${reward(sim(WAS ?? WEEKEND_GAIN_PERIPHERY_WIN * 100, c).put)}`]
  if (WAS !== null) parts.push(reward(sim(WEEKEND_GAIN_PERIPHERY_WIN * 100, c).put))
  console.log(parts.join(' | '))
}

console.log('\n=== ③ 每场进度收入（单价不变 ⇒ 直接跟推进量走）===')
console.log(
  `外围主动胜利 +${WEEKEND_GAIN_PERIPHERY_WIN * 100}% = ${fmt(WEEKEND_GAIN_PERIPHERY_WIN * 100 * WEEKEND_PROGRESS_ISK_PER_PCT)} 信用点` +
    (WAS === null ? '' : `（基准 +${WAS}% = ${fmt(WAS * WEEKEND_PROGRESS_ISK_PER_PCT)}）`),
)
console.log(
  `核心主动胜利 +${WEEKEND_GAIN_CORE_WIN * 100}% = ${fmt(WEEKEND_GAIN_CORE_WIN * 100 * WEEKEND_PROGRESS_ISK_PER_PCT)} · ` +
    `击退遇袭 +${WEEKEND_GAIN_REPEL * 100}% = ${fmt(WEEKEND_GAIN_REPEL * 100 * WEEKEND_PROGRESS_ISK_PER_PCT)} · ` +
    `离线击退 +${WEEKEND_GAIN_OFFLINE_REPEL * 100}% = ${fmt(WEEKEND_GAIN_OFFLINE_REPEL * 100 * WEEKEND_PROGRESS_ISK_PER_PCT)}`,
)

console.log('\n=== ④ 「打满一处」的总收入（按台账总量算、不按场次算）===')
console.log(
  `投入比例 = 100% ⇒ 夺回奖 ${fmt(WEEKEND_RECLAIM_ISK)} ＋ 进度收入 ${fmt(100 * WEEKEND_PROGRESS_ISK_PER_PCT)} ＝ ` +
    `${fmt(WEEKEND_RECLAIM_ISK + 100 * WEEKEND_PROGRESS_ISK_PER_PCT)} 信用点（不随单场推进量变；变的是要打几场才够）`,
)
console.log(
  `全清追加 ${fmt(WEEKEND_ALL_CLEAR_ISK)} × min(1, 玩家总投入 ÷ 占领区数)：` +
    `${SITES} 处全打满 = ${fmt(WEEKEND_ALL_CLEAR_ISK)} · 只打满 1 处 = ${fmt(WEEKEND_ALL_CLEAR_ISK / SITES)}`,
)

console.log(`\n=== ⑤ 结算时的清缴占比与贡献奖档位（占领区 ${SITES} 处；全处被铺满时 clear = 玩家总投入 ÷ ${SITES}）===`)
console.log('情形 | 玩家总投入 | clear | 占比（未打 BOSS = 0.4×clear）| 贡献奖档位')
{
  const M = SITES
  const rows: [string, number][] = [
    ['只打满 1 处 · 快节奏（0.25 时/场）', sim(WEEKEND_GAIN_PERIPHERY_WIN * 100, 0.25).put],
    ['只打满 1 处 · 慢节奏（2 时/场）', sim(WEEKEND_GAIN_PERIPHERY_WIN * 100, 2).put],
    ['处处打满', M],
  ]
  for (const [label, put] of rows) {
    const clear = Math.min(1, put / M)
    const share = Math.min(1, (1 - WEEKEND_CONTRIBUTION_BOSS_WEIGHT) * clear)
    const t = weekendContributionTier(share)
    console.log(`${label} | ${pct(put)} | ${pct(clear)} | ${pct(share)} | ${t.tier}（稀有残骸 ×${t.wreck} 件 · ${fmt(t.isk)} 信用点）`)
  }
  console.log('⚠ 真打 BOSS 时 share 还要加 BOSS 权重那一份，档位会更高；本表只算"没碰 BOSS"的下限。')
}

console.log('\n=== ⑥ 遇袭概率随进度（p = 60% × (1 − 进度)，封顶 90%）===')
console.log('进度 | 遇袭概率')
for (const p of [0, 0.25, 0.5, 0.75, 0.9, 1]) console.log(`${pct(p).padStart(6)} | ${pct(Math.min(0.9, 0.6 * (1 - p)))}`)
console.log('⇒ 推进越慢，玩家在同一星系停留时进度越低 ⇒ 遇袭越多（而击退遇袭那一档不随本值变）。')
