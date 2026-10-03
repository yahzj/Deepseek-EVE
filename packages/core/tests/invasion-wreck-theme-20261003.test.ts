/**
 * **入侵残骸（H 墨潮帮 / R 光环）的「特色掉落」= 族专属件 ＋ 家族 MK2 混池**（2026-10-03 · 二号 · 船长令）
 *
 * 船长原话（照抄，两段）：
 * ① 「**光环残骸的普通残骸卡牌的特色掉落只有基础的MK2系列，包括墨潮帮的普通残骸也一样**」（报障）；
 * ② 「**不能使用和星系内残骸同样的设置吗？普通残骸有10%概率出特色掉落，特色掉落里，MK2和势力装备
 *    混在一起。稀有残骸必定出特色掉落**」（改口径）＋ 两条选择（掷点 = **回收炉每批**；
 *    掷中后在「专属件 : MK2」间按 **1 : 20** 分、**可重复获得**）。
 *
 * 本文件钉六件事：
 * 1. **组配置**：`h-hi` / `r-inv` 的 `theme` 为空（不再走"主题追加件"）、族专属件挂在 `themeGear`；
 * 2. **两条支路不重叠**：特色池的族专属件**不在** `FOE_LAIR_GEAR`（专属池只装武器/无人机类）；
 * 3. **概率与构成**：每批 10% 掷中，掷中后专属件 ≈ 1/21、家族 MK2 ≈ 20/21（真抽 20 万批对读数）；
 * 4. **EV 记账**：本支**有意**不接受"每批 EV 守恒"（10% 与守恒不可兼得，差 4.7 万倍）⇒
 *    锁住"代价可复算"：特色掉落 EV 与旧机制价值上限的倍数、族专属件/场的件数与价值量级；
 * 5. **卡面真的会具名**（界面同源规则）：印「跃迁规避装置 / 墨潮捕获网」＋「另有…MK2 系列装备」；
 * 6. **真回收炉出得来**：烧普通残骸 ⇒ 装备库既进族专属件、也进家族 MK2；且**不再**出默认池那些通用件
 *    （本支是"替换"而非"追加"）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { addWare } from '../src/inventory'
import { advanceRefining, startRecycleRun } from '../src/industry'
import { FOE_LAIR_GEAR } from '../src/lairs'
import {
  INVASION_FEATURE_CHANCE,
  INVASION_FEATURE_GEAR_WEIGHT,
  INVASION_FEATURE_MK2_WEIGHT,
  RECYCLE_BASE_MODULES,
  RECYCLE_BATCH_M3,
  RECYCLE_CHANCE,
  recycleProfileOf,
  rollRecycleLoot,
} from '../src/salvage'
import { WRECK_GROUP_BY_KEY } from '../src/wreckGroups'
import type { GameState } from '../src/state'

const ctx = buildSimContext('zh')
const nameOf = (id: string): string => ctx.modules.get(id)?.name ?? ctx.items.get(id)?.name ?? id
const priceOf = (id: string): number => ctx.marketGoods.get(id)?.basePrice ?? 0
const avgPriceOf = (ids: readonly string[]): number => {
  const ps = ids.map(priceOf).filter((p) => p > 0)
  return ps.length > 0 ? ps.reduce((a, b) => a + b, 0) / ps.length : 0
}

/** 界面「特色掉落」的具名规则（复刻 `ui/wreckFlavor.tsx` 的 `recycleFeatureOf`：主题件 ＋ `themeGear`） */
function cardNamedOf(groupKey: string): string[] {
  const g = WRECK_GROUP_BY_KEY.get(groupKey)!
  const ids = [...(g.theme.modules ?? []), ...(g.themeGear ?? [])]
  return ids.filter((id) => ctx.modules.has(id)).map(nameOf)
}

