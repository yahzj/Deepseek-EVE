/**
 * **虫洞 · 谜质储存器（F3c A 批 · 船长 2026-09-13 逐条裁定）**。
 *
 * 锁住这批的六组口径：
 * ① **装置表 ↔ 数据表 ↔ 形状表三处一致**（一台 = 2000 m³ = 2×2 = 4 格，全 `unreleased`）；
 * ② **每层保底 1 个谜质格**（船长：「每层保底 1 个谜质格」）；
 * ③ **哪一台按 (种子, 层, 格) 定死**（不写存档 ⇒ 读档后还是同一台）；
 * ④ **效果一律从货仓现算**（扫描半径 / 打捞·采集堆数 / 母矿产量 / 仓格）；
 * ⑤ **回合实时派生 + 夹紧**（船长：「实时派生 + 夹紧 + 丢弃提醒」）：
 *    装上就 +10、丢掉就 −10 并把剩余夹到新上限、**永不为负**、**0 回合照样能撤离**；
 * ⑥ **老档零迁移**（`turnsBase` 缺失时按"当前上限 − 当前加成"反推）；
 * ⑦ **谜质格只发装置**（2026-09-16 玩家报障「从谜质中获得了图纸货柜」取证固化：玩家澄清是看错，
 *    这里把"谜质格出不了货柜"钉成常驻护栏）。
 *
 * ✅ 2026-09-14 船长解除不可见；本文件不产生玩家可见文案。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import { addShipToFleet } from '../src/shipyard'
import { wormholeEnter, wormholeExtract } from '../src/wormhole'
import {
  WORMHOLE_MATTER_DEVICES,
  WORMHOLE_MATTER_DEVICE_IDS,
  WORMHOLE_MATTER_DRAW_POOL,
  WORMHOLE_MATTER_ENEMY_HIT_DOWN_CAP,
  WORMHOLE_MATTER_EVASION_CAP,
  wormholeMatterApplyTurnDelta,
  wormholeMatterBuffs,
  wormholeMatterDeviceAt,
  wormholeMatterDeviceOf,
  wormholeMatterDiscardHint,
  wormholeMatterThreatMul,
} from '../src/wormholeMatter'
import { WORMHOLE_HOLD_SHAPES, wormholeShapeOf } from '../src/wormholeHold'
import { WORMHOLE_MATTER_FLOOR, gridScanTargets, wormholeMakeGrid } from '../src/wormholeGrid'
import {
  WORMHOLE_BP_BOX_IDS,
  wormholeCollectOreAt,
  wormholeEnsureArrivalPiles,
  wormholeHoldCapacityOf,
  wormholeHoldDiscard,
  wormholeRelicBoxPoolOf,
  wormholeSalvageAt,
  wormholeStowOrTemp,
  wormholeSyncMatterTurns,
  wormholeTakePileAt,
} from '../src/wormholeSalvage'
import { wormholeActivateAt, wormholeStartBattle, wormholeTravelTo } from '../src/wormholeBattle'
import { applyMatterPlayerBuffs, carryVolleyOverflow, droneRecoveryRateWithBonus, rawDamageToKill, wormholeMatterBattleModsOf } from '../src/combat'
import { applyDamage } from '../src/combat'
import { wormholeFoeThreat } from '../src/wormholeFoes'
import type { UnitSpec } from '../src/combat'
import { wormholeCardIdForRun } from '../src/wormholeFoes'
import { createFoeSpecs, wormholeDerivedAnomaly } from '../src/combat'
import { WORMHOLE_MATTER_BUFFS_NONE } from '../src/wormholeMatter'

const ctx = buildSimContext()
const T3 = 'sh-thresher'

/** 起一趟：`ships` 艘巡洋舰 */
function enterRun(ships = 4, seed = 777): GameState {
  const state = createInitialState({ nowWallMs: 0, seed })
  const ids: string[] = []
  for (let i = 0; i < ships; i++) ids.push(addShipToFleet(state, T3))
  state.shipId = ids[0]!
  expect(wormholeEnter(state, ctx, ids, seed).ok).toBe(true)
  return state
}

