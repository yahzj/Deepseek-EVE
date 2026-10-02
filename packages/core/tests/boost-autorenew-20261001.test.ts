/**
 * **技能加速「自动续用」**用例（**2026-10-01 船长令**）。
 *
 * 船长原话（照抄）：「**给技能加速页面添加一个循环使用的开关。当当前加速效果过时时，自动使用相同效果的
 * 技能加速消耗品，离线期间也一样**」。
 *
 * 五条裁定（船长同日全取推荐案）：① 默认关 · ② 没料自动关 ＋ 一条提示 · ③ 无缝续用（不足当前这一级的
 * 训练时长就补）· ④ 在线逐枚写日志、离线只在结算汇总里写一句 · ⑤ 离线期间同样生效。
 *
 * 判据一律走真引擎（`advanceGame` / `simulateOffline`），不手搓中间态；扣料口径照既有"货仓优先"。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { advanceGame, createInitialState, simulateOffline } from '../src/index'
import {
  SYNAPTIC_ACCELERANT_ITEM_ID,
  SYNAPTIC_ACCELERANT_MS,
  boostAutoRenewOn,
  setBoostAutoRenew,
  skillLevelTimeMs,
  synapticAccelerantRemainMs,
  synapticAccelerantActive,
  trainingTimeFactor,
} from '../src/index'
import { addItem, addWare, countItem, countWare } from '../src/inventory'

const ctx = buildSimContext()
/** 一个短档（rank1 技能单级 60 秒，方便在几拍内制造"剩得不够练完这一级"） */
const BOOST_SKILL = 'mining'

type S = ReturnType<typeof createInitialState>

function stateWithStock(units = 3): S {
  const s = createInitialState({ nowWallMs: 0, seed: 7 })
  addWare(s, SYNAPTIC_ACCELERANT_ITEM_ID, units)
  resetSkill(s)
  return s
}

/**
 * 直接入队（**绕开** `enqueueSkill` 的前置/技能书校验）。
 * 用例考的是"加速剂自动续用"，不是技能解锁链 —— 用一个真实技能 id 走真队列，
 * 但不受"这条技能此刻锁没锁"的影响（`mining` 带前置，`enqueueSkill` 会拒）。
 */
function enqueueDirect(s: S, targetLevel = 5): void {
  s.skills.queue.push({ skillId: BOOST_SKILL, targetLevel, progressMs: 0 })
}

/**
 * 用例内部的干净起点：清掉这条技能已练的等级 ＋ 上一用例残留的队列。
 * （已练等级会影响"单级时长" ⇒ 不清掉的话 `levelMs` 会随用例顺序漂移，断言就变成玄学。）
 */
function resetSkill(s: S): void {
  delete s.skills.trained[BOOST_SKILL]
  s.skills.queue.length = 0
}

/** 这条技能"当前练的这一级"的标称时长（与引擎同一套乘区：等级系数 × 训练乘区 × 标定乘区） */
function levelMsNow(s: S): number {
  const lv = s.skills.trained[BOOST_SKILL] ?? 0
  return Math.max(1, Math.round(skillLevelTimeMs(ctx.skills.get(BOOST_SKILL)!, lv + 1) * trainingTimeFactor(s)))
}

/** 跑一段推进（不依赖等级期望，用例靠"标称时长"自洽判断） */
function run(s: S, ms: number): void {
  advanceGame(s, ms, ctx)
}

describe('技能加速自动续用 · 契约', () => {
  it('物品 id 与加速剂常量对得上（P0 幽灵 id 的回归钉）', () => {
    expect(ctx.items.get(SYNAPTIC_ACCELERANT_ITEM_ID), '突触加速剂必须在物品目录里').toBeDefined()
    expect(SYNAPTIC_ACCELERANT_MS).toBe(24 * 3600_000)
  })
})

