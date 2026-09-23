/**
 * **支援呼叫装置**（船长 2026-09-19：「**战斗开始20秒后，增援2艘幽灵舰。如果对方在自己最远射程之外时，
 * 增援2艘静滞卫舰。**」＋「因为延迟到场，所以需要一定补偿。**卡计算的实际威胁要*1.1**」）。
 *
 * 落点：`foe-d-throne`（守墓王座舰）**舰级**挂 `foe-mount-support-call`；两支到场单位写在洞内深层卡
 * 「陵墓王庭」（`wh-grave-throne`）的**条目**上（`enterAt: { sec: 20 }` ＋ `enterBranch`）。
 *
 * 本文件钉四组事：
 * 1. **数据口径**：装置参数（20 秒 / ×1.1）· 每级挂载位 · 两支成对且账面总量相等（血与火力各 ≤3%）；
 * 2. **派生**：实际威胁 = round(层威胁 × 1.1)（显示与预算同源）· 到场总量 = 同层预算 ×约 1.16 ·
 *    互斥分支**只记较重的一支**（`wormholeSkippedBranch`）⇒ 与改动前的单舰卡同量（红线：改名不改难度）；
 * 3. **战斗**：20 秒时**判定一次** —— 射程内 ⇒ 2 幽灵舰 / 射程外 ⇒ 2 静滞卫舰，**另一支永不到场**；
 *    开战与到场各推一条画面提示；判完锁死（之后再拉距离也不换支）；
 * 4. **边界**：20 秒前击毁王座舰 ⇒ 立即胜、援军不来；未到场的增援不参与判胜；分支标记不受总开关影响
 *    （派生要用它 ⇒ 关掉开关仍写 `foeReinforceBranch`，但**不写** `foeReinforceAt`）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import type { AnomalyDef, GameState, SimContext } from '../src/index'
import {
  FOE_MOUNTS,
  FOE_MOUNT_IDS,
  addShipToFleet,
  createInitialState,
  repairDeprecatedModules,
} from '../src/index'
import {
  wormholeBranchNaturalHp,
  wormholeCardThreatOf,
  wormholeNaturalHp,
  wormholeSkippedBranch,
} from '../src/wormhole'
import { advanceBattleFor, createFoeSpecs, foeHpOfThreat, startBattleFor, wormholeDerivedAnomaly } from '../src/combat'

const CARD = 'wh-grave-throne'
const ctx = buildSimContext()
const bal = ctx.balance.battle

/** 世界 = 真数据 + 一条没装武器的船（本文件只验机制；玩家血量会在开战后拉满以免 20 秒内被打死） */
function world(): { state: GameState; ctx: SimContext } {
  const state = createInitialState({ nowWallMs: 0, seed: 7 })
  const id = addShipToFleet(state, 'sh-thresher')
  state.shipId = id
  state.fleet[id]!.fitted = { high: [], mid: [], low: [] }
  repairDeprecatedModules(state, ctx)
  return { state, ctx }
}

/** 起一场「陵墓王庭」（走的是洞外那条普通战斗入口：本文件不验层派生，只验"到场机制"） */
function supportBattle(): { state: GameState; ctx: SimContext; b: NonNullable<ReturnType<typeof startBattleFor>> } {
  const { state, ctx: c } = world()
  const b = startBattleFor(state, c, state.shipId, CARD, 0)!
  expect(b, '应能开战').toBeTruthy()
  // 玩家血量拉满：王座舰单发 181/4 秒、必中光束 ⇒ 不拉满会在 20 秒内被打死（本文件只验机制）
  b.units['player']!.hp = { s: 1_000_000, a: 1_000_000, h: 1_000_000 }
  return { state, ctx: c, b }
}

/** 推进到战斗时钟第 ms 毫秒（步长 1 秒，等价实时推进） */
function tickTo(
  state: GameState,
  c: SimContext,
  b: NonNullable<ReturnType<typeof startBattleFor>>,
  ms: number,
): void {
  state.gameMs = ms
  advanceBattleFor(state, c, b, state.shipId, CARD)
}