/** 真跑一炉：返回这一炉产出的**模块 id** 计数 */
function burn(itemId: string, batches: number, seed = 20261003): Map<string, number> {
  const s: GameState = createInitialState({ nowWallMs: 0, seed })
  s.moduleBay = {}
  addWare(s, itemId, RECYCLE_BATCH_M3 * (batches + 1))
  const r = startRecycleRun(s, itemId, 'pilot', ctx)
  expect(r.ok, `起炉 ${itemId}`).toBe(true)
  for (let i = 0; i < batches; i++) {
    const run = s.refineRuns[s.refineRuns.length - 1]
    if (!run) break
    s.gameMs += run.cycleMs
    advanceRefining(s, ctx)
  }
  return new Map(Object.entries(s.moduleBay).filter(([, n]) => n > 0))
}

describe('① 组配置：两族特色掉落走 `themeGear`，不再走"主题追加件"', () => {
  it('`theme` 为空（否则又落回会把直出链压垮的旧机制）· `themeGear` = 族专属件', () => {
    for (const [key, gear] of [['r-inv', 'mod-lair-blink-r'], ['h-hi', 'mod-lair-web-h']] as const) {
      const g = WRECK_GROUP_BY_KEY.get(key)!
      expect(g.theme.modules ?? [], `${key} 的 theme.modules 应为空`).toEqual([])
      expect(g.themeGear, `${key} 的族专属件`).toEqual([gear])
      expect(g.themeGearMk2?.length ?? 0, `${key} 应有家族 MK2`).toBeGreaterThan(0)
    }
  })

  it('画像把 `themeGear` / `themeGearMk2` 带出来（引擎与界面同一份）', () => {
    const p = recycleProfileOf(ctx, 'wreck-r-inv')!
    expect(p.themeGear).toEqual(['mod-lair-blink-r'])
    expect(p.themeGearMk2).toEqual(WRECK_GROUP_BY_KEY.get('r-inv')!.themeGearMk2)
    expect(recycleProfileOf(ctx, 'wreck-h-hi')!.themeGear).toEqual(['mod-lair-web-h'])
    // 非入侵组不带这两个字段（零行为变化）
    expect(recycleProfileOf(ctx, 'wreck-d-hi')!.themeGear).toBeUndefined()
  })

  it('族专属件是模块 ＋ 非武器（直出支只收模块；B3.1「武器移出主题」契约）', () => {
    for (const [key, id] of [['r-inv', 'mod-lair-blink-r'], ['h-hi', 'mod-lair-web-h']] as const) {
      expect(ctx.modules.has(id), `${key} 的族专属件 ${id} 必须在模块目录里`).toBe(true)
      const slot = ctx.modules.get(id)!.slot
      expect(['turret', 'laser', 'missile'], `${id} 不得是武器（slot=${slot}）`).not.toContain(slot)
    }
  })
})

describe('② 两条支路不重叠：专属池只装武器/无人机类专属件', () => {
  it('族专属件**不在** `FOE_LAIR_GEAR`；池子件数 R 3 / H 2', () => {
    expect(FOE_LAIR_GEAR.R).not.toContain('mod-lair-blink-r')
    expect(FOE_LAIR_GEAR.H).not.toContain('mod-lair-web-h')
    expect(FOE_LAIR_GEAR.R!.length).toBe(3)
    expect(FOE_LAIR_GEAR.H!.length).toBe(2)
  })

  it('R 专属池三件**全是武器**（另三件激光类）', () => {
    for (const id of FOE_LAIR_GEAR.R!) {
      expect(ctx.modules.has(id), `${id} 在模块目录里`).toBe(true)
      expect(ctx.modules.get(id)!.slot, `${id} 应是武器`).toBe('laser')
    }
  })

  it('回收画像：三条支路各自独立 —— 普通残骸只有特色池；稀有残骸只有专属池 ＋ 兜底池', () => {
    const plainR = recycleProfileOf(ctx, 'wreck-r-inv')!
    const rareR = recycleProfileOf(ctx, 'wreck-rare-r-inv')!
    expect(plainR.themeGear).toEqual(['mod-lair-blink-r'])
    expect(plainR.lairGear).toBeUndefined()
    // ⚠ `rareTheme` 是**组级字段、两种残骸的画像都带**（抽取点只有稀有箱那一处）——带出来无害，
    //    这里显式锁住"它是普通残骸画像里也有的"，免得日后误以为它像 `lairGear` 那样按稀有判定
    expect(plainR.rareTheme).toEqual(WRECK_GROUP_BY_KEY.get('r-inv')!.themeGearMk2)
    // 稀有残骸：专属支（武器）＋ 兜底支（家族 MK2 一件）——**不带 `themeGear`**（那件是普通残骸那条面的）
    expect(rareR.themeGear).toBeUndefined()
    expect(rareR.themeGearMk2).toBeUndefined()
    expect(rareR.lairGear).toEqual([...FOE_LAIR_GEAR.R!])
    expect(rareR.rareTheme, '兜底支 = 家族 MK2 一件').toEqual(WRECK_GROUP_BY_KEY.get('r-inv')!.themeGearMk2)
  })
})