describe('技能加速自动续用 · 开关', () => {
  it('默认是关的：老档缺字段 ⇒ 不自动补、不扣料', () => {
    const s = stateWithStock(3)
    expect(boostAutoRenewOn(s)).toBe(false)
    enqueueDirect(s)
    advanceGame(s, 10 * 60_000, ctx) // 10 分钟：足够练完好几级
    expect(countWare(s, SYNAPTIC_ACCELERANT_ITEM_ID), '没开开关 ⇒ 一枚都不该动').toBe(3)
    expect(synapticAccelerantActive(s)).toBe(false)
  })

  it('没库存时打开开关会被当场拒绝（避免"开了下一拍又被自动关掉"的怪手感）', () => {
    const s = createInitialState({ nowWallMs: 0, seed: 7 })
    const r = setBoostAutoRenew(s, true)
    expect(r.ok).toBe(false)
    expect(r.errorId).toBe('core.consumable.016')
    expect(boostAutoRenewOn(s)).toBe(false)
  })

  it('有库存时能开能关（关掉后立刻停止补用）', () => {
    const s = stateWithStock(3)
    expect(setBoostAutoRenew(s, true).ok).toBe(true)
    expect(boostAutoRenewOn(s)).toBe(true)
    expect(setBoostAutoRenew(s, false).ok).toBe(true)
    expect(boostAutoRenewOn(s)).toBe(false)
  })
})

