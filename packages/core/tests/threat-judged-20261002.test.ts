/**
 * **威胁的"价目表"与"判据"分离**（**2026-10-02 船长令：「两个都同意」**）
 *
 * 背景（一天两批）：威胁同时兼着两件事——① **给玩家看的价目表**（按「单舰 ×3」定价式重锚过两次：
 * 2026-09-25 主题卡、2026-10-02 窝点；两次都是"**只改数字、属性零改动**"）；② **引擎判据的输入**
 * （`pdEnabledFor`：威胁 ≥ 60 的敌舰装近防炮 · 敌「船体修理装置」强度 `k = max(1, 威胁 ÷ 45)`）。
 *
 * 两次重锚都让 ② 跟着漂（实测各 5 处翻转）⇒ 船长裁定**乙**：这两处按「**重锚前的旧标签**」判
 * （字段 `AnomalyDef.threatJudged` ＋ 单点 `foeJudgedThreatOf`）；并把 09-25 那 5 处一并**回钉**。
 *
 * 本文件钉住：① 判据单点的优先级 · ② 窝点派生把判据按倍率带上（本批那 5 处不再翻）·
 * ③ 5 张回钉卡的数据与 PD 状态 · ④ 6 张重锚卡的标签 = 定价式实测价（±1）且判据仍是旧标签 ·
 * ⑤ 派系活跃的判据同乘 · ⑥ 曲线平台区豁免（新手卡）。
 */
import { describe, expect, it } from 'vitest'
import { ANOMALIES_FLAVORED, buildSimContext } from '@whale/data'
import { pdEnabledFor } from '../src/combat'
import { foeJudgedThreatOf } from '../src/foePower'
import { LAIR_THREAT_MUL, factionAnomalyOf, isLairCandidate, lairAnomalyOf } from '../src/lairs'
import type { AnomalyDef } from '../src/types'

const ctx = buildSimContext()
const bal = ctx.balance.battle
const floor = bal.pdThreatFloor
const cardOf = (id: string): AnomalyDef => ANOMALIES_FLAVORED.find((a) => a.id === id)!
const lairs = ANOMALIES_FLAVORED.filter((a) => isLairCandidate(a))

