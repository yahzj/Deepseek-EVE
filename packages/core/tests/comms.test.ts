/**
 * 通讯收件箱（2026-09-11 船长定：NPC 发消息补充剧情与任务提示；六条裁决全为「甲」）。
 *
 * 覆盖：触发条件逐个 correctness / 送达幂等 / 未读与已读口径 / 剧本镜像（合并进同一收件箱）/
 * 存档往返（含垃圾数据丢弃）/ 序章引导期间的送达时机。
 * 设计稿：`docs/design/comms-20260911.md`。
 */
import { describe, expect, it } from 'vitest'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import type { CommsMessageDef, SimContext, StationSiteDef } from '../src/types'
import {
  advanceComms,
  commsDialogueKey,
  commsGameClock,
  commsInbox,
  commsTriggerMet,
  commsUnreadCount,
  markAllCommsRead,
  markCommsRead,
} from '../src/comms'
import { COMMS_DAY_MS } from '../src/comms'
import { onArriveAtGalaxy, playDialogue } from '../src/station'
import { advanceGame } from '../src/engine'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { ONB_DONE } from '../src/onboarding'
import { makeTestCtx } from './helpers'

/** 迷你建站点（挂在 galaxy-far；介绍剧本 dlg-intro） */
function siteDef(): StationSiteDef {
  return {
    id: 'site-test',
    name: '测试前哨站',
    galaxyId: 'galaxy-far',
    standingReq: 0,
    tiers: [{ name: '建成', bill: [{ itemId: 'ore-a', count: 100 }], unlockDesc: '建成' }],
    introDialogueId: 'dlg-intro',
    doneDialogueId: null,
    description: '测试站点',
  }
}

const MSGS: readonly CommsMessageDef[] = [
  { id: 'msg-start', from: '协会 · 调度台', subject: '开局信', body: ['第一段。', '第二段。'], trigger: { kind: 'start' } },
  { id: 'msg-day', from: '协会 · 测绘处', subject: '第二天备忘', body: ['过了两天。'], trigger: { kind: 'day', days: 2 } },
  { id: 'msg-explored', from: '协会 · 巡逻队', subject: '三次探明', body: ['开了三个星系。'], trigger: { kind: 'explored', count: 3 } },
  { id: 'msg-galaxy', from: '打捞队 · 老陈', subject: '坟场见闻', body: ['坟场那边有货。'], trigger: { kind: 'galaxy', galaxyId: 'galaxy-far' } },
  { id: 'msg-skill', from: '协会 · 训练处', subject: '技能达标', body: ['技能到 2 级了。'], trigger: { kind: 'skill', skillId: 'mining', level: 2 } },
  { id: 'msg-isk', from: '协会 · 财务', subject: '资金到账', body: ['账上有钱了。'], trigger: { kind: 'isk', amount: 50_000 } },
  { id: 'msg-site', from: '协会 · 基建部', subject: '前哨站并网', body: ['站建好了。'], trigger: { kind: 'siteBuilt', siteId: 'site-test' } },
  {
    id: 'msg-hint',
    from: '协会 · 任务处',
    subject: '带跳转的消息',
    body: ['正文。'],
    trigger: { kind: 'day', days: 1 },
    hint: { text: '去星图看看。', page: 'map', tab: 'salvage' },
  },
]

function world(msgs: readonly CommsMessageDef[] = MSGS) {
  const ctx: SimContext = makeTestCtx({
    stations: [siteDef()],
    quietEvents: true,
    commsMessages: msgs,
    dialogues: [{ id: 'dlg-intro', title: '深空工业协会 · 基建部', subject: '测试前哨站 · 建设交底', lines: [
      { speaker: '基建部 · 柯岚', text: '能收到吗？' },
      { speaker: '基建部 · 柯岚', text: '这里要建站。' },
    ] }],
  })
  const state: GameState = createInitialState({ nowWallMs: 0, seed: 7 })
  return { state, ctx }
}

/** 推进一帧（走真实引擎入口，保证 advanceComms 挂在正确的链路里） */
function tick(state: GameState, ctx: SimContext, ms = 1000): void {
  advanceGame(state, ms, ctx, { nowWallMs: 0 })
}

