/**
 * 存档系统（读写 / 迁移 / 容错）的单元测试（M1：v1 → v2 迁移链）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { addLog, createInitialState, CURRENT_STATE_VERSION } from '../src/state'
import type { ImportantTaskState } from '../src/state'
import { loadSaveFile, MIN_MIGRATABLE_VERSION, SaveError, SAVE_FORMAT, serializeSaveFile } from '../src/save'
import { addShipToFleet } from '../src/shipyard'
import { wormholeEnter } from '../src/wormhole'
import { wormholeMakeGrid } from '../src/wormholeGrid'
import { fittedOf } from './helpers'
import { advanceGame } from '../src/engine'
import { startMining } from '../src/mining'
import { startRefineRun } from '../src/industry'
import { startManufacturing } from '../src/manufacturing'
import { placeBuyOrder, learnBlueprint } from '../src/market'

/** 母港唯一矿带（丰饶之环）＋它产的矿（与 `first-tasks.test.ts` 同一组真 id） */
const BELT = 'belt-fortune'
const BELT_ORE = 'ore-veldspar'

/** 真上下文（进洞要看船体准入与扫描件，`makeTestCtx` 的裁剪版不够用） */
const simCtx = buildSimContext()

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


describe('虫洞网格读档回归（玩家报障 2026-09-20：「深入下一层后，显示本层没有网格」）', () => {
  /**
   * 根因：`cleanWormholeGrid` 当年写死 `radius <= 8`（阶梯封顶 R=4 时代的余量），
   * 而 2026-09-20 阶梯改成「每 1 层 +1 环、上不封顶」⇒ **层 8 起（R=9+）的盘被整块丢掉**，
   * 该层退回旧式线性地图 ⇒ 界面显示「本层没有网格」。
   * 本用例逐层走一遍**真实存档往返**，把"阶梯 ↔ 读档护栏"的耦合钉死。
   */
  it('存档往返逐层保住网格（层 1~40，含 R>8 的深层盘）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 20260920 })
    const uid = addShipToFleet(state, 'sh-thresher')
    state.shipId = uid
    const entry = wormholeEnter(state, simCtx, [uid], 20260920)
    expect(entry.ok, entry.error).toBe(true)
    for (const depth of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 20, 40]) {
      const run = state.wormhole.run!
      run.depth = depth
      run.bossCleared = depth
      const grid = wormholeMakeGrid(20260920, depth, 0, 1)
      run.grid = grid
      const back = loadSaveFile(serializeSaveFile(state, 0)).state.wormhole.run
      expect(back?.grid, `层 ${String(depth)}（R=${String(grid.radius)}）的盘在读档后丢了`).toBeDefined()
      expect(back!.grid!.radius, `层 ${String(depth)}`).toBe(grid.radius)
      expect(back!.grid!.cells.length, `层 ${String(depth)}`).toBe(grid.cells.length)
      expect(back!.grid!.pos, `层 ${String(depth)}`).toEqual(grid.pos)
    }
  })
})

/**
 * **`importantTasks` 白名单不许漏键**（**2026-09-22 船长报障**：「**玩家刷新可以重复领取补发的打捞器**」）。
 *
 * 根因：`save.ts` 的 `normalizeState` 是**手工白名单重建** `importantTasks`——每加一个字段就得在两处都写一遍；
 * 打捞器全员补发（临时补丁）新加的 `salvagerGift` 只写了引擎侧 ⇒ **读档即丢去重键** ⇒ 刷新一次多领一台。
 * （🔧 2026-09-24 补注：该临时补丁**已按船长令拆除**，字段随之删除；本条留作这道护栏的来历。）
 *
 * 这条用例是**这一类 bug 的护栏**：下面那份 `Record<keyof ImportantTaskState, true>` 会被 TS 强制**穷尽**——
 * 将来给 `ImportantTaskState` 加字段而没在这里补一行，`npm run typecheck` 直接红；补了行但漏进白名单，
 * 这条用例红。同款前车之鉴：`wormhole.run` 漏 `turnsBase` / `turnsTechBonus`。
 */
describe('importantTasks 存档往返：白名单不许漏键（船长报障 2026-09-22）', () => {
  /** 类型改了这里必须跟着改（漏了 = typecheck 报缺少属性） */
  const ALL_KEYS: Record<keyof ImportantTaskState, true> = {
    done: true,
    delivered: true,
    allExplored: true,
    started: true,
  }

  it('每个字段都随档往返（一个不落）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 44 })
    state.importantTasks['first-salvage'] = {
      done: true,
      delivered: 3,
      allExplored: true,
      started: true,
    }
    const back = loadSaveFile(serializeSaveFile(state, 0)).state.importantTasks['first-salvage']
    expect(back, '这条任务本身要还在').toBeDefined()
    for (const key of Object.keys(ALL_KEYS) as (keyof ImportantTaskState)[]) {
      expect(back?.[key], `字段 ${key} 读档后丢了（白名单漏键）`).toBe(state.importantTasks['first-salvage']![key])
    }
    // 全键都在（反过来也钉一下：别只保留了一部分）
    expect(Object.keys(back!).sort()).toEqual(Object.keys(ALL_KEYS).sort())
  })
})

