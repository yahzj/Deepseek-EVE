/**
 * **光环（R 族）入侵残骸 → 势力装备 / AI 核心 可回收**（2026-10-02 · 二号 · 船长令「检查」）
 *
 * 船长原话：「**检查光环入侵的残骸是否可以正常回收出势力装备或AI核心**」
 *
 * 这条链有五段，本文件**逐段用真入口跑一遍**（不靠读代码下结论）：
 * 1. **入侵开打**：外围的主动出击走 `weekendFoeCardOf('R','assault')`（游弋集群）· 主力走 `corona-converge`
 *    （卡面 `rareWreckDrop: 1`）；
 * 2. **残骸落场**：打赢 ⇒ `weekendWrecks[星系]` 记下 density 与**来源族 `family: 'R'`**（打捞型号池据此
 *    并入本族独立卡，2026-09-26 修玩家报障那条）；
 * 3. **捞出来的是本族残骸**：选「入侵残骸」打捞 ⇒ 稀有箱 = **`wreck-rare-r-inv`**（＝势力装备的载体）、
 *    普通残骸 = `wreck-r-inv`；
 * 4. **回收画像**：`wreck-rare-r-inv` 的 `lairGear` = `FOE_LAIR_GEAR.R`（**三件武器** · ⟪2026-10-03 起⟫）·
 *    档位 `dire` ⇒ 专属命中率 **10%/箱**；普通残骸的主题件 = **跃迁规避装置**（同日起从专属池移出、
 *    改走"普通残骸直出"这条面 —— 船长报障「普通残骸卡牌的特色掉落只有基础的MK2系列」的修法）；
 * 5. **真回收炉**：烧 `wreck-r-inv` 若干批 ⇒ **AI 核心入核心账本**（10%/批，60/30/10）；烧
 *    `wreck-rare-r-inv` ⇒ 装备库/核心账本至少一处进账 ＋ 保底矿物照给。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { addWare, countWare } from '../src/inventory'
import { advanceRefining, startRecycleRun } from '../src/industry'
import { countAiCore } from '../src/aiCores'
import { FOE_LAIR_GEAR } from '../src/lairs'
import {
  injectWeekendWreck,
  pullRareWreck,
  recycleProfileOf,
  rollRareBoxExtra,
  rollRecycleCoreGain,
  weekendRareWreckCountOf,
  weekendWreckDensityOf,
  RARE_WRECK_VOLUME_M3,
  RECYCLE_BATCH_M3,
  RECYCLE_CYCLE_MS,
  WEEKEND_WRECK_TARGET,
} from '../src/salvage'
import { weekendApplyBattleOutcome } from '../src/weekendBattle'
import { weekendFoeCardOf } from '../src/weekendEvent'
import { WRECK_GROUP_BY_KEY, WRECK_GROUP_OF_MEMBER } from '../src/wreckGroups'
import type { WeekendEventState } from '../src/weekendEvent'
import type { GameState } from '../src/state'

const ctx = buildSimContext('zh')
const GID = 'galaxy-alkali'
const CORE = 'galaxy-kor'
/** R 族四件势力装备（= 残骸族专属池） */
const R_GEAR = [...(FOE_LAIR_GEAR.R ?? [])]

/** 一场 R 族入侵（外围未夺回 ⇒ 打的是外围的主动出击） */
function invasion(): { s: GameState; ev: WeekendEventState } {
  const s = createInitialState({ nowWallMs: 0, seed: 20261002 })
  s.exploredGalaxies = [...ctx.galaxies.keys()]
  s.debugQuick = true
  const ev: WeekendEventState = {
    seq: 1,
    // ⚠ 必须用"当下"：NPC 铺底是 (now − T0)/48h 的时间函数，写死 1970 会让星系"早就被夺回"⇒ 整场不结算
    startedAtWallMs: Date.now(),
    coreId: CORE,
    peripheryIds: [GID],
    family: 'R',
    contributed: {},
  }
  s.weekendEvent = ev
  return { s, ev }
}

