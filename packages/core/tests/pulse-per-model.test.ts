/**
 * **三类周期脉冲装置「逐型号独立回转冷却」**（**2026-09-21 船长令**）。
 *
 * 船长原话（照抄）：「**漏了一点，哪怕同类型装备，只要是不同型号，就要独立的回转冷却**」＋
 * 追问后追加「**包括船体维修装置的不同型号也一样的规则**」⇒ 力场（高槽）/ 护盾充能（中槽）/
 * 船体维修（中槽）三类一律**按型号拆成多路**，各带自己的计时器、各按各的间隔跳。
 *
 * 改动前是"一台一路"：同舰 MK2+MK3 **共用**一个计时器、间隔取最短的一档；维修更极端 ——
 * 一路 5 秒脉冲**只结算一台**装置（装三台与装一台的实修量几乎一样）。本文件锁四组口径：
 * ① **逐型号各自计时**（两路的 `nextPulseAtMs` 各排各的、各按各的间隔前移）；
 * ② **衰减仍按全族**（第 n 件按 EVE 曲线；换型号绕不开惩罚）——两条粒度互不干扰；
 * ③ **旧档迁移**（单路 `pctPerPulse` ⇒ 升级成一行流；维修旧档缺逐台计时器 ⇒ 借账本那个值继续跑）；
 * ④ **单船路径也建力场账本**（改前只有多舰路径建 ⇒ 悬赏/遭遇/AI 副船里装了也白装）。
 *
 * ⚠ 本文件不产生任何玩家可见文案。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import { addShipToFleet } from '../src/shipyard'
import { addWare } from '../src/inventory'
import {
  advanceBattleFor,
  repairStreamsOf,
  shieldChargeStreamsOf,
  shieldFieldStreamsOf,
  startBattleFor,
  startFleetBattleFor,
  REPAIR_PULSE_MS,
  SHIELD_PULSE_MS,
} from '../src/combat'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { stackWeight } from '../src/equipment'

const ctx = buildSimContext()

/** 一艘能装三类装置的大船（T4 战列，槽位够） */
function world(high: string[], mid: string[], low: string[] = []): { state: GameState; uid: string } {
  const state = createInitialState({ nowWallMs: 0, seed: 21 })
  const uid = addShipToFleet(state, 'sh-megalodon')
  state.shipId = uid
  state.fleet[uid]!.fitted = { high, mid, low }
  addWare(state, 'repairkit-mil', 500)
  addWare(state, 'repairkit-civ', 500)
  return { state, uid }
}

/**
 * **跑到 `targetMs` 就停**（每拍 100ms，与实时心跳同粒度）——用于"某个时刻的跳数应该长这样"的断言。
 *
 * ⚠ **别手工改 `battle.lastTickGameMs` 来"跳时间"**：战斗时钟与全局时钟是两套（`speedAxis` 锚点配对），
 * 手工错开之后补帧循环**一拍都不跑**（我第一版就这么写测试，三条用例全红、现场与生产不符）。
 * 就按真实时间轴跑 —— 只是**别指望跑很久**：教学卡很弱，T4 战列舰十几秒就把它打完了。
 */
function runUntil(state: GameState, b: import('../src/state').BattleState, targetMs: number): void {
  let guard = 0
  while (state.gameMs < targetMs && !b.ended && guard++ < 5_000) {
    state.gameMs += 100
    advanceBattleFor(state, ctx, b, state.shipId, 'ano-training')
  }
}

describe('逐型号独立回转：装配读数', () => {
  it('① 力场两档 ⇒ **两路**，各带自己的间隔（MK2 10 秒 / MK3 8 秒）', () => {
    const { state, uid } = world(['mod-shieldfield-2', 'mod-shieldfield-3'], [])
    const s = shieldFieldStreamsOf(state, ctx, uid)
    expect(s.map((x) => x.modelId)).toEqual(['mod-shieldfield-2', 'mod-shieldfield-3'])
    expect(s.map((x) => x.ms)).toEqual([10_000, 8_000])
    // 衰减仍按全族：第 2 件折到 87%
    expect(s[0]!.pct).toBeCloseTo(0.1 * stackWeight(1), 10)
    expect(s[1]!.pct).toBeCloseTo(0.1 * stackWeight(2), 10)
  })

  it('① 护盾充能两档 ⇒ **两路**（间隔同为 30 秒，各带各的比例）', () => {
    const { state, uid } = world([], ['mod-shieldchg-1', 'mod-shieldchg-3'])
    const s = shieldChargeStreamsOf(state, ctx, uid)
    expect(s.map((x) => x.modelId)).toEqual(['mod-shieldchg-1', 'mod-shieldchg-3'])
    expect(s.map((x) => x.ms)).toEqual([SHIELD_PULSE_MS, SHIELD_PULSE_MS])
    expect(s[0]!.pct).toBeCloseTo(0.24, 10)
    expect(s[1]!.pct).toBeCloseTo(0.64 * stackWeight(2), 10)
  })

  it('① 维修三档 ⇒ **三路**（逐台一线），第 n 台按全族曲线折减', () => {
    const { state, uid } = world([], ['mod-hullrep-civ', 'mod-hullrep-1', 'mod-hullrep-2'])
    const s = repairStreamsOf(state, ctx, uid)
    expect(s.map((x) => x.modelId)).toEqual(['mod-hullrep-civ', 'mod-hullrep-1', 'mod-hullrep-2'])
    expect(s.map((x) => x.ms)).toEqual([REPAIR_PULSE_MS, REPAIR_PULSE_MS, REPAIR_PULSE_MS])
    expect(s.map((x) => x.armorHp)).toEqual([
      5 * stackWeight(1),
      10 * stackWeight(2),
      18 * stackWeight(3),
    ])
  })

  it('② **同型号多件合并成一路**（同一型号就是同一路冷却），比例按位次累加', () => {
    const { state, uid } = world([], ['mod-hullrep-1', 'mod-hullrep-1'])
    const s = repairStreamsOf(state, ctx, uid)
    expect(s).toHaveLength(1)
    // 两台 MK1：位次 1 与 2 ⇒ 10×1 + 10×0.869
    expect(s[0]!.armorHp).toBeCloseTo(10 * (stackWeight(1) + stackWeight(2)), 10)
  })
})