describe('通讯 · 触发条件', () => {
  it('开局信：序章引导期间不送（导航那时被教程锁着），收尾演出起送达', () => {
    const { state, ctx } = world()
    expect(state.onboarding.step).toBeLessThan(ONB_DONE)
    tick(state, ctx, 5000)
    expect(state.commsDelivered?.['msg-start']).toBeUndefined() // 引导中不送
    state.onboarding.step = ONB_DONE
    tick(state, ctx, 1000)
    expect(state.commsDelivered?.['msg-start']).toBeDefined()
  })

  it('六个条件各自独立生效（天数 / 已探明 / 指定星系 / 技能 / 现金 / 副站建成）', () => {
    const { state, ctx } = world()
    state.onboarding.step = ONB_DONE
    expect(commsTriggerMet(state, ctx, { kind: 'day', days: 2 })).toBe(false)
    expect(commsTriggerMet(state, ctx, { kind: 'explored', count: 3 })).toBe(false)
    expect(commsTriggerMet(state, ctx, { kind: 'galaxy', galaxyId: 'galaxy-far' })).toBe(false)
    expect(commsTriggerMet(state, ctx, { kind: 'skill', skillId: 'mining', level: 2 })).toBe(false)
    expect(commsTriggerMet(state, ctx, { kind: 'isk', amount: 50_000 })).toBe(false)
    expect(commsTriggerMet(state, ctx, { kind: 'siteBuilt', siteId: 'site-test' })).toBe(false)
    // 逐个满足
    state.gameMs = COMMS_DAY_MS * 2
    expect(commsTriggerMet(state, ctx, { kind: 'day', days: 2 })).toBe(true)
    state.exploredGalaxies = ['galaxy-hub', 'galaxy-far', 'galaxy-grave']
    expect(commsTriggerMet(state, ctx, { kind: 'explored', count: 3 })).toBe(true)
    expect(commsTriggerMet(state, ctx, { kind: 'galaxy', galaxyId: 'galaxy-far' })).toBe(true)
    state.skills.trained['mining'] = 2
    expect(commsTriggerMet(state, ctx, { kind: 'skill', skillId: 'mining', level: 2 })).toBe(true)
    state.wallet.isk = 50_000
    expect(commsTriggerMet(state, ctx, { kind: 'isk', amount: 50_000 })).toBe(true)
    state.stationSites['site-test'] = { stage: 1, delivered: {} } // 档位全完成 = 建成
    expect(commsTriggerMet(state, ctx, { kind: 'siteBuilt', siteId: 'site-test' })).toBe(true)
    // 未知 kind（数据写错时）：既不崩也不送
    expect(commsTriggerMet(state, ctx, { kind: 'nope' } as unknown as CommsMessageDef['trigger'])).toBe(false)
  })

  it('送达幂等：重复推进不重复送，日志只留一条', () => {
    const { state, ctx } = world()
    state.onboarding.step = ONB_DONE
    state.gameMs = COMMS_DAY_MS * 3 // 一次满足 day 2 / day 1 / start
    for (let i = 0; i < 5; i += 1) advanceComms(state, ctx)
    expect(state.commsDelivered?.['msg-start']).toBeDefined()
    expect(state.commsDelivered?.['msg-day']).toBeDefined()
    expect(state.commsDelivered?.['msg-hint']).toBeDefined()
    const startLogs = state.logs.filter((l) => l.text.includes('开局信'))
    expect(startLogs).toHaveLength(1)
    const deliveredAt = state.commsDelivered!['msg-start']!
    advanceComms(state, ctx)
    expect(state.commsDelivered!['msg-start']).toBe(deliveredAt) // 时间戳不被刷新
  })
})

describe('通讯 · 未读与已读', () => {
  it('未读计数 = 已送达且未读；点开即已读；全部标记已读归零', () => {
    const { state, ctx } = world()
    state.onboarding.step = ONB_DONE
    state.gameMs = COMMS_DAY_MS * 3
    advanceComms(state, ctx)
    const total = commsInbox(state, ctx).length
    expect(total).toBeGreaterThanOrEqual(3) // start + day2 + day1(hint)
    expect(commsUnreadCount(state, ctx)).toBe(total)
    expect(markCommsRead(state, 'msg-start').ok).toBe(true)
    expect(commsUnreadCount(state, ctx)).toBe(total - 1)
    expect(commsInbox(state, ctx).find((e) => e.id === 'msg-start')?.read).toBe(true)
    expect(markAllCommsRead(state, ctx)).toBe(total - 1)
    expect(commsUnreadCount(state, ctx)).toBe(0)
    expect(markAllCommsRead(state, ctx)).toBe(0) // 再点一次无事发生
    // 没送达过的 id 不能标已读（防伪造）
    expect(markCommsRead(state, 'msg-not-delivered').ok).toBe(false)
  })

  it('收件箱按送达时间倒序；跳转提示原样透传；带来源标记', () => {
    const { state, ctx } = world()
    state.onboarding.step = ONB_DONE
    state.gameMs = COMMS_DAY_MS * 3
    advanceComms(state, ctx)
    const inbox = commsInbox(state, ctx)
    for (let i = 1; i < inbox.length; i += 1) {
      expect(inbox[i - 1]!.deliveredAtGameMs).toBeGreaterThanOrEqual(inbox[i]!.deliveredAtGameMs)
    }
    const hint = inbox.find((e) => e.id === 'msg-hint')!
    expect(hint.hint).toEqual({ text: '去星图看看。', page: 'map', tab: 'salvage' })
    expect(hint.source).toBe('message')
  })

  it('游戏内时钟文本：第 N 天 hh:mm（day 从 1 起）', () => {
    expect(commsGameClock(0)).toBe('第 1 天 00:00')
    expect(commsGameClock(COMMS_DAY_MS + 3 * 3_600_000 + 7 * 60_000)).toBe('第 2 天 03:07')
  })
})

