/**
 * **敌舰体火力「越线折扣」影响面读数**（正式工具 · `npm run battle:overcap`）。
 *
 * 口径（与 `tests/foe-dps-cap.test.ts` 的夹具同源，2026-09-12 深夜已复核无误）：
 * - 只算**舰体**武器（`src !== 'drone'` 一律排除；**机群不吃折扣**）；
 * - **逐波独立建档**：引擎 `foeDpsCapScaleOf` 在每次 `createFoeSpecsFromShips` 里只看得到**本波**单位
 *   ⇒ 多波卡（如噬口猎杀令，头目在第 3 波）必须按波分别算，不能拿波 0 代表全卡；
 * - 被 `droneFireShare` / `firepowerAnchor` 拆分的条目不参与（引擎内部处理，本工具直接读建档产物）；
 * - 折扣公式（2026-09-15 船长「**不是钳制到150，而是超过150的部分进行一个约15%的折扣**」）：
 *   `D > 阈值` 时 `D′ = 阈值 + (D − 阈值) × (1 − 折扣率)`，再等比例施加于全卡舰体单发（**不封顶**）。
 *
 * 输出三张表：
 * ① 基础卡（含 15 张洞内敌卡原值）单波舰体 DPS；
 * ② 窝点派生档（`lairAnomalyOf` ×1.3/1.6/2.0）未折扣 → 折扣后；
 * ③ 虫洞派生（`wormholeDerivedAnomaly` · node/boss · waves=1 最坏情形 · 层 1~12）各卡档位解锁层之后的
 *   最小/峰值、首个越线层与**峰值层折扣后**读数。
 *
 * 用法：`npm run battle:overcap`（读现行 `balance.ts` 的阈值与折扣率）
 *      `npm run battle:overcap -- --cap=160 --disc=0.2`（临时覆写两个旋钮，只影响本工具输出）
 * 读数日志按惯例可重定向到 `tools/_ui-artifacts/*.log`（gitignore 区）。
 *
 * ⚠ **版本自检**（口径同「旧读数不可靠」）：
 *   - 游戏版本 **v0.1.0**（`package.json`）· 存档结构 **v25**（`CURRENT_STATE_VERSION`）
 *   - 本工具最后核对：**2026-09-15**（当日读数：洞外 27 张基础卡**全未越线**、最高 虚海 131.3；
 *     越线 = 穹顶 L1/2/3 164.8/203.1/253.2 → **162.7/195.2/237.8** · 虚海 L1/2 170.3/210.0 →
 *     **167.3/201.0** · 噬口 L2/3 172.3/215.5 → **169.3/205.5**；虫洞峰值 node 1,234.5 → **1,071.8**、
 *     boss 1,665.8 → **1,438.5**）
 *   - 本工具最后跑过：**2026-09-15**
 *   - 判据：`CURRENT_STATE_VERSION − v25 ≥ 2` ⇒ 必须重跑核对。
 */
import { ANOMALIES, buildSimContext } from '@whale/data'
import type { AnomalyDef, BattleBalance } from '@whale/core'
import { createFoeSpecs, wormholeDerivedAnomaly } from '../packages/core/src/combat'
import { lairAnomalyOf, lairLevelOf } from '../packages/core/src/lairs'
import { WORMHOLE_TIER_UNLOCK_DEPTH, wormholeTierOfCard } from '../packages/core/src/wormholeFoes'

