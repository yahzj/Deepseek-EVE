/**
 * 存档系统（读写 / 迁移 / 容错）的单元测试（M1：v1 → v2 迁移链）。
 */
import { describe, expect, it } from 'vitest'
import { addLog, createInitialState, CURRENT_STATE_VERSION } from '../src/state'
import { loadSaveFile, MIN_MIGRATABLE_VERSION, SaveError, SAVE_FORMAT, serializeSaveFile } from '../src/save'
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
      rvLeft: 0,
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

describe('制造多线读档回归（卷B3 修复 2026-09-08：玩家反馈组装机同蓝图双线刷新后丢队列且 AI 核心占用）', () => {
  it('同蓝图两条 AI 线往返保留（不再按 blueprintId 去重）；worker 随档保留；结构性坏条丢弃并归还核心', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 3 })
    state.aiCores.basic = 0 // 三条线各出库 1 枚（账上已扣）
    state.manufacturingRuns = [
      { active: true, id: 1, blueprintId: 'sbp-a', worker: 'basic', finishAtGameMs: 100_000, durationMs: 60_000 },
      { active: true, id: 2, blueprintId: 'sbp-a', worker: 'basic', finishAtGameMs: 200_000, durationMs: 60_000 },
      // 结构性坏条（无蓝图 id）：读档丢弃 → 归还其已出库的 AI 核心
      { active: true, id: 3, blueprintId: '', worker: 'basic', finishAtGameMs: 0, durationMs: 0 },
    ]
    state.manufacturingSeq = 4

    const text = serializeSaveFile(state, 0)
    const loaded = loadSaveFile(text)

    expect(loaded.state.manufacturingRuns).toHaveLength(2) // 两条有效线都在（同蓝图不去重）
    for (const r of loaded.state.manufacturingRuns) {
      expect(r.blueprintId).toBe('sbp-a')
      expect(r.worker).toBe('basic') // worker 不丢 → 完成/取消时核心正确归还、占用照常计数
    }
    expect(loaded.state.manufacturingRuns[0]!.id).not.toBe(loaded.state.manufacturingRuns[1]!.id) // id 重新唯一分配
    expect(loaded.state.aiCores.basic).toBe(1) // 有效两条各占 1；坏条那枚已归还
  })

  it('旧档（无 worker 字段）的制造线照常保留为旧作业豁免语义（worker=undefined，不占核心）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 5 })
    state.manufacturingRuns = [
      { active: true, id: 1, blueprintId: 'bp-a', finishAtGameMs: 50_000, durationMs: 50_000 },
    ]
    const text = serializeSaveFile(state, 0)
    const loaded = loadSaveFile(text)
    expect(loaded.state.manufacturingRuns).toHaveLength(1)
    expect(loaded.state.manufacturingRuns[0]!.worker).toBeUndefined()
    expect(loaded.state.aiCores.basic).toBe(0)
  })
})