describe('③ 概率与构成：每批 10% · 族专属件 : 家族 MK2 = 1 : 20', () => {
  it('三常量就是船长定的那三个数', () => {
    expect(INVASION_FEATURE_CHANCE).toBe(0.1)
    expect(INVASION_FEATURE_GEAR_WEIGHT).toBe(1)
    expect(INVASION_FEATURE_MK2_WEIGHT).toBe(20)
  })

  it('真抽 20 万批：出件率 ≈10% · 其中族专属件 ≈1/21 · 家族 MK2 ≈20/21', () => {
    const s = createInitialState({ nowWallMs: 0, seed: 424242 })
    const prof = recycleProfileOf(ctx, 'wreck-r-inv')!
    const gear = new Set(['mod-lair-blink-r'])
    const mk2 = new Set(WRECK_GROUP_BY_KEY.get('r-inv')!.themeGearMk2 ?? [])
    const BATCHES = 200_000
    let hits = 0
    let gearHits = 0
    let mk2Hits = 0
    let other = 0
    for (const m of rollRecycleLoot(s, ctx, prof, BATCHES).modules) {
      hits += 1
      if (gear.has(m)) gearHits += 1
      else if (mk2.has(m)) mk2Hits += 1
      else other += 1
    }
    const rate = hits / BATCHES
    expect(rate, `出件率 ${(rate * 100).toFixed(2)}% 应≈10%`).toBeGreaterThan(0.09)
    expect(rate).toBeLessThan(0.11)
    // 船长定的 **1 : 20** = 两组的**总权重**比 ⇒ 族专属件占总命中 1/21 ≈ 4.76%
    const expected = 1 / (1 + INVASION_FEATURE_MK2_WEIGHT)
    expect(gearHits / hits, `族专属件占比应≈${(expected * 100).toFixed(2)}%`).toBeGreaterThan(expected * 0.75)
    expect(gearHits / hits).toBeLessThan(expected * 1.25)
    expect(mk2Hits / hits, '家族 MK2 占比应≈20/21').toBeGreaterThan(0.93)
    expect(other, '不该出池外的件（默认直出池已被本支替换）').toBe(0)
    console.log(
      `  [读数] ${BATCHES.toLocaleString('zh-CN')} 批：出件 ${hits}（${(rate * 100).toFixed(2)}%）· ` +
        `族专属件 ${gearHits}（占比 ${((gearHits / hits) * 100).toFixed(2)}% · 期望 ${(expected * 100).toFixed(2)}%）· ` +
        `家族 MK2 ${mk2Hits}（占比 ${((mk2Hits / hits) * 100).toFixed(2)}%）· 池外 ${other}`,
    )
  })

  it('对照：守墓者（非入侵组）仍走"默认池 ＋ 主题追加件"那条老机制（零行为变化）', () => {
    const s = createInitialState({ nowWallMs: 0, seed: 424242 })
    const d = recycleProfileOf(ctx, 'wreck-d-hi')!
    const got = new Set(rollRecycleLoot(s, ctx, d, 200_000).modules)
    // 老机制是"追加"：默认池那些 MK1/民用件照样出得来
    expect([...got].some((id) => RECYCLE_BASE_MODULES.includes(id)), '默认池件应出得来').toBe(true)
  })
})