/** 逐秒推进到 21 秒，并在每拍结束后把交战距离钉在 `pin`（判定那一刻读的就是它） */
function runToJudgement(
  state: GameState,
  c: SimContext,
  b: NonNullable<ReturnType<typeof startBattleFor>>,
  pin: number,
): void {
  for (let t = 1_000; t <= 21_000; t += 1_000) {
    tickTo(state, c, b, t)
    b.distanceM = pin
    if (b.ended) break
  }
}

const foeNames = (b: NonNullable<ReturnType<typeof startBattleFor>>): string[] =>
  Object.values(b.units)
    .filter((u) => u.side === 'foe')
    .map((u) => u.name)

const noticeTexts = (b: NonNullable<ReturnType<typeof startBattleFor>>): string[] =>
  (b.notices ?? []).map((n) => n.text)

describe('支援呼叫装置 · 数据口径', () => {
  it('装置本身：名「支援呼叫装置」· 开战 20 秒判定 · 延迟补偿 ×1.1', () => {
    const def = FOE_MOUNTS[FOE_MOUNT_IDS.supportCall]
    expect(def.name).toBe('支援呼叫装置')
    expect(def.supportCall).toEqual({ delaySec: 20, threatMul: 1.1 })
    expect(def.charge ?? null).toBeNull() // 一件一类效果（体检亦拦）
  })

  it('挂载位：守墓王座舰**舰级**挂它（只服务陵墓王庭 ⇒ 不外借）', () => {
    const throne = ctx.anomalies.get(CARD)!.ships!.find((s) => s.ship.id === 'foe-d-throne')!
    expect(throne.ship.mounts).toEqual([FOE_MOUNT_IDS.supportCall])
  })

  it('两支成对：同延时（20 秒）· 自然总血与自然火力各相等（≤3%）', () => {
    const card = ctx.anomalies.get(CARD)!
    const ins = card.ships!.filter((s) => s.enterBranch === 'inside')
    const outs = card.ships!.filter((s) => s.enterBranch === 'outside')
    expect(ins).toHaveLength(1)
    expect(outs).toHaveLength(1)
    expect(ins[0]!.enterAt?.sec).toBe(20)
    expect(outs[0]!.enterAt?.sec).toBe(20)
    // 血：幽灵 ×2 @0.68 = 587.5 / 静滞卫舰 ×2 @0.25 = 585
    expect(wormholeBranchNaturalHp(card, 'inside')).toBeCloseTo(587.52, 2)
    expect(wormholeBranchNaturalHp(card, 'outside')).toBeCloseTo(585, 2)
    // 火力：设计单发 35×2 / 39×2（含多舰补偿折算后按 reload 折算成 DPS 比）
    const dps = (br: 'inside' | 'outside'): number =>
      createFoeSpecs(card, bal)
        .filter((f) => f.foeReinforceBranch === br)
        .reduce(
          (n, f) =>
            n +
            f.weapons.reduce((m, w) => m + ((w.shotDmg ?? 0) * (w.count ?? 1) * 1000) / Math.max(1, w.reloadMs), 0),
          0,
        )
    const dpsIn = dps('inside')
    const dpsOut = dps('outside')
    expect(dpsIn).toBeGreaterThan(0)
    expect(Math.abs(dpsIn - dpsOut) / Math.max(dpsIn, dpsOut)).toBeLessThan(0.03)
  })

  it('分支标记不受总开关影响（派生要用它）；`foeReinforceAt` 才吃开关', () => {
    const card = ctx.anomalies.get(CARD)!
    const off = createFoeSpecs(card, { ...bal, foeReinforceEnabled: false })
    for (const s of off) {
      expect(s.foeReinforceAt, '关掉总开关 ⇒ 入场触发一律不写').toBeUndefined()
    }
    expect(off.filter((s) => s.foeReinforceBranch !== undefined)).toHaveLength(4) // 2 幽灵 + 2 静滞卫舰
    const on = createFoeSpecs(card, bal)
    expect(on.filter((s) => s.foeReinforceAt !== undefined)).toHaveLength(4)
  })
})

