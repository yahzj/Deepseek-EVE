/**
 * 重复清剿「停下」原因诊断（2026-09-10 玩家反馈排查用；正式入库，改判定/阈值后可复跑）。
 *
 * 背景：玩家反馈「自动重复悬赏有时会停下，但检查后战损不多，平均战斗时长 5 分钟」。
 * 本工具用真实引擎跑连打，逐场记录结构与装甲残余、组件消耗、以及**停环原因**，用于验证：
 *  - 停环判定是「装甲**或**结构任一 <50%」（battle 内结构 <50% 则自动撤退停环）；
 *  - 装甲先吃伤害 → 常见形态是「装甲 0% / 结构仍高（如 94%）」→ 玩家观感"战损不多"却停环；
 *  - 停环前的自动维修（repairWithKits target=0.6）会把货仓修理组件**整批烧光**。
 *
 * 运行：npx tsx tools/loop-stop-check.ts（内置场景：中配灰鲭鲨 / 顶配牛鲨 × 高威胁多波卡 × 组件量档）
 */
import {
  createInitialState,
  advanceGame,
  addShipToFleet,
  setAutoLoopBounty,
  advanceAutoLoopBounty,
  markExplored,
  DSI_FACTION_ID,
} from '@whale/core'
import { buildSimContext } from '@whale/data'

const ctx = buildSimContext()
const MAX_MS = 8 * 3_600_000

/** 配置档：S1 弱档虎鲨（无技能，长盘磨血）/ S2 中配灰鲭鲨（玩家现实档）/ T3 顶配牛鲨（对照） */
const BUILDS = {
  s1: {
    ship: 'sh-tigershark',
    high: ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2'],
    mid: ['mod-prop-1'],
    low: [],
    skillLv: 0,
  },
  s2: {
    ship: 'sh-mako',
    high: ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2'],
    mid: ['mod-shield-kin-2', 'mod-track-2', 'mod-gyro-2'],
    low: ['mod-stab-kin-2', 'mod-armor-kin-2'],
    skillLv: 3,
  },
  bull: {
    ship: 'sh-bullshark',
    high: ['mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3'],
    mid: ['mod-shield-kin-2', 'mod-shield-ext-2', 'mod-track-2', 'mod-gyro-2'],
    low: ['mod-stab-kin-2', 'mod-armor-kin-2', 'mod-armor-plate-2', 'mod-rof-2'],
    skillLv: 5,
  },
} as const

const SKILL_IDS = [
  'gunnery',
  'kinetic-gunnery',
  'fire-control',
  'reload-drills',
  'shield-operation',
  'hull-upgrades',
  'shield-tuning',
  'armor-tuning',
  'armed-ops',
  'vector-maneuvering',
  'ship-systems-engineering',
  'targeting-integration',
]

function makeWorld(build: 's1' | 's2' | 'bull', kits: number) {
  const b = BUILDS[build]
  const state = createInitialState({ nowWallMs: 0, seed: 20260910 })
  addShipToFleet(state, b.ship)
  state.shipId = b.ship
  state.standings[DSI_FACTION_ID] = 24
  for (const g of ctx.galaxies.keys()) markExplored(state, g)
  for (const k of SKILL_IDS) state.skills.trained[k] = b.skillLv
  const entry = state.fleet[b.ship]!
  entry.fitted = { high: [...b.high], mid: [...b.mid], low: [...b.low] }
  state.warehouse.items['ammo-kinetic-l'] = 300_000
  entry.cargo['repairkit-mil'] = kits
  return { state, shipId: b.ship }
}

