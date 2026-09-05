/**
 * 存档系统（读写 / 迁移 / 容错）的单元测试（M1：v1 → v2 迁移链）。
 */
import { describe, expect, it } from 'vitest'
import { addLog, createInitialState } from '../src/state'
import { loadSaveFile, SaveError, SAVE_FORMAT, serializeSaveFile } from '../src/save'
import { fittedOf } from './helpers'

describe('存档往返（v7）', () => {
  it('保存后再读回：内容完全一致（含舰队/仓库/采矿/队列/日志）', () => {
    const state = createInitialState({ name: '测试飞行员', nowWallMs: 12_345, seed: 7 })
    state.wallet.isk = 500
    // 把掘洞级加入舰队并切换驾驶（合法状态：当前船必须在舰队里）
    state.fleet['burrower'] = { defId: 'burrower', customName: null, durability: 1, cargo: {}, fitted: fittedOf({ turret: null, miner: null, shield: null, propulsion: null, armor: null, cargo: null }) }
    state.shipId = 'burrower'
    state.fleet['burrower'].cargo['ore-a'] = 100
    state.warehouse.items['min-a'] = 40
    state.mining = {
      active: true,
      beltId: 'belt-a',
      phase: 'mining',
      cycleAccMs: 3000,
      phaseAccMs: 0,
      tripUnits: 40,
      autoCycle: true,
      stopAfterTrip: false,
      originGalaxy: null,
    }
    state.skills.trained['mining'] = 2
    state.skills.queue.push({ skillId: 'refining', targetLevel: 3, progressMs: 500 })
    addLog(state, 'trade', '测试用经济日志')

    const text = serializeSaveFile(state, 12_345)
    const loaded = loadSaveFile(text)

    expect(loaded.savedAtWallMs).toBe(12_345)
    expect(loaded.state).toEqual(state)
  })

  it('序列化时记录"本次保存的墙钟时间"，读档时以文件头为准', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 1 })
    const text = serializeSaveFile(state, 888_888)
    const loaded = loadSaveFile(text)
    expect(loaded.state.savedAtWallMs).toBe(888_888)
  })
})