/**
 * **自动护栏：引擎跑过的档，往返不许丢键**（2026-09-22 加）。
 *
 * 为什么要有它：`normalizeState` 里几十处都是**手工白名单**（读档时逐字段重建对象），**每加一个随档字段
 * 就得在两处都写一遍**——漏了不会报错，只会在"刷新/重进"时表现为**重复发奖 / 状态回退**（船长报障的
 * 打捞器重复领取就是这么来的：`importantTasks.salvagerGift` 没进白名单）。
 * （🔧 2026-09-24 补注：那次临时补丁已拆，字段已删；本条留作"刷新即丢"这类缺陷的实例。）
 *
 * 与上一条 `importantTasks` 用例的分工：那条靠 TS **穷尽一个类型**；这条**不依赖任何清单**——它把真引擎
 * 跑过的档整体落盘再读回，**递归比对键集合**，凡是"引擎写过、读回来没了"的键一律报出来。
 * 覆盖面 = 本场景真的跑到的那些子系统（想扩面就往场景里多加一步）。
 */
describe('存档往返：引擎跑过的档不许丢键（自动护栏）', () => {
  /**
   * 递归收集**"有内容的"**键路径。口径两条：
   * - 跳过 `undefined`（JSON 本来就不带它）与**空值**（`false`/`0`/`''`/空表/空对象）——
   *   `normalizeState` 一律"只在有值时落键"（如 `exitKnown?: boolean`、`...(x === true ? {x:true} : {})`），
   *   读回来缺省 = 同一个结果 ⇒ 不算丢；
   * - 数组只看**第一条还活着的**元素：内存里 `active === false` 的作业条是残留（玩家切活动时上一条会被
   *   `haltActivityForSwitch` 置停），读档**按设计**丢弃（`sanitizeRefineRun` 等只收 `active === true`）。
   */
  function keysDeep(v: unknown, path: string, out: Set<string>): void {
    if (v === null || typeof v !== 'object') return
    if (Array.isArray(v)) {
      const live = v.filter(isLive)
      if (live.length > 0) keysDeep(live[0], `${path}[]`, out)
      return
    }
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (val === undefined) continue
      const p = path ? `${path}.${k}` : k
      if (meaningful(val)) out.add(p)
      keysDeep(val, p, out)
    }
  }

  /** 已停工的残留作业条（内存里 `active === false`）：读档按设计丢弃，不算内容 */
  const isLive = (x: unknown): boolean => !(x !== null && typeof x === 'object' && (x as { active?: unknown }).active === false)

  /** "有内容" = 丢了会读出不同结果的值（空值不算：缺省与空值同义；数组里只剩停工的残留也算空） */
  function meaningful(v: unknown): boolean {
    if (v === null || v === false) return false
    if (typeof v === 'number') return v !== 0
    if (typeof v === 'string') return v.length > 0
    if (Array.isArray(v)) return v.some(isLive)
    if (typeof v === 'object') return Object.keys(v).length > 0
    return true // true 等
  }

  it('跑过采矿/精炼/市场/工业/进洞之后：键一个不少', () => {
    const state = createInitialState({ name: '护栏', nowWallMs: 0, seed: 77 })
    // ① 让引擎自己跑一段（首个心跳会走：补发打捞器、任务收口、成就/通讯、事件……）
    for (let i = 0; i < 30; i += 1) advanceGame(state, 10_000, simCtx)
    // ② 手动把几条常用子系统的状态摆出来（覆盖面越宽，这条护栏越值钱）
    const uid = addShipToFleet(state, 'sh-falconet')
    state.shipId = uid
    expect(startMining(state, BELT, simCtx).ok).toBe(true)
    state.warehouse.items[BELT_ORE] = 500
    expect(startRefineRun(state, BELT_ORE, 'pilot', simCtx).ok).toBe(true)
    state.blueprintStock['sbp-sandcat'] = 1
    expect(learnBlueprint(state, simCtx, 'sbp-sandcat').ok).toBe(true)
    state.warehouse.items['min-tritanium'] = 400
    state.warehouse.items['min-pyerite'] = 100
    expect(startManufacturing(state, 'sbp-sandcat', 'pilot', simCtx).ok).toBe(true)
    const good = [...simCtx.marketGoods.values()].find((g) => g.key === BELT_ORE)
    expect(placeBuyOrder(state, simCtx, good!.key, Math.max(1, Math.round(good!.basePrice ?? 1)), 10)).not.toBeNull()
    expect(wormholeEnter(state, simCtx, [uid], 4242).ok).toBe(true)

    const back = loadSaveFile(serializeSaveFile(state, 0)).state
    const before = new Set<string>()
    const after = new Set<string>()
    keysDeep(state, '', before)
    keysDeep(back, '', after)
    const lost = [...before].filter((k) => !after.has(k))
    expect(lost, `这些键引擎写过、读回来没了（白名单漏键）`).toEqual([])
    // 顺手钉住"护栏真的在看东西"：键集合不该是空的
    expect(before.size).toBeGreaterThan(200)
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
 * **core 文案 id（甲案 · 2026-09-20 船长定）的存档往返**：
 * 日志的 `textId` / `textParams` 要能原样存读（造档工具与备份恢复都走这条路），
 * 坏值一律当"没有"（界面于是回退 `text` 中文原串 ⇒ 老档行为不变）。
 */
describe('日志文案 id 的读写（甲案）', () => {
  it('addLog 落 id 与参数 → 序列化 → 读回一致', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 5 })
    addLog(state, 'info', '已停止开采（测试带）。本趟共采得 12 单位原矿。', 'core.mining.021', {
      p1: '测试带',
      p2: 12,
      p3: '原矿',
      p4: '',
    })
    const loaded = loadSaveFile(serializeSaveFile(state, 0)).state
    const entry = loaded.logs[loaded.logs.length - 1]!
    expect(entry.textId).toBe('core.mining.021')
    expect(entry.textParams).toEqual({ p1: '测试带', p2: 12, p3: '原矿', p4: '' })
    expect(entry.text).toContain('已停止开采') // 中文正文照写（检索与兜底用）
  })

  it('未传 id 的日志（老写法）读回后没有 textId ⇒ 界面走中文回退', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 5 })
    addLog(state, 'info', '老写法的一条日志。')
    const entry = loadSaveFile(serializeSaveFile(state, 0)).state.logs.slice(-1)[0]!
    expect(entry.textId).toBeUndefined()
    expect(entry.text).toBe('老写法的一条日志。')
  })

  it('坏 textId / 坏 textParams 一律当没有（不炸、不半残）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 5 })
    const file = JSON.parse(serializeSaveFile(state, 0)) as {
      state: { logs: unknown[] }
    }
    file.state.logs = [
      { id: 1, atGameMs: 0, kind: 'info', text: '甲', textId: 42, textParams: { p1: 'x' } },
      { id: 2, atGameMs: 0, kind: 'info', text: '乙', textId: '', textParams: '不是对象' },
      { id: 3, atGameMs: 0, kind: 'info', text: '丙', textId: 'core.mining.001', textParams: { p1: '带', p2: null, p3: true } },
    ]
    const loaded = loadSaveFile(JSON.stringify(file)).state
    expect(loaded.logs[0]!.textId).toBeUndefined() // 非字符串 ⇒ 丢弃
    expect(loaded.logs[1]!.textId).toBeUndefined() // 空串 ⇒ 丢弃
    expect(loaded.logs[2]!.textId).toBe('core.mining.001')
    expect(loaded.logs[2]!.textParams).toEqual({ p1: '带' }) // 非 string/number 的坏值逐项丢弃
  })
})