describe('逐型号独立回转：战斗中的计时器', () => {
  it('① 力场 MK2+MK3：两路各有各的首跳（10 秒 / 8 秒），到 10 秒时两路都跳过、MK2 排到 20 秒', () => {
    const { state, uid } = world(['mod-shieldfield-2', 'mod-shieldfield-3'], [])
    const b = startFleetBattleFor(state, ctx, [uid], 'ano-training', 0)!
    const led = b.shieldFieldBy!['player']!
    // **首跳各按各的间隔**（改前：两件并成一路、统一取最短的 8 秒）
    expect(led.streams.map((s) => s.nextPulseAtMs)).toEqual([
      b.startedAtGameMs + 10_000,
      b.startedAtGameMs + 8_000,
    ])
    runUntil(state, b, 10_000)
    expect(b.ended, '前提：10 秒时这一场还没打完').toBeFalsy()
    // MK2 跳到 20 秒（自己 10 秒的节奏）；MK3 在 8 秒跳过 ⇒ 排到 16 秒
    expect(led.streams[0]!.nextPulseAtMs).toBe(20_000)
    expect(led.streams[1]!.nextPulseAtMs).toBe(16_000)
    expect(led.pulses, '两路各一跳').toBe(2)
  })

  it('① 维修民用级+MK1：**两台各排各的计时器、各扣各的组件**（改前"一拍只结算一台"）', () => {
    const { state, uid } = world([], ['mod-hullrep-civ', 'mod-hullrep-1'])
    const b = startBattleFor(state, ctx, uid, 'ano-training', 0)!
    // ⚠ 别把三层打空（阵亡 ⇒ 装置全停）；留护盾、给装甲开个缺口即可
    b.units['player']!.hp = { s: 5_000, a: 100, h: 100 }
    const led = repairLedgers(b)!
    // **两台各自排首跳**（同一拍到期，但各是各的计时器）
    expect(led.units.map((u) => u.nextPulseAtMs)).toEqual([5_000, 5_000])
    runUntil(state, b, 5_000)
    expect(b.ended, '前提：5 秒时这一场还没打完').toBeFalsy()
    // 两台**都**跳了（各自排到 10 秒），且**各扣各的组件**
    expect(led.units.map((u) => u.nextPulseAtMs)).toEqual([10_000, 10_000])
    expect(led.pulses, '一拍里两台各记一跳').toBe(2)
    expect(led.kitsUsed, '两台各扣 1 枚组件').toBe(2)
  })

  it('③ 旧档（单路合计值 + 无逐台计时器）⇒ 读档后仍能继续跳', () => {
    const { state, uid } = world(['mod-shieldfield-2', 'mod-shieldfield-3'], ['mod-shieldchg-1', 'mod-shieldchg-3'], ['mod-hullrep-1'])
    const b = startBattleFor(state, ctx, uid, 'ano-training', 0)!
    state.expedition.active = true
    state.expedition.phase = 'battle'
    state.expedition.anomalyId = 'ano-training'
    state.expedition.battle = b
    const raw = JSON.parse(serializeSaveFile(state, 0)) as { state: { expedition: { battle: Record<string, unknown> } } }
    const battleRaw = raw.state.expedition.battle
    // 把力场/充能改回**旧单路结构**，并抹掉维修的逐台计时器（= 2026-09-21 之前写下的在途战斗）
    const sf = battleRaw.shieldFieldBy as Record<string, { streams: Array<{ pct: number; ms: number }> }>
    const sfTag = Object.keys(sf)[0]!
    battleRaw.shieldFieldBy = {
      [sfTag]: { pctPerPulse: 0.2, msPerPulse: 8_000, nextPulseAtMs: 8_000, pulses: 3 },
    }
    const sc = battleRaw.shieldCharge as { streams: Array<{ pct: number }> }
    battleRaw.shieldCharge = { pctPerPulse: sc.streams.reduce((n, s) => n + s.pct, 0), nextPulseAtMs: 30_000, pulses: 0 }
    const rep = battleRaw.repair as { units: Array<Record<string, unknown>> }
    for (const u of rep.units) delete u.nextPulseAtMs

    const back = loadSaveFile(JSON.stringify(raw))
    const b2 = back.state.expedition.battle!
    // 力场：升级成**一行流**，比例与冷却原样保留（不重算衰减）
    expect(b2.shieldFieldBy![sfTag]!.streams).toEqual([
      { modelId: '', pct: 0.2, ms: 8_000, nextPulseAtMs: 8_000 },
    ])
    // 护盾充能：旧档没有 `msPerPulse` ⇒ 按本族常量补齐（否则会整块丢掉）
    expect(b2.shieldCharge!.streams[0]).toMatchObject({ pct: combinedPct(sc), ms: SHIELD_PULSE_MS })
    // 维修：逐台计时器缺失 ⇒ 迁移分支借账本那一个值继续跑
    // ⚠ 这一条用的是**合并时钟跳**（`state.gameMs` 与 `battle.lastTickGameMs` **一起**设）：
    //   两个时钟是两套（`speedAxis` 锚点配对），只推一个的话补帧循环一拍都不跑（我第一版就这么错）。
    // ⚠ 这一跳**必须由刚开战的战斗来跑**（双方满血、且 `meShots/foeShots` 都还没有）：
    //   拿"已经打过一会儿"的存档来跳，一帧跨 10 秒会撞上「无法交战/超时」那条判负（实测 `ended=foe`）。
    const fresh = world([], ['mod-hullrep-1'], [])
    const fb = startBattleFor(fresh.state, ctx, fresh.uid, 'ano-training', 0)!
    const led2 = repairLedgers(fb)!
    expect(led2.units.every((u) => u.nextPulseAtMs !== undefined), '新战斗：逐台已排首跳').toBe(true)
    for (const u of led2.units) delete u.nextPulseAtMs // 抹成旧档形状
    /**
     * ⚠ **时钟纪律**（我在这上面连踩三次，写下来免得后人再踩）：
     * `advanceBattleFor` 在**进补帧循环之前**把"现在"读一次（`nowMs()` = 锚点折算后夹到 `state.gameMs`），
     * 而 `state.gameMs` 只在 `advanceGame` 里自己往前走 —— 直接调 `advanceBattleFor` 时：
     * - 两个时钟**相等** ⇒ 差为 0 ⇒ 循环一次都不进（跳时间必须**先**把两者推到同一时刻）；
     * - 一帧跨 10 秒以上 ⇒ 会撞上「无法交战 / 超时」判负（实测 `ended=foe`）。
     * ⇒ 这里做"从旧档续跑"：先把两套时钟推到 9,900（**调用前**），再让它自然走完到 10 秒以上那一拍。
     */
    fresh.state.gameMs = 9_900
    fb.lastTickGameMs = 9_900
    for (let i = 0; i < 20 && !fb.ended; i++) {
      fresh.state.gameMs += 100
      advanceBattleFor(fresh.state, ctx, fb, fresh.uid, 'ano-training')
    }
    expect(fb.ended, '前提：这一拍不该判负').toBeFalsy()
    expect(fb.repair!.pulses, '旧档续战要能继续跳').toBeGreaterThan(0)
    // 迁移后**未停机的那些**都拿到了自己的计时器（下拍起转入逐台制）；停机的不排程是有意为之
    expect(fb.repair!.units.filter((u) => !u.stopped).every((u) => u.nextPulseAtMs !== undefined)).toBe(true)
    // 且计时器**真的在按 5 秒的节奏往前走**（不是停在迁移那一刻）
    expect(fb.repair!.units[0]!.nextPulseAtMs).toBeGreaterThan(fb.lastTickGameMs)
  })

  it('④ 单船路径也建力场账本（改前只有多舰路径建 ⇒ 悬赏/遭遇里装了白装）', () => {
    const { state, uid } = world(['mod-shieldfield-3'], [])
    const b = startBattleFor(state, ctx, uid, 'ano-training', 0)!
    expect(b.shieldFieldBy?.['player'], '单船路径必须建力场账本').toBeTruthy()
    b.units['player']!.hp.s = 0
    runUntil(state, b, 8_000)
    expect(b.units['player']!.hp.s, '8 秒那一跳要把盾点起来').toBeGreaterThan(0)
  })
})

/** 逐舰维修账本（单船路径 = `battle.repair`） */
function repairLedgers(b: import('../src/state').BattleState): import('../src/state').BattleRepairLedger | undefined {
  return b.repairBy ? Object.values(b.repairBy)[0] : b.repair
}

function combinedPct(sc: { streams: Array<{ pct: number }> }): number {
  return sc.streams.reduce((n, s) => n + s.pct, 0)
}
