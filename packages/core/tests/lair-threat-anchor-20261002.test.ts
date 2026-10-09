/**
 * **窝点（每日赏金任务）威胁的"相对重锚"**（**2026-10-02 船长令取「甲」**）
 *
 * 船长先问：「现在每日赏金任务的威胁还是采用旧版吗」⇒ 查明：窝点威胁 = 主题卡威胁 × `LAIR_THREAT_MUL`
 * （1.3/1.6/2.0，**2026-09-10 定的系数**）**线性**乘积，而主题卡在 **2026-09-25 按「单舰 ×3」定价式
 * 重定标**（属性零改动、只重锚标签）时没同步这套系数 ⇒ 深层窝点印出 **230**，比入侵旗舰（170）还高，
 * 实际强度却没到那儿。船长裁定取**甲**：「让窝点威胁按其**实际强度**重新定价，与入侵/常驻悬赏同尺
 * （**只改数字，战斗零变化**）」。
 *
 * 新口径（本文件钉住）：
 * - **标签 = 相对重锚**：`威胁 = 血曲线反解( 派生倍率 × 血曲线(主题卡威胁) )` —— 以主题卡自己的标签为锚
 *   ⇒ ① 每卡每档**严格高于主题卡**（绝对定价那条会有 6 张倒挂，故船长没取）；
 * - **属性一个字不动**：`scale` 仍是 `round(主题威胁 × 倍率) / 主题威胁`；
 * - **残骸线不受影响**：读 `wreckThreat ?? threat`，而候选卡全写了 `wreckThreat`（冻结值）；
 * - 船长2026-10-09授权放宽窝点威胁，取消固定旗舰余量上限，仍验证曲线最小反解。
 */
import { describe, expect, it } from 'vitest'
import { ANOMALIES_FLAVORED, buildSimContext } from '@whale/data'
import { createFoeSpecs } from '../src/combat'
import { foeHpOfThreat } from '../src/foePower'
import { LAIR_THREAT_MUL, isLairCandidate, lairAnomalyOf } from '../src/lairs'
import { wreckInjectThreatOf } from '../src/salvage'
import { weekendFoeCardOf } from '../src/weekendEvent'
import type { AnomalyDef } from '../src/types'

const ctx = buildSimContext()
const bal = ctx.balance.battle
const cards = ANOMALIES_FLAVORED.filter((a) => isLairCandidate(a))
const tiers = [1, 2, 3] as const
const hpOf = (c: AnomalyDef): number =>
  (c.ships ?? []).reduce((n, s) => n + s.ship.hp * (s.hpMul ?? 1) * Math.max(1, Math.floor(s.count ?? 1)), 0)
const powerOf = (c: AnomalyDef): number =>
  (c.ships ?? []).reduce(
    (n, s) => n + s.ship.shotDmg * (s.dmgMul ?? 1) * Math.max(1, Math.floor(s.count ?? 1)),
    0,
  )