/**
 * **迁移链下限的两条钉子**（船长 2026-09-19：「删除过旧的版本迁移，仅保留虫洞之后的」）：
 * ① **下限那一版（v24）仍能升上来**；② **更早的档一律拒载入**（`SaveError('VERSION')`）——
 * 玩家侧由 `engine.start()` 开新档并写日志（本文件只管核心侧的错误码与文案）。
 */
/**
 * **墙钟账只许前进不许回退**（2026-09-25 修 · 与"调试快进"配套）：
 * 快进把 `state.savedAtWallMs` 推到未来（它消费的就是那段未来时间）；写盘若一律盖成 `Date.now()`，
 * 下次读档就把账拽回来 ⇒ ① 快进推进过的入侵时间线要重来；② 再快进一次会把同一段未来算两遍
 * （这一场被 NPC 铺底瞬间吞掉 ⇒ 板面恢复正常悬赏、遇袭不再触发）。
 */
describe('存档墙钟账：只许前进、不许回退', () => {
  it('快进后写盘保留未来值；正常在线仍按 nowWallMs 盖戳', () => {
    const s = createInitialState({ nowWallMs: 0, seed: 21 })
    const real = 1_700_000_000_000
    s.savedAtWallMs = real - 3_600_000
    expect(JSON.parse(serializeSaveFile(s, real)).savedAtWallMs, '正常在线 ⇒ nowWallMs').toBe(real)
    const future = real + 8 * 3_600_000
    s.savedAtWallMs = future
    const file = JSON.parse(serializeSaveFile(s, real)) as { savedAtWallMs: number }
    expect(file.savedAtWallMs, '快进后 ⇒ 保留未来值（不被拽回）').toBe(future)
    /** 读回来仍是这个值；且离线结算见到"负间隔"⇒ 不动（那段时间已经在快进里花掉了） */
    const text = serializeSaveFile(s, real) // 这一份的 savedAtWallMs 就是 future
    const back = loadSaveFile(text)
    expect(back.state.savedAtWallMs).toBe(future)
  })
})

describe('存档迁移下限（v24 起）', () => {  const atVersion = (version: number): string => {
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