const ctx = buildSimContext()
/** 现行配置（基准）：阈值 + 折扣率都从 balance 读，临时覆写只走命令行 */
const live: BattleBalance = { ...ctx.balance.battle }
const argNum = (key: string, fallback: number): number => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${key}=`))
  if (!hit) return fallback
  const v = Number(hit.slice(key.length + 3))
  return Number.isFinite(v) ? v : fallback
}
const CAP = argNum('cap', live.foeDpsCap ?? 0)
const DISC = argNum('disc', live.foeDpsOverCapDiscount ?? 0)
const on: BattleBalance = { ...live, foeDpsCap: CAP, foeDpsOverCapDiscount: DISC }
const off: BattleBalance = { ...live, foeDpsCap: undefined, foeDpsOverCapDiscount: undefined }

type Spec = { weapons?: ReadonlyArray<{ shotDmg?: number; reloadMs?: number; src?: string }> }

/** 单波舰体总 DPS（`tagPrefix` 选波，与引擎逐波建档同口径） */
function waveDps(a: AnomalyDef, b: BattleBalance, wave: number): number {
  const specs = createFoeSpecs(a, b, { tagPrefix: wave === 0 ? '' : `w${wave}-` }) as unknown as Spec[]
  let d = 0
  for (const sp of specs) for (const w of sp.weapons ?? []) {
    if (w.src === 'drone' || !w.shotDmg) continue
    d += (w.shotDmg * 1000) / Math.max(1, w.reloadMs ?? 4000)
  }
  return d
}

/** 逐波建档的最大单波舰体 DPS（= 判线读数：引擎每次建档只看得见本波单位） */
function maxWaveDps(a: AnomalyDef, b: BattleBalance): number {
  let m = 0
  for (let i = 0; i < Math.max(1, a.waves?.length ?? 1); i++) m = Math.max(m, waveDps(a, b, i))
  return m
}

const f = (n: number): string => n.toFixed(1)
const pad = (s: string, w: number): string => s.padEnd(w)

console.log(
  `口径自报：阈值 foeDpsCap = ${CAP} · 折扣率 foeDpsOverCapDiscount = ${DISC}` +
    `（${DISC > 0 && CAP > 0 ? `越线只对超出部分打 ${((1 - DISC) * 100).toFixed(0)} 折，不封顶` : '⚠ 关闭态：不缩放'}）`,
)

console.log('\n══ ① 基础卡（全表 · 单波舰体 DPS · 不折扣）══')
for (const a of ANOMALIES) {
  const d = maxWaveDps(a, off)
  console.log(`${pad(a.id, 26)} ${pad(a.name, 16)} ${f(d).padStart(8)}${d > CAP && CAP > 0 ? '  ✗ 越线' : ''}`)
}

console.log('\n══ ② 窝点派生档（lairAnomalyOf · 未折扣 → 折扣后）══')
for (const a of ANOMALIES) {
  const lv = lairLevelOf(a)
  if (!lv || lv < 1) continue
  for (let t = 1; t <= lv; t++) {
    const der = lairAnomalyOf(a, t)
    const u = maxWaveDps(der, off)
    const c = maxWaveDps(der, on)
    const mark = u > CAP && CAP > 0 ? `  ✗ 越线（−${(100 * (1 - c / u)).toFixed(1)}%）` : ''
    console.log(`${pad(a.id, 26)} L${t} ${f(u).padStart(8)} → ${f(c).padStart(8)}${mark}`)
  }
}

console.log('\n══ ③ 虫洞派生（node/boss · waves=1 · 只报该档解锁层之后 · 层 1~12）══')
for (const a of ANOMALIES) {
  if (!a.id.startsWith('wh-')) continue
  const tier = wormholeTierOfCard(a.id) ?? 'shallow'
  const unlock = WORMHOLE_TIER_UNLOCK_DEPTH[tier]
  const line = (kind: 'node' | 'boss'): string => {
    let minV = Infinity
    let maxV = 0
    let maxDepth = unlock
    let firstCross = 0
    let firstCapped = 0
    for (let d = unlock; d <= 12; d++) {
      const der = wormholeDerivedAnomaly(ctx, a, { depth: d, kind, waves: 1 })
      const u = maxWaveDps(der, off)
      if (u > maxV) {
        maxV = u
        maxDepth = d
      }
      minV = Math.min(minV, u)
      if (u > CAP && CAP > 0 && firstCross === 0) {
        firstCross = d
        firstCapped = maxWaveDps(der, on)
      }
    }
    const maxCapped = maxWaveDps(wormholeDerivedAnomaly(ctx, a, { depth: maxDepth, kind, waves: 1 }), on)
    const cross =
      firstCross > 0
        ? ` ✗ 首越线 L${firstCross}（${f(maxWaveDps(wormholeDerivedAnomaly(ctx, a, { depth: firstCross, kind, waves: 1 }), off))} → ${f(firstCapped)}）`
        : CAP > 0
          ? ' 未越线'
          : ''
    const peak = firstCross > 0 ? ` · 峰值 L${maxDepth} ${f(maxV)} → ${f(maxCapped)}` : ''
    return `   ${pad(kind, 4)} 解锁层${unlock}+  min ${f(minV).padStart(8)}  max ${f(maxV).padStart(8)}${cross}${peak}`
  }
  console.log(`${pad(a.id, 26)} ${pad(a.name, 16)} ${tier}`)
  console.log(line('node'))
  console.log(line('boss'))
}