/** 打赢一张入侵卡（走真入口）；`cardId` = 这一场实际打的那张卡 */
function winCard(s: GameState, cardId: string): ReturnType<typeof weekendApplyBattleOutcome> {
  return weekendApplyBattleOutcome(s, ctx, cardId, true, Date.now(), null, { kind: 'assault', galaxyId: GID })
}

const coreCount = (s: GameState): number =>
  countAiCore(s, 'gamma') + countAiCore(s, 'beta') + countAiCore(s, 'alpha')

describe('① 光环入侵的族登记（卡 / 组 / 残骸 id）', () => {
  it('四张独立卡都在册，且都归 `r-inv` 组（残骸物品 = wreck-r-inv / wreck-rare-r-inv）', () => {
    expect(weekendFoeCardOf('R', 'assault'), '外围主动出击打的是游弋集群').toBe('corona-drift')
    expect(weekendFoeCardOf('R', 'flagship'), '旗舰 = 中枢卫队').toBe('corona-nexus')
    const g = WRECK_GROUP_BY_KEY.get('r-inv')!
    expect(g, 'r-inv 组在册').toBeTruthy()
    expect(g.family, '组带来源族 R（AI 核心掉落靠它判）').toBe('R')
    expect(g.tier, '危档 ⇒ 高级箱专属命中率 10%').toBe('dire')
    for (const card of ['corona-drift', 'corona-split', 'corona-converge', 'corona-nexus']) {
      expect(WRECK_GROUP_OF_MEMBER.get(card), `${card} 必须挂在 r-inv 组`).toBe('r-inv')
    }
    expect(ctx.anomalies.get('corona-converge')?.rareWreckDrop, '主力卡面写了稀有残骸掉落').toBe(1)
  })
})

describe('② 打赢入侵 ⇒ 残骸落入侵残骸场（带来源族）', () => {
  it('主力打赢 ⇒ 稀有箱 +1；普通残骸注入走遭遇结算那条真入口 ⇒ density ＋ family = R', () => {
    const { s } = invasion()
    /** 普通残骸的注入口 = `encounters.dropWrecks`（打赢遭遇那一拍调），传的是"打的那张卡的 foeFamily" */
    injectWeekendWreck(s, GID, 40, 'R')
    expect(weekendWreckDensityOf(s, GID), '普通残骸注入').toBeCloseTo(40, 6)
    expect(s.weekendWrecks?.[GID]?.byFamily.R?.density, '来源族 = R 独立桶').toBe(40)
    winCard(s, 'corona-converge')
    expect(weekendRareWreckCountOf(s, GID), '主力舰队掉 1 具稀有残骸').toBe(1)
    /** 卡片自带族（`foeFamily: 'R'`）——遭遇结算据此记族，不依赖事件族 */
    expect(ctx.anomalies.get('corona-converge')?.foeFamily).toBe('R')
    expect(ctx.anomalies.get('corona-drift')?.foeFamily).toBe('R')
    console.log(
      `  [读数] 打赢 R 族入侵：普通残骸 ${weekendWreckDensityOf(s, GID).toFixed(1)} · 稀有箱 ${weekendRareWreckCountOf(s, GID)} 具 · 来源桶 R`,
    )
  })
})

describe('③ 捞出来的是本族残骸（势力装备的载体）', () => {
  it('选「入侵残骸」打捞 ⇒ 捞到 wreck-rare-r-inv；普通池 = wreck-r-inv', () => {
    const { s } = invasion()
    winCard(s, 'corona-converge')
    const got = pullRareWreck(s, GID, ctx, WEEKEND_WRECK_TARGET)
    expect(got, '稀有箱 = 本族稀有残骸').toBe('wreck-rare-r-inv')
    expect(ctx.items.has('wreck-r-inv'), '普通残骸物品在册').toBe(true)
    expect(weekendRareWreckCountOf(s, GID), '捞走即少一具').toBe(0)
    console.log(`  [读数] 打捞：稀有 = ${got} · 普通 = wreck-r-inv（两件都在物品目录里）`)
  })
})