describe('旧版本迁移链（v0 → … → v9）', () => {
  it('v0 草图档一路迁移到 v9：技能与队列保留，各系统补默认值', () => {
    const v0Text = JSON.stringify({
      format: SAVE_FORMAT,
      version: 0,
      savedAtWallMs: 555,
      state: {
        trained: { a: 1 },
        queue: [
          { skill: 'a', level: 3 },
          { skill: 'x', level: 1 },
        ],
      },
    })

    const loaded = loadSaveFile(v0Text)
    expect(loaded.state.version).toBe(23)
    expect(loaded.state.skills.trained['a']).toBe(1)
    expect(loaded.state.skills.queue).toHaveLength(2)
    expect(loaded.state.skills.queue[0]).toEqual({ skillId: 'a', targetLevel: 3, progressMs: 0 })
    expect(loaded.state.skills.queue[1]).toEqual({ skillId: 'x', targetLevel: 1, progressMs: 0 })
    // v1→v2 迁移补上的默认经济：初始资金、初始船、空货舱、停采
    expect(loaded.state.wallet.isk).toBe(10_000)
    expect(loaded.state.shipId).toBe('sandcat')
    expect(loaded.state.fleet[loaded.state.shipId].cargo).toEqual({})
    expect(loaded.state.mining.active).toBe(false)
    // v2→v3 迁移补上的默认制造
    expect(loaded.state.moduleBay).toEqual({})
    expect(loaded.state.fleet[loaded.state.shipId].fitted).toEqual(fittedOf())
    expect(loaded.state.learnedRecipes).toEqual([])
    expect(loaded.state.manufacturingRuns).toHaveLength(0)
    // v3→v4 迁移补上的默认远征
    expect(loaded.state.standings).toEqual({})
    expect(loaded.state.expedition.active).toBe(false)
    // v5→v6 迁移补上的默认船坞
    expect(Object.keys(loaded.state.fleet)).toEqual(['sandcat'])
    // v8→v9 迁移补上的默认市场
    expect(loaded.state.market.pools).toEqual({})
    expect(loaded.state.orders).toEqual([])
    expect(loaded.state.escrowItems).toEqual({})
    expect(loaded.state.escrowShips).toEqual({})
    // 一直缺的字段由容错补默认值
    expect(loaded.state.character.name).toBe('深空学徒')
    expect(loaded.state.gameMs).toBe(0)
    expect(loaded.state.rng.count).toBe(0)
  })

  it('v1 完整档一路迁移到 v9：技能队列进度无损', () => {
    const v1State = {
      version: 1,
      gameMs: 123_456,
      savedAtWallMs: 100,
      logCap: 300,
      character: { name: '老矿工', startedAtWallMs: 10 },
      rng: { seed: 42, count: 7 },
      skills: {
        trained: { refining: 2 },
        queue: [{ skillId: 'mining', targetLevel: 3, progressMs: 10_000 }],
      },
      logs: [
        { id: 1, atGameMs: 0, kind: 'levelup', text: '精炼学 提升至 Lv2！' },
      ],
    }
    const v1Text = JSON.stringify({ format: SAVE_FORMAT, version: 1, savedAtWallMs: 100, state: v1State })

    const loaded = loadSaveFile(v1Text)
    expect(loaded.state.version).toBe(23)
    expect(loaded.state.skills.trained['refining']).toBe(2)
    expect(loaded.state.skills.queue[0]!.progressMs).toBe(10_000)
    expect(loaded.state.logs).toHaveLength(1)
    expect(loaded.state.gameMs).toBe(123_456)
    expect(loaded.state.wallet.isk).toBe(10_000)
    expect(loaded.state.shipId).toBe('sandcat')
    expect(loaded.state.moduleBay).toEqual({})
    expect(loaded.state.fleet[loaded.state.shipId].fitted).toEqual(fittedOf())
    expect(loaded.state.expedition.active).toBe(false)
  })

  it('v2 完整档一路迁移到 v9：采矿/钱包状态无损，后续系统补默认', () => {
    const v2State = {
      version: 2,
      gameMs: 50_000,
      savedAtWallMs: 200,
      logCap: 300,
      character: { name: '老矿工', startedAtWallMs: 10 },
      rng: { seed: 42, count: 7 },
      skills: { trained: { mining: 2 }, queue: [] },
      wallet: { isk: 55_000 },
      shipId: 'burrower',
      inventory: { items: { 'ore-a': 300, 'min-a': 40 } },
      mining: { active: true, beltId: 'belt-a', cycleAccMs: 5_000, tripUnits: 120 },
      logs: [{ id: 1, atGameMs: 0, kind: 'levelup', text: '采矿技术 提升至 Lv2！' }],
    }
    const v2Text = JSON.stringify({ format: SAVE_FORMAT, version: 2, savedAtWallMs: 200, state: v2State })

    const loaded = loadSaveFile(v2Text)
    expect(loaded.state.version).toBe(23)
    expect(loaded.state.wallet.isk).toBe(55_000)
    expect(loaded.state.shipId).toBe('burrower')
    expect(loaded.state.fleet[loaded.state.shipId].cargo).toEqual({ 'ore-a': 300, 'min-a': 40 })
    expect(loaded.state.mining).toEqual({
      active: true,
      beltId: 'belt-a',
      phase: 'mining',
      cycleAccMs: 5_000,
      phaseAccMs: 0,
      tripUnits: 120,
      autoCycle: true,
      stopAfterTrip: false,
      originGalaxy: null,
    })
    expect(loaded.state.moduleBay).toEqual({})
    expect(loaded.state.learnedRecipes).toEqual([])
    expect(loaded.state.manufacturingRuns).toHaveLength(0)
    expect(loaded.state.standings).toEqual({})
    expect(loaded.state.expedition.active).toBe(false)
  })

  it('v4 完整档迁移到 v9：装备与远征无损，蓝图转"已学会配方"', () => {
    const v4State = {
      version: 4,
      gameMs: 88_000,
      savedAtWallMs: 300,
      logCap: 300,
      character: { name: '老矿工', startedAtWallMs: 10 },
      rng: { seed: 42, count: 7 },
      skills: { trained: { gunnery: 3 }, queue: [] },
      wallet: { isk: 200_000 },
      shipId: 'whale',
      inventory: { items: { 'ore-a': 10 } },
      mining: { active: false, beltId: null, cycleAccMs: 0, tripUnits: 0 },
      moduleBay: { 'mod-a': 2 },
      fitted: { miner: 'mod-a', cargo: null },
      blueprints: ['bp-a'],
      manufacturing: { active: false, blueprintId: null, finishAtGameMs: 0, durationMs: 0 },
      standings: { dsi: 6 },
      expedition: { active: false, anomalyId: null, finishAtGameMs: 0, durationMs: 0, outMs: 0, combatMs: 0, power: 0 },
      logs: [],
    }
    const v4Text = JSON.stringify({ format: SAVE_FORMAT, version: 4, savedAtWallMs: 300, state: v4State })

    const loaded = loadSaveFile(v4Text)
    expect(loaded.state.version).toBe(23)
    expect(loaded.state.fleet[loaded.state.shipId].fitted).toEqual(fittedOf({ miner: 'mod-a' }))
    expect(loaded.state.moduleBay).toEqual({ 'mod-a': 2 })
    expect(loaded.state.standings).toEqual({ dsi: 6 })
    expect(loaded.state.skills.trained['gunnery']).toBe(3)
    // v8→v9：blueprints（购买即永久）→ learnedRecipes（无损平移）
    expect(loaded.state.learnedRecipes).toEqual(['bp-a'])
    expect(loaded.state.blueprintStock).toEqual({})
  })

  it('v5 完整档迁移到 v9：装备与远征无损，船坞补当前船（M5）', () => {
    const v5State = {
      version: 5,
      gameMs: 120_000,
      savedAtWallMs: 400,
      logCap: 300,
      character: { name: '造船匠', startedAtWallMs: 10 },
      rng: { seed: 1, count: 3 },
      skills: { trained: { industry: 4 }, queue: [] },
      wallet: { isk: 500_000 },
      shipId: 'pioneer',
      inventory: { items: { 'min-a': 50 } },
      mining: { active: false, beltId: null, cycleAccMs: 0, tripUnits: 0 },
      moduleBay: { 'mod-turret-1': 1 },
      fitted: { miner: null, cargo: null, turret: 'mod-turret-1' },
      blueprints: ['bp-turret-1'],
      manufacturing: { active: false, blueprintId: null, finishAtGameMs: 0, durationMs: 0 },
      standings: { dsi: 4 },
      expedition: {
        active: true,
        anomalyId: 'ano-a',
        finishAtGameMs: 200_000,
        durationMs: 60_000,
        outMs: 30_000,
        combatMs: 30_000,
        power: 12,
      },
      logs: [],
    }
    const v5Text = JSON.stringify({ format: SAVE_FORMAT, version: 5, savedAtWallMs: 400, state: v5State })

    const loaded = loadSaveFile(v5Text)
    expect(loaded.state.version).toBe(23)
    expect(loaded.state.shipId).toBe('pioneer')
    // 船坞以"当前船"起步（migration v5→v6），容错再补默认船
    expect(Object.keys(loaded.state.fleet)).toContain('pioneer')
    expect(Object.keys(loaded.state.fleet)).toContain('sandcat')
    // v12 战斗升级：旧式在途远征在 11→12 迁移中自动召回（无法平滑转换为两阶段语义）
    expect(loaded.state.expedition.active).toBe(false)
    expect(loaded.state.logs.some((l) => l.text.includes('召回'))).toBe(true)
    expect(loaded.state.expedition.eventId).toBeNull()
    expect(loaded.state.expedition.eventFired).toBe(false)
    expect(loaded.state.fleet[loaded.state.shipId].fitted.high[0]).toBe('mod-turret-1')
  })

  it('v7 完整档迁移到 v9：废除 aiCoreLevel，补核心库与空任务表', () => {
    // 基于 v7 形状构造（含已废弃的 aiCoreLevel = 5）
    const v7State = {
      version: 7,
      gameMs: 10_000,
      savedAtWallMs: 500,
      logCap: 300,
      character: { name: '老舰长', startedAtWallMs: 1 },
      rng: { seed: 5, count: 9 },
      skills: { trained: { 'ai-expert': 2 }, queue: [] },
      wallet: { isk: 40_000 },
      shipId: 'sandcat',
      fleet: {
        sandcat: { durability: 1, cargo: {}, fitted: { miner: null, cargo: null, turret: null } },
      },
      warehouse: { items: { 'min-tritanium': 10 } },
      moduleBay: {},
      blueprints: [],
      aiCoreLevel: 5, // v7 残留字段：迁移时应被移除
      mining: { active: false, beltId: null, phase: 'mining', cycleAccMs: 0, phaseAccMs: 0, tripUnits: 0, autoCycle: true, stopAfterTrip: false },
      manufacturing: { active: false, blueprintId: null, finishAtGameMs: 0, durationMs: 0 },
      standings: {},
      expedition: { active: false, anomalyId: null, finishAtGameMs: 0, durationMs: 0, outMs: 0, combatMs: 0, power: 0, eventId: null, eventFired: false },
      logs: [],
    }
    const v7Text = JSON.stringify({ format: SAVE_FORMAT, version: 7, savedAtWallMs: 500, state: v7State })

    const loaded = loadSaveFile(v7Text)
    expect(loaded.state.version).toBe(23)
    expect('aiCoreLevel' in loaded.state).toBe(false)
    expect(loaded.state.aiCores).toEqual({ basic: 0, gamma: 0, beta: 0, alpha: 0 })
    expect(loaded.state.aiAssignments).toEqual({})
    expect(loaded.state.skills.trained['ai-expert']).toBe(2)
    expect(loaded.state.warehouse.items['min-tritanium']).toBe(10)
  })

  it('v8 完整档迁移到 v9：已购蓝图无损转"已学会配方"，市场全新初始化', () => {
    // 基于真实 v8 状态形状构造（含 blueprints 与 AI 指派）
    const v8State = {
      version: 8,
      gameMs: 300_000,
      savedAtWallMs: 600,
      logCap: 300,
      character: { name: '老舰长', startedAtWallMs: 1 },
      rng: { seed: 5, count: 9 },
      skills: { trained: { 'ai-expert': 2 }, queue: [] },
      wallet: { isk: 40_000 },
      shipId: 'whale',
      fleet: {
        sandcat: { durability: 0.7, cargo: { 'ore-a': 50 }, fitted: { miner: 'mod-miner-1', cargo: null, turret: null } },
        whale: { durability: 1, cargo: {}, fitted: { miner: null, cargo: null, turret: null } },
      },
      warehouse: { items: { 'min-tritanium': 10 } },
      moduleBay: { 'mod-miner-1': 1 },
      blueprints: ['bp-miner-1', 'sbp-whale-king'],
      aiCores: { basic: 1, gamma: 0, beta: 0, alpha: 0 },
      aiAssignments: {
        sandcat: {
          coreType: 'basic',
          startedAtGameMs: 10_000,
          task: { kind: 'mining', beltId: 'belt-a', phase: 'mining', cycleAccMs: 100, phaseAccMs: 0, tripUnits: 3 },
        },
      },
      mining: { active: false, beltId: null, phase: 'mining', cycleAccMs: 0, phaseAccMs: 0, tripUnits: 0, autoCycle: true, stopAfterTrip: false },
      manufacturing: { active: false, blueprintId: null, finishAtGameMs: 0, durationMs: 0 },
      standings: { dsi: 2 },
      expedition: { active: false, anomalyId: null, finishAtGameMs: 0, durationMs: 0, outMs: 0, combatMs: 0, power: 0, eventId: null, eventFired: false },
      logs: [],
    }
    const v8Text = JSON.stringify({ format: SAVE_FORMAT, version: 8, savedAtWallMs: 600, state: v8State })

    const loaded = loadSaveFile(v8Text)
    expect(loaded.state.version).toBe(23)
    expect('blueprints' in loaded.state).toBe(false)
    expect(loaded.state.learnedRecipes).toEqual(['bp-miner-1', 'sbp-whale-king']) // 无损平移
    expect(loaded.state.blueprintStock).toEqual({})
    expect(loaded.state.market.pools).toEqual({})
    expect(loaded.state.market.lastTickGameMs).toBe(0)
    expect(loaded.state.orders).toEqual([])
    expect(loaded.state.escrowItems).toEqual({})
    expect(loaded.state.escrowShips).toEqual({})
    // 其余 v8 状态原样保留
    expect(loaded.state.aiAssignments['sandcat']!.task.kind).toBe('mining')
    expect(loaded.state.aiCores).toEqual({ basic: 1, gamma: 0, beta: 0, alpha: 0 })
    expect(loaded.state.fleet['sandcat']!.durability).toBe(0.7)
  })
})

