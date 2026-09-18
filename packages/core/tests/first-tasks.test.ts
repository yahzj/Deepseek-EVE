/**
 * **「第一次」任务系列 · 端到端**（2026-09-17 教程重做批 · 阶段④）。
 *
 * 这一组用例钉的是"**事件 → 计数 → 判定 → 通讯/奖励 → 次数链 → 领奖**"这条链上的每一环，
 * 以及最容易悄悄坏掉的三件事：
 * ① 奖励只发一次（去重键 = `importantTasks[id].done`）；
 * ② 链的**记账**（`advanceFirstChains`，每拍）与**发钱**（`claimChainReward`，点一次领一次）分开；
 * ③ 终身计数读档往返不丢（`firstStats` 落盘）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState, HOME_GALAXY_ID } from '../src/state'
import type { GameState } from '../src/state'
import { advanceGame } from '../src/engine'
import {
  CHAIN_REWARD_ISK,
  FIRST_TASKS,
  advanceFirstChains,
  chainProgressOf,
  claimChainReward,
  firstStatOf,
  visibleFirstTasks,
} from '../src/firstTasks'
import { startMining } from '../src/mining'
import { startRecycleRun, startRefineRun } from '../src/industry'
import { repairShip } from '../src/shipyard'
import { startScan } from '../src/explore'
import { loadSaveFile, serializeSaveFile } from '../src/save'

const ctx = buildSimContext()
const HOME = HOME_GALAXY_ID
/** 母港唯一矿带（丰饶之环 · 声望门槛 0） */
const BELT = 'belt-fortune'

/** 非序章档（母港已探明，可直接开采）：只用来测计数与任务判定本身 */
function testState(): GameState {
  return createInitialState({ nowWallMs: 0, seed: 11 })
}

describe('「第一次」任务：计数 → 完成 → 奖励（一次性）', () => {
  it('采矿计数随产量增长，采到第一单位即判过「第一次采集原矿」', () => {
    const state = testState()
    expect(firstStatOf(state, 'mineUnits')).toBe(0)
    expect(startMining(state, BELT, ctx).ok).toBe(true)
    // 推进到至少产出一次（采矿循环 30 秒/次；多推几拍保证出料）
    for (let i = 0; i < 60 && firstStatOf(state, 'mineUnits') === 0; i++) advanceGame(state, 5_000, ctx)
    const mined = firstStatOf(state, 'mineUnits')
    expect(mined).toBeGreaterThan(0)
    expect(state.importantTasks['first-mine']?.done).toBe(true)
  })

  it('奖励只发一次：那张动能弹药蓝图进一次库存，重复推进不再加', () => {
    const state = testState()
    expect(startMining(state, BELT, ctx).ok).toBe(true)
    for (let i = 0; i < 60 && state.importantTasks['first-mine']?.done !== true; i++) advanceGame(state, 5_000, ctx)
    expect(state.blueprintStock['bp-ammo-kinetic']).toBe(1)
    // 再推进一段（计数继续涨）——奖励不再发第二次
    for (let i = 0; i < 20; i++) advanceGame(state, 5_000, ctx)
    expect(state.blueprintStock['bp-ammo-kinetic']).toBe(1)
  })

  it('前置未完成 ⇒ 任务在任务中心不显示（船长：「两者都隐藏」）', () => {
    // 序章新档：一处都没点亮 ⇒ 只有「第一次扫描」与不设前置的那几条可见
    const fresh = createInitialState({ nowWallMs: 0, seed: 11, prologue: true })
    const visible = visibleFirstTasks(fresh).map((d) => d.id)
    expect(visible).toContain('first-scan')
    expect(visible).not.toContain('first-mine') // 前置 = first-scan
    // 完成前置 ⇒ 后继出现
    fresh.importantTasks['first-scan'] = { done: true }
    expect(visibleFirstTasks(fresh).map((d) => d.id)).toContain('first-mine')
  })
})