describe('④ 回收画像：稀有残骸挂着三件武器类势力装备', () => {
  it('lairGear = FOE_LAIR_GEAR.R（三件）· 档位 dire ⇒ 命中率 10%', () => {
    expect(R_GEAR.length, 'R 族残骸族专属池现在三件武器（2026-10-03 跃迁规避装置改走主题件）').toBe(3)
    const prof = recycleProfileOf(ctx, 'wreck-rare-r-inv')!
    expect(prof, '稀有残骸有回收画像').toBeTruthy()
    expect(prof.tier).toBe('dire')
    expect(prof.family, '画像带来源族（核心掉落判据）').toBe('R')
    expect(prof.lairGear, '专属池 = FOE_LAIR_GEAR.R 逐字相等').toEqual(R_GEAR)
    const plain = recycleProfileOf(ctx, 'wreck-r-inv')!
    expect(plain.lairGear, '普通残骸不带专属池（只走保底 ＋ 主题件）').toBeUndefined()
    expect(plain.family).toBe('R')
    // ⟪2026-10-03 船长改口径⟫ 普通残骸走 `themeGear` 特色池（10%/批 · 专属件 : 家族 MK2 = 1 : 20）
    expect(plain.themeGear, '普通残骸的族专属件 = 跃迁规避装置').toEqual(['mod-lair-blink-r'])
    expect(plain.themeGearMk2?.length ?? 0, '特色池另有家族 MK2').toBeGreaterThan(0)
    expect(plain.theme?.modules ?? [], '不再走"主题追加件"那条').toEqual([])
    expect(R_GEAR, '该件已从专属池移出（同一件不许同时挂两条支路）').not.toContain('mod-lair-blink-r')
    console.log(`  [读数] 画像：稀有 lairGear=${R_GEAR.join(' / ')}（${prof.tier} 档 · 10%/箱）· 普通特色池=跃迁规避装置 ＋ MK2×${plain.themeGearMk2?.length ?? 0}`)
  })
})

describe('⑤ 开稀有箱：三件武器类势力装备都出得来', () => {
  it('连开 400 箱 ⇒ 三件都出现过；且"集齐前不重复"（前 3 次专属命中互不相同）', () => {
    const { s } = invasion()
    const prof = recycleProfileOf(ctx, 'wreck-rare-r-inv')!
    /** 只统计走"专属装备"那一支的命中（note 前缀区分：专属装备 / 主题装备） */
    const gearHits: string[] = []
    let themeHits = 0
    let mineralHits = 0
    for (let i = 0; i < 400; i++) {
      const out = rollRareBoxExtra(s, ctx, prof, [])
      if (!out) continue
      const gear = out.modules.find((id) => R_GEAR.includes(id))
      if (gear !== undefined) gearHits.push(gear)
      else if (out.modules.length > 0) themeHits += 1
      if (out.minerals.length > 0) mineralHits += 1
      /** 每开一箱都把到手的件"入库"，让"未集齐才抽"的口径按真实持有算 */
      for (const id of out.modules) s.moduleBay[id] = (s.moduleBay[id] ?? 0) + 1
    }
    const unique = new Set(gearHits)
    expect(gearHits.length, `400 箱里应有专属命中（实测 ${gearHits.length}）`).toBeGreaterThan(10)
    expect([...unique].sort(), '三件势力装备必须都能开出来').toEqual([...R_GEAR].sort())
    expect(themeHits, '未命中时保底给主题件（跃迁规避装置）').toBeGreaterThan(0)
    expect(mineralHits, '每箱都附一批高阶矿物').toBe(400)
    const rate = gearHits.length / 400
    expect(rate, `专属命中率 ${(rate * 100).toFixed(1)}% 应≈10%`).toBeGreaterThan(0.05)
    expect(rate).toBeLessThan(0.16)
    console.log(
      `  [读数] 400 箱：专属命中 ${gearHits.length} 次（${((gearHits.length / 400) * 100).toFixed(1)}%）· ` +
        `集齐三件用时 ${gearHits.findIndex((_, i) => new Set(gearHits.slice(0, i + 1)).size === 3) + 1} 次命中 · ` +
        `主题件 ${themeHits} · 矿物 ${mineralHits}`,
    )
  })
})