describe('窝点威胁「相对重锚」（2026-10-02 船长令取甲）', () => {
  it('候选卡非空且都走舰级路径（重锚只对舰级路径生效；旧路径由血曲线负责、标签仍线性）', () => {
    expect(cards.length, '可作窝点的主题卡').toBeGreaterThan(10)
    for (const c of cards) expect((c.ships?.length ?? 0) > 0, `${c.name} 应是舰级路径`).toBe(true)
  })

  it('① 每卡每档：重锚后的标签**严格高于**主题卡（绝对定价那条会有 6 张倒挂，故不取）', () => {
    for (const c of cards) {
      for (const t of tiers) {
        const lair = lairAnomalyOf(c, t, bal)
        expect(lair.threat, `${c.name} 档 ${t}`).toBeGreaterThan(c.threat)
      }
      /**
       * 三档标签**单调不减**（不是"严格递增"）：血曲线是**整数台阶**，低威胁段一条台阶能跨好几档
       * ⇒ 现实中会出现"核心与深层撞在同一格"（实测 `信标猎手悬赏` 30 → 37/41/41）。
       * ⚠ 撞格只是**标签取整**，**强度仍严格递增**（由 ② 的属性倍率用例钉住）。
       */
      const [a, b, d] = tiers.map((t) => lairAnomalyOf(c, t, bal).threat)
      expect(a! <= b! && b! <= d!, `${c.name} 三档标签应单调不减（${a}/${b}/${d}）`).toBe(true)
    }
  })

  it('①b 标签满足"最小的使曲线值 ≥ 派生倍率 × 主题曲线值"那个威胁（相对锚的定义）', () => {
    for (const c of cards) {
      for (const t of tiers) {
        const need = (Math.round(c.threat * LAIR_THREAT_MUL[t]) / Math.max(1, c.threat)) * foeHpOfThreat(c.threat, bal)
        const label = lairAnomalyOf(c, t, bal).threat
        expect(foeHpOfThreat(label, bal), `${c.name} 档 ${t} 达到预算`).toBeGreaterThanOrEqual(need)
        expect(foeHpOfThreat(label - 1, bal), `${c.name} 档 ${t} 是最小的那个`).toBeLessThan(need)
      }
    }
  })

  it('② 属性零变化：血 / 火力仍 = 主题卡 × `LAIR_THREAT_MUL` 的比例（与标签无关）', () => {
    for (const c of cards) {
      for (const t of tiers) {
        const scale = Math.round(c.threat * LAIR_THREAT_MUL[t]) / Math.max(1, c.threat)
        const lair = lairAnomalyOf(c, t, bal)
        expect(hpOf(lair), `${c.name} 档 ${t} 血比`).toBeCloseTo(hpOf(c) * scale, 6)
        expect(powerOf(lair), `${c.name} 档 ${t} 火力比`).toBeCloseTo(powerOf(c) * scale, 6)
      }
    }
  })

  it('②b 战斗零变化的直接证据：把标签换回旧的线性值 ⇒ 建档（specs 血/单发/装填）逐值一致', () => {
    for (const c of cards) {
      for (const t of tiers) {
        const lair = lairAnomalyOf(c, t, bal)
        /** 旧口径的标签（线性乘积）——只改这一个字段，其余照抄 */
        const oldLinear: AnomalyDef = { ...lair, threat: Math.round(c.threat * LAIR_THREAT_MUL[t]) }
        const nowSpecs = createFoeSpecs(lair, bal)
        const oldSpecs = createFoeSpecs(oldLinear, bal)
        expect(nowSpecs.length, `${c.name} 档 ${t} 单位数`).toBe(oldSpecs.length)
        for (let i = 0; i < nowSpecs.length; i++) {
          expect(nowSpecs[i]!.hp, `${c.name} 档 ${t} 单位 ${i} 血`).toEqual(oldSpecs[i]!.hp)
          const nowW = nowSpecs[i]!.weapons.map((w) => [w.shotDmg, w.count, w.reloadMs, w.minRangeM, w.maxRangeM])
          const oldW = oldSpecs[i]!.weapons.map((w) => [w.shotDmg, w.count, w.reloadMs, w.minRangeM, w.maxRangeM])
          expect(nowW, `${c.name} 档 ${t} 单位 ${i} 武器`).toEqual(oldW)
        }
      }
    }
  })

  it('③ 残骸口径与标签无关：`wreckInjectThreatOf(派生卡) === wreckInjectThreatOf(主题卡)`', () => {
    for (const c of cards) {
      for (const t of tiers) {
        expect(wreckInjectThreatOf(lairAnomalyOf(c, t, bal)), `${c.name} 档 ${t}`).toBe(wreckInjectThreatOf(c))
      }
    }
  })

  it('④ 深层最高标签按最大曲线预算反解，不再受固定旗舰余量限制', () => {
    const flagship = ctx.anomalies.get(weekendFoeCardOf('H', 'flagship'))
    expect(flagship, 'H 族旗舰卡在场').toBeDefined()
    const maxDeep = Math.max(...cards.map((c) => lairAnomalyOf(c, 3, bal).threat))
    const maxBudget = Math.max(...cards.map(c =>
      Math.round(c.threat * LAIR_THREAT_MUL[3]) / Math.max(1, c.threat) * foeHpOfThreat(c.threat, bal),
    ))
    expect(Number.isSafeInteger(maxDeep)).toBe(true)
    expect(foeHpOfThreat(maxDeep, bal), '最高标签必须覆盖最高预算').toBeGreaterThanOrEqual(maxBudget)
    expect(foeHpOfThreat(maxDeep - 1, bal), '最高标签仍为预算的最小反解，不能任意抬高').toBeLessThan(maxBudget)
    console.log('[深层威胁读数]', { maxDeep, flagship: flagship!.threat, maxBudget })
  })
})
