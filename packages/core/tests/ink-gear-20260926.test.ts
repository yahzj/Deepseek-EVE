/**
 * **H 族（墨潮帮）势力装备三件套**（**船长 2026-09-26**）：
 * 「**墨潮帮势力装备定为射程压制、捕获网、重袭机，分别占据高槽，高槽，攻坚机。**」
 * ＋「**1按你推荐来2，只电子舱。3，玩家的捕获网和武器一样有冷却周期，独立瞄准，不看命中，
 * 击沉携带者才解除，或者对面被击沉，不选取重复目标。对方被击沉后进入冷却，冷却结束选择新目标。
 * 重袭机单发16的动能伤害，40/80/100血量，4500射程，0.05闪避其他不变**」
 * ＋「**我方捕获网移除武器射程下降的效果，其他没问题了**」。
 *
 * 本文件钉四件事：① 池子与掉落链路 ② 墨潮电子舱（射程压制）③ 墨潮捕获网（周期/独立瞄准/解除）
 * ④ 敌方那件迁成具名挂载件 ＋ 重袭机数值 ＋ H 族残骸回收打开。
 */
import { describe, expect, it } from 'vitest'
import { ANOMALIES, FOE_SHIPS, MODULES, buildSimContext } from '@whale/data'
import { FOE_MOUNT_IDS, FOE_MOUNTS } from '../src/foeMounts'
import { FOE_LAIR_GEAR, lairGearOf } from '../src/lairs'
import {
  addModule,
  addShipToFleet,
  addWare,
  createInitialState,
  createPlayerSpec,
  startRecycleRun,
} from '../src/index'
import {
  activeFoeSpecsOf,
  advanceMyCaptureWebs,
  applyFoeWebDebuff,
  createFoeSpecs,
  foeGunMaxRangeOf,
  meFoeRangeDebuffOf,
} from '../src/combat'
import { recycleProfileOf, rollRareBoxExtra, wreckRecycleClosedOf } from '../src/salvage'
import type { AnomalyDef } from '../src/types'
import type { UnitSpec } from '../src/combat'
import type { GameState } from '../src/state'
import type { BattleState } from '../src/state'

const ctx = buildSimContext()
const bal = ctx.balance.battle
const H_POOL = ['mod-lair-ecm-h', 'mod-lair-web-h', 'drone-ink-heavy'] as const

/** 造一条装了指定件的我方船（返回规格 + 状态） */
function carrierOf(moduleId: string, shipId = 'sh-shrike'): { state: GameState; id: string; spec: UnitSpec } {
  const state = createInitialState({ nowWallMs: 0, seed: 926 })
  const id = addShipToFleet(state, shipId)
  state.shipId = id
  state.fleet[id]!.fitted = { high: [moduleId], mid: [], low: [] } as never
  const spec = createPlayerSpec(state, ctx, id)!
  return { state, id, spec }
}

/** 一张只放指定 H 族舰级的敌卡（拿它建档） */
function foesOf(shipId: string, count = 1): UnitSpec[] {
  const shell: AnomalyDef = {
    ...ANOMALIES.find((a) => a.id === 'ink-harass')!,
    id: 'probe-ink',
    ships: [{ ship: FOE_SHIPS.find((s) => s.id === shipId)!, count }],
    waves: undefined,
  }
  return createFoeSpecs(shell, bal)
}

/** 最小战斗态：敌我都要有一条**活着**的单位记录（isAlive 读数三系血） */
function battleOf(spec: UnitSpec, foes: readonly UnitSpec[] = []): BattleState {
  const units: Record<string, { name: string; hp: { s: number; a: number; h: number } }> = {
    [spec.tag]: { name: spec.name, hp: { s: 100, a: 100, h: 100 } },
  }
  for (const f of foes) units[f.tag] = { name: f.name, hp: { s: 100, a: 100, h: 100 } }
  return { lastTickGameMs: 0, units, fx: [], fxSeq: 0 } as unknown as BattleState
}