describe('技能加速自动续用 · 无缝补用（在线）', () => {
  it('队列在练、料够：自动补一枚并接上 24 小时（玩家不用手点）', () => {
    const s = stateWithStock(3)
    setBoostAutoRenew(s, true)
    enqueueDirect(s)
    // 队列空着时不会补 —— 先排上队，再推一拍
    advanceGame(s, 1_000, ctx)
    expect(synapticAccelerantActive(s), '第一拍就该补上了（原本没有生效中的加速剂）').toBe(true)
    expect(countWare(s, SYNAPTIC_ACCELERANT_ITEM_ID)).toBe(2)
    expect(s.skillBoostUntilMs).toBe(s.gameMs + SYNAPTIC_ACCELERANT_MS)
  })

  it('无缝：生效时间不足以练完当前这一级时就补，不等它过期', () => {
    const s = stateWithStock(3)
    setBoostAutoRenew(s, true)
    enqueueDirect(s)
    // 窗口 = 本级标称时长的一半 ⇒ "剩下的时间练不完这一级"
    s.skillBoostUntilMs = s.gameMs + Math.floor(levelMsNow(s) / 2)
    const leftBefore = synapticAccelerantRemainMs(s)
    run(s, 1_000)
    /**
     * **2026-10-02 修（船长报障「点自动续用的时候会无视当前剩余时间直接使用一个新的」）**：
     * 补的那一枚**接在剩余之上**（累加），不再把手上那一段剩余丢掉 ⇒ 剩余 = 原剩余 ＋ 24 小时 − 这一拍。
     */
    expect(synapticAccelerantRemainMs(s), '补用是"接在剩余之上"，不丢剩余').toBe(
      leftBefore + SYNAPTIC_ACCELERANT_MS - 1_000,
    )
    expect(countWare(s, SYNAPTIC_ACCELERANT_ITEM_ID)).toBe(2)
  })

  it('剩余充裕时不补（不会白白多烧一枚）', () => {
    const s = stateWithStock(3)
    setBoostAutoRenew(s, true)
    enqueueDirect(s)
    s.skillBoostUntilMs = s.gameMs + SYNAPTIC_ACCELERANT_MS
    advanceGame(s, 1_000, ctx)
    expect(countWare(s, SYNAPTIC_ACCELERANT_ITEM_ID), '还剩 24 小时 ⇒ 不补').toBe(3)
  })

  it('队列空着也照补：开关＝"让加速一直生效"，不因为没在练就停摆', () => {
    const s = stateWithStock(3)
    setBoostAutoRenew(s, true)
    s.skillBoostUntilMs = s.gameMs + 30_000 // 只剩 30 秒（低于兜底阈值 60 秒）
    const leftBefore = synapticAccelerantRemainMs(s)
    run(s, 1_000)
    expect(countWare(s, SYNAPTIC_ACCELERANT_ITEM_ID), '空队列 + 快过期 ⇒ 补一枚').toBe(2)
    expect(synapticAccelerantRemainMs(s), '同样是累加（30 秒 ＋ 24 小时 − 这一拍）').toBe(
      leftBefore + SYNAPTIC_ACCELERANT_MS - 1_000,
    )
  })

  it('队列被练空、且料也尽了 ⇒ 开关收口（离线一趟练空队列的真实形态）', () => {
    const s = stateWithStock(1)
    setBoostAutoRenew(s, true)
    enqueueDirect(s, 1) // 只练到 Lv1
    // 先把它练空：Lv1 的标称时长 + 一点余量
    run(s, levelMsNow(s) + 1_000)
    expect(s.skills.queue.length, '队列已空').toBe(0)
    expect(countWare(s, SYNAPTIC_ACCELERANT_ITEM_ID), '那一枚已在开练前用掉').toBe(0)
    expect(boostAutoRenewOn(s), '料尽 ⇒ 开关收口（不会一直亮着）').toBe(false)
    expect(s.logs.filter((l) => l.textId === 'core.consumable.015').length).toBe(1)
  })

  it('扣料货仓优先（与手动「使用」同一笔语义）', () => {
    const s = stateWithStock(0)
    addItem(s, SYNAPTIC_ACCELERANT_ITEM_ID, 1) // 货仓 1 枚
    addWare(s, SYNAPTIC_ACCELERANT_ITEM_ID, 2) // 仓库 2 枚
    setBoostAutoRenew(s, true)
    enqueueDirect(s)
    advanceGame(s, 1_000, ctx)
    expect(countItem(s, SYNAPTIC_ACCELERANT_ITEM_ID), '货仓那枚先用掉').toBe(0)
    expect(countWare(s, SYNAPTIC_ACCELERANT_ITEM_ID), '仓库那两枚没动').toBe(2)
  })

  it('在线逐枚写日志（可检索的那一句）', () => {
    const s = stateWithStock(3)
    setBoostAutoRenew(s, true)
    enqueueDirect(s)
    advanceGame(s, 1_000, ctx)
    expect(s.logs.some((l) => l.textId === 'core.consumable.013'), '补用要留一条日志').toBe(true)
  })

  /**
   * **不丢剩余**（**2026-10-02 船长报障**：「**点自动续用的时候会无视当前剩余时间直接使用一个新的**」）。
   * 场景 = 手上还剩一大段（本级练不完）⇒ 补一枚，窗口必须是 **剩余 ＋ 24 小时**
   * （原先被重置成 24 小时，那一段剩余白白丢掉）。
   * ⚠ 剩余要按**加速生效后**的本级时长算（乘区 ×0.5 会缩短本级）——先立一剂再量本级时长。
   */
  it('补用**不丢剩余**：手上还剩一大段时，窗口 = 剩余 ＋ 24 小时（修前会被重置成 24 小时）', () => {
    const s = stateWithStock(3)
    setBoostAutoRenew(s, true)
    enqueueDirect(s)
    s.skillBoostUntilMs = s.gameMs + 30 * 3_600_000 // 先让加速生效（乘区 ×0.5 才会算进"本级时长"）
    const left = Math.floor(levelMsNow(s) * 0.6) // 手上剩余：盖不住本级（不到 100%）⇒ 判据③ 该补
    s.skillBoostUntilMs = s.gameMs + left
    run(s, 1_000)
    expect(synapticAccelerantRemainMs(s), '剩余 ＋ 24 小时 − 这一拍（那一段剩余没被丢掉）').toBe(
      left + SYNAPTIC_ACCELERANT_MS - 1_000,
    )
    expect(countWare(s, SYNAPTIC_ACCELERANT_ITEM_ID), '补了一枚').toBe(2)
  })
})