function run(build: 's1' | 's2' | 'bull', anomalyId: string, kits: number): void {
  const { state, shipId } = makeWorld(build, kits)
  setAutoLoopBounty(state, ctx, anomalyId)
  let idx = 0
  let rounds = 0
  let stopReason: string | null = null
  let stopStruct = 0
  let stopArmor = 0
  let stopKits = 0
  let battleStartMs: number | null = null
  const durations: number[] = []
  const events: string[] = []
  while (state.gameMs < MAX_MS && rounds < 15) {
    advanceGame(state, 30_000, ctx)
    advanceAutoLoopBounty(state, ctx)
    const logs = state.logs.slice(idx)
    idx = state.logs.length
    for (const l of logs) {
      if (l.text.includes('抵达目标')) battleStartMs = state.gameMs
      const ended = l.text.includes('大捷') || (l.text.includes('战报') && l.text.includes('失利')) || l.text.includes('自动撤退（')
      const dur = battleStartMs !== null ? Math.round((state.gameMs - battleStartMs) / 1000) : 0
      if (ended && dur > 0) durations.push(dur)
      if (l.text.includes('大捷')) {
        rounds += 1
        const fs = state.fleet[shipId]!
        events.push(`场${rounds} 胜 · 约${dur}s · 结构 ${Math.round(fs.durability * 100)}% 装甲 ${Math.round((fs.armorPct ?? 1) * 100)}%`)
      }
      if (l.text.includes('战报') && l.text.includes('失利')) events.push(`**失利**（约${dur}s，交火文案与真战败不可区分——超时判负也走此分支）`)
      if (l.text.includes('自动撤退（')) events.push(`**自动撤退（结构损失过半）**（约${dur}s）`)
      if (l.text.includes('自动使用修理组件')) events.push(`  ↳ 自动维修：${l.text.slice(0, 72)}`)
      // 两类停环日志：stopAutoLoopReason（暂停：原因）/ 自动撤退收手（停止（本场结构损失过半…））
      if (l.text.includes('重复清剿已暂停：') || l.text.includes('重复清剿已停止（')) {
        stopReason = l.text.replace(/^.*重复清剿已/, '重复清剿已')
        const fs = state.fleet[shipId]!
        stopStruct = Math.round(fs.durability * 100)
        stopArmor = Math.round((fs.armorPct ?? 1) * 100)
        stopKits = fs.cargo['repairkit-mil'] ?? 0
      }
    }
    if (stopReason !== null) break
  }
  const def = ctx.anomalies.get(anomalyId)
  const fs = state.fleet[shipId]!
  console.log(`\n══ [${build}] ${def?.name ?? anomalyId}（威胁 ${def?.threat ?? '?'}，组件 ${kits} 枚）══`)
  for (const e of events.slice(-26)) console.log('  ' + e)
  console.log(
    `  → 停环：${stopReason ?? '（未停环，达场次/时间上限）'} · 结束值 结构 ${Math.round(fs.durability * 100)}% / 装甲 ${Math.round((fs.armorPct ?? 1) * 100)}% / 组件余 ${fs.cargo['repairkit-mil'] ?? 0} 枚 · 游戏时间 ${(state.gameMs / 3_600_000).toFixed(1)}h · 完成 ${rounds} 场${stopReason !== null ? ` · 停止时结构 ${stopStruct}% 装甲 ${stopArmor}% 组件 ${stopKits}` : ''} · 场次用时 ${durations.length > 0 ? `${Math.min(...durations)}~${Math.max(...durations)}s（中位 ${[...durations].sort((a, b) => a - b)[Math.floor(durations.length / 2)]}s）` : '—'}（战斗硬上限 600s）`,
  )
}

run('s2', 'ano-maw-hunt', 40) // 中配 vs 噬口 80（多波）
run('s2', 'ano-gravekeeper', 40) // 中配 vs 坟场 88（多波）
run('s2', 'ano-voidedge-warden', 40) // 中配 vs 虚海 88（多波 2+2+1）
run('s1', 'ano-gravekeeper', 40) // 弱档虎鲨无技能 vs 坟场 88（长盘磨血，校准 ~336s）
run('s2', 'ano-vault-sentinel', 40) // 中配 vs 穹顶 96（打不动 → 观察是否触达 600s 超时判负）
run('bull', 'ano-vault-sentinel', 40) // 顶配 vs 穹顶 96（多波 2+2+1）
run('s2', 'ano-gravekeeper', 3) // 组件极少：复现「组件耗尽停环」

/* ── 超时路径验证（把战斗硬上限压到 45s，让超时先于结构撤退触发） ── */
{
  const { state, shipId } = makeWorld('s2', 40)
  const oldMax = ctx.balance.battle.maxBattleMs
  ctx.balance.battle.maxBattleMs = 45_000
  setAutoLoopBounty(state, ctx, 'ano-vault-sentinel')
  let idx = 0
  let verdict = '（进行中/未结算）'
  const seen: string[] = []
  for (let i = 0; i < 600; i++) {
    advanceGame(state, 10_000, ctx)
    advanceAutoLoopBounty(state, ctx)
    for (const l of state.logs.slice(idx)) {
      if (l.text.includes('大捷')) verdict = '胜利（超时血比判胜）'
      if (l.text.includes('战报') && l.text.includes('失利'))
        verdict = '失利（超时血比判负；日志与真战败同文案，玩家无法区分）'
      if (l.text.includes('自动撤退（')) verdict = '自动撤退（结构<50%，早于超时）'
      if (l.text.includes('重复清剿已暂停：') || l.text.includes('重复清剿已停止（')) seen.push(l.text.slice(0, 90))
    }
    idx = state.logs.length
    if (verdict !== '（进行中/未结算）') break
  }
  ctx.balance.battle.maxBattleMs = oldMax
  const fs = state.fleet[shipId]!
  console.log(
    `\n══ 超时路径验证（maxBattleMs 压到 45s；配置 s2 vs 穹顶 96）══\n  结局：${verdict} · 结构 ${Math.round(fs.durability * 100)}% / 装甲 ${Math.round((fs.armorPct ?? 1) * 100)}% · 组件 ${fs.cargo['repairkit-mil'] ?? 0}\n  停环日志：${seen.length > 0 ? seen.join(' | ') : '（无）'}`,
  )
}

