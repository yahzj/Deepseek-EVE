/**
 * **入侵旗舰战 · 全过程真实模拟**（2026-09-26 二号 · 船长令）。
 *
 * 船长原话：「**还是有玩家触发了击杀无黑匣奖励的情况，你真实模拟一下，旗舰战全过程**」。
 *
 * 本工具用**真存档 ＋ 引擎真路径**把一场旗舰战从头跑到尾，逐步打印读数：
 *
 * ```
 * 真档读入(只读) → 摆一场入侵(核心条满·池子 150,000) → weekendFlagshipSpecOf + weekendStartFlagshipBattle
 *   → 挂进遭遇槽（与 engine.challengeWeekendFlagship 逐字同形）
 *   → 每拍：weekendTick(活动时钟) → advanceGame(内部 weekendTickBoss 章鱼削血 ＋ advanceEncounterWatch
 *            → advanceBattleFor → settleEncounterBattle → weekendApplyBattleOutcome)
 *            → weekendSettleAndGrant(结束后结算)
 *   → 读池子/结局/黑匣/仓库/日志
 * ```
 *
 * 场景：
 * - `full`     真档舰队打一场（打出多少伤害、打到第几波、母舰有没有入场）
 * - `kill`     抢到最后一下 ＋ 占比 > 50%（船长爆率表：**必爆** ⇒ 仓库必须有黑匣）
 * - `lowShare` 章鱼先削掉 85%，玩家补最后一下（占比 ≤ 50% ⇒ 表定 10%~100% 线性，**允许不爆**）
 * - `window`   打到一半活动窗口到点（**2026-09-27 起的口径：顺延到"打完 + 60 秒"** ⇒ 这一场照常结算）
 *
 * 用法：`npx tsx tools/weekend-flagship-sim.ts [场景…]`（缺省 = 全部）；`npm run weekend:sim`。
 * **只读存档、不写任何档**；随机固定种子，读数可复现。
 *
 * **版本自检**：游戏版本 v0.1.0 · 存档结构 **v31** · 最后核对 2026-09-26 · 最后跑过 2026-09-26
 */
import { readFileSync } from 'node:fs'
import { buildSimContext } from '@whale/data'
import {
  advanceGame,
  countWare,
  loadSaveFile,
  weekendBlackBoxSettledOf,
  weekendLastHitByPlayer,
  weekendSettleAndGrant,
  weekendTick,
  WEEKEND_FIRST_T0_WALL_MS,
  WEEKEND_WINDOW_MS,
} from '@whale/core'
import { weekendNoteFlagshipDamage, WEEKEND_FLAGSHIP_POOL_HP } from '../packages/core/src/weekendEvent'
import { weekendStartFlagshipBattle, weekendFlagshipBattleActive } from '../packages/core/src/weekendLaunch'
import { weekendFlagshipSpecOf } from '../packages/core/src/weekendBattle'
import type { BattleState, GameState } from '../packages/core/src/state'

const ctx = buildSimContext('zh')
const SAVE =
  process.argv.find((a) => a.endsWith('.json')) ??
  'H:\\大鲸鱼\\Deepseek-EVE\\docs\\test-saves\\save-20260926-230119.json.json'
const CORE_ID = 'galaxy-maw'
const PERIPHERY = ['galaxy-cinder', 'galaxy-chasm', 'galaxy-vault']
/** 引擎心跳节奏（真档交火中 100ms 切片；这里 250ms 兼顾速度与粒度） */
const STEP_MS = 250
const SEED = 4092153844
const BOSS_SHIP_ID = 'foe-h-ink-flagship'

interface ScenarioOpts {
  /** 活动已开了多久（毫秒）；窗口 = WEEKEND_WINDOW_MS（现 96 小时）。`startedAt` 另有下限：不得早于首场 T0 */
  startedAgoMs?: number
  /**
   * **模拟墙钟**（相对真实现在的偏移）：引擎的 `ensureWeekendEvent` 会按周排期/首场 T0 校正手上的场次，
   * 手摆的场若落在它认的窗口之外会被**整场换掉**（读数全废）⇒ 需要"把时钟拨到窗口末尾"那类场景
   * 走本字段（与调试快进同一手法：只动墙钟，不动内存里的场次）。
   */
  clockOffsetMs?: number
  /** 玩家此前已打进池子的伤害 */
  preDmg?: number
  /** 章鱼此前已削掉的血量 */
  preOctopus?: number
  maxTicks?: number
  trace?: boolean
  /** 不接战：只推进墙钟，让章鱼人把血条收走（复刻真档那一场"玩家没抢到最后一下"） */
  noBattle?: boolean
}

