/**
 * **网与冲锋的边界（2026-09-30 船长令两条）**。
 *
 * 船长原话（照抄）：
 * 1.「**给拦截舰添加效果，不会被网子选为目标。**」
 * 2.「**给C族添加族设定，他们的冲锋不会被网子解除。**」
 *
 * 口径追问三答（船长选定）：**甲** = 网「关推进器」对 C 族无效 · **甲** = 截击舰不能被选为目标 ·
 * 两项都**做成数据开关**；文案落在 **C 族常驻的那件挂载件**上（船长：「文案写在C族的挂载件上」）。
 *
 * 落点两处（各一条单点，都在引擎里）：
 * - ① `combat.fireFoeCaptureWeb` **入口守卫**：目标带 `interceptorImmuneToWeb` ⇒ 本次网**不发出、
 *   不算用掉**（`foeWebFired` 不记），与该函数既有的"目标已被别的网钉住"同一处置；
 *   数据开关 = `ShipDef.interceptorImmuneToWeb`（只两艘 C 族截击舰写）。
 * - ② `combat.applyFoeWebDebuff` **推进器层**：带 `foeChargeWebImmune` 的单位**不清零** `thrusterBoost`
 *   （减速与闪避归零照旧）；数据开关 = `FoeMountDef.charge.webImmune`（C 族四件「虫群冲锋器」写，
 *   A 族「劫掠冲锋推进器」不写），解析单点 = `foeMounts.resolveFoeMounts`。
 *
 * ⚠ **口径读数（如实记账）**：`thrusterBoost` 目前只有**我方**机动链读
 * （`unitSpeedMulOf` 的 me 支；敌阵机动走 `foeChargeMul`）⇒ ② 在当前数据下是**规则声明 ＋ 玩家可见文案
 *  ＋ 防回归的守卫**，不改任何一条既有战斗读数；它把"C 族冲锋不吃网关推进器"这条族设定钉死在
 * 数据（件上）与引擎（单点）两处，日后若把推进器层接进敌阵，这条族设定自动成立。
 */
import { describe, expect, it } from 'vitest'
import { FOE_SHIPS, L10N, SHIPS, buildSimContext } from '@whale/data'
import {
  addShipToFleet,
  createInitialState,
  createPlayerSpec,
  startFleetBattleFor,
} from '../src/index'
import {
  FOE_MOUNT_IDS,
  FOE_MOUNTS,
  createFoeSpecs,
  resolveFoeMounts,
} from '../src/index'
import { advanceBattleFor, applyFoeWebDebuff } from '../src/combat'
import { anomaly, makeTestCtx } from './helpers'

const realCtx = buildSimContext()
const CARD = 'wh-pirate-warband'
const EWAR = 'foe-pirate-raider'

/** C 族四件「虫群冲锋器」（C 族全舰常驻的那一件） */
const SWARM_MOUNTS = [
  FOE_MOUNT_IDS.chargeSwarmT1,
  FOE_MOUNT_IDS.chargeSwarmT2,
  FOE_MOUNT_IDS.chargeSwarmT3,
  FOE_MOUNT_IDS.chargeSwarmT4,
] as const

/* ══════════════ ① 截击舰：不会被网子选为目标 ══════════════ */