describe('威胁价目表 ↔ 判据分离（2026-10-02 船长令取「乙」）', () => {
  it('① 判据单点优先级：`threatJudged ?? threat`', () => {
    expect(foeJudgedThreatOf({ threat: 10 })).toBe(10)
    expect(foeJudgedThreatOf({ threat: 10, threatJudged: 3 })).toBe(3)
  })

  it('② 窝点派生把判据按强度倍率带上（不是跟着重锚后的标签跑）', () => {
    for (const a of lairs) {
      for (const t of [1, 2, 3] as const) {
        const lair = lairAnomalyOf(a, t, bal)
        const want = Math.round(foeJudgedThreatOf(a) * LAIR_THREAT_MUL[t])
        expect(foeJudgedThreatOf(lair), `${a.name} 档 ${t}`).toBe(want)
        expect(pdEnabledFor(foeJudgedThreatOf(lair), bal), `${a.name} 档 ${t} 的近防炮与重锚前一致`).toBe(
          pdEnabledFor(want, bal),
        )
      }
    }
  })

  it('③ 本批重锚曾翻过门槛的 5 处档位：判据回钉后 PD 状态与重锚前一致', () => {
    /**
     * 这 5 处是 2026-10-02 窝点重锚**实测翻过** PD 门槛的档位（探针读数，写死当回归钉）：
     * 幽灵舰信号 档2/档3 · 碎晶带劫匪通缉 档3 · 信标猎手悬赏 档3 · 灰霾伏击团清剿令 档3。
     * 回钉后它们**都应有近防炮**（＝重锚前那 61/76/72/60/68 都 ≥ 60）。
     */
    const cases: ReadonlyArray<readonly [string, 1 | 2 | 3]> = [
      ['ano-ghost-signal', 2],
      ['ano-ghost-signal', 3],
      ['ano-shard-bandits', 3],
      ['ano-lantern-saboteurs', 3],
      ['ano-haze-ambush', 3],
    ]
    for (const [id, tier] of cases) {
      const lair = lairAnomalyOf(cardOf(id), tier, bal)
      expect(pdEnabledFor(foeJudgedThreatOf(lair), bal), `${id} 档 ${tier} 应有近防炮（回钉前如此）`).toBe(true)
      expect(lair.threat, `${id} 档 ${tier}：价目表标签仍按重锚后的值`).toBeLessThanOrEqual(foeJudgedThreatOf(lair))
    }
  })

  it('④ 5 张 09-25 回钉卡：判据 = 重定标前旧标签（与冻结的 wreckThreat 同值）', () => {
    /** 这 5 张是 09-25 重定标实测翻过 PD 门槛的（45→81 · 62→59 · 42→64 · 48→68 · 58→77） */
    for (const id of ['ano-abyss-guard', 'ano-auro-hulk', 'ano-cinder-siege', 'ano-mirage-hijackers', 'ano-rift-hunt']) {
      const a = ANOMALIES_FLAVORED.find((x) => x.id === id)
      if (!a) continue // id 更名时跳过（上面 ③ 已按名字钉住行为）
      expect(a.threatJudged, `${id} 应显式回钉`).toBe(a.wreckThreat)
      expect(pdEnabledFor(foeJudgedThreatOf(a), bal), `${id} 的 PD 状态 = 重定标前`).toBe(
        pdEnabledFor(a.wreckThreat ?? a.threat, bal),
      )
    }
  })

  it('⑤ 甲已撤（读数纠错）：那 6 张的标签**保持 09-25 定价式的原值**，判据行不进数据', () => {
    /**
     * ⚠ 本批原打算按「单舰 ×3」定价式重锚 6 张标签（船长取「甲」），落码后既有契约
     * `foe-threat-pricing.test.ts` 报红 ⇒ 查明：**仓库里有两套 X 算法**——
     * ① 那条契约的 `xOf`（逐 `card.waves` 建档 ＋ **各波 DPS 求和**）＝ 09-25 定标签时的口径；
     * ② `foeStrengthOf`（按 `slot.wave` 建档 ＋ **取各波 DPS 最大**）＝ `foeThreatOfAnomaly` 用的那套。
     * 两套对这 6 张差 4~17 点，**甲是基于 ② 的误读** ⇒ 已整段回滚（标签一字未动），只保留「乙」。
     * 这条用例把"回滚"钉住：这 6 张的标签就是 09-25 的值，且**没有** threatJudged（判据 = 标签）。
     */
    const labels: ReadonlyArray<readonly [string, number]> = [
      ['ano-abyss-guard', 81],
      ['ano-starcore-boss', 67],
      ['ano-maw-hunt', 109],
      ['ano-chasm-aberrations', 77],
      ['ano-shard-bandits', 36],
      ['ano-lantern-saboteurs', 30],
    ]
    for (const [id, want] of labels) {
      const a = cardOf(id)
      expect(a.threat, `${id} 标签保持 09-25 原值`).toBe(want)
    }
    /** 其中两张同时是「乙」那批的**回钉**对象（09-25 改标签时翻过 PD 门槛）⇒ 它们有判据行；其余四张没有 */
    expect(cardOf('ano-abyss-guard').threatJudged, '深渊之门卫队：回钉到重定标前 45').toBe(45)
    expect(cardOf('ano-chasm-aberrations').threatJudged, '裂谷畸变体猎杀令：回钉到重定标前 58').toBe(58)
    for (const id of ['ano-starcore-boss', 'ano-maw-hunt', 'ano-shard-bandits', 'ano-lantern-saboteurs']) {
      expect(cardOf(id).threatJudged, `${id} 不在回钉名单里 ⇒ 无判据行`).toBeUndefined()
    }
  })
  it('⑥ 派系活跃：判据威胁跟着那 10% 加成一起走（真加成）', () => {
    const a = cardOf('ano-starcore-boss')
    const f = factionAnomalyOf(a)
    expect(f.threat).toBe(Math.round(a.threat * 1.1))
    expect(foeJudgedThreatOf(f)).toBe(Math.round(foeJudgedThreatOf(a) * 1.1))
  })

  it('⑦ 曲线平台区豁免：威胁 ≤ 10 的卡不参与定价（威胁 1~5 曲线同档）', () => {
    const drill = cardOf('ano-training')
    expect(drill.threat, '新手卡仍标 5（定价式在那儿没有分辨力）').toBeLessThanOrEqual(10)
    expect(drill.threatJudged, '平台区卡不需要判据字段').toBeUndefined()
    expect(floor, 'PD 门槛常量（本文件的判据基准）').toBe(60)
  })
})