describe('「第一次」任务：计数落点回归（2026-09-17 自查修的两处）', () => {
  it('精炼炉出料记一批；**残骸回收炉不计入**（任务文案 = 「让精炼炉出一批料」）', () => {
    const state = testState()
    state.warehouse.items['ore-veldspar'] = 200
    expect(startRefineRun(state, 'ore-veldspar', 'pilot', ctx).ok).toBe(true)
    for (let i = 0; i < 20 && firstStatOf(state, 'refineBatches') === 0; i++) advanceGame(state, 60_000, ctx)
    expect(firstStatOf(state, 'refineBatches')).toBeGreaterThan(0)
    // 残骸回收：同一页的另一台炉，不记精炼批数
    const wreck = [...ctx.items.values()].find((i) => i.kind === 'wreck')
    expect(wreck).toBeDefined()
    const before = firstStatOf(state, 'refineBatches')
    state.warehouse.items[wreck!.id] = 200
    expect(startRecycleRun(state, wreck!.id, 'pilot', ctx).ok).toBe(true)
    for (let i = 0; i < 10; i++) advanceGame(state, 60_000, ctx)
    expect(firstStatOf(state, 'refineBatches')).toBe(before)
  })

  it('港内付费维修记一次（任务：「用修理组件或港内维修修一次船」）', () => {
    const state = testState()
    state.wallet.isk = 500_000
    const fal = state.fleet['sh-falconet']!
    fal.armorPct = 0.4
    fal.durability = 0.4
    expect(firstStatOf(state, 'repairs')).toBe(0)
    expect(repairShip(state, 'sh-falconet', ctx).ok).toBe(true)
    expect(firstStatOf(state, 'repairs')).toBe(1)
    advanceGame(state, 1000, ctx)
    expect(state.importantTasks['first-repair']?.done).toBe(true)
  })
})

describe('「第一次」次数链：记账与领奖分开', () => {
  it('扫描链：每越过一档记一级（记账不掏钱），领奖时才发 ISK', () => {
    const state = testState()
    const chain = FIRST_TASKS.find((d) => d.id === 'first-scan')!.chain!
    expect(chainProgressOf(state, chain).level).toBe(0)
    // 点亮 5 个星系 = 第一档（阈值表 scan[0] = 5）
    const ids = [...ctx.galaxies.keys()].slice(0, 5)
    state.exploredGalaxies = ids
    const ups = advanceFirstChains(state)
    expect(ups.map((u) => u.id)).toContain('explorer')
    expect(state.importantTasks['chain-explorer']?.delivered).toBe(1)
    // 记账不发钱：钱包没动
    expect(state.wallet.isk).toBe(createInitialState({ nowWallMs: 0, seed: 11 }).wallet.isk)
    // 领奖：一次领 1 档 = 2,500；再点一次为 0（幂等）
    expect(claimChainReward(state, 'explorer')).toBe(CHAIN_REWARD_ISK)
    expect(claimChainReward(state, 'explorer')).toBe(0)
    // 再点亮到第 2 档（8 个）⇒ 又记一级；这次领 1 档
    state.exploredGalaxies = [...ctx.galaxies.keys()].slice(0, 8)
    advanceFirstChains(state)
    expect(state.importantTasks['chain-explorer']?.delivered).toBe(2)
    expect(claimChainReward(state, 'explorer')).toBe(CHAIN_REWARD_ISK)
  })

  it('一次跨越两档：领奖按"已达成 − 已领"一次结清', () => {
    const state = testState()
    // 直接点亮 12 个星系 = 第 3 档（5/8/12）
    state.exploredGalaxies = [...ctx.galaxies.keys()].slice(0, 12)
    advanceFirstChains(state)
    expect(state.importantTasks['chain-explorer']?.delivered).toBe(3)
    expect(claimChainReward(state, 'explorer')).toBe(CHAIN_REWARD_ISK * 3)
    expect(claimChainReward(state, 'explorer')).toBe(0)
  })

  it('未知链 id 领奖返回 0（界面误点不炸）', () => {
    const state = testState()
    expect(claimChainReward(state, 'no-such-chain')).toBe(0)
  })
})

describe('「第一次」任务：存档往返', () => {
  it('终身计数与领奖额随档往返（`firstStats` 落盘、缺省 0）', () => {
    const state = testState()
    state.importantTasks['first-scan'] = { done: true }
    state.exploredGalaxies = [...ctx.galaxies.keys()].slice(0, 5)
    advanceFirstChains(state)
    claimChainReward(state, 'explorer')
    const loaded = loadSaveFile(serializeSaveFile(state, 1)).state
    expect(loaded.firstStats?.['paid-explorer']).toBe(1)
    expect(loaded.importantTasks['first-scan']?.done).toBe(true)
    // 读档后不再重复领
    expect(claimChainReward(loaded, 'explorer')).toBe(0)
  })

  it('新档不写 `firstStats` 键（真零迁移）；扫描这类"可推导计数"也不建表', () => {
    const fresh = createInitialState({ nowWallMs: 0, seed: 11, prologue: true })
    expect(fresh.firstStats).toBeUndefined()
    expect(startScan(fresh, HOME, ctx).ok).toBe(true)
    expect(fresh.firstStats).toBeUndefined() // 扫描不写计数（走 exploredGalaxies）
  })
})