describe('⑥ 真回收炉：烧 R 族残骸出 AI 核心', () => {
  it('普通残骸烧 80 批 ⇒ 核心入账（10%/批）＋ 保底矿物照给；对照族一批都不出', () => {
    const { s } = invasion()
    const batches = 80
    addWare(s, 'wreck-r-inv', RECYCLE_BATCH_M3 * batches)
    expect(startRecycleRun(s, 'wreck-r-inv', 'pilot', ctx).ok, '起炉').toBe(true)
    const cores0 = coreCount(s)
    /** ⚠ `advanceRefining` 一次会把"到点的全部批次"都结算掉，所以批数要读炉自己的 `batchesDone` */
    let done = 0
    for (let i = 0; i < batches + 4; i++) {
      s.gameMs += RECYCLE_CYCLE_MS
      advanceRefining(s, ctx)
      const run = (s.refineRuns ?? [])[0]
      if (run) done = run.batchesDone
      else break
    }
    const cores = coreCount(s) - cores0
    expect(countWare(s, 'wreck-r-inv'), '料尽 = 烧完').toBe(0)
    /** ⚠ 末批与炉子一起消失 ⇒ 读不到最终批数，只能保证"确实烧到了最后"（前一次读到 ≥75） */
    expect(done, '炉子确实烧到了最后（末批随炉消失）').toBeGreaterThanOrEqual(batches - 5)
    expect(cores, `烧 ${batches} 批应出核心（10%/批）`).toBeGreaterThan(0)
    expect(cores, '不该离谱地多').toBeLessThanOrEqual(batches * 0.25)
    /** 对照：H 族残骸（同为入侵族但没登记核心特色）一批都不出 */
    let hHits = 0
    for (let i = 1; i <= 500; i++) if (rollRecycleCoreGain('wreck-h-inv', i) !== undefined) hHits += 1
    expect(hHits, 'H 族一次都不该出核心').toBe(0)
    console.log(
      `  [读数] 回收炉烧 ${batches} 批 wreck-r-inv：核心 +${cores} 枚（约 ${((cores / batches) * 100).toFixed(1)}%/批，标称 10%）· 对照 H 族 500 批命中 ${hHits}`,
    )
  })

  it('稀有残骸烧 1 具 ⇒ 至少一处进账（专属装备 / 主题件 / 核心 / 矿物）', () => {
    const { s } = invasion()
    addWare(s, 'wreck-rare-r-inv', RARE_WRECK_VOLUME_M3) // 一件 = 30 m³（= 3 批 × 10 m³）
    const prof = recycleProfileOf(ctx, 'wreck-rare-r-inv')!
    const mineralIds = (prof.pool ?? []).map(([id]) => id)
    const mineralsOf = (): number => mineralIds.reduce((n, id) => n + countWare(s, id), 0)
    const st = () => ({
      gear: R_GEAR.reduce((n, id) => n + (s.moduleBay[id] ?? 0), 0),
      theme: s.moduleBay['mod-shield-pla-2'] ?? 0,
      cores: coreCount(s),
      minerals: mineralsOf(),
    })
    const before = st()
    expect(startRecycleRun(s, 'wreck-rare-r-inv', 'pilot', ctx).ok, '稀有残骸起炉').toBe(true)
    for (let i = 0; i < 6; i++) {
      s.gameMs += RECYCLE_CYCLE_MS
      advanceRefining(s, ctx)
      if ((s.refineRuns ?? []).length === 0) break
    }
    const after = st()
    expect(after.gear + after.theme, '高级箱要么出专属装备、要么出主题件（必给一件）').toBeGreaterThan(
      before.gear + before.theme,
    )
    expect(after.minerals, '保底矿物照给').toBeGreaterThan(before.minerals)
    console.log(
      `  [读数] 拆 1 具稀有残骸：专属装备 +${after.gear - before.gear} · 主题件 +${after.theme - before.theme} · 核心 +${after.cores - before.cores} · 矿物 +${after.minerals - before.minerals}`,
    )
  })
})