describe('H 族势力装备 · 池子与掉落链路', () => {
  it('`FOE_LAIR_GEAR.H` 三件齐备、且都能在目录里解析到', () => {
    expect(FOE_LAIR_GEAR.H).toEqual([...H_POOL])
    const card = ANOMALIES.find((a) => a.foeFamily === 'H')!
    expect(lairGearOf(card)).toEqual([...H_POOL])
    for (const id of H_POOL) {
      expect(ctx.modules.has(id) || ctx.items.has(id), `${id} 必须能被解析`).toBe(true)
    }
    // 两件高槽模块 ＋ 一架攻坚机（船长：「分别占据高槽，高槽，攻坚机」）
    expect(ctx.modules.get('mod-lair-ecm-h')!.rack).toBe('high')
    expect(ctx.modules.get('mod-lair-web-h')!.rack).toBe('high')
    expect(ctx.items.get('drone-ink-heavy')!.droneClass).toBe('assault')
  })

  it('高级箱：集齐前不重复掉同一件，三件全到手后才允许重复', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 4242 })
    const profile = { rare: true as const, lairGear: H_POOL, tier: 'common' as const }
    const got = new Set<string>()
    for (let i = 0; i < 4000 && got.size < H_POOL.length; i++) {
      const res = rollRareBoxExtra(state, ctx, profile as never)
      for (const m of res?.modules ?? []) {
        expect(got.has(m), `未集齐前不该重复掉 ${m}`).toBe(false)
        got.add(m)
        addModule(state, m, 1) // 记成"已持有"⇒ 退出候选池
      }
      for (const d of res?.drones ?? []) {
        expect(got.has(d.id), `未集齐前不该重复掉 ${d.id}`).toBe(false)
        got.add(d.id)
        addWare(state, d.id, d.count)
      }
    }
    expect([...got].sort()).toEqual([...H_POOL].sort())
  })
})

describe('墨潮电子舱（射程压制 · 高槽 · CPU 150）', () => {
  it('船长给定值：压制 15% · CPU 150', () => {
    const m = MODULES.find((x) => x.id === 'mod-lair-ecm-h')!
    expect(m.foeRangeDebuffPct).toBe(0.15)
    expect(m.cpuUse).toBe(150)
    expect(m.rack).toBe('high')
  })

  it('编队削减率：单装一件 = 15% · 一件 ＋ 一艘电子舰 = **27.75%**（乘法叠加）', () => {
    const { state, id } = carrierOf('mod-lair-ecm-h')
    expect(meFoeRangeDebuffOf(state, ctx, [id])).toBeCloseTo(0.15, 10)
    // 再加一艘电子舰（`foeRangeDebuffPct 0.15` 写在船体上）
    const ew = addShipToFleet(state, 'sh-wh-a-frigate')
    expect(meFoeRangeDebuffOf(state, ctx, [id, ew])).toBeCloseTo(1 - 0.85 * 0.85, 10)
  })

  it('实际生效：敌舰武器射程按削减率缩短（走既有 `foeGunMaxRangeOf` 单一真相源）', () => {
    const { state, id } = carrierOf('mod-lair-ecm-h')
    const foes = foesOf('foe-h-ink-corvette')
    const battle = { meFoeRangeDebuff: meFoeRangeDebuffOf(state, ctx, [id]) } as unknown as BattleState
    const f = foes[0]!
    for (const w of f.weapons as Array<{ maxRangeM: number }>) {
      if (w.maxRangeM < 3000) {
        expect(foeGunMaxRangeOf(battle, f, w), '基础射程 < 3000 的武器完全不削').toBe(w.maxRangeM)
      } else {
        expect(foeGunMaxRangeOf(battle, f, w)).toBe(Math.round(w.maxRangeM * 0.85))
      }
    }
  })
})