describe('截击舰特性「不会被网子选为目标」（船长 2026-09-30 · 数据开关）', () => {
  it('数据：全仓只有两艘 C 族截击舰写它，且都是子分类「截击舰」', () => {
    const immune = SHIPS.filter((s) => s.interceptorImmuneToWeb === true).map((s) => s.id).sort()
    expect(immune).toEqual(['sh-wh-c-destroyer', 'sh-wh-c-frigate'])
    for (const id of immune) {
      expect(SHIPS.find((s) => s.id === id)!.subClass, `${id} 应为截击舰`).toBe('截击舰')
    }
  })

  it('规格：本船带出旗标（未写的船不写字段 ⇒ 旧口径零行为变化）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 5 })
    const ids = [
      addShipToFleet(state, 'sh-wh-c-frigate'),
      addShipToFleet(state, 'sh-wh-c-destroyer'),
      addShipToFleet(state, 'sh-thresher'),
    ]
    expect(createPlayerSpec(state, realCtx, ids[0]!)!.interceptorImmuneToWeb).toBe(true)
    expect(createPlayerSpec(state, realCtx, ids[1]!)!.interceptorImmuneToWeb).toBe(true)
    expect(createPlayerSpec(state, realCtx, ids[2]!)!.interceptorImmuneToWeb).toBeUndefined()
  })

  /**
   * **真战斗取证**（走真实开战入口 + 真实敌卡）：我方只有一艘**截击舰**时，劫掠电子舰照常开火
   * （`stats.foeShots > 0` ⇒ 不是"没开火"），但那张网**一次都没发**（`foeWebFired` 不记、账本为空）。
   */
  it('实机：敌方照常开火，但网不落在截击舰身上（不发出、不算用掉）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 11 })
    const id = addShipToFleet(state, 'sh-wh-c-frigate')
    state.shipId = id
    state.fleet[id]!.fitted = { high: ['mod-turret-kin-2'], mid: [], low: [] }
    for (const a of ['ammo-kinetic-l', 'ammo-explosive-l', 'ammo-plasma-l']) state.warehouse.items[a] = 9_000
    const b = startFleetBattleFor(state, realCtx, [id], CARD, 0, null, { depth: 4, kind: 'node', waves: 1 })!
    expect(b).toBeTruthy()
    const ewTag = Object.values(b.units).find((u) => u.name === '劫掠电子舰')?.tag
    expect(ewTag, '本卡应有劫掠电子舰').toBeTruthy()
    for (let t = 1_000; t <= 60_000; t += 1_000) {
      state.gameMs = t
      advanceBattleFor(state, realCtx, b, id, CARD)
      if (b.ended) break
    }
    expect(b.stats.foeShots, '敌方必须真的开过火（否则本用例会因"没开火"而假通过）').toBeGreaterThan(0)
    expect(b.meWebDebuffs ?? {}, '截击舰不该被网上账本').toEqual({})
    expect(b.foeWebFired?.[ewTag!], '网不发出 ⇒ 也不算用掉').not.toBe(true)
  })

  /** 对照组：同一条卡、同一段时长，换成普通舰 ⇒ 网照旧落下来（证明"上面那条不是环境没触发"） */
  it('对照：同卡同时长换普通舰，网照旧落下（截击舰那条不是环境问题）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 11 })
    const id = addShipToFleet(state, 'sh-thresher')
    state.shipId = id
    state.fleet[id]!.fitted = { high: ['mod-turret-kin-2'], mid: [], low: [] }
    for (const a of ['ammo-kinetic-l', 'ammo-explosive-l', 'ammo-plasma-l']) state.warehouse.items[a] = 9_000
    const b = startFleetBattleFor(state, realCtx, [id], CARD, 0, null, { depth: 4, kind: 'node', waves: 1 })!
    const ewTag = Object.values(b.units).find((u) => u.name === '劫掠电子舰')?.tag
    let webbed = false
    for (let t = 1_000; t <= 60_000; t += 1_000) {
      state.gameMs = t
      advanceBattleFor(state, realCtx, b, id, CARD)
      if (Object.keys(b.meWebDebuffs ?? {}).length > 0) {
        webbed = true
        break
      }
      if (b.ended) break
    }
    expect(webbed, '普通舰照旧会被网钉住').toBe(true)
    expect(b.foeWebFired?.[ewTag!]).toBe(true)
  })
})

/* ══════════════ ② C 族族设定：冲锋不被网的「关推进器」解除 ══════════════ */