describe('支援呼叫装置 · 派生（实际威胁 ×1.1 与互斥分支记账）', () => {
  const base = ctx.anomalies.get(CARD)!

  it('实际威胁 = round(层威胁 × 1.1)：层 1 = 50 · 层 4 = 69（显示与预算同源）', () => {
    expect(wormholeCardThreatOf(base, 1, 'node')).toBe(50) // 45 × 1.1 = 49.5 → 50
    expect(wormholeCardThreatOf(base, 4, 'node')).toBe(69) // 63 × 1.1（层 4 威胁 60 → 63：2026-09-23 增幅上调）
    const d4 = wormholeDerivedAnomaly(ctx, base, { depth: 4, kind: 'node', waves: 1 })
    expect(d4.threat, '派生卡上的威胁就是那个数').toBe(69)
  })

  it('互斥分支只记较重的一支 ⇒ 到场总量与改动前的单舰卡同量（红线：改名不改难度）', () => {
    // 幽灵那一支更重 ⇒ 被排除的是 outside（同重时也取 outside，口径写在注释里）
    expect(wormholeSkippedBranch(base)).toBe('outside')
    // 王座 1840×0.68 = 1251.2 ＋ 幽灵 2×432×0.68 = 587.52 ⇒ 1838.72
    expect(wormholeNaturalHp(base)).toBeCloseTo(1838.72, 2)
    // 对照：拆掉装置与两支的"原样单舰卡"= 1840 —— 自然总血几乎逐字相同（差 0.07%）
    const bare: AnomalyDef = { ...base, ships: [{ ship: base.ships![0]!.ship, count: 1, hpMul: 1, dmgMul: 1 }] }
    expect(wormholeNaturalHp(bare)).toBe(1840)
    // 没有互斥分支的卡一律不受影响
    expect(wormholeSkippedBranch(bare)).toBeNull()
    expect(wormholeNaturalHp(bare) / wormholeNaturalHp(base)).toBeCloseTo(1.0007, 3)
  })

  it('到场总量 = 未补偿口径 × foeHpOfThreat(69)/foeHpOfThreat(63) ≈ 1.15（血与火力同比例）', () => {
    /** 到场编成 = 开战即在 + 指定的一支（另一支按设计永不到场） */
    const pick = (d: AnomalyDef, br: 'inside' | 'outside') =>
      createFoeSpecs(d, bal).filter(
        (f) => f.foeReinforceBranch === undefined || f.foeReinforceBranch === br,
      )
    const hpOf = (us: ReturnType<typeof pick>): number => us.reduce((n, f) => n + f.hp.s + f.hp.a + f.hp.h, 0)
    const dpsOf = (us: ReturnType<typeof pick>): number =>
      us.reduce(
        (n, f) =>
          n +
          f.weapons.reduce((m, w) => m + ((w.shotDmg ?? 0) * (w.count ?? 1) * 1000) / Math.max(1, w.reloadMs), 0),
        0,
      )
    const dTest = wormholeDerivedAnomaly(ctx, base, { depth: 4, kind: 'node', waves: 1 })
    /**
     * 对照 = **同一张卡退回"未补偿"的预算**：用校准覆写 `strengthMul`（`tools/wormhole-econ.ts` 同一入口）
     * 把 69 那档的预算乘回 `foeHpOfThreat(63)/foeHpOfThreat(69)` ⇒ 血/火力比 `r` 与档位修正完全一致，
     * 唯一差别就是那份 ×1.1（比造一张"拆掉装置"的对照卡更干净：不必跟派生记忆/档位查表打交道）。
     */
    const back = foeHpOfThreat(63, bal) / foeHpOfThreat(69, bal)
    const dCtrl = wormholeDerivedAnomaly(ctx, base, {
      depth: 4,
      kind: 'node',
      waves: 1,
      strengthMul: back,
    })
    const ctrlHp = hpOf(pick(dCtrl, 'inside'))
    const ctrlDps = dpsOf(pick(dCtrl, 'inside'))
    expect(dCtrl.threat, '对照卡读的还是同一个威胁（威胁是标尺、不是强度）').toBe(69)
    for (const br of ['inside', 'outside'] as const) {
      const us = pick(dTest, br)
      const hpRatio = hpOf(us) / ctrlHp
      const dpsRatio = dpsOf(us) / ctrlDps
      expect(hpRatio, `${br} 支到场血量比`).toBeGreaterThan(1.14)
      expect(hpRatio, `${br} 支到场血量比`).toBeLessThan(1.18)
      expect(dpsRatio, `${br} 支到场火力比`).toBeGreaterThan(1.14)
      expect(dpsRatio, `${br} 支到场火力比`).toBeLessThan(1.18)
      // 份额：王座 68% 血 / 72% 火力（开战即在的那一份）
      const throne = us.filter((f) => f.foeReinforceBranch === undefined)
      expect(hpOf(throne) / hpOf(us)).toBeCloseTo(0.68, 2)
      expect(dpsOf(throne) / dpsOf(us)).toBeCloseTo(0.72, 2)
      // 20 秒后才会到场：那一支的每条都带入场触发
      expect(us.filter((f) => f.foeReinforceBranch === br).every((f) => f.foeReinforceAt !== undefined)).toBe(true)
    }
    // 两支到场总量一致（来哪一支都一样重）
    expect(hpOf(pick(dTest, 'inside')) / hpOf(pick(dTest, 'outside'))).toBeCloseTo(1, 2)
  })
})

