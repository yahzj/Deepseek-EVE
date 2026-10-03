/**
 * 敌方近防炮**规则契约**（2026-09-12 船长八条裁决）：
 * 「敌人防空火力受舰船级别影响。越大的舰船防空火力越强。改为集火制度。
 *   优先攻击哨戒和攻坚无人机，给攻坚无人机添加 25% 全抗性。侦查和普通战机相同权重抽取。
 *   允许命中下限 10%。基础命中率提高到 70%」
 *
 * ＋ **按族覆写**（H 族 2026-09-25 增强；**R 族 2026-10-03 改能量光束近防炮 · 必中**）。
 *
 * 本文件钉住**可确定断言**的部分（数值与数据不变量）；集火 / 优先级 / 档系数的**行为读数**
 * 由 `tools/pd-tune.ts` 与 `tools/battle-calibrate.ts --std` 的标定轮回答（P-41）。
 */
import { describe, expect, it } from 'vitest'
import { ANOMALIES_FLAVORED, buildSimContext } from '@whale/data'
import { DEFAULT_BALANCE, addShipToFleet, addWare, createInitialState } from '@whale/core'
import { advanceBattleFor, createFoeSpecs, pdPriorityOf, pdShotOf, startBattleFor, waveGapTotalMs } from '../src/combat'
import type { GameState } from '../src/state'
import type { SimContext } from '../src/types'

const bal = DEFAULT_BALANCE.battle
/** ⚠ 用 `buildSimContext()`（物品表含无人机）——`makeTestCtx()` 的 items 只有装备模块 */
const ctx = buildSimContext()
/** 我方无人机机型 id（四型 + G 族专属「鱿蜂无人机」） */
const DRONE_IDS = ['drone-scout', 'drone-assault', 'drone-heavy', 'drone-sentry', 'drone-exile-bee']