describe('虫洞 · 谜质装置（F3c A 批）', () => {
  it('① 装置表 / 数据表 / 形状表三处一致：2×2 = 4 格、2000 m³、已上线可见', () => {
    expect(WORMHOLE_MATTER_DEVICES.length).toBeGreaterThan(0)
    expect(WORMHOLE_MATTER_DEVICE_IDS.length).toBe(WORMHOLE_MATTER_DEVICES.length)
    for (const d of WORMHOLE_MATTER_DEVICES) {
      const item = ctx.items.get(d.id)
      expect(item, `物品表里应有 ${d.id}`).toBeDefined()
      expect(item!.kind).toBe('matter')
      expect(item!.unitM3).toBe(2000)
      // 2026-09-14 虫洞上线（船长「解除不可见」）⇒ 不再标 unreleased（手册图鉴里看得到）
      expect(item!.unreleased).toBeUndefined()
      // 形状表登记（没登记 ⇒ 会被当散货合并进背包，只占 1 格、形状丢失）
      expect(WORMHOLE_HOLD_SHAPES[d.id]).toBeDefined()
      const shape = wormholeShapeOf(d.id)
      expect(shape.w * shape.h).toBe(4)
    }
  })

  /**
   * **退役装置**（2026-09-15 船长「虫洞的撤离战取消吧」带出的第一批）：
   * 撤离掩护器只能压"撤离战威胁"，而撤离战整条退役 ⇒ 它**留档但不再抽出**。
   * 这条同时钉住三件事：① 退役项仍在装置表里（老档读得懂）；② 抽取池排除它（不再产出）；
   * ③ 真按散列抽 2000 次也抽不到它（`wormholeMatterDeviceAt` 的池子已换）。
   */
  it('①b 退役装置：撤离掩护器留档可读、但不进抽取池（抽 2000 次也抽不到）', () => {
    const dev = wormholeMatterDeviceOf('mat-extract-cover')
    expect(dev, '退役项仍要在装置表里（老档货仓里可能正带着它）').toBeDefined()
    expect(dev!.name).toBe('撤离掩护器')
    expect(dev!.retired).toBe(true)
    expect(
      WORMHOLE_MATTER_DRAW_POOL.some((d) => d.id === 'mat-extract-cover'),
      '退役项不该在抽取池里',
    ).toBe(false)
    expect(WORMHOLE_MATTER_DRAW_POOL.every((d) => d.retired !== true)).toBe(true)
    const hits = new Set<string>()
    for (let i = 0; i < 2000; i++) hits.add(wormholeMatterDeviceAt(i, (i % 8) + 1, `cell-${i}`).id)
    expect(hits.has('mat-extract-cover'), '抽 2000 格都不该出现退役项').toBe(false)
    // 池子覆盖了其余全部在役装置（排除退役后不是"抽来抽去只有几种"）
    expect(hits.size).toBeGreaterThan(5)
  })

  it('② 每层保底 1 个谜质格（多 seed × 多层真数一遍）', () => {
    for (let depth = 1; depth <= 5; depth++) {
      for (let seed = 1; seed <= 40; seed++) {
        const grid = wormholeMakeGrid(seed, depth, 0)
        const n = grid.cells.filter((c) => c.place === 'matter').length
        expect(n, `层 ${depth} · seed ${seed} 应至少 ${WORMHOLE_MATTER_FLOOR} 个谜质格`).toBeGreaterThanOrEqual(
          WORMHOLE_MATTER_FLOOR,
        )
      }
    }
  })

  it('③ 哪一台按 (种子, 层, 格) 定死：同输入同输出、且必在装置表里', () => {
    const a = wormholeMatterDeviceAt(1234, 2, '3,-1')
    const b = wormholeMatterDeviceAt(1234, 2, '3,-1')
    expect(a.id).toBe(b.id)
    expect(WORMHOLE_MATTER_DEVICE_IDS).toContain(a.id)
    // 不同格 / 不同层会换台（至少不是恒同一台）
    const set = new Set<string>()
    for (let q = 0; q < 12; q++) set.add(wormholeMatterDeviceAt(1234, 2, `${q},0`).id)
    expect(set.size).toBeGreaterThan(1)
  })

  it('④ 派生：扫描半径 / 回合 / 打捞·采集堆数 / 母矿倍率 / 仓格 逐类相加', () => {
    const run = enterRun().wormhole.run!
    run.hold = { placements: [], cols: 8 }
    const hold = run.hold
    const add = (itemId: string, n: number): void => {
      for (let i = 0; i < n; i++) {
        hold.placements.push({ id: `${itemId}-${i}`, kind: 'box', itemId, x: 0, y: i, w: 2, h: 2 })
      }
    }
    expect(wormholeMatterBuffs(hold).devices).toBe(0)
    add('mat-surveyor', 2)
    add('mat-chrono', 1)
    add('mat-crane', 1)
    add('mat-drill', 1)
    add('mat-nebula', 1)
    add('mat-enricher', 2)
    add('mat-expander', 1)
    const b = wormholeMatterBuffs(hold)
    expect(b.devices).toBe(9)
    expect(b.scanRadius).toBe(2)
    expect(b.turnBonus).toBe(10)
    expect(b.salvagePiles).toBe(1)
    expect(b.collectPiles).toBe(1)
    expect(b.nebulaDisperse).toBe(2)
    expect(b.oreYieldMul).toBeCloseTo(1.5, 5)
    expect(b.holdCells).toBe(8)
    // 扫描半径加成真的让"这一扫能揭更多格"
    const grid = run.grid!
    expect(gridScanTargets(grid, b.scanRadius).length).toBeGreaterThan(gridScanTargets(grid, 0).length)
    // 仓格加成走同一条派生（容量 +8）
    const capBase = wormholeHoldCapacityOf(enterRun(), ctx)
    const s2 = enterRun()
    s2.wormhole.run!.hold = { placements: [], cols: 8 }
    wormholeStowOrTemp(s2, ctx, 'mat-expander', 1)
    expect(wormholeHoldCapacityOf(s2, ctx)).toBe(capBase + 8)
  })

  it('⑤ 回合实时派生 + 夹紧：装上 +10、丢掉 −10 且夹到上限、0 回合仍能撤离', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    const base = run.turnsTotal
    // 装一台时序核心 ⇒ 上限与剩余各 +10（`wormholeStowOrTemp` 内部会同步）
    const stowed = wormholeStowOrTemp(state, ctx, 'mat-chrono', 1)
    expect(stowed.ok).toBe(true)
    expect(stowed.where).toBe('hold')
    expect(run.turnsTotal).toBe(base + 10)
    expect(run.turnsLeft).toBe(base + 10)
    // 花掉一些回合（模拟探索），再丢掉它 ⇒ 上限回到 base、剩余夹到上限、永不为负
    run.turnsLeft = base + 3
    const box = run.hold!.placements.find((p) => p.itemId === 'mat-chrono')!
    expect(wormholeMatterDiscardHint('mat-chrono')).toContain('少 10 回合')
    const dropped = wormholeHoldDiscard(state, ctx, box.id)
    expect(dropped.ok).toBe(true)
    expect(run.turnsTotal).toBe(base)
    expect(run.turnsLeft).toBeLessThanOrEqual(run.turnsTotal)
    expect(run.turnsLeft).toBeGreaterThanOrEqual(0)
    // **0 回合也照样能撤离**（丢弃回合装置不会软锁——撤离不看回合）
    run.turnsLeft = 0
    expect(wormholeExtract(run).ok).toBe(true)
    // 幂等：再同步一次不变
    const snap = { total: run.turnsTotal, left: run.turnsLeft }
    wormholeSyncMatterTurns(state)
    expect(run.turnsTotal).toBe(snap.total)
    expect(run.turnsLeft).toBe(snap.left)
  })

  it('⑥ 老档零迁移：没有 `turnsBase` 时按"当前上限 − 当前加成"反推', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    delete run.turnsBase
    const total = run.turnsTotal
    wormholeSyncMatterTurns(state)
    expect(run.turnsBase).toBe(total)
    expect(run.turnsTotal).toBe(total)
    // 手工把一台装置塞进货仓（模拟老档里本来就有装置的情形）⇒ 下一次同步把上限抬到 base + 10
    run.hold = { placements: [{ id: 'x', kind: 'box', itemId: 'mat-chrono', x: 0, y: 0, w: 2, h: 2 }], cols: 8 }
    wormholeSyncMatterTurns(state)
    expect(run.turnsTotal).toBe(total + 10)
  })

  it('⑦ 走到谜质格取回：装置进包（2×2）且回合按派生结清', () => {
    const state = enterRun(4, 20260913)
    const run = state.wormhole.run!
    const grid = run.grid!
    const target = grid.cells.find((c) => c.place === 'matter' && c.key !== `${grid.pos.q},${grid.pos.r}`)!
    expect(target).toBeDefined()
    const moved = wormholeTravelTo(state, ctx, { q: target.q, r: target.r }, { confirmUnknown: true })
    expect(moved.ok).toBe(true)
    const expected = wormholeMatterDeviceAt(run.seed ?? 0, run.depth, target.key)
    const before = run.turnsTotal
    const act = wormholeActivateAt(state, ctx)
    expect(act.ok, act.error).toBe(true)
    // 装置落进货仓（腾得出 2×2）或临时空间（腾不出）——两种都算成功
    const inHold = (run.hold?.placements ?? []).some((p) => p.itemId === expected.id)
    const inTemp = (run.temp ?? []).some((s) => s.itemId === expected.id)
    expect(inHold || inTemp, `应拿到 ${expected.id}`).toBe(true)
    if (expected.id === 'mat-chrono' && inHold) expect(run.turnsTotal).toBe(before + 10)
    else expect(run.turnsTotal).toBe(before)
    // 同一格再激活：不重复给（已 activated）
    const again = wormholeActivateAt(state, ctx)
    expect(again.ok).toBe(false)
  })

  /**
   * **谜质格只发谜质装置**（2026-09-16 玩家报障取证固化：「从谜质中获得了图纸货柜」⇒ 玩家当场澄清是**看错**）。
   *
   * 这条护栏钉两件事，免得日后有人把「格上产出」的闸门改松：
   * ① **三条作业入口在谜质格上全被拒**（打捞 / 采集 / 逐堆拾取都要对的地点）⇒ 不扣回合、不动仓库；
   * ② **多 seed × 多层扫一遍**：谜质格激活发到手的**只能是装置表里的那台**（`wormholeMatterDeviceOf` 认得），
   *    且货仓/临时空间/背包里**绝不出现 `box-*`**（图纸货柜的正规来源只有遗迹掉落池与残骸堆那条 0.75%）。
   */
  it('⑦b 谜质格只发谜质装置：打捞/采集/拾取一律被拒，扫遍各层也出不了货柜', () => {
    // ① 单格：三条作业入口全拒、不扣回合、不动仓库
    const state = enterRun(4, 20260916)
    const run = state.wormhole.run!
    const grid = run.grid!
    /** 站到谜质格上 = 挪 `grid.pos` + 走"到达那一刻"的真实钩子（铺堆逻辑就在那里面） */
    const here = grid.cells.find((c) => c.place === 'matter')!
    grid.pos = { q: here.q, r: here.r }
    wormholeEnsureArrivalPiles(state, ctx)
    expect((here.piles ?? []).length, '谜质格不该铺堆').toBe(0)
    const turnsBefore = run.turnsLeft
    const wareBefore = { ...state.warehouse.items }
    expect(wormholeSalvageAt(state, ctx).ok).toBe(false)
    expect(wormholeCollectOreAt(state, ctx).ok).toBe(false)
    expect(wormholeTakePileAt(state, ctx, 0).ok).toBe(false)
    expect(run.turnsLeft).toBe(turnsBefore)
    expect(state.warehouse.items).toEqual(wareBefore)
    // ② 图纸货柜的正规来源（对照）：遗迹掉落池里才有它
    expect(wormholeRelicBoxPoolOf(ctx)).toEqual(expect.arrayContaining([...WORMHOLE_BP_BOX_IDS]))

    // ③ 多 seed × 层 1~5：谜质格只发装置
    let granted = 0
    /** 件数账（**按重数比**：同一盘里两台同型装置是合法的，不能用"清单里有没有"判新增） */
    const held = (r: typeof run): Map<string, number> => {
      const out = new Map<string, number>()
      const bump = (id: string): void => {
        out.set(id, (out.get(id) ?? 0) + 1)
      }
      for (const p of r.hold?.placements ?? []) bump(p.itemId)
      for (const p of r.tempGrid?.placements ?? []) bump(p.itemId)
      for (const p of r.bag ?? []) bump(p.itemId)
      return out
    }
    const addedOf = (before: Map<string, number>, after: Map<string, number>): string[] => {
      const out: string[] = []
      for (const [id, n] of after) for (let i = n - (before.get(id) ?? 0); i > 0; i--) out.push(id)
      return out
    }
    for (let seed = 1; seed <= 12; seed++) {
      for (const depth of [1, 2, 3, 4, 5]) {
        const s = enterRun(2, seed)
        const r = s.wormhole.run!
        if (depth !== 1) {
          r.depth = depth
          r.grid = wormholeMakeGrid(seed, depth)
        }
        const g = r.grid!
        for (const cell of g.cells.filter((c) => c.place === 'matter')) {
          g.pos = { q: cell.q, r: cell.r }
          const before = held(r)
          const act = wormholeActivateAt(s, ctx)
          const added = addedOf(before, held(r))
          for (const id of added) {
            expect(wormholeMatterDeviceOf(id), `seed ${seed} 层 ${depth} 格 ${cell.key} 发了非装置：${id}`).toBeDefined()
            expect(id.startsWith('box-'), `谜质格出货柜：${id}`).toBe(false)
          }
          if (!act.ok) continue
          granted += 1
          expect(added, '取回成功就该拿到那一台装置').toContain(wormholeMatterDeviceAt(r.seed ?? 0, r.depth, cell.key).id)
        }
      }
    }
    expect(granted, '样本里应当真取回过装置（否则这条护栏是空转）').toBeGreaterThan(10)
  })

  it('⑧ 非回合装置的"丢弃提醒"为空（界面照旧直接抛）', () => {
    expect(wormholeMatterDiscardHint('mat-surveyor')).toBeNull()
    expect(wormholeMatterDiscardHint('box-relic-a')).toBeNull()
    // 直接调 delta 也不该动回合
    const fake = { turnsLeft: 5, turnsTotal: 9 }
    wormholeMatterApplyTurnDelta(fake, 'mat-drill', 1)
    expect(fake).toEqual({ turnsLeft: 5, turnsTotal: 9 })
  })
})