describe('墨潮捕获网（周期装置 · 独立瞄准 · 不看命中 · 不重复目标）', () => {
  it('船长给定值：周期 20 秒 · CPU 44 · 高槽', () => {
    const m = MODULES.find((x) => x.id === 'mod-lair-web-h')!
    expect(m.captureWebCycleMs).toBe(20_000)
    expect(m.cpuUse).toBe(44)
    expect(m.rack).toBe('high')
  })

  it('开战即钉第一个可选目标：**独立瞄准（不看命中）** · 三层效果 · **不含射程**', () => {
    const { state, spec } = carrierOf('mod-lair-web-h')
    expect(spec.myCaptureWeb!.cycleMs).toBe(20_000)
    const foes = foesOf('foe-h-ink-corvette', 2)
    const b = battleOf(spec, foes)
    const rangesBefore = foes[0]!.weapons.map((w: { maxRangeM: number }) => w.maxRangeM)
    advanceMyCaptureWebs(state, b, [spec], foes)
    const pinned = Object.entries(b.foeWebDebuffs ?? {})
    expect(pinned).toHaveLength(1)
    expect(pinned[0]![0]).toBe(foes[0]!.tag) // 按敌阵顺序取第一个
    expect(pinned[0]![1].byTag).toBe(spec.tag)
    expect(b.myWebs![spec.tag]!.targetTag).toBe(foes[0]!.tag)
    // 三层效果：机动 ×0.1 · 推进器全关 · 闪避归零（⚠ **不含"武器射程下降"**）
    expect(foes[0]!.evasion, '闪避归零').toBe(0)
    expect(foes[0]!.thrusterBoost, '推进器全关').toBe(0)
    expect(foes[0]!.weapons.map((w: { maxRangeM: number }) => w.maxRangeM), '射程一点不动（船长明令移除）').toEqual(rangesBefore)
    expect(state.logs[state.logs.length - 1]!.text).toContain('墨潮捕获网')
  })

  it('**不选取重复目标**：两台网手 ⇒ 钉两个不同的敌舰；没有可选目标时保持待发', () => {
    const a = carrierOf('mod-lair-web-h')
    const bState = createInitialState({ nowWallMs: 0, seed: 927 })
    const idB = addShipToFleet(bState, 'sh-shrike')
    bState.fleet[idB]!.fitted = { high: ['mod-lair-web-h'], mid: [], low: [] } as never
    const specB = createPlayerSpec(bState, ctx, idB)!
    specB.tag = 'mate'
    const foes = foesOf('foe-h-ink-corvette', 1) // 只有一艘可选
    const b = battleOf(a.spec, foes)
    b.units['mate'] = { name: specB.name, hp: { s: 100, a: 100, h: 100 } } as never
    advanceMyCaptureWebs(a.state, b, [a.spec, specB], foes)
    // 第二台没有可选目标 ⇒ 保持待发（**不空转冷却**）
    expect(Object.keys(b.foeWebDebuffs ?? {})).toHaveLength(1)
    expect(b.myWebs![specB.tag]!.targetTag).toBeUndefined()
    expect(b.myWebs![specB.tag]!.cooldownUntilMs, '待发 ≠ 冷却').toBe(0)
    // 再来一艘敌舰 ⇒ 第二台立刻钉它
    const extra = foesOf('foe-h-ink-corvette', 1).map((f) => ({ ...f, tag: 'foe-extra' }))
    for (const f of extra) b.units[f.tag] = { name: f.name, hp: { s: 100, a: 100, h: 100 } } as never
    const more = [...foes, ...extra]
    advanceMyCaptureWebs(a.state, b, [a.spec, specB], more)
    expect(b.myWebs![specB.tag]!.targetTag).toBe('foe-extra')
  })

  it('**目标被击沉 ⇒ 进入冷却，冷却结束才选新目标**；**携带者被击沉 ⇒ 该网解除**', () => {
    const { state, spec } = carrierOf('mod-lair-web-h')
    const foes = foesOf('foe-h-ink-corvette', 2)
    const b = battleOf(spec, foes)
    advanceMyCaptureWebs(state, b, [spec], foes)
    const first = b.myWebs![spec.tag]!.targetTag!
    // 目标被击沉（三系血全 0）
    ;(b.units[first] as { hp: { s: number; a: number; h: number } }).hp = { s: 0, a: 0, h: 0 }
    b.lastTickGameMs = 5_000
    advanceMyCaptureWebs(state, b, [spec], foes)
    expect(b.myWebs![spec.tag]!.targetTag, '目标没了 ⇒ 先清目标').toBeUndefined()
    expect(b.myWebs![spec.tag]!.cooldownUntilMs, '记冷却 = 现在 + 周期').toBe(25_000)
    expect(Object.keys(b.foeWebDebuffs ?? {})).toHaveLength(0)
    // 冷却未到 ⇒ 不张新网
    b.lastTickGameMs = 20_000
    advanceMyCaptureWebs(state, b, [spec], foes)
    expect(b.myWebs![spec.tag]!.targetTag).toBeUndefined()
    // 冷却到点 ⇒ 钉下一个（第二个目标）
    b.lastTickGameMs = 25_000
    advanceMyCaptureWebs(state, b, [spec], foes)
    expect(b.myWebs![spec.tag]!.targetTag).toBe(foes[1]!.tag)
    // 携带者被击沉 ⇒ 整条解除
    ;(b.units[spec.tag] as { hp: { s: number; a: number; h: number } }).hp = { s: 0, a: 0, h: 0 }
    advanceMyCaptureWebs(state, b, [spec], foes)
    expect(b.myWebs![spec.tag], '网手没了 ⇒ 账本删掉').toBeUndefined()
    expect(Object.keys(b.foeWebDebuffs ?? {})).toHaveLength(0)
  })

  it('三层效果施加器：`applyFoeWebDebuff` 只动机动/推进器/闪避（**不含射程**）', () => {
    const foes = foesOf('foe-h-ink-corvette')
    const f = foes[0]!
    const speed = f.speedMps
    const ranges = f.weapons.map((w: { maxRangeM: number }) => w.maxRangeM)
    applyFoeWebDebuff(f, { byTag: 'me', slowMul: 0.1, noThruster: true, noEvasion: true, atMs: 0 })
    expect(f.speedMps).toBe(Math.max(20, speed * 0.1))
    expect(f.evasion).toBe(0)
    expect(f.thrusterBoost).toBe(0)
    expect(f.weapons.map((w: { maxRangeM: number }) => w.maxRangeM)).toEqual(ranges)
  })
})