describe('技能加速自动续用 · 料尽', () => {
  it('料已被上一枚吃光时：当场关掉开关，并且只提示一次', () => {
    const s = stateWithStock(1)
    setBoostAutoRenew(s, true)
    enqueueDirect(s)
    run(s, 1_000) // 用掉唯一一枚，开关此时应还开着（那一剂正在生效）
    expect(countWare(s, SYNAPTIC_ACCELERANT_ITEM_ID)).toBe(0)
    run(s, 1_000) // 下一拍：库存 0 ⇒ 判据② 当场收口（不等这一剂自然过期）
    expect(boostAutoRenewOn(s), '料尽 ⇒ 开关自动关').toBe(false)
    expect(s.logs.filter((l) => l.textId === 'core.consumable.015').length, '提示只写一次').toBe(1)
    run(s, 60 * 60_000) // 再推一小时：既不补、也不再刷提示
    expect(s.logs.filter((l) => l.textId === 'core.consumable.015').length).toBe(1)
    expect(countWare(s, SYNAPTIC_ACCELERANT_ITEM_ID)).toBe(0)
  })
})

describe('技能加速自动续用 · 离线', () => {
  it('离线期间照旧补用；汇总里写一句"×N"，但离线时段不逐枚刷日志', () => {
    const s = stateWithStock(2)
    setBoostAutoRenew(s, true)
    enqueueDirect(s)
    s.skillBoostUntilMs = s.gameMs + 5 * 60_000 // 只剩 5 分钟
    const before = s.logs.length
    simulateOffline(s, 1_000_000, 1_000_000 + 30 * 60_000, ctx) // 离线 30 分钟
    const added = s.logs.slice(before)
    expect(
      added.filter((l) => l.textId === 'core.consumable.013').length,
      '离线期间不逐枚写（船长选案）',
    ).toBe(0)
    const done = added.find((l) => l.textId === 'core.simulation.002')
    expect(done, '离线汇总那一句必须在').toBeDefined()
    expect(done?.text).toContain('自动续用突触加速剂 ×1')
    expect(countWare(s, SYNAPTIC_ACCELERANT_ITEM_ID), '离线补了一枚').toBe(1)
  })

  it('离线期间料尽 ⇒ 同样自动关掉开关（开关随档，上线不复燃）', () => {
    const s = stateWithStock(1)
    setBoostAutoRenew(s, true)
    s.skills.queue.length = 0 // 这一条只考"离线段里把料吃光后开关收口"
    s.skillBoostUntilMs = s.gameMs + 5 * 60_000
    // 离线 9 小时：够跨过"剩 5 分钟"那道到期点，也超过离线上限（超出的部分不结算）
    simulateOffline(s, 2_000_000, 2_000_000 + 9 * 3600_000, ctx)
    expect(countWare(s, SYNAPTIC_ACCELERANT_ITEM_ID), '离线里补过一枚并吃光').toBe(0)
    expect(boostAutoRenewOn(s), '料尽 ⇒ 关').toBe(false)
  })

  it('离线补用的那一枚真的让训练更快（无缝的因果闭环）', () => {
    const s = stateWithStock(2)
    setBoostAutoRenew(s, true)
    enqueueDirect(s)
    // 窗口只够一小段 ⇒ 必须靠自动补用才能一路加速（只跑 10 分钟，离线上限不掺和）
    s.skillBoostUntilMs = s.gameMs + Math.floor(levelMsNow(s) / 2)
    const leftBefore = synapticAccelerantRemainMs(s)
    run(s, 1_000) // 先让它补上一枚
    // 累加语义（2026-10-02）：补后 = 原剩余 ＋ 24 小时 − 这一拍
    expect(synapticAccelerantRemainMs(s)).toBe(leftBefore + SYNAPTIC_ACCELERANT_MS - 1_000)
    const trainedBefore = skillsTrained(s, BOOST_SKILL)
    const progressBefore = s.skills.queue[0]!.progressMs
    run(s, 5 * 60_000)
    const advanced = skillsTrained(s, BOOST_SKILL) > trainedBefore || s.skills.queue[0]!.progressMs > progressBefore
    expect(advanced, '补用后训练继续推进（没有掉速空窗）').toBe(true)
    expect(countWare(s, SYNAPTIC_ACCELERANT_ITEM_ID), '窗口够长 ⇒ 这 5 分钟不再多烧一枚').toBe(1)
  })
})

function skillsTrained(s: S, id: string): number {
  return s.skills.trained[id] ?? 0
}