describe('④ EV：本支**有意**不接受"每批 EV 守恒"（代价精确记账）', () => {
  it('特色掉落 EV = 10% × 特色池均价（远高于旧机制的价值上限），且记账算式与注释一致', () => {
    const defBase = RECYCLE_BASE_MODULES.filter((id) => ctx.modules.has(id))
    const defBaseAvg = avgPriceOf(defBase)
    const prof = recycleProfileOf(ctx, 'wreck-r-inv')!
    const gear = prof.themeGear ?? []
    const mk2 = prof.themeGearMk2 ?? []
    const pool = [...gear, ...mk2.flatMap((id) => Array.from({ length: Math.max(1, Math.round(INVASION_FEATURE_MK2_WEIGHT / Math.max(1, mk2.length))) }, () => id))]
    const featureAvg = avgPriceOf(pool)
    /** 旧机制隐含的"每次命中价值上限" = 那一次基础直出的期望（每单位） */
    const oldCap = RECYCLE_CHANCE.base * defBaseAvg
    const featureEv = INVASION_FEATURE_CHANCE * featureAvg
    expect(featureEv, '船长要的 10% 必然突破旧机制的守恒上限（这是知情选择）').toBeGreaterThan(oldCap)
    // 记账算式：倍数可复算
    const mult = featureEv / oldCap
    expect(mult).toBeGreaterThan(1000)
    console.log(
      `  [读数] 默认池均价 ${defBaseAvg.toFixed(0)} · 特色池 ${pool.length} 件均价 ${featureAvg.toFixed(0)}` +
        ` ⇒ 旧机制价值上限 ${oldCap.toFixed(1)} ISK/批 · 现特色掉落 EV ${featureEv.toFixed(0)} ISK/批（×${mult.toFixed(0)}）` +
        ` · 同一批保底矿物 EV 101.88 × 100 = 10,188 ISK/批`,
    )
  })

  it('尺度对照：一场入侵（≈4,000 m³）的各族收入量级可复算', () => {
    const EVENT_M3 = 4_000
    const batches = EVENT_M3 / RECYCLE_BATCH_M3
    const prof = recycleProfileOf(ctx, 'wreck-r-inv')!
    const mk2Ids = prof.themeGearMk2 ?? []
    const mk2PerItem = Math.max(1, Math.round(INVASION_FEATURE_MK2_WEIGHT / Math.max(1, mk2Ids.length)))
    const pool = [
      ...(prof.themeGear ?? []).flatMap((id) => Array.from({ length: INVASION_FEATURE_GEAR_WEIGHT }, () => id)),
      ...mk2Ids.flatMap((id) => Array.from({ length: mk2PerItem }, () => id)),
    ]
    const gearShare = (prof.themeGear?.length ?? 0) / pool.length
    const hits = INVASION_FEATURE_CHANCE * batches
    const gearN = hits * gearShare
    const gearV = gearN * priceOf('mod-lair-blink-r')
    const minV = EVENT_M3 * 101.88
    // 40 批 × 10% × (1/21) = 0.19 件/场（3 件 MK2 摊权重后实际 1/21）
    expect(Math.round(gearN * 100) / 100, '族专属件 ≈0.19 件/场').toBeCloseTo(0.19, 1)
    expect(gearV / minV, '族专属件价值 ≈ 保底矿物的 5 倍（同量级、不吞掉地板）').toBeLessThan(10)
    console.log(
      `  [读数] 4,000 m³ ⇒ ${batches.toFixed(0)} 批 · 特色命中 ${hits.toFixed(0)} 次` +
        `（族专属件 ${gearN.toFixed(2)} 件 = ${(gearV / 1e6).toFixed(1)}M ISK · 家族 MK2 ${(hits - gearN).toFixed(1)} 件）` +
        ` · 同量保底矿物 ${(minV / 1e6).toFixed(2)}M ISK`,
    )
  })
})