/** 造一批装置（数量任意，用来顶封顶） */
function holdWith(counts: Record<string, number>): { placements: Array<{ id: string; kind: 'box'; itemId: string; x: number; y: number; w: number; h: number }>; cols: number } {
  const placements: Array<{ id: string; kind: 'box'; itemId: string; x: number; y: number; w: number; h: number }> = []
  let i = 0
  for (const [itemId, n] of Object.entries(counts)) {
    for (let k = 0; k < n; k++) placements.push({ id: `${itemId}-${i++}`, kind: 'box', itemId, x: 0, y: 0, w: 2, h: 2 })
  }
  return { placements, cols: 8 }
}

/** 一份最小可用的我方单位规格（只填 `applyMatterPlayerBuffs` 会碰的字段） */
function fakeSpec(): UnitSpec {
  return {
    tag: 'player',
    name: '测试舰',
    side: 'me',
    hp: { s: 1000, a: 1000, h: 1000 },
    resists: {},
    evasion: 0.1,
    hitBonus: 0.02,
    signatureM: 100,
    scanResMm: 400,
    speedMps: 200,
    agility: 0.3,
    weapons: [
      { label: '测试炮', kind: 'fixed', fixedType: 'kinetic', shotDmg: 100, maxRangeM: 3000, minRangeM: 500, hitRate: 0.75, falloff: 0.5, reloadMs: 4000 },
    ],
  } as unknown as UnitSpec
}