describe('通讯 · 剧本合并（T9 建站剧本进同一收件箱）', () => {
  it('抵达建站星系挂起通讯 → 收件箱出现该条；播放后仍只有一条（幂等）', () => {
    const { state, ctx } = world()
    state.onboarding.step = ONB_DONE
    onArriveAtGalaxy(state, ctx, 'galaxy-far')
    expect(state.pendingDialogue).toBe('dlg-intro')
    const key = commsDialogueKey('dlg-intro')
    const first = commsInbox(state, ctx).find((e) => e.id === key)
    expect(first).toBeDefined()
    expect(first!.source).toBe('dialogue')
    expect(first!.subject).toBe('测试前哨站 · 建设交底') // 剧本可带主题（缺省回落 title）
    expect(first!.paragraphs.join('')).toContain('基建部 · 柯岚：能收到吗？')
    expect(first!.read).toBe(false)
    // 播放（UI 侧调 playDialogue）→ 再镜像一次，仍只有一条
    playDialogue(state, 'dlg-intro', ctx, ctx.dialogues.get('dlg-intro')!.lines)
    expect(commsInbox(state, ctx).filter((e) => e.id === key)).toHaveLength(1)
    expect(state.commsDelivered?.[key]).toBe(first!.deliveredAtGameMs)
  })

  it('已送达但表里查不到的消息（被撤下/剧本改名）不显示，但记账保留（不重复送）', () => {
    const { state, ctx } = world()
    state.onboarding.step = ONB_DONE
    state.gameMs = COMMS_DAY_MS * 3
    advanceComms(state, ctx)
    // 换一个"没有这条消息"的上下文（模拟数据被撤下）
    const ctx2: SimContext = { ...ctx, commsMessages: new Map() }
    expect(commsInbox(state, ctx2).some((e) => e.id === 'msg-start')).toBe(false)
    expect(state.commsDelivered?.['msg-start']).toBeDefined()
  })
})

describe('通讯 · 存档往返', () => {
  it('送达时间与已读状态原样保留；负时间/非数值被丢弃（视作未送达，下次按条件补送）', () => {
    const { state, ctx } = world()
    state.onboarding.step = ONB_DONE
    state.gameMs = COMMS_DAY_MS * 3
    advanceComms(state, ctx)
    markCommsRead(state, 'msg-start')
    const before = { ...state.commsDelivered }
    const loaded = loadSaveFile(serializeSaveFile(state, 1)).state
    expect(loaded.commsDelivered?.['msg-start']).toBe(before['msg-start'])
    expect(loaded.commsRead?.['msg-start']).toBe(true)
    expect(commsUnreadCount(loaded, ctx)).toBe(commsUnreadCount(state, ctx))
    // 垃圾数据：负数/字符串/非有限数一律丢弃
    const raw = JSON.parse(serializeSaveFile(state, 1)) as { state: Record<string, unknown> }
    raw.state.commsDelivered = { 'msg-isk': -5, 'msg-day': 'x', 'msg-galaxy': Number.NaN, 'msg-skill': 1234 }
    raw.state.commsRead = { 'msg-skill': 'yes', 'msg-galaxy': true }
    const l2 = loadSaveFile(JSON.stringify(raw)).state
    expect(l2.commsDelivered).toEqual({ 'msg-skill': 1234 })
    expect(l2.commsRead).toEqual({ 'msg-galaxy': true })
  })

  it('老档（没有这两个字段）读入不报错：空收件箱，推进后按条件补送', () => {
    const { state, ctx } = world()
    state.onboarding.step = ONB_DONE
    const raw = JSON.parse(serializeSaveFile(state, 1)) as { state: Record<string, unknown> }
    delete raw.state.commsDelivered
    delete raw.state.commsRead
    const loaded = loadSaveFile(JSON.stringify(raw)).state
    expect(commsInbox(loaded, ctx)).toHaveLength(0)
    expect(commsUnreadCount(loaded, ctx)).toBe(0)
    advanceComms(loaded, ctx)
    expect(commsInbox(loaded, ctx).length).toBeGreaterThan(0)
  })
})
