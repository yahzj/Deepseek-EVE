/**
 * **战斗伤害飘字读数**（2026-09-24 船长令：「战斗界面，我希望添加战斗伤害的数值动画（包括 MISS）」＋四答甲）。
 *
 * 表现层（`apps/desktop/.../BattleScreen.tsx`）在**目标旁**飘一个数字，数字来源就是本文件锁的
 * `BattleFx.dmg`——引擎逐发结算的**实收伤害**（`applyDamage().dealt`：盾→甲→结构真扣掉的血量，
 * 已吃层克制与层抗，含本发附伤段）。未命中 / 无伤事件（捕获网连线、机群击落演出）**不写该字段**，
 * 表现层据此只飘灰色 MISS、不出「-0」。
 *
 * 本文件锁四件事：
 *   ① 命中必有 `dmg > 0`，未命中必无 `dmg`（我方与敌方两侧同款口径）；
 *   ② **逐发加总 = 当拍真实掉血**（我方：`stats.meDmg` 增量；敌方：我方三层血量降幅）——
 *      这条把"数字必须与结算同源、不许另算一份"钉死（飘字与血条不会各说各话）；
 *   ③ 纯读数：写入 `dmg` 不改变任何结算（同种子下伤害/命中数与不带该字段时逐值相同）；
 *   ④ 事件环裁剪（48 条上限）后仍按 `seq` 续播不受影响（既有语义，这里顺带守一条）。
 */
import { describe, expect, it } from 'vitest'
import type { BattleFx, BattleState } from '../src/state'
import { createInitialState } from '../src/state'
import { advanceBattleFor, startBattleFor } from '../src/combat'
import { addModule, fitModule } from '../src/equipment'
import { anomaly, makeTestCtx, moduleDef, ship } from './helpers'

/** 我方单位 tag（'player' 主控 + 'ally-N' 僚舰） */
function myTagsOf(battle: BattleState): string[] {
  return Object.keys(battle.units).filter((t) => t === 'player' || t.startsWith('ally-'))
}

/** 我方三层血量总和（判定"实收伤害"的基准） */
function myHpSum(battle: BattleState): number {
  return myTagsOf(battle).reduce((s, t) => {
    const hp = battle.units[t]!.hp
    return s + hp.s + hp.a + hp.h
  }, 0)
}

/** 一批事件里的飘字数字之和（缺 `dmg` 按 0 计） */
function dmgSum(events: readonly BattleFx[]): number {
  return events.reduce((s, e) => s + (typeof e.dmg === 'number' ? e.dmg : 0), 0)
}

/** 只保留"真·开火事件"——排除无伤的演出事件（捕获网连线、机群击落） */
function shotEvents(events: readonly BattleFx[]): BattleFx[] {
  return events.filter((e) => e.web !== true && e.droneDown !== true)
}

/** 装一门测试炮（`hitRate` 决定必中/必失），返回可推进的战斗 */
function setup(opts: { hitRate: number; threat?: number; seed?: number; evasion?: number; shieldHp?: number }) {
  const state = createInitialState({ nowWallMs: 0, seed: opts.seed ?? 42 })
  const tur = moduleDef('tur-fx', 'turret', 0, {
    maxRangeM: 9000, // 长于敌（开局即在带内 ⇒ 第一拍就接火）
    minRangeM: 0,
    hitRate: opts.hitRate,
    falloff: 1,
    reloadMs: 900,
    dmgMult: 2,
    cpuUse: 5,
  })
  const ctx = makeTestCtx({
    ships: [
      ship('sandcat', {
        // ⚠ 默认带 20,000 盾：被打掉的盾会被**被动回充**补回来（`shieldRegenPerSec`），
        // "逐发加总 = 掉血"那条不变式会被回充搅乱 ⇒ 需要精确对账的用例传 `shieldHp: 0`
        // （盾容量 0 ⇒ 回充分支直接跳过，伤害直奔甲/结构，账目逐值对得上）。
        shieldHp: opts.shieldHp ?? 20_000,
        armorHp: 20_000,
        hullHp: 20_000,
        cpu: 300,
        evasion: opts.evasion ?? 0,
      }),
    ],
    modules: [tur],
    anomalies: [anomaly('ano-fx', 'galaxy-hub', { threat: opts.threat ?? 8, reward: 1_000 })],
  })
  state.warehouse.items['ammo-kinetic-l'] = 5_000
  addModule(state, 'tur-fx', 1)
  expect(fitModule(state, 'tur-fx', ctx).ok).toBe(true)
  const battle = startBattleFor(state, ctx, state.shipId, 'ano-fx', 0)!
  return { state, ctx, battle }
}

/** 推进到 gameMs 并只取这一拍新增的事件（按 seq 过滤，环裁剪也安全） */
function step(
  state: ReturnType<typeof createInitialState>,
  ctx: ReturnType<typeof makeTestCtx>,
  battle: BattleState,
  atMs: number,
): BattleFx[] {
  const preSeq = battle.fx.length > 0 ? battle.fx[battle.fx.length - 1]!.seq : -1
  state.gameMs = atMs
  advanceBattleFor(state, ctx, battle, state.shipId, 'ano-fx')
  return battle.fx.filter((e) => e.seq > preSeq)
}

