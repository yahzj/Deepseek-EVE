/**
 * **悬赏线敌人总表 · 整卡总血 / 整卡 DPS**（2026-09-16 船长：「重新计算统计出所有悬赏的总血量和DPS」）。
 *
 * 口径（与引擎**逐字同源**）：
 * - 每张卡按 `AnomalyDef.waves` **逐波建档**——第 0 波无前缀、第 i 波前缀 `w${i}-`
 *   （同 `advanceBattleFor.specsOf(wi)`；**这条是必须的**：不带 `waves` 覆盖建出来的只有第一波，
 *   多波卡会被严重低估——2026-09-16 就踩过这一次）；
 * - **整卡总血 / 整卡 DPS = 各波求和**（玩家实际要打完所有波才算赢，故这才是可比口径）；
 * - `DPS` = **名义值** Σ(单发 × 门数 × 1000 ÷ 装填)，**不含命中率与距离衰减**；机群（`src:'drone'`）单列；
 * - 只统计**可见的敌卡**（`hidden !== true` 且写了 `ships`）＝ 玩家在悬赏板上能接到的那些。
 *
 * 用法：
 *   `npx tsx tools/bounty-stats.ts`               全表（默认按威胁升序）
 *   `npx tsx tools/bounty-stats.ts --family=C`    只看某族
 *   `npx tsx tools/bounty-stats.ts --min=45`      只看威胁 ≥ N
 *   `npx tsx tools/bounty-stats.ts --waves`       逐波明细（多波卡）
 *
 * **版本自检**
 * - 游戏版本：**v25**（`CURRENT_STATE_VERSION` · 本工具只读目录与敌卡，不碰存档）
 * - 本工具最后核对：**2026-09-16**（首版：23 张可见悬赏卡 · 逐波求和 · 合计总血 36,774 / DPS 920+293）
 * - 本工具最后跑过：**2026-09-16**
 */
import { buildSimContext } from '@whale/data'
import type { AnomalyDef } from '@whale/core'
import { createFoeSpecs } from '@whale/core'
// ⚠ `foeHpOfThreat` 只在 core 源里导出、不在 `@whale/core` 的公开面（本条只是读数对照用）
import { foeHpOfThreat } from '../packages/core/src/combat'

const ctx = buildSimContext()
const bal = ctx.balance.battle

const arg = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const FAMILY = arg('family')
const MIN = Number(arg('min') ?? '0')
const PER_WAVE = process.argv.includes('--waves')

interface WaveStat {
  wi: number
  units: number
  names: string[]
  hp: number
  dps: number
  drone: number
}

/** 逐波建档（**与 `advanceBattleFor.specsOf(wi)` 同源**），再求和 */
function wavesOf(a: AnomalyDef): WaveStat[] {
  const waves = a.waves && a.waves.length > 0 ? a.waves : null
  const n = waves ? waves.length : 1
  const out: WaveStat[] = []
  for (let wi = 0; wi < n; wi++) {
    const specs = waves
      ? createFoeSpecs(a, bal, {
          units: waves[wi]!.units,
          hpShare: waves[wi]!.hpShare,
          tagPrefix: wi === 0 ? '' : `w${wi}-`,
        })
      : createFoeSpecs(a, bal)
    let hp = 0
    let dps = 0
    let drone = 0
    for (const f of specs) {
      hp += f.hp.s + f.hp.a + f.hp.h
      for (const w of f.weapons) {
        const d = ((w.shotDmg ?? 0) * (w.count ?? 1) * 1000) / Math.max(1, w.reloadMs)
        if (w.src === 'drone') drone += d
        else dps += d
      }
    }
    out.push({ wi, units: specs.length, names: specs.map((f) => f.name), hp, dps, drone })
  }
  return out
}

interface Row {
  a: AnomalyDef
  waves: WaveStat[]
  hp: number
  dps: number
  drone: number
}

const rows: Row[] = []
for (const a of ctx.anomalies.values()) {
  if (a.hidden === true || (a.ships ?? []).length === 0) continue
  if (FAMILY !== undefined && (a.foeFamily ?? '?') !== FAMILY) continue
  if (a.threat < MIN) continue
  const waves = wavesOf(a)
  rows.push({
    a,
    waves,
    hp: waves.reduce((s, w) => s + w.hp, 0),
    dps: waves.reduce((s, w) => s + w.dps, 0),
    drone: waves.reduce((s, w) => s + w.drone, 0),
  })
}
rows.sort((x, y) => x.a.threat - y.a.threat)

const n = (v: number): string => Math.round(v).toLocaleString('zh-CN')
console.log('威胁　族　卡名　　　　　　　　　波数　整卡总血　　整卡DPS　血/威胁　DPS/威胁　曲线倍数')
for (const r of rows) {
  const curve = foeHpOfThreat(r.a.threat, bal)
  console.log(
    `${String(r.a.threat).padStart(3)}　${r.a.foeFamily ?? '?'}　${(r.a.name ?? r.a.id).padEnd(12, '　')}　` +
      `${String(r.waves.length).padStart(2)}　${n(r.hp).padStart(8)}　` +
      `${(r.dps.toFixed(0) + (r.drone > 0 ? `+${r.drone.toFixed(0)}` : '')).padStart(6)}　` +
      `${(r.hp / r.a.threat).toFixed(1).padStart(6)}　${(r.dps / r.a.threat).toFixed(2).padStart(6)}　` +
      `${(r.hp / curve).toFixed(2).padStart(6)}`,
  )
}

const sumHp = rows.reduce((s, r) => s + r.hp, 0)
const sumDps = rows.reduce((s, r) => s + r.dps, 0)
const sumDrone = rows.reduce((s, r) => s + r.drone, 0)
console.log(
  `\n共 ${rows.length} 张卡 · 合计总血 ${n(sumHp)} · 合计 DPS ${sumDps.toFixed(0)}` +
    (sumDrone > 0 ? `（＋机群 ${sumDrone.toFixed(0)}）` : ''),
)

if (PER_WAVE) {
  console.log('\n逐波明细：')
  for (const r of rows) {
    if (r.waves.length <= 1) continue
    const per = r.waves
      .map(
        (w) =>
          `第 ${w.wi + 1} 波 ${w.units} 只 · 血 ${n(w.hp)} · DPS ${w.dps.toFixed(0)}` +
          (w.drone > 0 ? ` +机群 ${w.drone.toFixed(0)}` : '') +
          `（${[...new Set(w.names)].join('/')}）`,
      )
      .join('\n     ')
    console.log(`  【${r.a.name}】威胁 ${r.a.threat} · ${r.waves.length} 波 · 整卡血 ${n(r.hp)} · 整卡 DPS ${r.dps.toFixed(0)}\n     ${per}`)
  }
}
