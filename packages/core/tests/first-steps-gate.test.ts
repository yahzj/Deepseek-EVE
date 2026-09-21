/**
 * **新档「母港未知」与前置解锁（船长 2026-09-17）**。
 *
 * 船长原话：「**初始将母港星系设置为和其他星系一样的未知状态，需要扫描才有悬赏和挖矿**」⇒ 三处配套：
 * ① 序章档（真实新游戏入口 `prologue: true`）开局 `exploredGalaxies` **为空**；
 * ② `isExplored` / `actionBlockReason` **删除"母港恒为已探索"的豁免**（原先两处硬写 `=== HOME_GALAXY_ID`）；
 * ③ `frontierGalaxyIds` 把**未探索的母港**当种子 —— 否则零探索时"邻接已探索"为空 ⇒ **无处可扫的死锁**。
 *
 * ⚠ 非序章档（测试与工具入口 `prologue !== true`）**保持母港已探索**，最后一条对照用例把它钉住。
 * ⚠ 本文件只覆盖"前置面"（阶段①）；「第一次」任务系列与解锁表在后续阶段落码。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { HOME_GALAXY_ID, createInitialState } from '../src/state'
import { advanceGame } from '../src/engine'
import { actionBlockReason, frontierGalaxyIds, isExplored, startScan } from '../src/explore'
import { unlocked, unlockNeedTitle } from '../src/firstTasks'
import { startMining } from '../src/mining'

const ctx = buildSimContext()
const HOME = HOME_GALAXY_ID
/** 母港唯一矿带（丰饶之环 · 声望门槛 0）——就是原教程第一步用的那条 */
const BELT = 'belt-fortune'

function newGame() {
  return createInitialState({ nowWallMs: 0, seed: 7, prologue: true })
}

describe('新档「母港未知」与前置解锁（船长 2026-09-17）', () => {
  it('序章档开局：**一处都没点亮**；母港是唯一可扫描目标（防"零探索无处可扫"）', () => {
    const state = newGame()
    expect(state.exploredGalaxies).toEqual([])
    expect(isExplored(state, HOME)).toBe(false)
    expect(frontierGalaxyIds(state, ctx)).toEqual([HOME])
  })

  it('未扫描前：**悬赏与挖矿都被拒**（拒因点名"尚未探索"）；扫完母港即放行', () => {
    const state = newGame()
    // ① 未扫描 ⇒ 母港矿带开采被拒、行动封锁点名
    const blocked = startMining(state, BELT, ctx)
    expect(blocked.ok, '母港未探索时不该能开采').toBe(false)
    expect(blocked.error ?? '').toContain('尚未探索')
    expect(actionBlockReason(state, HOME)).not.toBeNull()
    // ② 扫母港（新玩家的第一个扫描目标）
    expect(startScan(state, HOME, ctx).ok).toBe(true)
    for (let i = 0; i < 400 && (state.scanning.active || !isExplored(state, HOME)); i++) {
      advanceGame(state, 60_000, ctx)
    }
    expect(isExplored(state, HOME), '扫完母港应当点亮').toBe(true)
    // ③ 放行
    expect(actionBlockReason(state, HOME)).toBeNull()
    expect(startMining(state, BELT, ctx).ok).toBe(true)
  })

  it('对照：非序章档（测试与工具入口）母港照旧已探索，矿带不受影响', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    expect(isExplored(state, HOME)).toBe(true)
    expect(actionBlockReason(state, HOME)).toBeNull()
    expect(startMining(state, BELT, ctx).ok).toBe(true)
  })

  /**
   * 前置解锁表（阶段③ · 数据驱动）：界面只读 `FIRST_UNLOCKS` / `unlocked()`。
   * 口径：**工业 ← 「第一次操作精炼炉」轮到**（**2026-09-20 船长令**：「解锁工业界面要和第一次精炼的任务
   * 挂钩一起解锁」⇒ 走 `UNLOCK_AT_TASK`；旧句"工业 ← 第一次采集原矿完成"作废）· 市场 ← 第一次生产 ·
   * 星图四项 ← 第一次扫描；**未解锁的页面与任务都隐藏**（隐藏是 UI 的事，这里钉的是判定本体）。
   */
  it('解锁表：开局只放行未登记项；完成对应「第一次」后逐项开放（工业跟精炼任务一起开）', () => {
    const state = newGame()
    // 表里没有的能力（舰船/装配/物品/技能/任务中心/通讯/手册/星图页本体）开局即可用
    expect(unlocked(state, 'ship')).toBe(true)
    expect(unlocked(state, 'map')).toBe(true)
    expect(unlocked(state, 'star')).toBe(true)
    expect(unlockNeedTitle('ship')).toBeUndefined()
    // 表里有的：开局全锁，且提示文案点名前置任务
    expect(unlocked(state, 'industry')).toBe(false)
    expect(unlocked(state, 'market')).toBe(false)
    for (const k of ['mapMine', 'mapBounty', 'mapSalvage', 'mapHaul']) {
      expect(unlocked(state, k), `${k} 应在开局锁上`).toBe(false)
      expect(unlockNeedTitle(k)).toBe('第一次扫描')
    }
    // 工业页跟「第一次操作精炼炉」**一起**开 ⇒ 提示给的是它的**前一条**
    expect(unlockNeedTitle('industry')).toBe('第一次完成悬赏')
    expect(unlockNeedTitle('market')).toBe('第一次生产')
    // 完成「第一次扫描」⇒ 星图四项一起开（工业/市场仍锁——各有各的前置）
    state.importantTasks['first-scan'] = { done: true }
    for (const k of ['mapMine', 'mapBounty', 'mapSalvage', 'mapHaul']) expect(unlocked(state, k)).toBe(true)
    expect(unlocked(state, 'industry')).toBe(false)
    expect(unlocked(state, 'market')).toBe(false)
    // 采矿/打捞/维修做完 ⇒ 工业页**仍然锁着**（它等的不是"采矿完成"，而是「精炼」轮到）
    for (const id of ['first-mine', 'first-salvage', 'first-repair']) {
      state.importantTasks[id] = { done: true }
      expect(unlocked(state, 'industry'), `${id} 完成后工业页不该开`).toBe(false)
    }
    expect(unlocked(state, 'market')).toBe(false)
    // 悬赏做完 ⇒ 「第一次操作精炼炉」轮到 ⇒ 工业页与之同时亮起
    state.importantTasks['first-bounty'] = { done: true }
    expect(unlocked(state, 'industry')).toBe(true)
    expect(unlocked(state, 'market')).toBe(false)
    state.importantTasks['first-produce'] = { done: true }
    expect(unlocked(state, 'market')).toBe(true)
  })
})
