/**
 * **残骸经济冻结**（船长 2026-09-25 令「**乙**」= 冻结残骸经济）。
 *
 * 背景（本用例要挡的回潮）：威胁是**多条链路的输入**，其中残骸链是
 * `wreckBaseDensity = Σ(威胁 × 0.4 × (1+0.2×敌人数)) × 20`（`salvage.ts`）。
 * 2026-09-25 洞外 23 张常驻悬赏按「单舰 ×3」定价式**重定标威胁**（属性零改动）⇒
 * 若残骸链继续读 `threat`，回收经济会被连带改动（实测：20/20 星系密度全变、
 * 3 个星系回收档位跳档、2 组残骸的 T3 碎片门槛掉档）。
 *
 * 落法：卡上新增 **`AnomalyDef.wreckThreat`**（回收口径的冻结体量，缺省 = `threat`），
 * 残骸链**四处同源**改读 `wreckInjectThreatOf`：逐场注入（悬赏 / AI）、星系基础密度、
 * 最强卡注入（低安遇袭）、残骸组威胁（→ 蓝图碎片门槛）。
 *
 * 本文件钉四件事：
 * ① `wreckInjectThreatOf` 的回落口径（没写 `wreckThreat` 的卡逐字零变化）；
 * ② **改 `threat` 不动密度**（冻结的语义本身）；
 * ③ 现表 23 张常驻悬赏的星系密度 = **重定标前读数**（挑 4 个变动最大的星系钉死）；
 * ④ 残骸组威胁（碎片门槛输入）同样不随威胁重定标漂移。
 */
import { describe, expect, it } from 'vitest'
import { ANOMALIES, buildSimContext } from '@whale/data'
import type { AnomalyDef } from '../src/types'
import { recycleProfileOf, wreckBaseDensity, wreckInjectThreatOf } from '../src/salvage'
import { anomaly, makeTestCtx } from './helpers'

const ctx = buildSimContext()

describe('残骸经济冻结（船长 2026-09-25「冻结残骸经济」）', () => {
  it('① 口径：`wreckThreat` ?? `threat`（缺省回落 ⇒ 新卡/洞内卡/隐藏模板零行为变化）', () => {
    expect(wreckInjectThreatOf({ threat: 42 })).toBe(42)
    expect(wreckInjectThreatOf({ threat: 42, wreckThreat: 7 })).toBe(7)
    expect(wreckInjectThreatOf({ threat: 42, wreckThreat: 0 })).toBe(0)
  })

  it('② 改威胁不动密度：同一张卡只改 `threat`，星系密度逐值不变', () => {
    /** 合成卡 + 单卡星系（`galaxy-freeze` 只有这一张卡）⇒ 密度 = 该卡注入量 × 20 */
    const mk = (threat: number, wreckThreat?: number): number => {
      const card: AnomalyDef = {
        ...anomaly('ano-freeze-probe', 'galaxy-freeze', { threat }),
        ...(wreckThreat !== undefined ? { wreckThreat } : {}),
      }
      return wreckBaseDensity('galaxy-freeze', makeTestCtx({ quietEvents: true, anomalies: [card] }))
    }
    const at10 = mk(10, 10)
    expect(mk(200, 10)).toBe(at10) // 威胁 20 倍 ⇒ 密度**不变**（读的是冻结值）
    expect(mk(5, 10)).toBe(at10)
    // 口径守卫：不写冻结值 ⇒ 回落 `threat` ⇒ 密度随威胁涨（若哪天残骸链被改回读 `threat`，上一行会红）
    expect(mk(200)).toBeGreaterThan(at10)
  })

  it('③ 现表 23 张常驻悬赏都带冻结值，且星系密度 = 重定标前读数（挑变动最大的 4 个钉死）', () => {
    const visible = ANOMALIES.filter((a) => a.hidden !== true && (a.ships ?? []).length > 0)
    expect(visible.length).toBe(23)
    expect(visible.every((a) => typeof a.wreckThreat === 'number')).toBe(true)
    // 重定标若牵动回收线，这四个星系会分别变成 144 / 566 / 432 / 288
    expect(wreckBaseDensity('galaxy-hub', ctx)).toBe(58)
    expect(wreckBaseDensity('galaxy-redring', ctx)).toBe(768)
    expect(wreckBaseDensity('galaxy-lantern', ctx)).toBe(317)
    expect(wreckBaseDensity('galaxy-mirage', ctx)).toBe(461)
  })

  it('④ 残骸组威胁（碎片门槛 ≥17 / ≥41 的输入）不随威胁重定标漂移', () => {
    // 三组的档位/门槛在重定标下最危险（b-hi 会越过 17；d-hi / a-lo 会掉下 41）
    expect(recycleProfileOf(ctx, 'wreck-b-hi')!.threat).toBe(11)
    expect(recycleProfileOf(ctx, 'wreck-d-hi')!.threat).toBe(46)
    expect(recycleProfileOf(ctx, 'wreck-a-lo')!.threat).toBe(48)
    // 组档位（= 出量乘数与保底池的输入）也一字不动
    expect(recycleProfileOf(ctx, 'wreck-d-hi')!.tier).toBe('dire')
    expect(recycleProfileOf(ctx, 'wreck-a-lo')!.tier).toBe('risky')
  })
})