function baseState(): GameState {
  const { state } = loadSaveFile(readFileSync(SAVE, 'utf8'))
  state.rng = { seed: SEED, count: 0 }
  state.debugQuick = false
  state.logs = []
  return state
}

/** 摆一场入侵：核心满 ＋ 外围全清 ＋ 池子按参数预置（与真活动同一批字段） */
function armEvent(s: GameState, nowWallMs: number, o: ScenarioOpts): void {
  const firstT0 = WEEKEND_FIRST_T0_WALL_MS ?? 0
  const startedAtWallMs = Math.max(firstT0, nowWallMs - (o.startedAgoMs ?? 25 * 3_600_000))
  s.weekendEvent = {
    seq: 900,
    startedAtWallMs,
    coreId: CORE_ID,
    peripheryIds: [...PERIPHERY],
    family: 'H',
    contributed: { [CORE_ID]: 1, ...Object.fromEntries(PERIPHERY.map((g) => [g, 1])) },
    flagshipAtWallMs: startedAtWallMs,
  }
  weekendNoteFlagshipDamage(s.weekendEvent, o.preDmg ?? 0, 0) // 立池子 ＋ 记"此前各场"的伤害
  if ((o.preOctopus ?? 0) > 0) s.weekendEvent.octopusHpDone = o.preOctopus
  s.encounter = {
    active: false,
    shipId: null,
    galaxyId: null,
    name: '',
    threat: 0,
    anomalyId: null,
    origin: '',
    invitedAtGameMs: 0,
    deadlineGameMs: 0,
    battle: null,
  }
  console.log(
    `  [摆场] 场次 ${s.weekendEvent.seq} · T0 = ${new Date(startedAtWallMs).toISOString()} · 池子 ${s.weekendEvent.flagshipHpMax} · 玩家 ${s.weekendEvent.flagshipHpDone ?? 0} ＋ 章鱼 ${s.weekendEvent.octopusHpDone ?? 0}`,
  )
}

/** 开一场真旗舰战，并按 `engine.challengeWeekendFlagship` 同形挂进遭遇槽 */
function launch(s: GameState, nowWallMs: number): { ok: boolean; name?: string; squad?: string[] } {
  const spec = weekendFlagshipSpecOf(s, ctx, nowWallMs)
  if (!spec) return { ok: false }
  const battle = weekendStartFlagshipBattle(s, ctx, nowWallMs, s.weekendPrepSquad ?? [])
  if (!battle) return { ok: false }
  const ev = s.weekendEvent!
  s.encounter = {
    active: true,
    shipId: Object.keys(s.fleet)[0] ?? s.shipId,
    galaxyId: ev.coreId,
    name: spec.name,
    threat: spec.threat,
    anomalyId: spec.cardId,
    origin: '模拟',
    invitedAtGameMs: s.gameMs,
    deadlineGameMs: s.gameMs + ctx.balance.encounter.inviteWaitMs,
    battle,
  }
  return { ok: true, name: spec.name, squad: (battle.myFleet ?? []).map((f) => f.shipId) }
}

interface Reading {
  ticks: number
  poolDone: number
  octopusDone: number
  down: string
  box: string
  waves: number
  ended: string
  battle: string
  lastLogs: string[]
}

