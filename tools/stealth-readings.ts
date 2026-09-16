/**
 * **隐秘行动装置 · 装 / 不装对照读数**（2026-09-15 船长 Q5 丙 = "先落码 + 交对照读数，看过读数
 * 再定要不要加代价"）。
 *
 * 口径（与 `winEstimate` 的玩家可见预估同一套：**真引擎实战**）：
 * - 船 = 大白鲨级炮舰（CPU 225 · 高槽 5 · 中 3 · 低 2）；技能 = **全 L3**（仓库标准的中位档）；
 *   弹药管够；每格 **40 种子**（`SEED_BASE` + i×1013904223）取平均。
 * - **表 1 · 机制净效果**：同一套装配里把第 5 门炮换成装置（4 炮 vs 4 炮 + 装置）——隔离出装置本身
 *   （CPU 会超船体，仅用于隔离机制，不代表可装配）。
 * - **表 2 · CPU 合法的真实取舍**：满火力 4 门（208）vs 2 门 + 装置（MK2 = 179 / MK3 = 224）
 *   —— 回答"极度吃 CPU 拿走了什么"。
 *
 * 读数落 `tools/_ui-artifacts/stealth-readings.log`（gitignore 区，便于随时看尾）。
 * 用量：`npm run battle:stealth-readings`
 *
 * 版本自检：
 *   - 游戏版本：记录 **v25**（读 `CURRENT_STATE_VERSION` 不参与本工具，表内只有战斗口径）
 *   - 本工具最后核对：**2026-09-16**（首版：六卡 × 两表 × 40 种子；灰霾卡净效果 40%→65%、
 *     合法装下 MK3 45% vs 满火力 40%，与用例口径一致）
 *   - 本工具最后跑过：**2026-09-16**
 */
import { addShipToFleet, createInitialState, type GameState, type SimContext } from '@whale/core'
import { ANOMALIES, buildSimContext } from '@whale/data'
import { advanceBattleFor, startBattleFor, waveGapTotalMs } from '../packages/core/src/combat'

const SHIP = 'sh-whiteshark'
const CARDS = [
  'ano-training', // 演习场驱逐令（软卡 · 对照）
  'ano-pirate-post', // 边境海盗前哨（软卡 · 对照）
  'ano-shard-bandits', // 碎晶带劫匪通缉（软卡 · 对照）
  'ano-haze-ambush', // 灰霾伏击团清剿令（kite 长战卡 · 装置的主场）
  'ano-maw-hunt', // 噬口猎杀令（硬卡）
  'ano-vault-sentinel', // 穹顶守卫（硬卡）
]
const GUN = 'mod-turret-kin-3'
/** 全技能 L3（与 battle-calibrate 的 MID_SKILLS 同口径；此处逐字列出以免工具间互相 import） */
const SKILL_IDS = [
  'gunnery', 'kinetic-gunnery', 'missile-launching', 'laser-cannon', 'fire-control', 'reload-drills',
  'drone-warfare', 'drone-servicing', 'ammunition-condensing', 'shield-operation', 'energy-management',
  'hull-upgrades', 'shield-tuning', 'armor-tuning', 'armed-ops', 'armored-ops', 'vector-maneuvering',
  'evasion-maneuvering', 'targeting-integration', 'ship-systems-engineering',
]
const SKILLS: Record<string, number> = Object.fromEntries(SKILL_IDS.map((k) => [k, 3]))

type Fit = { key: string; high: readonly string[]; cpu: string }
const TABLE1: readonly Fit[] = [
  { key: '4×炮台（对照）', high: [GUN, GUN, GUN, GUN], cpu: '208（可装配）' },
  { key: '4×炮台 + 隐秘MK2', high: [GUN, GUN, GUN, GUN, 'mod-stealth-2'], cpu: '283（超船体·仅隔离机制）' },
  { key: '4×炮台 + 隐秘MK3', high: [GUN, GUN, GUN, GUN, 'mod-stealth-3'], cpu: '328（超船体·仅隔离机制）' },
]
const TABLE2: readonly Fit[] = [
  { key: '满火力 4×炮台（无装置）', high: [GUN, GUN, GUN, GUN], cpu: '208/225' },
  { key: '2×炮台 + 隐秘MK2（20 秒）', high: [GUN, GUN, 'mod-stealth-2'], cpu: '179/225' },
  { key: '2×炮台 + 隐秘MK3（30 秒）', high: [GUN, GUN, 'mod-stealth-3'], cpu: '224/225' },
]
const RUNS = 40
const SEED_BASE = 20260915
const ctx: SimContext = buildSimContext()