describe('战斗飘字读数：每发实收伤害（2026-09-24 船长令）', () => {
  it('我方命中必有数字，且逐发加总 = 当拍 stats.meDmg 增量（数字与结算同源）', () => {
    const { state, ctx, battle } = setup({ hitRate: 1 }) // 命中率 1 ⇒ 每一发都命中
    const before = battle.stats.meDmg
    const fresh = step(state, ctx, battle, 5_000)
    const shots = shotEvents(fresh.filter((e) => e.side === 'me'))
    expect(shots.length).toBeGreaterThan(0)
    for (const e of shots) expect(e.hit, `事件 ${e.seq} 应命中`).toBe(true)
    for (const e of shots) expect(e.dmg, `事件 ${e.seq} 命中必须带实收伤害`).toBeGreaterThan(0)
    // 逐发加总 == 本拍真伤（`stats.meDmg` 与飘字同一批 `dealt`，不许各算一份）
    expect(dmgSum(shots)).toBeCloseTo(battle.stats.meDmg - before, 6)
    expect(battle.stats.meDmg - before).toBeGreaterThan(0)
  })

  it('我方未命中不带 dmg（命中率 0 ⇒ 恒 MISS，伤害账目一分不动）', () => {
    const { state, ctx, battle } = setup({ hitRate: 0 })
    const before = battle.stats.meDmg
    const fresh = step(state, ctx, battle, 5_000)
    const shots = shotEvents(fresh.filter((e) => e.side === 'me'))
    expect(shots.length).toBeGreaterThan(0)
    expect(shots.every((e) => e.hit === false)).toBe(true)
    expect(shots.every((e) => e.dmg === undefined)).toBe(true)
    expect(battle.stats.meDmg - before).toBe(0) // 未命中确实零伤害（飘字不是"少显示"而是"没发生"）
  })

  it('敌方打我方也带数字，且逐发加总 = 我方三层血量降幅（敌方 MISS 同样不带 dmg）', () => {
    const { state, ctx, battle } = setup({ hitRate: 0, threat: 60, seed: 9, shieldHp: 0 })
    battle.myDesireM = 500 // 主动贴脸（威胁 60 的敌舰射程较短，等它自己进带要 ~15 秒）
    const hpBefore = myHpSum(battle)
    // 敌方要接火（接近 + 装填错峰），多推几拍再合并看
    const fresh: BattleFx[] = []
    for (const at of [3_000, 6_000, 9_000, 12_000, 15_000, 18_000, 21_000]) {
      fresh.push(...step(state, ctx, battle, at))
    }
    const foeShots = shotEvents(fresh.filter((e) => e.side === 'foe'))
    expect(foeShots.length).toBeGreaterThan(0) // 敌方确实开了火
    for (const e of foeShots) {
      if (e.hit) expect(e.dmg, `敌方事件 ${e.seq} 命中必须带实收伤害`).toBeGreaterThan(0)
      else expect(e.dmg, `敌方事件 ${e.seq} 未命中不得带 dmg`).toBeUndefined()
    }
    expect(foeShots.some((e) => e.hit && (e.dmg ?? 0) > 0)).toBe(true) // 至少有一发真打进来
    // 逐发加总 == 我方三层真掉血（该档满盾为 0 ⇒ 无被动回充；无维修装置 ⇒ 无回血干扰）
    expect(hpBefore - myHpSum(battle)).toBeGreaterThan(0)
    expect(dmgSum(foeShots)).toBeCloseTo(hpBefore - myHpSum(battle), 6)
  })

  it('纯读数：写不写 dmg 都不改结算（同种子同拍，命中数/伤害/血量逐值相同）', () => {
    const a = setup({ hitRate: 0.6, seed: 123 })
    const b = setup({ hitRate: 0.6, seed: 123 })
    step(a.state, a.ctx, a.battle, 6_000)
    step(b.state, b.ctx, b.battle, 6_000)
    expect(a.battle.stats.meShots).toBe(b.battle.stats.meShots)
    expect(a.battle.stats.meHits).toBe(b.battle.stats.meHits)
    expect(a.battle.stats.meDmg).toBeCloseTo(b.battle.stats.meDmg, 9)
    expect(a.battle.stats.foeHits).toBe(b.battle.stats.foeHits)
    expect(a.battle.distanceM).toBe(b.battle.distanceM)
    // 两边的结算结果与"事件环里有没有 dmg"无关：命中事件两侧都存在且数值一致
    const aHits = shotEvents(a.battle.fx.filter((e) => e.side === 'me' && e.hit))
    const bHits = shotEvents(b.battle.fx.filter((e) => e.side === 'me' && e.hit))
    expect(aHits.length).toBe(bHits.length)
    for (let i = 0; i < aHits.length; i++) {
      expect(aHits[i]!.dmg).toBeCloseTo(bHits[i]!.dmg!, 9)
      expect(aHits[i]!.to).toBe(bHits[i]!.to)
    }
  })
})