/** 每拍：活动时钟 → 引擎推进（章鱼 ＋ 遭遇战收尾） → 结束后结算 */
function run(s: GameState, nowWallMs: number, o: ScenarioOpts): Reading {
  const ev = s.weekendEvent!
  const logFrom = s.logs.length
  let ticks = 0
  let waves = 0
  let lastWave = -1
  /** 战斗对象在收尾时会被"清槽"换掉 ⇒ 自己留一份引用（收尾读数只看这一份） */
  let battle: BattleState | null = null
  for (let i = 0; i < (o.maxTicks ?? 3200); i += 1) {
    const wall = nowWallMs + i * STEP_MS
    /** 第 5 参 = 旗舰战是否在打（2026-09-27 顺延口径；判据与引擎/战斗界面同源） */
    weekendTick(s, ctx, wall, wall - STEP_MS, weekendFlagshipBattleActive(s))
    advanceGame(s, STEP_MS, ctx, { nowWallMs: wall })
    weekendSettleAndGrant(s, ctx, wall)
    ticks += 1
    const b = s.encounter.battle
    if (b) {
      battle = b
      waves = Math.max(waves, (b.waveIdx ?? 0) + 1)
    }
    /** 波次变化那一刻**逐单位**打一份花名册（认母舰全靠 `foeShipId`） */
    const waveNow = b ? (b.waveIdx ?? 0) : -1
    if (o.trace && waveNow !== lastWave) {
      lastWave = waveNow
      const roster = Object.entries(b?.units ?? {}).map(
        ([tag, u]) =>
          `${tag}${u.side === 'me' ? '(我)' : ''}:${u.foeShipId ?? u.name.slice(0, 6)} ${Math.round(u.hp.s + u.hp.a + u.hp.h)}${
            u.hpMax ? `/${Math.round(u.hpMax.s + u.hpMax.a + u.hpMax.h)}` : ''
          }`,
      )
      console.log(
        `    · ${((i * STEP_MS) / 1000).toFixed(0)}s ${waveNow >= 0 ? `进入第 ${waveNow + 1} 波` : '战斗已收尾（遭遇槽已清）'} —— ${roster.join(' | ') || '（无单位）'}`,
      )
    }
    if (ev.endedAtWallMs !== undefined && !s.encounter.active) break
  }
  return {
    ticks,
    poolDone: Math.round(s.weekendEvent?.flagshipHpDone ?? 0),
    octopusDone: Math.round(s.weekendEvent?.octopusHpDone ?? 0),
    down: s.weekendEvent?.flagshipDown ?? '（未定）',
    box: String(s.weekendEvent?.flagshipBlackBox),
    waves,
    ended: s.weekendEvent?.endedAtWallMs === undefined ? '未结束' : new Date(s.weekendEvent.endedAtWallMs).toISOString(),
    battle: battle
      ? `ended=${String(battle.ended)} 撤退=${String(battle.autoEscaped)} 原因=${battle.escapeReason ?? '—'} 我方开火 ${battle.stats.meShots} / 命中 ${battle.stats.meHits} / 总伤害 ${Math.round(battle.stats.meDmg)} · 母舰单位 ${Object.entries(battle.units)
          .filter(([, u]) => u.foeShipId === BOSS_SHIP_ID)
          .map(([tag, u]) => `${tag} ${Math.round(u.hp.s + u.hp.a + u.hp.h)}/${Math.round((u.hpMax?.s ?? 0) + (u.hpMax?.a ?? 0) + (u.hpMax?.h ?? 0))}`)
          .join(',') || '（自始至终没入场）'}`
      : '（没打成）',
    lastLogs: s.logs.slice(logFrom).map((l) => `[${l.kind}] ${l.text}${l.textId ? `（${l.textId}）` : ''}`),
  }
}

function report(title: string, s: GameState, r: Reading): void {
  const ev = s.weekendEvent
  const p = (ev?.flagshipHpDone ?? 0) / WEEKEND_FLAGSHIP_POOL_HP
  console.log(`\n── ${title} ──`)
  console.log(`  推进 ${r.ticks} 拍（${((r.ticks * STEP_MS) / 1000).toFixed(0)}s 真实时间）· 打到第 ${r.waves || 0} 波 · 结束=${r.ended}`)
  console.log(`  收尾时手上的场次 = 第 ${ev?.seq ?? '—'} 场（换场 = 读数串场，须警惕）`)
  console.log(
    `  池子：玩家 ${r.poolDone}（p=${(p * 100).toFixed(2)}%）＋ 章鱼 ${r.octopusDone} = ${r.poolDone + r.octopusDone} / ${ev?.flagshipHpMax ?? '—'}`,
  )
  console.log(
    `  结局 flagshipDown=${r.down} · flagshipBlackBox=${r.box} · 击杀判据=${weekendLastHitByPlayer(ev)} · 已结清=${weekendBlackBoxSettledOf(ev)}`,
  )
  console.log(
    `  仓库黑匣 ×${countWare(s, 'blackbox-h')} · 战果快照 ${s.weekendLastResult ? `blackBox=${s.weekendLastResult.blackBox} outcome=${s.weekendLastResult.flagshipOutcome}` : '（无）'}`,
  )
  const logs = r.lastLogs.filter((t) => /旗舰|黑匣|入侵|结算|夺回/.test(t))
  console.log(`  本次相关日志 ${logs.length} 条：`)
  for (const l of logs.slice(-8)) console.log(`    ${l.slice(0, 170)}`)
}