describe('支援呼叫装置 · 战斗（20 秒判定一次，二选一）', () => {
  it('开战：只有王座舰在场，并推一条"敌方呼叫增援"提示', () => {
    const { b } = supportBattle()
    expect(Object.keys(b.units).sort()).toEqual(['foe-0', 'player'])
    expect(b.foeMounts).toContain('支援呼叫装置')
    expect(noticeTexts(b)).toContain('敌方呼叫增援：20 秒后抵达')
  })

  it('射程内 ⇒ 2 艘幽灵舰到场（静滞卫舰永不到场）；判完锁死', () => {
    const { state, ctx: c, b } = supportBattle()
    // 20 秒前：一支都没来
    tickTo(state, c, b, 19_000)
    b.distanceM = 1_000
    expect(foeNames(b)).toEqual(['守墓王座舰'])
    runToJudgement(state, c, b, 1_000) // 射程内（1,000m < 王座舰 9,600m）
    expect(foeNames(b).filter((n) => n === '幽灵舰')).toHaveLength(2)
    expect(foeNames(b)).not.toContain('静滞卫舰')
    expect(noticeTexts(b)).toContain('敌方增援抵达：幽灵舰 ×2')
    // 锁存：判定之后把距离拉到射程外、继续推进 ⇒ 也不会换成静滞卫舰
    for (let t = 22_000; t <= 40_000; t += 1_000) {
      tickTo(state, c, b, t)
      b.distanceM = 30_000
      if (b.ended) break
    }
    expect(foeNames(b)).not.toContain('静滞卫舰')
    expect(foeNames(b).filter((n) => n === '幽灵舰')).toHaveLength(2)
  })

  it('射程外（王座舰够不着）⇒ 2 艘静滞卫舰到场（幽灵舰永不到场）', () => {
    const { state, ctx: c, b } = supportBattle()
    runToJudgement(state, c, b, 30_000) // 远在 9,600m 之外
    expect(foeNames(b).filter((n) => n === '静滞卫舰')).toHaveLength(2)
    expect(foeNames(b)).not.toContain('幽灵舰')
    expect(noticeTexts(b)).toContain('敌方增援抵达：静滞卫舰 ×2')
  })

  it('20 秒前击毁王座舰 ⇒ 立即胜，援军不来（未到场的增援不参与判胜）', () => {
    const { state, ctx: c, b } = supportBattle()
    b.units['foe-0']!.hp = { s: 0, a: 0, h: 0 }
    tickTo(state, c, b, 1_000)
    expect(b.ended).toBe('me')
    expect(Object.keys(b.units).sort()).toEqual(['foe-0', 'player'])
    expect(noticeTexts(b)).not.toContain('敌方增援抵达：幽灵舰 ×2')
  })
})