describe('虫洞 · 谜质装置（F3c B1 批：威胁与战斗静态增益）', () => {
  it('① 四类封顶：威胁最多 −50% · 回避 +0.25 · 敌方命中 −0.25 · 抗性 0.9（其余不封顶）', () => {
    const b = wormholeMatterBuffs(
      holdWith({
        'mat-suppressor': 40, // 40×5% = 200% ⇒ 必须夹到 −50%
        'mat-gyro': 20, // 20×0.05 = 1.0 ⇒ 夹到 0.25
        'mat-jammer': 20, // 同上
        'mat-shield-res': 40, // 40×0.10 = 4.0 ⇒ 夹到 0.9
        'mat-tracker': 20, // 不封顶：20×0.05 = 1.0
        'mat-ammo-dmg': 20, // 不封顶：20×0.08 = 1.6
      }),
    )
    expect(wormholeMatterThreatMul(b, 'node')).toBeCloseTo(0.5, 6)
    expect(b.evasion).toBeCloseTo(WORMHOLE_MATTER_EVASION_CAP, 6)
    expect(b.enemyHitDown).toBeCloseTo(WORMHOLE_MATTER_ENEMY_HIT_DOWN_CAP, 6)
    expect(b.resistShield).toBeCloseTo(0.9, 6)
    expect(b.hitBonus).toBeCloseTo(1.0, 6)
    expect(b.damagePct).toBeCloseTo(1.6, 6)
  })

  it('② 威胁三档：压制力场三档同源 · 守卫解析仪只压守卫 · 撤离掩护器只压撤离', () => {
    const press = wormholeMatterBuffs(holdWith({ 'mat-suppressor': 2 })) // −10%
    expect(wormholeMatterThreatMul(press, 'node')).toBeCloseTo(0.9, 6)
    expect(wormholeMatterThreatMul(press, 'boss')).toBeCloseTo(0.9, 6)
    expect(wormholeMatterThreatMul(press, 'extract')).toBeCloseTo(0.9, 6)
    const boss = wormholeMatterBuffs(holdWith({ 'mat-boss-analyzer': 2 })) // 守卫 −20%
    expect(wormholeMatterThreatMul(boss, 'node')).toBeCloseTo(1, 6)
    expect(wormholeMatterThreatMul(boss, 'boss')).toBeCloseTo(0.8, 6)
    expect(wormholeMatterThreatMul(boss, 'extract')).toBeCloseTo(1, 6)
    const cover = wormholeMatterBuffs(holdWith({ 'mat-extract-cover': 3 })) // 撤离 −30%
    expect(wormholeMatterThreatMul(cover, 'extract')).toBeCloseTo(0.7, 6)
    expect(wormholeMatterThreatMul(cover, 'boss')).toBeCloseTo(1, 6)
    // 三档叠加后一起夹 −50%
    const all = wormholeMatterBuffs(holdWith({ 'mat-suppressor': 20, 'mat-boss-analyzer': 20, 'mat-extract-cover': 20 }))
    expect(wormholeMatterThreatMul(all, 'boss')).toBeCloseTo(0.5, 6)
    expect(wormholeMatterThreatMul(all, 'extract')).toBeCloseTo(0.5, 6)
  })

  it('③ 我方静态增益施加到单位规格：命中 / 回避 / 单层单系抗性（缺口合成 + 0.9 上限）/ 射程 / 单发 / 装填', () => {
    const spec = fakeSpec()
    const buffs = wormholeMatterBuffs(
      holdWith({
        'mat-tracker': 2, // 命中 +0.10
        'mat-gyro': 2, // 回避 +0.10
        'mat-shield-res': 1, // 护盾对 kinetic +0.10
        'mat-hull-res': 1, // 结构 +0.10
        'mat-rangefinder': 2, // 射程 +20%
        'mat-ammo-dmg': 5, // 单发 +40%
        'mat-reload': 5, // 装填 −40%
      }),
    )
    applyMatterPlayerBuffs(spec, buffs, 'kinetic')
    expect(spec.hitBonus).toBeCloseTo(0.12, 6)
    expect(spec.evasion).toBeCloseTo(0.2, 6)
    // 只对敌队主系（kinetic）加，另外两系一字不动
    expect(spec.resists.shield?.kinetic).toBeCloseTo(0.1, 6)
    expect(spec.resists.hull?.kinetic).toBeCloseTo(0.1, 6)
    expect(spec.resists.armor?.kinetic).toBeUndefined()
    expect(spec.resists.shield?.explosive).toBeUndefined()
    expect(spec.weapons[0]!.maxRangeM).toBe(3600)
    expect(spec.weapons[0]!.minRangeM).toBe(500) // 近盲带不跟着放大（放大反而吃亏）
    expect(spec.weapons[0]!.shotDmg).toBeCloseTo(140, 6)
    expect(spec.weapons[0]!.reloadMs).toBe(2400)
    // 抗性走"缺口削减"且封顶 0.9：再叠 20 台也只到 0.9
    const capped = fakeSpec()
    applyMatterPlayerBuffs(capped, wormholeMatterBuffs(holdWith({ 'mat-shield-res': 20 })), 'kinetic')
    expect(capped.resists.shield?.kinetic).toBeCloseTo(0.9, 6)
    // 没有装置 ⇒ 一字不动
    const plain = fakeSpec()
    applyMatterPlayerBuffs(plain, WORMHOLE_MATTER_BUFFS_NONE, 'kinetic')
    expect(plain.hitBonus).toBe(0.02)
    expect(plain.weapons[0]!.maxRangeM).toBe(3000)
  })

  it('④ 开战快照：威胁乘数 / 敌主系 / 敌方削弱写进 battle.wormhole，敌方总血按乘数缩水', () => {
    const state = enterRun(4, 4242)
    const run = state.wormhole.run!
    run.hold = holdWith({ 'mat-suppressor': 2, 'mat-jammer': 2, 'mat-blindspot': 2, 'mat-shield-res': 1 })
    // 敌卡按同一取值点取（族锁 + 该层档位池）；本用例只关心"谜质对威胁/命中的快照"
    const cardId = wormholeCardIdForRun({ family: run.family, seed: run.seed, depth: run.depth, kind: 'node', nodeIndex: 0 })
    const baseCard = ctx.anomalies.get(cardId)!
    const mods = wormholeMatterBattleModsOf(state, baseCard, 'node')!
    expect(mods.threatMul).toBeCloseTo(0.9, 6)
    expect(mods.foeHitDown).toBeCloseTo(0.1, 6)
    expect(mods.blindReduce).toBeCloseTo(0.1, 6)
    expect(['kinetic', 'explosive', 'plasma']).toContain(mods.foeMainType)
    // 敌卡派生：威胁乘数直接压总血预算 ⇒ 按 createFoeSpecs 实算总血比（血预算落在派生卡内部）
    const hpOf = (a: Parameters<typeof createFoeSpecs>[0]): number =>
      createFoeSpecs(a, ctx.balance.battle).reduce((n, s) => n + s.hp.s + s.hp.a + s.hp.h, 0)
    const full = wormholeDerivedAnomaly(ctx, baseCard, { depth: run.depth, kind: 'node', waves: 1 })
    const cut = wormholeDerivedAnomaly(ctx, baseCard, { depth: run.depth, kind: 'node', waves: 1, threatMul: 0.5 })
    expect(hpOf(full)).toBeGreaterThan(0)
    expect(hpOf(cut)).toBeLessThan(hpOf(full))
    expect(hpOf(cut) / hpOf(full)).toBeCloseTo(0.5, 1)
    // 敌方命中 / 近盲带也折进派生卡
    const debuffed = wormholeDerivedAnomaly(ctx, baseCard, {
      depth: run.depth,
      kind: 'node',
      waves: 1,
      foeHitDown: 0.2,
      blindReduce: 0.2,
    })
    expect(debuffed.foeHitRate ?? 0).toBeLessThan(full.foeHitRate ?? 1)
    expect(debuffed.blindDmgMul ?? 0).toBeLessThan(full.blindDmgMul ?? 1)
  })

  it('⑤ 洞内战斗真的吃到增益（走开战入口，读 battle.wormhole 快照）', () => {    /** 走到一个"舰船信号"格并开战（装置已先摆好；战斗中不能再移动 ⇒ 每趟只打一场） */
    const fightAtSignal = (seed: number, withDevice: boolean): GameState => {
      const state = enterRun(4, seed)
      const run = state.wormhole.run!
      if (withDevice) run.hold = holdWith({ 'mat-suppressor': 2, 'mat-jammer': 2 })
      const grid = run.grid!
      const target = grid.cells.find((c) => c.place === 'ship' && c.key !== `${grid.pos.q},${grid.pos.r}`)!
      expect(target, '盘面上应有舰船信号格').toBeDefined()
      expect(wormholeTravelTo(state, ctx, { q: target.q, r: target.r }, { confirmUnknown: true }).ok).toBe(true)
      // 舰船信号 = **到达即开打**（船长 2026-09-13）⇒ 走完这一步战斗就已经开起来了
      if (!run.battle) {
        const act = wormholeActivateAt(state, ctx)
        expect(act.ok, act.error).toBe(true)
      }
      expect(run.battle).toBeTruthy()
      return state
    }
    // 不带装置 ⇒ 快照是"无压制"
    const plain = fightAtSignal(9090, false).wormhole.run!
    expect(plain.battle!.wormhole?.threatMul ?? 1).toBe(1)
    expect(plain.battle!.wormhole?.foeHitDown ?? 0).toBe(0)
    // 带 2 台压制力场 + 2 台干扰发射器 ⇒ 快照里 0.9 / −0.10（逐拍重建读同一份）
    const armed = fightAtSignal(9091, true).wormhole.run!
    expect(armed.battle!.wormhole?.threatMul).toBeCloseTo(0.9, 6)
    expect(armed.battle!.wormhole?.foeHitDown).toBeCloseTo(0.1, 6)
    expect(armed.battle!.wormhole?.foeMainType).toBeTruthy()
    expect(wormholeFoeThreat(armed.depth, 'node')).toBeGreaterThan(0)
  })
})