describe('敌方近防炮 · 2026-09-12 船长八条裁决', () => {
  it('基础命中率 70% + 命中下限 10% + 判定周期 500ms（频率 = 还手速率上限）+ 门槛 60', () => {
    expect(bal.pdAcc).toBe(0.7)
    expect(bal.pdHitFloor).toBe(0.1)
    expect(bal.pdJudgementMs).toBe(500)
    expect(bal.pdThreatFloor).toBe(60)
  })

  it('舰种档系数：越大的船防空越强（T1 = 1.0 且严格递增）', () => {
    const muls = bal.pdTierMul
    expect(muls.length).toBeGreaterThanOrEqual(5)
    expect(muls[0]).toBe(1)
    for (let i = 1; i < muls.length; i += 1) expect(muls[i]!).toBeGreaterThan(muls[i - 1]!)
  })

  it('命中下限保证**每一种机型都可被近防炮打中**（修掉"闪避 ≥ pdAcc ⇒ 永久免疫"）', () => {
    for (const id of DRONE_IDS) {
      const d = ctx.items.get(id)
      expect(d, `缺机型 ${id}`).toBeTruthy()
      const ev = d!.defense?.evasion ?? 0
      const pHit = Math.max(bal.pdHitFloor, bal.pdAcc - ev)
      expect(pHit, `${d!.name}（闪避 ${ev}）的命中率`).toBeGreaterThanOrEqual(bal.pdHitFloor)
    }
  })

  it('攻坚无人机 = **25% 全抗性**（三层 × 三系）', () => {
    const heavy = ctx.items.get('drone-heavy')
    expect(heavy).toBeTruthy()
    const def = heavy!.defense as unknown as Record<string, Record<string, number> | undefined>
    for (const layer of ['shieldResist', 'armorResist', 'hullResist']) {
      for (const t of ['kinetic', 'explosive', 'plasma']) {
        expect(def[layer]?.[t], `攻坚机 ${layer}.${t}`).toBe(0.25)
      }
    }
  })

  it('舰级路径的单位带**舰种档**（近防炮档系数据此取值）', () => {
    const a = ANOMALIES_FLAVORED.find((x) => x.id === 'ano-nadir-static')!
    const specs = createFoeSpecs(a, ctx.balance.battle)
    // 天底静区封锁 = 1 巡洋舰（T3）+ 2 驱逐舰（T2）
    expect(specs.map((s) => s.hullClassTier)).toEqual([3, 2, 2])
  })

  /**
   * **船长 2026-09-25 令**：「**我希望增强H族敌人的近防炮强度。其近防炮伤害增加50%，命中提高5%**」
   * ⇒ `balance.pdFamilyOverride.H = { dmgMul: 1.5, accAdd: 0.05 }`，取数收口在 `combat.pdShotOf`。
   * 本用例钉两张表 + 一条"只动 H"：别的族/无族一律逐字走全局值。
   */
  it('H 族近防炮覆写：伤害 ×1.5 · 命中 +0.05（百分点）· 别的族不动', () => {
    /** 基础值：命中 0.7 · 单发 5（T1 档系数 1.0 ⇒ 5）· 弹种动能 · 非必中 */
    const base = { acc: 0.7, dmg: 5, dmgType: 'kinetic' as const, autoHit: false }
    expect(pdShotOf(bal, undefined, 1), '旧路径/合成 spec ⇒ 全局值').toEqual(base)
    expect(pdShotOf(bal, 'A', 1), 'A 族 ⇒ 全局值（只特化 H / R）').toEqual(base)
    expect(pdShotOf(bal, 'H', 1), 'H 族 T1 ⇒ 命中 0.75 · 伤害 7.5').toEqual({ ...base, acc: 0.75, dmg: 7.5 })
    /** 档系数照旧连乘（T5 旗舰 ×4）：H 族 = 5 × 4 × 1.5 = 30；命中那一项与档无关 */
    expect(pdShotOf(bal, 'H', 5)).toEqual({ ...base, acc: 0.75, dmg: 30 })
    expect(pdShotOf(bal, 'A', 5)).toEqual({ ...base, dmg: 20 })
    /** 与"命中下限"的关系：H 的加成是**加在 pdAcc 上**，仍要 clamp 到 [下限, 1] */
    const evasion = 0.12
    expect(Math.max(bal.pdHitFloor, pdShotOf(bal, 'H', 1).acc - evasion), 'H 打普通机型的命中').toBeCloseTo(0.63, 6)
    /** 单位带族：舰级路径的 H 单位必须带 `family: 'H'`（否则覆写取不到） */
    const ink = ANOMALIES_FLAVORED.find((x) => x.id === 'ink-harass')!
    expect(createFoeSpecs(ink, bal).every((s) => s.family === 'H'), 'H 卡的单位带族 H').toBe(true)
    const a = ANOMALIES_FLAVORED.find((x) => x.id === 'ano-nadir-static')!
    expect(createFoeSpecs(a, bal).every((s) => s.family !== 'H'), '别的卡不带 H').toBe(true)
  })

  /**
   * **R 族 = 能量光束近防炮**（**船长 2026-10-03 令**：「**给光环势力的近防炮换成能量伤害的光束近防炮，
   * 特点是和光束武器一样，必中**」＋两个值裁「甲」：单发仍 5 · 弹种能量 · 完全不吃闪避）。
   * ⇒ `balance.pdFamilyOverride.R = { dmgType: 'plasma', autoHit: true }`。
   * 本用例钉三件：① 读数（能量 ＋ 必中 ＋ 伤害不额外加成）② 单位带族 ③ **必中真的绕开闪避**。
   */
  it('R 族近防炮覆写：弹种能量 · 必中（不吃闪避）· 伤害维持全局值', () => {
    const r = pdShotOf(bal, 'R', 1)
    expect(r.dmgType, 'R 族近防炮弹种 = 能量').toBe('plasma')
    expect(r.autoHit, 'R 族近防炮必中').toBe(true)
    expect(r.dmg, '单发伤害仍走全局值（船长选「甲」）').toBe(bal.pdDmg)
    expect(r.acc, '命中率那一项照旧（必中支不再用它，但读数保留）').toBe(bal.pdAcc)
    // 档系数照旧：T5 ×4 ⇒ 20（与 A 族同值，只换弹种与必中）
    expect(pdShotOf(bal, 'R', 5)).toEqual({ acc: bal.pdAcc, dmg: bal.pdDmg * 4, dmgType: 'plasma', autoHit: true })
    // 别的族一个都不许变成必中
    for (const fam of ['A', 'C', 'D', 'E', 'G', 'H'] as const) {
      expect(pdShotOf(bal, fam, 1).autoHit, `${fam} 族不该必中`).toBe(false)
      expect(pdShotOf(bal, fam, 1).dmgType, `${fam} 族弹种不该变成能量`).toBe('kinetic')
    }
    // 单位带族：R 族四张卡的舰级都要带 `family: 'R'`（否则覆写取不到）
    for (const id of ['corona-drift', 'corona-split', 'corona-converge', 'corona-nexus']) {
      const card = ANOMALIES_FLAVORED.find((x) => x.id === id)!
      expect(card.threat, `${id} 威胁 ≥ pdThreatFloor 才有近防炮`).toBeGreaterThanOrEqual(bal.pdThreatFloor)
      expect(createFoeSpecs(card, bal).every((s) => s.family === 'R'), `${id} 的单位带族 R`).toBe(true)
    }
  })

  /**
   * **必中的真行为读数**（不是只断言字段）：同一张 R 族卡、同一随机种子，跑两场真战斗 ——
   * 一场按现行配置（R = 能量 ＋ 必中），一场把 `autoHit` 摘掉（其余一字不动，等于"动能版 R 族近防炮"）
   * ⇒ 必中那一场的**击落架数必须不少于**掷骰那一场，且掷骰场的命中上限被机型闪避压住。
   * ⚠ 这一条是**读数型断言**（不是精确等值）：它回答"必中是否真的落到伤害上"，
   * 具体架数由平衡决定（用例只钉单调关系与"掷骰场命中 < 1"）。
   */
  it('真战斗读数：R 族必中近防炮击落架数 ≥ 摘掉必中的对照场', () => {
    const itemId = 'corona-converge' // R 族核心卡（2 波 · 威胁 129 ≥ 门槛 ⇒ 敌人装近防炮）
    const makeState = (seed: number): GameState => {
      const s = createInitialState({ nowWallMs: 0, seed })
      const uid = addShipToFleet(s, 'sh-sentinel') // 王鲭：4 高槽 + 机巢，与 drone-loss 同款载体
      s.shipId = uid
      for (const k of [
        'drone-warfare', 'drone-servicing', 'gunnery', 'kinetic-gunnery', 'laser-cannon', 'fire-control',
        'reload-drills', 'shield-operation', 'energy-management', 'hull-upgrades',
      ]) s.skills.trained[k] = 5
      s.fleet[uid]!.fitted = {
        high: ['mod-drone-rack-3', 'mod-drone-rack-3', 'mod-drone-tac-3', 'mod-drone-tac-3'],
        mid: ['mod-shield-kin-2', 'mod-track-2', 'mod-gyro-2'],
        low: ['mod-stab-kin-2', 'mod-rof-2', 'mod-armor-kin-2'],
      }
      s.fleet[uid]!.droneLoad = { 'drone-heavy': 4, 'drone-sentry': 6 }
      for (const [id, n] of Object.entries({ 'drone-heavy': 4, 'drone-sentry': 6 })) addWare(s, id, n)
      return s
    }
    /** R 族卡：把单发压到 0.2（只动这一场的克隆卡，不污染共享对象）⇒ 战斗活到近防炮出结果 */
    const card = ctx.anomalies.get(itemId)!
    const calm: typeof card = {
      ...card,
      ships: card.ships?.map((sl) => ({ ...sl, ship: { ...sl.ship, shotDmg: 0.2 } })),
    }
    const withCalm = (c: SimContext): SimContext => ({ ...c, anomalies: new Map([...c.anomalies, [itemId, calm]]) })
    const noAutoHit: SimContext = {
      ...ctx,
      balance: {
        ...ctx.balance,
        battle: {
          ...ctx.balance.battle,
          pdFamilyOverride: {
            ...ctx.balance.battle.pdFamilyOverride,
            R: { dmgType: 'plasma' }, // 摘掉 autoHit（其余一字不改）
          },
        },
      },
    }
    const run = (c: SimContext, seed: number, evasion: Record<string, number>): { lost: number; hp: number; note: string } => {
      const s = makeState(seed)
      const battle = startBattleFor(s, c, s.shipId, itemId, 0)!
      s.expedition.active = true
      s.expedition.phase = 'battle'
      s.expedition.anomalyId = itemId
      s.expedition.battle = battle
      s.gameMs = c.balance.battle.maxBattleMs + 5_000 + waveGapTotalMs(c.anomalies.get(itemId), c.balance.battle)
      advanceBattleFor(s, c, battle, s.shipId, itemId)
      const pools = Object.values(battle.dronePools ?? {})
      const lost = pools.filter((p) => !p.alive).length
      const hp = pools.reduce((n, p) => n + p.s + p.a + p.h, 0)
      const ev = pools.map((p) => `${p.artId ?? '?'}=${p.artId !== undefined ? (evasion[p.artId] ?? '?') : '?'}`).join(' ')
      return { lost, hp, note: `剩余总血 ${Math.round(hp)} · 机型闪避 ${ev} · 距离 ${Math.round(battle.distanceM)} · 我发 ${battle.stats.meShots}` }
    }
    /** 把机型的**闪避拉到最高**（0.55）⇒ 掷骰支的命中会被 `clamp(下限 0.1, 1, 0.7 − 0.55) = 0.15` 压死 */
    const highEvasion: SimContext = {
      ...ctx,
      items: new Map([...ctx.items].map(([id, def]) => [id, def.kind === 'drone' ? { ...def, evasion: 0.55 } : def])),
    }
    const hit = run(withCalm(highEvasion), 11, { 'drone-heavy': 0.55, 'drone-sentry': 0.55 })
    const rolled = run(withCalm(noAutoHit), 11, { 'drone-heavy': 0.55, 'drone-sentry': 0.55 })
    console.log(`  [读数] 必中场（R 能量光束近防炮）：击落 ${hit.lost} · ${hit.note}`)
    console.log(`  [读数] 对照场（摘掉必中，同一 R 族卡）：击落 ${rolled.lost} · ${rolled.note}`)
    expect(hit.hp, '必中场必须真的掉血（必中 ⇒ 每次判定都进伤害）').toBeLessThan(rolled.hp)
    expect(rolled.hp - hit.hp, '必中净多打掉的机群血量应为可观的量级').toBeGreaterThan(100)
    expect(hit.lost, `必中场击落 ${hit.lost} 应 ≥ 掷骰场 ${rolled.lost}`).toBeGreaterThanOrEqual(rolled.lost)
  })

  /**
   * **族专属无人机也要吃"优先打哨戒与攻坚"的档位**（2026-09-26 加）。
   *
   * 由来：`PD_PRIORITY_BY_ART` 原先只登记制式两型，而 `pdPriorityOf` 的 `role` 兜底**只认敌方机型**
   * （我方打的是敌机、按敌机 id 查不到才回落 role）⇒ 玩家的**专属**哨戒/攻坚机落进"其余等权"，
   * 与船长 2026-09-12 的口径（「优先攻击哨戒和攻坚无人机」）不符。
   * 同批还有一条更硬的漏洞：这三型在**战斗演出表**里从未登记 ⇒ 弹道与击落演出直接跳过
   * （船长报障「玩家的构件哨戒无人机不会出现在战斗场景中」；那道闸门在 `npm run art:ships:check`）。
   */
  it('专属无人机同档位优先：构件哨戒 = 0 · 巢卫攻坚 = 1 · 墨潮重袭 = 1 · 鱿蜂（侦察档）= 2', () => {
    expect(pdPriorityOf('drone-wh-e-sentry'), 'E 构件哨戒').toBe(0)
    expect(pdPriorityOf('drone-wh-c-heavy'), 'C 巢卫攻坚').toBe(1)
    expect(pdPriorityOf('drone-ink-heavy'), 'H 墨潮重袭（攻坚档）').toBe(1)
    expect(pdPriorityOf('drone-exile-bee'), 'G 鱿蜂（侦察档，与其他侦察机等权）').toBe(2)
    // 制式两型不受影响；未知 id 仍走 role 兜底（敌机路径靠它）
    expect(pdPriorityOf('drone-sentry')).toBe(0)
    expect(pdPriorityOf('drone-heavy')).toBe(1)
    expect(pdPriorityOf('foe-drone-e-alert')).toBe(2)
    expect(pdPriorityOf('unknown-drone', 'sentry')).toBe(0)
  })
})