describe('敌方「墨潮干扰阵列」（舰级字段迁成具名挂载件）', () => {
  it('挂载件目录：墨潮干扰阵列 pct 0.5 · 有中英名', () => {
    const m = FOE_MOUNTS[FOE_MOUNT_IDS.inkRangeDebuff]!
    expect(m.name).toBe('墨潮干扰阵列')
    expect(m.en).toBe('Ink Tide Jammer Array')
    expect(m.rangeDebuff!.pct).toBe(0.5)
  })

  it('墨潮干扰舰：舰级不再写该字段，改由挂载件供给（单位规格上的读数逐字不变）', () => {
    const ship = FOE_SHIPS.find((s) => s.id === 'foe-h-ink-jammer')!
    expect(ship.foeRangeDebuffPct, '舰级字段已迁走').toBeUndefined()
    expect(ship.mounts).toEqual([FOE_MOUNT_IDS.captureWeb, FOE_MOUNT_IDS.inkRangeDebuff])
    const spec = foesOf('foe-h-ink-jammer')[0]!
    expect(spec.foeRangeDebuffPct, '运行时读数不变').toBe(0.5)
    expect(spec.foeMountNames).toContain('墨潮干扰阵列')
  })
})

describe('墨潮重袭无人机（船长给定值）＋ H 族残骸回收打开', () => {
  it('说明文案与属性一致（2026-09-26 报障「描述和属性对应不上」的回归守卫）', () => {
    const d = ctx.items.get('drone-ink-heavy')!
    const std = ctx.items.get('drone-heavy')! // 制式攻坚机（对照）
    const total = (x: typeof d): number =>
      (x.defense?.shieldHp ?? 0) + (x.defense?.armorHp ?? 0) + (x.defense?.hullHp ?? 0)
    // 文案里的事实断言必须与数据一致：① 单发比制式重 ② 三层血更厚（**不是"最薄"**）③ 闪避最低
    expect(d.dmg!).toBeGreaterThan(std.dmg!) // 16 > 12
    expect(total(d)).toBeGreaterThan(total(std)) // 220 > 194 ⇒ 文案不得再写「机体最薄」
    expect(d.defense!.evasion!).toBeLessThan(std.defense!.evasion!) // 0.05 < 0.1
    const all = [...ctx.items.values()].filter((i) => i.kind === 'drone' && i.defense)
    const minEvasion = Math.min(...all.map((i) => i.defense!.evasion ?? 1))
    expect(d.defense!.evasion, '闪避确实是全机型最低').toBe(minEvasion)
    const desc = d.description ?? ''
    expect(desc, '文案不得写"最薄"（数据上它比制式更厚）').not.toContain('最薄')
    expect(desc, '文案应说清真正的短板 = 闪避').toContain('闪避')
    console.log(`  [读数] 描述：${desc}`)
    console.log(`  [读数] 三层血 墨潮 ${total(d)} vs 制式攻坚 ${total(std)} · 闪避 ${d.defense!.evasion}（全机型最低 ${minEvasion}）`)
  })

  it('数值逐项：单发 16 动能 · 血 40/80/100 · 射程 4500 · 闪避 0.05 · CPU 13 · 攻坚机', () => {
    const d = ctx.items.get('drone-ink-heavy')!
    expect(d.damageType).toBe('kinetic')
    expect(d.dmg).toBe(16)
    expect(d.maxRangeM).toBe(4500)
    expect(d.cpuUse).toBe(13)
    expect(d.droneClass).toBe('assault')
    expect(d.unitM3).toBe(20)
    expect(d.exclusive).toBe(true)
    expect(d.defense).toMatchObject({
      shieldHp: 40,
      armorHp: 80,
      hullHp: 100,
      evasion: 0.05,
    })
  })

  it('H 族残骸回收已打开：判据恒 false · 120 m³ 普通残骸能起炉（改前会被拒）', () => {
    expect(wreckRecycleClosedOf('wreck-h-hi', ctx)).toBe(false)
    expect(recycleProfileOf(ctx, 'wreck-h-hi'), '画像照旧').toBeTruthy()
    const state = createInitialState({ nowWallMs: 0, seed: 928 })
    addWare(state, 'wreck-h-hi', 120)
    const res = startRecycleRun(state, 'wreck-h-hi', 'pilot', ctx)
    expect(res.ok, `H 族残骸应能回收：${JSON.stringify(res)}`).toBe(true)
  })
})
