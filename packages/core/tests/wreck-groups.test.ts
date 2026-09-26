/**
 * **残骸合并：13 组定表 + 出量梯度**（船长 2026-09-19「残骸按来源种族 × 来源地区合并」＋
 * 「为了平衡价值，可以提高更危险地区的残骸出量」）。
 *
 * 这里钉的是**运行时口径**（组表的成员覆盖/命名/地区、洞内 5 组零变化、每轮出量的档位乘数）；
 * 「组池均价 = 保值目标 ±3%」等**内容契约**在 `content:check`（那边拿得到卡级池表 `RECYCLE_FLAVOR`）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import {
  RECYCLE_POOLS,
  recyclePoolMeanIsk,
  recycleProfileOf,
  wreckBaseDensity,
  wreckItemIdOf,
  wreckYieldMultiplierOf,
  WRECK_YIELD_TIER_MUL,
} from '../src/salvage'
import { pullOneWreck } from '../src/salvaging'
import {
  wreckGroupOfAnomaly,
  wreckGroupOfItemId,
  WRECK_GROUPS,
  WRECK_GROUP_OF_MEMBER,
  WRECK_REGION_LABELS,
} from '../src/wreckGroups'
import { anomaly, galaxy, makeTestCtx } from './helpers'

const ctx = buildSimContext()

describe('残骸组表（14 组 · 族 × 地区）', () => {
  it('成员覆盖全表 42 张卡，一张不漏、一张不重；族/地区与卡的数据一致', () => {
    expect(WRECK_GROUPS.length).toBe(14) // ⚠ 2026-09-24：13 → 14（H 族墨潮帮组 h-hi）
    expect(WRECK_GROUP_OF_MEMBER.size).toBe(ctx.anomalies.size)
    expect(ctx.anomalies.size).toBe(46) // ⚠ 2026-09-24：42 → 44（H 族两张入侵卡）
    let wh = 0
    let hi = 0
    let lo = 0
    let inv = 0
    for (const g of WRECK_GROUPS) {
      if (g.region === 'wh') wh += 1
      if (g.region === 'hi') hi += 1
      if (g.region === 'lo') lo += 1
      if (g.region === 'inv') inv += 1
      for (const m of g.members) {
        const a = ctx.anomalies.get(m)
        expect(a, `${g.key} 的成员 ${m} 不在敌卡表里`).toBeTruthy()
        expect(a!.foeFamily).toBe(g.family)
        const sec = ctx.galaxies.get(a!.galaxyId)?.security ?? 1
        // 2026-09-24: 卡级 region 覆写优先（入侵卡 ink-* 不以 wh- 开头但按卡级地区计，与 content:check 同源）
        // 2026-09-26: 入侵卡的地区由 'hi' 改新类别 'inv'（船长令「统一为入侵残骸」）
        const region = a!.region ?? (m.startsWith('wh-') ? 'wh' : sec <= 0 ? 'lo' : 'hi')
        expect(region, `${m} 的地区判定`).toBe(g.region)
      }
    }
    expect([hi, lo, wh, inv]).toEqual([3, 5, 5, 1]) // 2026-09-26：H 族那组由**高安**改新类别**入侵**（船长令「统一为入侵残骸（新增一个类别）」）⇒ 高安 3 · 低安 5 · 洞内 5 · 入侵 1
    expect(Object.keys(WRECK_REGION_LABELS)).toEqual(['hi', 'lo', 'wh', 'inv'])
  })

  it('命名口径：`<族称>残骸（<地区>）` 与 `<族称>稀有残骸（<地区>）`，族称取完整名', () => {
    const byKey = new Map(WRECK_GROUPS.map((g) => [g.key, g]))
    expect(byKey.get('d-lo')!.name).toBe('守墓者残骸（低安）') // 船长给的样板
    expect(byKey.get('d-lo')!.rareName).toBe('守墓者稀有残骸（低安）')
    expect(byKey.get('a-hi')!.name).toBe('海盗残骸（高安）') // 船长 2026-09-19：「A族按海盗残骸来」
    expect(byKey.get('g-wh')!.name).toBe('鱿烬亡军残骸（虫洞）')
    for (const g of WRECK_GROUPS) {
      expect(g.name.endsWith(`残骸（${WRECK_REGION_LABELS[g.region]}）`)).toBe(true)
      expect(g.rareName.endsWith(`稀有残骸（${WRECK_REGION_LABELS[g.region]}）`)).toBe(true)
      // 族称不得用 2 字缩写（船长原话「种族名称要完整」）：组名的族称部分不许等于短写
      for (const short of ['异形', '守墓', '巨构', '亡军', '拾荒', '巡逻']) {
        expect(g.name.startsWith(`${short}残骸`), `${g.name} 用了族名短写「${short}」`).toBe(false)
      }
    }
  })

  it('物品 id ↔ 组：新 id 与旧"每卡一种"的 id 都能解析到同一个组', () => {
    expect(wreckItemIdOf('d-lo')).toBe('wreck-d-lo')
    expect(wreckGroupOfItemId('wreck-d-lo')!.key).toBe('d-lo')
    expect(wreckGroupOfItemId('wreck-ano-gravekeeper')!.key).toBe('d-lo') // 旧 id（迁移与旧档兼容同一条索引）
    expect(wreckGroupOfItemId('wreck-rare-wh-alien-hive')!.key).toBe('c-wh')
    expect(wreckGroupOfAnomaly('ano-redring-raiders')!.key).toBe('a-hi')
    expect(wreckGroupOfItemId('ore-voidmother')).toBeNull()
  })

  it('洞内 5 组：池 = 常档基础池、档位常、非低安、无主题件 —— 与合并前逐字一致（零变化）', () => {
    for (const g of WRECK_GROUPS.filter((x) => x.region === 'wh')) {
      expect(g.pool).toEqual(RECYCLE_POOLS.common)
      expect(g.tier).toBe('common')
      expect(g.theme.modules ?? []).toEqual([])
      expect(g.theme.mk2 ?? []).toEqual([])
      const profile = recycleProfileOf(ctx, wreckItemIdOf(g.key))!
      expect(profile.tier).toBe('common')
      expect(profile.lowSec).toBe(false) // 洞内卡挂在母港星系（sec 1）⇒ 旧口径也是 false
      expect(profile.region).toBe('wh')
      expect(profile.pool).toEqual(RECYCLE_POOLS.common)
    }
  })

  it('组池与档位：单卡成组的（幽灵舰 / 蜃影）画像逐字不变', () => {
    const ghost = recycleProfileOf(ctx, 'wreck-d-hi')! // 幽灵舰信号 = d-hi 唯一成员
    expect(ghost.tier).toBe('dire')
    expect(recyclePoolMeanIsk(ghost.pool, (id) => ctx.items.get(id)?.baseSellPriceIsk ?? 0)).toBeCloseTo(109.9, 1)
    const mirage = recycleProfileOf(ctx, 'wreck-a-lo')!
    expect(mirage.tier).toBe('risky')
    expect(mirage.lowSec).toBe(true)
    expect(recyclePoolMeanIsk(mirage.pool, (id) => ctx.items.get(id)?.baseSellPriceIsk ?? 0)).toBeCloseTo(43.2, 1)
  })
})

describe('出量梯度（按打捞星系的回收档；船长 2026-09-19「提高更危险地区的残骸出量」）', () => {
  it('常量：常档恒 1.00 且单调不降；常/险/危 = 1.00 / 1.15 / 1.20（船长选甲案）', () => {
    expect(WRECK_YIELD_TIER_MUL).toEqual({ common: 1, risky: 1.15, dire: 1.2 })
    expect(wreckYieldMultiplierOf('common')).toBe(1)
    expect(wreckYieldMultiplierOf('risky')).toBeGreaterThanOrEqual(wreckYieldMultiplierOf('common'))
    expect(wreckYieldMultiplierOf('dire')).toBeGreaterThanOrEqual(wreckYieldMultiplierOf('risky'))
  })

  it('落点在每轮出量：同一条公式 `baseM3 × 密度系数 × 打捞学 × 档位乘数`（危档 ×1.2 实测）', () => {
    // 合成世界：常档星系（威胁 30 单敌 → 密度 288）+ 危档星系（威胁 100 单敌 → 密度 960）
    const ctxS = makeTestCtx({
      quietEvents: true,
      galaxies: [
        { ...galaxy('galaxy-hub', '母港'), security: 1.0 },
        { ...galaxy('galaxy-grave', '坟场'), security: -1.0 },
      ],
      anomalies: [
        anomaly('ano-common', 'galaxy-hub', { threat: 30 }),
        anomaly('ano-dire', 'galaxy-grave', { threat: 100 }),
      ],
    })
    const state = createInitialState({ nowWallMs: 0, seed: 5 })
    // ⚠ 测试 ctx 另带默认卡（`ano-a` 也在母港）⇒ 密度用单点 `wreckBaseDensity` 现算，别手抄
    const hubDensity = wreckBaseDensity('galaxy-hub', ctxS)
    const graveDensity = wreckBaseDensity('galaxy-grave', ctxS)
    const common = pullOneWreck(state, ctxS, 'galaxy-hub', 60_000)!
    expect(common.itemId).toBe('wreck-ano-common') // 合成卡一卡一组（组 key = 卡 id）
    // 常档：baseM3 1.8 × (密度/10) × 1.00
    expect(common.volumeM3).toBeCloseTo(1.8 * (hubDensity / 10) * WRECK_YIELD_TIER_MUL.common, 6)
    const dire = pullOneWreck(state, ctxS, 'galaxy-grave', 60_000)!
    expect(dire.itemId).toBe('wreck-ano-dire')
    // 危档：baseM3 6 × (密度/10) × 1.20
    expect(dire.volumeM3).toBeCloseTo(6 * (graveDensity / 10) * WRECK_YIELD_TIER_MUL.dire, 6)
    // 出量乘数**不按残骸身份**而按打捞地：同一件残骸若在两种星系都能捞，危档那轮更肥
    expect(WRECK_YIELD_TIER_MUL.dire).toBeGreaterThan(WRECK_YIELD_TIER_MUL.common)
  })
})