describe('C 族族设定「冲锋不会被网子解除」（船长 2026-09-30 · 数据开关在挂载件上）', () => {
  it('数据：四件虫群冲锋器带旗标、A 族那件不带；解析单点把它变成运行时字段', () => {
    for (const id of SWARM_MOUNTS) {
      expect(FOE_MOUNTS[id].charge!.webImmune, `${FOE_MOUNTS[id].name} 应带 webImmune`).toBe(true)
    }
    expect(FOE_MOUNTS[FOE_MOUNT_IDS.chargePirate].charge!.webImmune, 'A 族那件不带').toBeUndefined()
    expect(resolveFoeMounts([FOE_MOUNT_IDS.chargeSwarmT4]).foeChargeWebImmune).toBe(true)
    expect(resolveFoeMounts([FOE_MOUNT_IDS.chargePirate]).foeChargeWebImmune).toBeUndefined()
    // C 族全族（走各自舰级的实际挂载）都拿到；倍率/冷却一字不变（按档契约仍由 thruster-charge 那条守）
    for (const s of FOE_SHIPS.filter((x) => x.family === 'C')) {
      const r = resolveFoeMounts(s.mounts)
      expect(r.foeChargeWebImmune, `${s.name}（${s.id}）应带 C 族旗标`).toBe(true)
      expect(r.foeChargeCooldownMs, `${s.name} 冲锋冷却沿用 10 秒`).toBe(10_000)
    }
  })

  it('建档：C 族单位的规格带旗标，A 族（劫掠电子舰条目）不带', () => {
    const ctx = makeTestCtx({ quietEvents: true })
    const cSpecs = createFoeSpecs(
      {
        ...anomaly('ano-c-immune', 'g-test', { threat: 20, tactic: 'brawl' }),
        ships: [{ ship: FOE_SHIPS.find((s) => s.id === 'foe-alien-maw')! }],
      },
      ctx.balance.battle,
    )
    expect(cSpecs[0]!.foeChargeWebImmune).toBe(true)
    const aSpecs = createFoeSpecs(
      {
        ...anomaly('ano-a-web', 'g-test', { threat: 20, tactic: 'brawl' }),
        ships: [
          {
            ship: FOE_SHIPS.find((s) => s.id === EWAR)!,
            mounts: [FOE_MOUNT_IDS.chargePirate, FOE_MOUNT_IDS.captureWeb],
          },
        ],
      },
      ctx.balance.battle,
    )
    expect(aSpecs[0]!.foeCaptureWeb, 'A 族那条仍带网').toBeDefined()
    expect(aSpecs[0]!.foeChargeWebImmune, 'A 族不带 C 族旗标').toBeUndefined()
  })

  it('引擎单点：`applyFoeWebDebuff` 对 C 族不清零推进器，减速与闪避归零照旧', () => {
    const ctx = makeTestCtx({ quietEvents: true })
    const spec = createFoeSpecs(
      {
        ...anomaly('ano-c-debuff', 'g-test', { threat: 20, tactic: 'brawl' }),
        ships: [{ ship: FOE_SHIPS.find((s) => s.id === 'foe-alien-maw')! }],
      },
      ctx.balance.battle,
    )[0]!
    spec.thrusterBoost = 0.6
    const speed0 = spec.speedMps
    const evasion0 = spec.evasion
    applyFoeWebDebuff(spec, { byTag: 'me', slowMul: 0.5, noThruster: true, noEvasion: true, atMs: 0 })
    expect(spec.thrusterBoost, 'C 族旗标 ⇒ 推进器层不动').toBe(0.6)
    expect(spec.speedMps, '减速照旧').toBe(Math.max(20, speed0 * 0.5))
    expect(spec.evasion, '闪避归零照旧').toBe(0)
    expect(evasion0).toBeGreaterThan(0)

    // 对照：不带旗标的单位（A 族）照旧被网关掉推进器层
    const plain = createFoeSpecs(
      {
        ...anomaly('ano-a-debuff', 'g-test', { threat: 20, tactic: 'brawl' }),
        ships: [{ ship: FOE_SHIPS.find((s) => s.id === EWAR)!, mounts: [FOE_MOUNT_IDS.chargePirate] }],
      },
      ctx.balance.battle,
    )[0]!
    plain.thrusterBoost = 0.6
    applyFoeWebDebuff(plain, { byTag: 'me', slowMul: 0.5, noThruster: true, noEvasion: true, atMs: 0 })
    expect(plain.thrusterBoost, '不带旗标 ⇒ 推进器层照旧清零').toBe(0)
  })
})

/* ══════════════ 文案（船长：「文案写在C族的挂载件上」） ══════════════ */

describe('文案落点（中英齐备 · id 制）', () => {
  it('挂载件那条族设定文案与船体特性那条都在唯一表里、中英都有', () => {
    const charge = L10N['ui.foeIntro.109']
    expect(charge, 'ui.foeIntro.109 应登记').toBeTruthy()
    expect(charge!.zh).toContain('冲锋不会被网子解除')
    expect(charge!.en.length).toBeGreaterThan(0)
    const trait = L10N['ui.shipInfo.245']
    expect(trait, 'ui.shipInfo.245 应登记').toBeTruthy()
    expect(trait!.zh).toBe('不会被网子选为目标')
    expect(trait!.en.length).toBeGreaterThan(0)
  })
})