/* ───────────── 场景 ───────────── */

function scenario(name: string, title: string, o: ScenarioOpts): Reading {
  const now = Date.now() + (o.clockOffsetMs ?? 0)
  const s = baseState()
  armEvent(s, now, o)
  const L = o.noBattle === true ? { ok: true, name: '（不接战）', squad: [] } : launch(s, now)
  console.log(`\n════ 场景 ${name} ════`)
  console.log(`  ${title}`)
  console.log(`  真档：${SAVE}`)
  console.log(`  模拟墙钟 ${new Date(now).toISOString()} · 玩家既有伤害 ${o.preDmg ?? 0} · 章鱼已削 ${o.preOctopus ?? 0}`)
  console.log(`  开战：${L.ok ? `${o.noBattle === true ? '不接战' : '成功'} · ${L.name} · 编队 ${JSON.stringify(L.squad)}` : '失败（核心条/池子条件不满足）'}`)
  if (!L.ok) {
    return { ticks: 0, poolDone: 0, octopusDone: 0, down: '—', box: '—', waves: 0, ended: '—', battle: '—', lastLogs: [] }
  }
  const r = run(s, now, o)
  report(title, s, r)
  console.log(`  战斗读数：${r.battle}`)
  return r
}

/* ───────────── 入口 ───────────── */
const known = new Set(['full', 'kill', 'lowShare', 'octopus', 'window'])
const argv = process.argv.slice(2).filter((a) => !a.startsWith('--') && !a.endsWith('.json'))
const list = argv.length > 0 ? argv : ['full', 'kill', 'lowShare', 'octopus', 'window']
for (const bad of list) {
  if (!known.has(bad)) {
    console.error(`未知场景：${bad}（可选：${[...known].join(' / ')}）`)
    process.exit(1)
  }
}

/** 先跑一次 `full` 量出"真档舰队一场能打多少"（同种子可复现），再按它摆 kill 的预置值 */
const full = scenario('full', '真档舰队满编打一场：能打多少伤害 / 打到第几波 / 母舰有没有入场', {
  trace: true,
  maxTicks: 3200,
})
const dmgHint = Math.max(1, full.poolDone)

for (const name of list) {
  if (name === 'full') continue
  if (name === 'kill') {
    scenario(
      'kill',
      `抢最后一下 ＋ 占比 > 50%（船长爆率表：**必爆** ⇒ 仓库必须有黑匣）——预置玩家伤害 ${WEEKEND_FLAGSHIP_POOL_HP - dmgHint}`,
      { preDmg: Math.max(1, WEEKEND_FLAGSHIP_POOL_HP - dmgHint), trace: true },
    )
  }
  if (name === 'lowShare') {
    scenario('lowShare', '章鱼先削掉 85%，玩家补最后一下（占比 ≤ 50% ⇒ 表定 10%~100%，**允许不爆**）', {
      preDmg: 15_000,
      preOctopus: 127_500,
      trace: true,
    })
  }
  if (name === 'octopus') {
    /** 真档那一场的复刻：玩家已打出 97.75%，血条只剩 2.25% 被章鱼收走（不接战） */
    scenario('octopus', '章鱼收尾（玩家没抢到最后一下）：p = 97.75% ⇒ 按表 `25% × p` 只掷一次', {
      preDmg: 146_625,
      preOctopus: 3_375,
      noBattle: true,
      maxTicks: 200,
    })
  }
  if (name === 'window') {
    /**
     * 打到一半活动窗口到点（把墙钟拨到 T0+窗口末尾前 20 秒）。
     * ⚠ **2026-09-27 船长令后的预期**：还有没打完的旗舰战 ⇒ `weekendTick` ④ **不顺延就不结束**
     * ——本场入侵顺延到"战斗打完 + 60 秒"才按窗口到点收场，那一场的伤害/判沉/掉落**照常落账**
     * （改动前是"整场白打"：母舰血条打到 0 也不记）。
     */
    const firstT0 = WEEKEND_FIRST_T0_WALL_MS ?? 0
    scenario('window', '打到一半活动窗口到点（顺延到"打完 + 60 秒" ⇒ 这一场照常结算）', {
      startedAgoMs: WEEKEND_WINDOW_MS - 20_000,
      clockOffsetMs: firstT0 + WEEKEND_WINDOW_MS - 20_000 - Date.now(),
      trace: true,
    })
  }
}