type Row = { win: number; sec: number; armorLeft: number; hullLeft: number; foeShots: number }

function measure(fit: Fit, anomalyId: string): Row {
  const state: GameState = createInitialState({ nowWallMs: 0, seed: 1 })
  const uid = addShipToFleet(state, SHIP)
  state.shipId = uid
  state.fleet[uid]!.fitted = { high: [...fit.high], mid: [], low: [] }
  for (const [id, lv] of Object.entries(SKILLS)) state.skills.trained[id] = lv
  const anomaly = ANOMALIES.find((a) => a.id === anomalyId)!
  let wins = 0
  let sec = 0
  let armorLeft = 0
  let hullLeft = 0
  let foeShots = 0
  for (let i = 0; i < RUNS; i++) {
    state.rng = { seed: (SEED_BASE + i * 1013904223) >>> 0, count: 0 }
    state.fleet[uid]!.cargo['ammo-kinetic-l'] = 1_000_000
    state.gameMs = 0
    const b = startBattleFor(state, ctx, uid, anomalyId, 0)
    if (!b) continue
    const pl0 = b.units['player']!
    const a0 = pl0.hp.a
    const h0 = pl0.hp.h
    state.gameMs = ctx.balance.battle.maxBattleMs + 5_000 + waveGapTotalMs(anomaly, ctx.balance.battle)
    advanceBattleFor(state, ctx, b, uid, anomalyId)
    const pl = b.units['player']!
    if (b.ended === 'me') wins += 1
    sec += Math.min(ctx.balance.battle.maxBattleMs, Math.max(0, b.lastTickGameMs - b.startedAtGameMs)) / 1000
    armorLeft += a0 > 0 ? Math.min(1, Math.max(0, pl.hp.a / a0)) : 0
    hullLeft += h0 > 0 ? Math.min(1, Math.max(0, pl.hp.h / h0)) : 0
    foeShots += b.stats.foeShots
  }
  return { win: wins / RUNS, sec: sec / RUNS, armorLeft: armorLeft / RUNS, hullLeft: hullLeft / RUNS, foeShots: foeShots / RUNS }
}

const pct = (v: number): string => `${Math.round(v * 100)}%`
const lines: string[] = []
lines.push(`隐秘行动装置 · 装/不装对照（${SHIP} · 全技能 L3 · ${RUNS} 种子/格 · 真引擎实战 · 弹药管够）`)
lines.push('')
for (const [title, table] of [
  ['表 1 · 机制净效果（只差装置，CPU 不设限）', TABLE1],
  ['表 2 · CPU 合法装（真实的火力取舍）', TABLE2],
] as const) {
  lines.push(`—— ${title} ——`)
  lines.push(
    `${'卡'.padEnd(20)}${'装配'.padEnd(26)}${'CPU'.padEnd(26)}${'胜率'.padEnd(7)}${'时长'.padEnd(9)}${'甲残'.padEnd(7)}${'壳残'.padEnd(7)}敌开火`,
  )
  for (const card of CARDS) {
    const name = ANOMALIES.find((a) => a.id === card)?.name ?? card
    for (const fit of table) {
      const r = measure(fit, card)
      lines.push(
        `${name.padEnd(20)}${fit.key.padEnd(26)}${fit.cpu.padEnd(26)}${pct(r.win).padEnd(7)}${(r.sec.toFixed(1) + ' 秒').padEnd(9)}${pct(r.armorLeft).padEnd(7)}${pct(r.hullLeft).padEnd(7)}${r.foeShots.toFixed(1)}`,
      )
    }
    lines.push('')
  }
}
const text = lines.join('\n')
console.log(text)
const fs = require('node:fs') as typeof import('node:fs')
fs.mkdirSync('tools/_ui-artifacts', { recursive: true })
fs.writeFileSync('tools/_ui-artifacts/stealth-readings.log', text, 'utf8')