describe('坏档处理', () => {
  it('不是 JSON → PARSE 错误', () => {
    try {
      loadSaveFile('{oops')
      expect.unreachable()
    } catch (e) {
      expect((e as SaveError).code).toBe('PARSE')
    }
  })

  it('格式标识不对（别的游戏存档）→ FORMAT 错误', () => {
    const text = JSON.stringify({ format: '另一个游戏', version: 2, state: {} })
    expect(() => loadSaveFile(text)).toThrowError(/格式标识不符/)
  })

  it('版本高于当前支持 → VERSION 错误', () => {
    const text = JSON.stringify({ format: SAVE_FORMAT, version: 99, state: {} })
    expect(() => loadSaveFile(text)).toThrowError(/高于当前支持/)
  })

  it('个别字段缺失/异常 → 容错补默认值，尽量把档救回来', () => {
    const text = JSON.stringify({
      format: SAVE_FORMAT,
      version: 2,
      savedAtWallMs: 1,
      state: {
        wallet: { isk: -5 },
        inventory: { items: { a: 99, b: '字符串', c: -1 } },
        mining: { active: '是', cycleAccMs: -100, tripUnits: '很多' },
        skills: { trained: { a: 99, b: '字符串' } },
        logs: [{ id: 'x', kind: '不存在的类型', text: 42 }],
      },
    })
    const loaded = loadSaveFile(text)
    // 越界/负值/异常类型全部安全处理
    expect(loaded.state.wallet.isk).toBe(0)
    expect(loaded.state.fleet[loaded.state.shipId].cargo).toEqual({ a: 99 }) // 负的丢掉、字符串丢掉
    expect(loaded.state.mining.active).toBe(false)
    expect(loaded.state.mining.cycleAccMs).toBe(0)
    expect(loaded.state.mining.tripUnits).toBe(0)
    expect(loaded.state.skills.trained['a']).toBe(5) // 截断到满级
    expect(loaded.state.logs[0]!.kind).toBe('info') // 坏类型修复为 info
    expect(loaded.state.shipId).toBe('sandcat') // 缺失用默认船
  })
})
