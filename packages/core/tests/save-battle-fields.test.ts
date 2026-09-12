/**
 * **战斗字段随档往返**（2026-09-12 审计 A3）：按 `save.ts` 的**登记表**逐字段守"重载不丢"。
 *
 * 为什么要数据驱动地守：此前载入侧是一份**手抄白名单**，加了字段忘了收录 ⇒ 战中重载静默丢状态
 * （2026-09-11 就漏过 `hullEscapeFrac`：连续作战保险凭空失效，该撤退的场次会继续打到弃船）。
 * 现在 `BATTLE_FIELDS` 用 `satisfies Record<keyof BattleState, …>` **在编译期**要求每个字段都分类，
 * 本用例则**在运行期**证明"登记为 persist 的字段真的能往返、且值不漂"。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import type { BattleState, GameState } from '../src/state'
import { addShipToFleet } from '../src/shipyard'
import { addWare } from '../src/inventory'
import { startBattleFor } from '../src/combat'
import { BATTLE_PERSIST_KEYS } from '../src/save'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import type { SimContext } from '../src/types'

/** 真数据上下文（与 `foe-drone.test.ts` 同款）：`makeTestCtx` 的夹具里没有真船/真卡，建不出战斗 */
const base = buildSimContext()

/** 打一场真战斗并把每个 persist 字段都写成"可辨识值" */
function battleWithAllFields(): { state: GameState; ctx: SimContext; battle: BattleState } {
  const ctx: SimContext = base
  const state = createInitialState({ nowWallMs: 0, seed: 7 })
  const uid = addShipToFleet(state, 'sh-sentinel')
  state.shipId = uid
  state.fleet[uid]!.fitted = { high: ['mod-turret-kin-1'], mid: [], low: [] }
  addWare(state, 'ammo-kinetic-l', 500)
  // ⚠ 用教学卡 `ano-training`（无声望门槛、单波、真卡）：`ano-hard` 之类有 req ⇒ `startBattleFor` 返回 null
  const battle = startBattleFor(state, ctx, uid, 'ano-training', 0)!
  // 逐个 persist 字段设成"可辨识"值（结构与真引擎同形，避免清洗逻辑把它们判为坏值）
  battle.startedAtGameMs = 1111
  battle.lastTickGameMs = 2222
  battle.distanceM = 3333
  battle.myDesireM = 4444
  battle.ammo = { kin: 5, exp: 6, pla: 7 }
  battle.ammoIds = { kinetic: 'ammo-kinetic-2', plasma: 'ammo-plasma-2' }
  battle.stats = { meShots: 8, meHits: 9, meDmg: 1010, foeShots: 11, foeHits: 12 }
  battle.fxSeq = 13
  battle.ended = null
  battle.hullEscapeFrac = 0.5
  battle.autoEscaped = true
  // `'cannot-engage'`（2026-09-12 起也随档；原先只认 'hull' | 'timeout'）
  battle.escapeReason = 'cannot-engage'
  battle.waveIdx = 1
  battle.waveClearAt = 1414
  // ── 2026-09-12 船长裁定七项（由 runtime 改随档）──
  battle.repair = {
    units: [
      { moduleId: 'mod-hull-repair-1', kitId: 'repairkit-mil', armorPerPulse: 3, hullPerPulse: 4, stopped: false },
    ],
    kits: { 'repairkit-mil': 7 },
    nextPulseAtMs: 1515,
    pulses: 2,
    kitsUsed: 5,
    kitsUsedByType: { 'repairkit-mil': 5 },
  }
  battle.dronePools = { 0: { s: 1, a: 2, h: 3, alive: true, artId: 'drone-x', evasion: 0.25 } }
  battle.foeDronePools = {
    'foe-0': [
      { s: 4, a: 5, h: 6, alive: false, evasion: 0.1, inHangar: true, readyAtMs: 1616, maxS: 4, maxA: 5, maxH: 6 },
    ],
  }
  battle.droneLost = { 'drone-x': 2 }
  battle.droneLoadAtStart = { 'drone-x': 4 }
  battle.foeDroneRangeBuff = 4
  battle.foeGunRangeBuff = 1.5
  state.expedition.active = true
  state.expedition.phase = 'battle'
  state.expedition.anomalyId = 'ano-hard'
  state.expedition.battle = battle
  return { state, ctx, battle }
}

describe('战斗字段随档往返（审计 A3 登记表）', () => {
  it('登记为 persist 的每个字段都能往返、值一字不漂', () => {
    const { state, battle } = battleWithAllFields()
    const loaded = loadSaveFile(serializeSaveFile(state, 1)).state
    const back = loaded.expedition.battle
    expect(back).toBeTruthy()
    /** **派生字段**：载入侧按 fx 环尾部重算（登记表里已标注），"值相等"对它不适用 ⇒ 断言派生式 */
    const DERIVED = new Set<string>(['fxSeq'])
    for (const key of BATTLE_PERSIST_KEYS) {
      if (DERIVED.has(String(key))) continue
      expect(back![key], `登记为 persist 的字段「${String(key)}」没有随档往返`).toEqual(battle[key])
    }
    const lastFx = battle.fx.length > 0 ? battle.fx[battle.fx.length - 1]!.seq : -1
    expect(back!.fxSeq).toBe(lastFx + 1)
    // 抽样核对几个"最容易漏"的（值写死，防用例自己被改坏）
    expect(back!.hullEscapeFrac).toBe(0.5)
    expect(back!.autoEscaped).toBe(true)
    expect(back!.escapeReason).toBe('cannot-engage')
    expect(back!.waveIdx).toBe(1)
    expect(back!.waveClearAt).toBe(1414)
    expect(back!.ammoIds).toEqual({ kinetic: 'ammo-kinetic-2', plasma: 'ammo-plasma-2' })
    // 2026-09-12 船长裁定七项：逐项写死抽样（结构体要整块一致，防"只带了一半"）
    expect(back!.repair).toEqual(battle.repair)
    expect(back!.repair!.kits).toEqual({ 'repairkit-mil': 7 })
    expect(back!.dronePools).toEqual(battle.dronePools)
    expect(back!.foeDronePools).toEqual(battle.foeDronePools)
    expect(back!.droneLost).toEqual({ 'drone-x': 2 })
    expect(back!.droneLoadAtStart).toEqual({ 'drone-x': 4 })
    expect(back!.foeDroneRangeBuff).toBe(4)
    expect(back!.foeGunRangeBuff).toBe(1.5)
  })

  it('登记为 runtime 的字段**有意不入档**（重载后按缺省口径续算）', () => {
    const { state, battle } = battleWithAllFields()
    // 故意给几个 runtime 字段塞值（真引擎里它们只在战斗中出现）
    battle.pdFocus = [0]
    battle.pdCd = [123]
    battle.notices = [{ atMs: 1, text: '测试提示' }]
    battle.foeChargeOn = true
    const loaded = loadSaveFile(serializeSaveFile(state, 1)).state
    const back = loaded.expedition.battle!
    const persist = new Set<string>(BATTLE_PERSIST_KEYS.map((k) => String(k)))
    for (const key of ['pdFocus', 'pdCd', 'notices', 'foeChargeOn']) {
      expect(persist.has(key), `${key} 不该被登记为 persist`).toBe(false)
    }
    expect(back.foeChargeOn).toBeUndefined()
    expect(back.pdCd).toBeUndefined()
    expect(back.pdFocus).toBeUndefined()
    expect(back.notices).toBeUndefined()
  })
})