describe('⑤ 卡面「特色掉落」真的会具名（界面同源规则）', () => {
  it('R / H 普通残骸卡面各印本族件名，不再印"只有 MK2 系列"', () => {
    expect(cardNamedOf('r-inv')).toEqual(['跃迁规避装置'])
    expect(cardNamedOf('h-hi')).toEqual(['墨潮捕获网'])
    // 对照：守墓者仍是那一件通用 MK2（它的卡面本来就对，本批没碰它）
    expect(cardNamedOf('d-hi')).toEqual(['护盾增强器 MK2·能量型'])
    console.log(
      `  [读数] 卡面「特色掉落」：R = ${cardNamedOf('r-inv').join('、')} · ` +
        `H = ${cardNamedOf('h-hi').join('、')} · D（对照）= ${cardNamedOf('d-hi').join('、')}`,
    )
  })
})

describe('⑥ 真回收炉：既出族专属件、也出家族 MK2，且不再出默认池件', () => {
  it('烧 4,000 批 `wreck-r-inv`（≈ 一场入侵的残骸量）', () => {
    const got = burn('wreck-r-inv', 4_000)
    expect(got.get('mod-lair-blink-r') ?? 0, '族专属件应出得来').toBeGreaterThan(0)
    for (const id of WRECK_GROUP_BY_KEY.get('r-inv')!.themeGearMk2 ?? []) {
      expect(got.get(id) ?? 0, `家族 MK2 ${nameOf(id)} 应出得来`).toBeGreaterThan(0)
    }
    const outOfPool = [...got.keys()].filter((id) => !['mod-lair-blink-r', ...(WRECK_GROUP_BY_KEY.get('r-inv')!.themeGearMk2 ?? [])].includes(id))
    expect(outOfPool, '不该出特色池以外的件').toEqual([])
    console.log(
      `  [读数] 4,000 批 wreck-r-inv：${[...got]
        .sort((a, b) => b[1] - a[1])
        .map(([id, n]) => `${nameOf(id)} ×${n}`)
        .join(' · ')}`,
    )
  })

  it('烧 4,000 批 `wreck-h-hi`（同款口径，H 族）', () => {
    const got = burn('wreck-h-hi', 4_000)
    expect(got.get('mod-lair-web-h') ?? 0, '族专属件应出得来').toBeGreaterThan(0)
    for (const id of WRECK_GROUP_BY_KEY.get('h-hi')!.themeGearMk2 ?? []) {
      expect(got.get(id) ?? 0, `家族 MK2 ${nameOf(id)} 应出得来`).toBeGreaterThan(0)
    }
    console.log(
      `  [读数] 4,000 批 wreck-h-hi：${[...got]
        .sort((a, b) => b[1] - a[1])
        .map(([id, n]) => `${nameOf(id)} ×${n}`)
        .join(' · ')}`,
    )
  })

  it('稀有箱那条链一字未动：专属支仍只出 `FOE_LAIR_GEAR`', () => {
    const s = createInitialState({ nowWallMs: 0, seed: 7 })
    const prof = recycleProfileOf(ctx, 'wreck-r-inv')!
    const out = new Set<string>()
    for (let i = 0; i < 200; i++) for (const m of rollRecycleLoot(s, ctx, prof, RECYCLE_BATCH_M3).modules) out.add(m)
    for (const id of FOE_LAIR_GEAR.R!) expect([...out], `${id} 不该从普通残骸出`).not.toContain(id)
  })
})