describe('循环制造上移到卡片级的老档归并（2026-09-10 船长定：无版本号变化，读档时归并）', () => {
  /** 造一份"改动前的 v24 档"：逐线 autoRepeat/repeatGoal/produced，且没有 manufacturingLoops */
  const legacyText = (
    runs: Array<{ blueprintId: string; autoRepeat?: boolean; repeatGoal?: number; produced?: number }>,
  ): string => {
    const state = createInitialState({ nowWallMs: 0, seed: 9 })
    state.manufacturingRuns = runs.map((r, i) => ({
      active: true,
      id: i + 1,
      blueprintId: r.blueprintId,
      finishAtGameMs: 100_000,
      durationMs: 60_000,
      autoRepeat: r.autoRepeat,
      repeatGoal: r.repeatGoal,
      produced: r.produced,
    }))
    const file = JSON.parse(serializeSaveFile(state, 0)) as { state: Record<string, unknown> }
    delete file.state.manufacturingLoops // 模拟改动前写下的档（没有新字段）
    return JSON.stringify(file)
  }

  it('逐线开关归并到卡片：on = 任一为真、produced = 各线之和、目标 = 各线之和', () => {
    const loaded = loadSaveFile(legacyText([
      { blueprintId: 'bp-a', autoRepeat: true, repeatGoal: 3, produced: 2 },
      { blueprintId: 'bp-a', autoRepeat: true, repeatGoal: 4, produced: 1 },
      { blueprintId: 'bp-b' }, // 没开循环的线 → 该卡不建配置
    ]))
    expect(loaded.state.manufacturingLoops['bp-a']).toEqual({ on: true, goal: 7, produced: 3 })
    expect(loaded.state.manufacturingLoops['bp-b']).toBeUndefined()
    // 逐线旧字段不再随档保留（引擎不再读写它们）
    for (const r of loaded.state.manufacturingRuns) {
      expect(r.autoRepeat).toBeUndefined()
      expect(r.repeatGoal).toBeUndefined()
      expect(r.produced).toBeUndefined()
    }
  })

  it('只要有任一条线是「无目标」，卡片就无目标（跑到材料不足）；新字段存在时优先、不与老字段重复计数', () => {
    const loaded = loadSaveFile(legacyText([
      { blueprintId: 'bp-a', autoRepeat: true, repeatGoal: 10, produced: 4 },
      { blueprintId: 'bp-a', autoRepeat: true, produced: 2 }, // 无目标线 → 卡片无目标
    ]))
    expect(loaded.state.manufacturingLoops['bp-a']).toEqual({ on: true, produced: 6 })
    expect(loaded.state.manufacturingLoops['bp-a']!.goal).toBeUndefined()

    // 新档字段（含停因）随档往返；同档若已带新字段，则不叠加老字段的合计
    const state = createInitialState({ nowWallMs: 0, seed: 11 })
    state.manufacturingLoops['bp-a'] = { on: false, goal: 5, produced: 5, stopWhy: '已达成目标 5 件' }
    const round = loadSaveFile(serializeSaveFile(state, 0))
    expect(round.state.manufacturingLoops['bp-a']).toEqual({ on: false, goal: 5, produced: 5, stopWhy: '已达成目标 5 件' })
    // 空记录不留档（开关关、无目标、无合计、无停因）
    const clean = loadSaveFile(serializeSaveFile(createInitialState({ nowWallMs: 0, seed: 12 }), 0))
    expect(clean.state.manufacturingLoops).toEqual({})
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
    /**
     * ⚠ 2026-09-19：fixture 版本由 v2 抬到**可迁移下限 v24**（船长裁「删除过旧的版本迁移」）——
     * 本用例验的是**归一化兜底**（缺字段/坏值 ⇒ 补默认），与「逐级迁移」无关，故保住覆盖。
     */
    const text = JSON.stringify({
      format: SAVE_FORMAT,
      version: MIN_MIGRATABLE_VERSION,
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

/**
 * **迁移链下限的两条钉子**（船长 2026-09-19：「删除过旧的版本迁移，仅保留虫洞之后的」）：
 * ① **下限那一版（v24）仍能升上来**；② **更早的档一律拒载入**（`SaveError('VERSION')`）——
 * 玩家侧由 `engine.start()` 开新档并写日志（本文件只管核心侧的错误码与文案）。
 */
describe('存档迁移下限（v24 起）', () => {
  const atVersion = (version: number): string => {
    const state = createInitialState({ nowWallMs: 0, seed: 21 })
    const file = JSON.parse(serializeSaveFile(state, 0)) as { version: number }
    file.version = version
    return JSON.stringify(file)
  }

  it('下限 v24 的档仍能读到当前版本（虫洞那一跳还在）', () => {
    const loaded = loadSaveFile(atVersion(MIN_MIGRATABLE_VERSION))
    expect(loaded.state.version).toBe(CURRENT_STATE_VERSION)
    expect(loaded.state.wormhole.run).toBeNull() // v24→v25 迁移的产物
  })

  it('比下限更早的档（v23）⇒ 拒载入：VERSION 错误 + 提示新开存档', () => {
    try {
      loadSaveFile(atVersion(MIN_MIGRATABLE_VERSION - 1))
      expect.unreachable('v23 档不该被读进来')
    } catch (e) {
      expect((e as SaveError).code).toBe('VERSION')
      expect((e as SaveError).message).toContain('早于可迁移下限')
      expect((e as SaveError).message).toContain('请新开存档')
    }
  })
})
