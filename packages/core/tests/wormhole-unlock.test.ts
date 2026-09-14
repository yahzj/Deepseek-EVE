/**
 * **虫洞解锁门槛 + 需弹窗的通讯 + 调试加速**（船长 2026-09-14 四条：
 * 「虫洞内战斗胜利的战斗报告会被虫洞界面遮挡」·「离开虫洞的战斗也会弹出战斗报告（这一场战斗不应该弹出）」·
 * 「希望调试模式也能增加虫洞扫码的速度」·「扫码虫洞需要玩家35声望才会解锁。解锁时发送通讯给玩家
 * （同时也要直接弹窗）」）。
 *
 * 前两条是**界面层**（`BattleScreen` 的战报阶段 z-index 与"撤离战不弹战报"），本文件锁**core 侧**这三条：
 * ① 声望门槛：< 35 一律拦（且理由是"未解锁"）、= 35 放行；
 * ② 调试 1 秒化：`state.debugQuick` 时扫描窗口 = 1 秒（与星图扫描/AI 任务同一把开关）；
 * ③ 解锁通讯：`{ kind: 'standing' }` 触发器 + `popup` 弹窗队列 + `unreleased` 施工期闸门（上线前不送达）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import { advanceComms, commsInbox, commsPopupQueue, dismissCommsPopup } from '../src/comms'
import { WORMHOLE_SCAN_UNLOCK_STANDING, advanceWormholeScan, reconcileWormholeScanWelcome, wormholeScanBlockReason, wormholeScanStanding, wormholeScanStart, wormholeScanUnlocked, wormholeScanWindowMs } from '../src/wormholeScan'
import type { CommsMessageDef } from '../src/types'
import { loadSaveFile, serializeSaveFile } from '../src/save'

const ctx = buildSimContext()

function fresh(seed = 7): GameState {
  return createInitialState({ nowWallMs: 0, seed })
}

/** 造一封"解锁信"（正式文案在 data/messages.ts；这里只测机制） */
function unlockMsg(opts?: { unreleased?: boolean; min?: number }): CommsMessageDef {
  return {
    id: 'msg-test-unlock',
    factionId: 'dshi',
    deptId: 'dept-survey',
    kind: '提示',
    subject: '深空测绘解锁：裂隙扫描阵列',
    body: ['测试正文'],
    trigger: { kind: 'standing', factionId: 'dsi', min: opts?.min ?? WORMHOLE_SCAN_UNLOCK_STANDING },
    popup: true,
    ...(opts?.unreleased === true ? { unreleased: true } : {}),
  }
}

/** 带一封自造通讯的 ctx（只改 commsMessages 一张表） */
function ctxWith(msg: CommsMessageDef): typeof ctx {
  return { ...ctx, commsMessages: new Map([[msg.id, msg]]) } as typeof ctx
}

describe('虫洞解锁门槛（船长 2026-09-14：先定 35，当日改判提高到 40）', () => {
  it('**门槛 = 协会声望 40**：不足时拦（理由是未解锁）、刚好达标放行', () => {
    const state = fresh()
    expect(WORMHOLE_SCAN_UNLOCK_STANDING).toBe(40)
    // 默认档声望 0 ⇒ 未解锁
    expect(wormholeScanUnlocked(state)).toBe(false)
    expect(wormholeScanStanding(state)).toBe(0)
    const blocked = wormholeScanBlockReason(state)
    expect(blocked).toContain('尚未解锁')
    expect(blocked).toContain(`${WORMHOLE_SCAN_UNLOCK_STANDING}`)
    // 差 1 点仍拦（边界跟着常量走，改门槛不用改用例）
    state.standings['dsi'] = WORMHOLE_SCAN_UNLOCK_STANDING - 1
    expect(wormholeScanUnlocked(state)).toBe(false)
    expect(wormholeScanBlockReason(state)).toContain('尚未解锁')
    // 达标放行（其余前置都满足 ⇒ 理由是 null）
    state.standings['dsi'] = WORMHOLE_SCAN_UNLOCK_STANDING
    expect(wormholeScanUnlocked(state)).toBe(true)
    expect(wormholeScanBlockReason(state)).toBeNull()
  })

  it('**调试 1 秒化**：`debugQuick` 打开后窗口 = 1 秒（与星图扫描同一把开关）', () => {
    const state = fresh()
    state.standings['dsi'] = WORMHOLE_SCAN_UNLOCK_STANDING
    const normal = wormholeScanWindowMs(state)
    expect(normal).toBe(12 * 60 * 60_000) // 未练技能 = 12 小时（船长 2026-09-14：「虫洞扫描时长提高到12小时」）
    state.debugQuick = true
    expect(wormholeScanWindowMs(state)).toBe(1000)
    state.debugQuick = false
    expect(wormholeScanWindowMs(state)).toBe(normal)
  })
})