describe('虫洞 · 谜质装置（F3c B2 批：溢火结转与战后收口）', () => {
  it('① 派生与物理上限：回收率 / 弹药退款 / 战地维修各夹 100%，齐射转移是"有/没有"', () => {
    const b = wormholeMatterBuffs(
      holdWith({
        'mat-volley': 3, // 多台不叠加（只看有没有）
        'mat-ammo-back': 20, // 20×25% = 500% ⇒ 夹 100%
        'mat-drone-net': 20, // 20×10% = 200% ⇒ 夹 100%
        'mat-field-repair': 40, // 40×5% = 200% ⇒ 夹 100%
      }),
    )
    expect(b.volleyOverflow).toBe(true)
    expect(b.ammoRefundPct).toBe(1)
    expect(b.droneRecoveryPct).toBe(1)
    expect(b.fieldRepairPct).toBe(1)
    const none = wormholeMatterBuffs(holdWith({ 'mat-surveyor': 1 }))
    expect(none.volleyOverflow).toBe(false)
    expect(none.ammoRefundPct).toBe(0)
    // 机群回收率加成走单点，且夹在 100% 以内
    const state = enterRun()
    const base = droneRecoveryRateWithBonus(state, 0)
    expect(droneRecoveryRateWithBonus(state, 0.1)).toBeCloseTo(base + 0.1, 6)
    expect(droneRecoveryRateWithBonus(state, 5)).toBe(1)
  })

  it('② 打空所需原始伤害：抗性越高越费（二分解与 applyDamage 自洽）', () => {
    const hp = { s: 100, a: 100, h: 100 }
    const plain = rawDamageToKill(hp, {}, 'kinetic')
    expect(applyDamage(hp, {}, plain, 'kinetic').dealt).toBeCloseTo(300, 3)
    // 抗性 50% ⇒ 需要的原始伤害明显更高
    const tanky = rawDamageToKill(hp, { shield: { kinetic: 0.5 }, armor: { kinetic: 0.5 }, hull: { kinetic: 0.5 } }, 'kinetic')
    expect(tanky).toBeGreaterThan(plain)
    expect(applyDamage(hp, { shield: { kinetic: 0.5 }, armor: { kinetic: 0.5 }, hull: { kinetic: 0.5 } }, tanky, 'kinetic').dealt).toBeCloseTo(300, 1)
  })

  it('③ 溢出火力转移：打死后多余的那一截转给下一艘（按下一艘自己的层克重重算）', () => {
    const foes = [
      { tag: 'foe-0' },
      { tag: 'foe-1' },
      { tag: 'foe-2' },
    ] as unknown as UnitSpec[]
    // foe-0 只剩 10 点结构 ⇒ 一发 100 打死后应有约 90 结转给 foe-1
    const b = {
      units: {
        'foe-0': { hp: { s: 0, a: 0, h: 10 } },
        'foe-1': { hp: { s: 100, a: 100, h: 100 } },
        'foe-2': { hp: { s: 0, a: 0, h: 0 } }, // 已沉：不该被选中
      },
      stats: { meDmg: 0 },
    }
    const hpBefore = { s: 0, a: 0, h: 10 }
    const res = carryVolleyOverflow(b, foes, 'foe-0', 'kinetic', 100, hpBefore)
    expect(res.hits).toBe(1)
    expect(res.lastTag).toBe('foe-1')
    // foe-1 掉血 ≈ 100 − 10 = 90（层克制为 1 的纯动能口径下）
    expect(300 - (b.units['foe-1']!.hp.s + b.units['foe-1']!.hp.a + b.units['foe-1']!.hp.h)).toBeGreaterThan(50)
    expect(b.stats.meDmg).toBeGreaterThan(50)
    // 打不死 ⇒ 不结转
    const b2 = {
      units: { 'foe-0': { hp: { s: 0, a: 0, h: 500 } }, 'foe-1': { hp: { s: 100, a: 100, h: 100 } } },
      stats: { meDmg: 0 },
    }
    expect(carryVolleyOverflow(b2, foes, 'foe-0', 'kinetic', 100, { s: 0, a: 0, h: 500 }).hits).toBe(0)
    // 没有别的活敌 ⇒ 也不结转
    const b3 = {
      units: { 'foe-0': { hp: { s: 0, a: 0, h: 10 } }, 'foe-1': { hp: { s: 0, a: 0, h: 0 } } },
      stats: { meDmg: 0 },
    }
    expect(carryVolleyOverflow(b3, foes, 'foe-0', 'kinetic', 100, { s: 0, a: 0, h: 10 }).hits).toBe(0)
  })

  it('④ 齐射协调仪写进战斗快照；开战还会记一份弹药预载量（供战后回收算已耗）', () => {
    const state = enterRun(4, 5150)
    const run = state.wormhole.run!
    run.hold = holdWith({ 'mat-volley': 1 })
    const grid = run.grid!
    const target = grid.cells.find((c) => c.place === 'ship' && c.key !== `${grid.pos.q},${grid.pos.r}`)!
    expect(wormholeTravelTo(state, ctx, { q: target.q, r: target.r }, { confirmUnknown: true }).ok).toBe(true)
    if (!run.battle) expect(wormholeActivateAt(state, ctx).ok).toBe(true)
    const battle = run.battle!
    expect(battle.wormhole?.volleyOverflow).toBe(true)
    // 预载量已记（空仓库时三个弹种都是 0，但字段齐备）；战后"已耗 = 预载 − 余额"靠这条不变量
    expect(battle.ammoLoaded).toBeTruthy()
    expect(battle.ammoLoaded!.kin).toBeGreaterThanOrEqual(battle.ammo.kin)
    expect(battle.ammoLoaded!.exp).toBeGreaterThanOrEqual(battle.ammo.exp)
    expect(battle.ammoLoaded!.pla).toBeGreaterThanOrEqual(battle.ammo.pla)
  })
})