describe('需弹窗的通讯（解锁信）', () => {
  it('**声望达标 ⇒ 送达 + 进弹窗队列**；点「知道了」后出队（信仍留在收件箱）', () => {
    const state = fresh()
    const msg = unlockMsg()
    const c = ctxWith(msg)
    // 未达标：不送、不弹
    advanceComms(state, c)
    expect(commsPopupQueue(state)).toHaveLength(0)
    // 达标：送 + 进队列
    state.standings['dsi'] = WORMHOLE_SCAN_UNLOCK_STANDING
    advanceComms(state, c)
    expect(commsPopupQueue(state)).toEqual([msg.id])
    expect(commsInbox(state, c).some((e) => e.id === msg.id)).toBe(true)
    // 幂等：再推进一拍不会重复入队
    advanceComms(state, c)
    expect(commsPopupQueue(state)).toEqual([msg.id])
    // 关掉弹窗：出队，但收件箱里还在（关掉不丢信）
    expect(dismissCommsPopup(state, msg.id)).toBe(true)
    expect(commsPopupQueue(state)).toHaveLength(0)
    expect(commsInbox(state, c).some((e) => e.id === msg.id)).toBe(true)
    // 再关一次是幂等 false
    expect(dismissCommsPopup(state, msg.id)).toBe(false)
  })

  it('**`unreleased` 施工期闸门**：标了就不送达、也不弹（上线时删字段即可开送）', () => {
    const state = fresh()
    state.standings['dsi'] = 99
    const msg = unlockMsg({ unreleased: true })
    const c = ctxWith(msg)
    advanceComms(state, c)
    expect(commsPopupQueue(state)).toHaveLength(0)
    expect(commsInbox(state, c).some((e) => e.id === msg.id)).toBe(false)
  })

  it('**门槛值口径**：`standing` 触发器按"声望势力 id"判定（不是通讯发件势力 id）', () => {
    const state = fresh()
    state.standings['dsi'] = WORMHOLE_SCAN_UNLOCK_STANDING
    state.standings['dshi'] = 0 // 通讯发件势力那套 id 不该被当声望用
    const c = ctxWith(unlockMsg())
    advanceComms(state, c)
    expect(commsPopupQueue(state)).toHaveLength(1)
  })
})

/**
 * **解锁当次那"满一个窗口"**（船长 2026-09-14 四步闸门：①甲 置满进度·玩家点一下即得 ②只送一次
 * ③乙 未达门槛时选项卡置灰不可点 ④不加提示语）。
 *
 * 船长原话：「当玩家解锁虫洞时，让虫洞的进度条初始为100%（也就是玩家点击扫描时立刻获得一个虫洞）」。
 */
describe('解锁当次的「满窗口」（2026-09-14 船长 · 甲 + 只送一次）', () => {
  it('未达标 ⇒ 不置满、不置标记；达标那一刻 ⇒ 置满 + 置标记；再调幂等（**只送一次**）', () => {
    const state = fresh()
    expect(reconcileWormholeScanWelcome(state)).toBe(false) // 声望 0：什么都不做
    expect(state.wormholeScan!.progressMs).toBe(0)
    expect(state.wormholeScan!.welcomed).not.toBe(true)

    state.standings['dsi'] = WORMHOLE_SCAN_UNLOCK_STANDING
    expect(reconcileWormholeScanWelcome(state)).toBe(true)
    expect(state.wormholeScan!.progressMs).toBe(wormholeScanWindowMs(state)) // = 满窗口
    expect(state.wormholeScan!.welcomed).toBe(true)

    // 模拟后续 tick：进度已被玩家用掉 ⇒ 不会被重新置满（只送一次）
    state.wormholeScan!.progressMs = 0
    expect(reconcileWormholeScanWelcome(state)).toBe(false)
    expect(state.wormholeScan!.progressMs).toBe(0)
  })

  it('接线：置满之后点「开始扫描」⇒ **第一拍就产出一处**（库存 +1、进度回落到那一拍）', () => {
    const state = fresh()
    state.standings['dsi'] = WORMHOLE_SCAN_UNLOCK_STANDING
    expect(reconcileWormholeScanWelcome(state)).toBe(true)
    expect(wormholeScanStart(state, ctx).ok).toBe(true)
    expect(state.wormholeStock ?? []).toHaveLength(0)
    advanceWormholeScan(state, ctx, 1) // **一拍**
    expect(state.wormholeStock ?? []).toHaveLength(1)
    expect(state.wormholeScan!.progressMs).toBe(1) // 满窗口被消耗掉，只剩这一拍
  })

  it('存档往返：标记随档保留；老档缺省 = 未发放（**零迁移**，达标后下一次 tick 自动补）', () => {
    const state = fresh()
    state.standings['dsi'] = WORMHOLE_SCAN_UNLOCK_STANDING
    reconcileWormholeScanWelcome(state)
    const back = loadSaveFile(serializeSaveFile(state))
    expect(back.state.wormholeScan!.welcomed).toBe(true)
    expect(back.state.wormholeScan!.progressMs).toBe(wormholeScanWindowMs(state))

    // 老档语义：字段缺省 = 尚未发放；达标的老档照样会被补上（逐 tick 收口）
    const legacy = fresh()
    expect(legacy.wormholeScan!.welcomed).toBeUndefined()
    legacy.standings['dsi'] = WORMHOLE_SCAN_UNLOCK_STANDING
    expect(reconcileWormholeScanWelcome(legacy)).toBe(true)
  })
})

