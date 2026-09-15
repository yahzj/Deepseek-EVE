/**
 * 通讯收件箱（2026-09-11 船长定：NPC 发消息补充剧情与任务提示；六条裁决全为「甲」）。
 *
 * 覆盖：触发条件逐个 correctness / 送达幂等 / 未读与已读口径 / 剧本镜像（合并进同一收件箱）/
 * 存档往返（含垃圾数据丢弃）/ 序章引导期间的送达时机 /
 * **发件方解析（势力 + 部门 → 发件人写法、立场、色调、图标）与其降级不崩**。
 * 设计稿：`docs/design/comms-20260911.md` · `docs/design/npc-factions-20260911.md`。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState, HOME_GALAXY_ID } from '../src/state'
import type { GameState } from '../src/state'
import type { CommsFactionDef, CommsMessageDef, SimContext, StationSiteDef } from '../src/types'
import {
  advanceComms,
  commsDialogueKey,
  commsGameClock,
  commsInbox,
  commsPopupQueue,
  commsTriggerMet,
  commsUnreadCount,
  dismissCommsPopup,
  markAllCommsRead,
  markCommsRead,
  resolveCommsSender,
  runCommsAction,
} from '../src/comms'
import { COMMS_DAY_MS } from '../src/comms'
import { onArriveAtGalaxy, playDialogue } from '../src/station'
import { advanceGame } from '../src/engine'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { ONB_BRIEFING, ONB_DONE, ONB_DELIVER, ONB_MINE, ONB_OFF } from '../src/onboarding'
import { anomaly, galaxy, makeTestCtx } from './helpers'

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

/** 测试用势力档案（与 data/src/commsFactions.ts 同构：消息只填 factionId/deptId，发件人由这里拼出） */
const FACTIONS: readonly CommsFactionDef[] = [
  {
    // 船内系统（2026-09-11 船长：教程/简报来源 = 信息库检索重启；头像用核心形图标）
    id: 'archive',
    name: '信息库',
    species: '舰载系统',
    alignment: '系统',
    tone: '#ff8ab5',
    glyph: 'nav-ai',
    brief: '这条船自己的舰载信息库。',
    kinds: ['教程', '提示'],
    departments: [{ id: 'dept-recall', name: '检索重启', brief: '按条目回放记录。', kinds: ['教程', '提示'] }],
  },
  {
    id: 'dshi',
    name: '深空工业协会',
    species: '章鱼人',
    alignment: '官方',
    tone: '#9fd8ff',
    glyph: 'faction-octopus',
    brief: '章鱼人的官方行业组织。',
    kinds: ['剧情', '提示', '委托'],
    departments: [
      { id: 'dept-nav-control', name: '航行管制', brief: '航道管理。', kinds: ['剧情', '提示'] },
      { id: 'dept-survey', name: '测绘处', brief: '星域测绘。', kinds: ['剧情', '提示'] },
      { id: 'dept-training', name: '训练处', brief: '技能训练。', kinds: ['剧情', '提示'] },
      { id: 'dept-finance', name: '财务处', brief: '结算与酬金。', kinds: ['提示', '委托'] },
      { id: 'dept-infra', name: '基建部', brief: '建站与并网。', kinds: ['剧情', '提示', '委托'] },
      { id: 'dept-unknown', name: '不存在部', brief: '留空用。', kinds: ['提示'] },
    ],
  },
  {
    id: 'salvage-guild',
    name: '打捞队工会',
    species: '章鱼人',
    alignment: '民间',
    tone: '#6fe3f0',
    glyph: 'faction-octopus',
    brief: '章鱼人的民间行会。',
    kinds: ['剧情', '提示'],
    departments: [{ id: 'dept-crew', name: '老陈', brief: '老打捞一队。', kinds: ['剧情', '提示'] }],
  },
]

const MSGS: readonly CommsMessageDef[] = [
  { id: 'msg-start', factionId: 'dshi', deptId: 'dept-nav-control', kind: '剧情', subject: '开局信', body: ['第一段。', '第二段。'], trigger: { kind: 'start' } },
  { id: 'msg-day', factionId: 'dshi', deptId: 'dept-survey', kind: '提示', subject: '第二天备忘', body: ['过了两天。'], trigger: { kind: 'day', days: 2 } },
  { id: 'msg-explored', factionId: 'dshi', deptId: 'dept-survey', kind: '提示', subject: '三次探明', body: ['开了三个星系。'], trigger: { kind: 'explored', count: 3 } },
  { id: 'msg-galaxy', factionId: 'salvage-guild', deptId: 'dept-crew', kind: '剧情', subject: '坟场见闻', body: ['坟场那边有货。'], trigger: { kind: 'galaxy', galaxyId: 'galaxy-far' } },
  { id: 'msg-skill', factionId: 'dshi', deptId: 'dept-training', kind: '提示', subject: '技能达标', body: ['技能到 2 级了。'], trigger: { kind: 'skill', skillId: 'mining', level: 2 } },
  { id: 'msg-isk', factionId: 'dshi', deptId: 'dept-finance', kind: '提示', subject: '资金到账', body: ['账上有钱了。'], trigger: { kind: 'isk', amount: 50_000 } },
  { id: 'msg-site', factionId: 'dshi', deptId: 'dept-infra', kind: '剧情', subject: '前哨站并网', body: ['站建好了。'], trigger: { kind: 'siteBuilt', siteId: 'site-test' } },
  {
    id: 'msg-hint',
    factionId: 'dshi',
    deptId: 'dept-finance',
    kind: '委托',
    subject: '带跳转的消息',
    body: ['正文。'],
    trigger: { kind: 'day', days: 1 },
    hint: { text: '去星图看看。', page: 'map', tab: 'salvage' },
  },
  /** 数据写漏：势力 id 不存在（界面必须降级显示原文 id，不崩）。挂在第 9 天，与其它用例的触发点错开 */
  { id: 'msg-orphan', factionId: 'no-such-faction', deptId: 'dept-x', kind: '提示', subject: '无主消息', body: ['正文。'], trigger: { kind: 'day', days: 9 } },
]

function world(msgs: readonly CommsMessageDef[] = MSGS) {
  const ctx: SimContext = makeTestCtx({
    stations: [siteDef()],
    quietEvents: true,
    commsMessages: msgs,
    commsFactions: FACTIONS,
    dialogues: [
      {
        id: 'dlg-intro',
        title: '深空工业协会 · 基建部',
        commsFactionId: 'dshi',
        commsDeptId: 'dept-infra',
        commsSigner: '柯岚',
        subject: '测试前哨站 · 建设交底',
        lines: [
          { speaker: '基建部 · 柯岚', text: '能收到吗？' },
          { speaker: '基建部 · 柯岚', text: '这里要建站。' },
        ],
      },
    ],
  })
  const state: GameState = createInitialState({ nowWallMs: 0, seed: 7 })
  return { state, ctx }
}

/** 推进一帧（走真实引擎入口，保证 advanceComms 挂在正确的链路里） */
function tick(state: GameState, ctx: SimContext, ms = 1000): void {
  advanceGame(state, ms, ctx, { nowWallMs: 0 })
}

describe('通讯 · 教程步骤触发器（2026-09-11 船长定：教程融入通讯）', () => {
  /** 教程通讯样本：简报（tut-0，带「开始教程」动作）与步骤 2、7 */
  const TUT_MSGS: readonly CommsMessageDef[] = [
    {
      id: 'tut-0',
      factionId: 'archive',
      deptId: 'dept-recall',
      kind: '教程',
      subject: '训前简报',
      body: ['先读简报再开工。', '04 修复护卫舰。'],
      // 2026-09-11 船长：训前简报的任务链要高亮（`highlight` 必须与正文某段逐字相等才生效）
      highlight: ['04 修复护卫舰。'],
      trigger: { kind: 'tutorial', step: 0 },
      action: { label: '按单开工：采集橄榄岩', command: 'startTutorial' },
    },
    { id: 'tut-2', factionId: 'archive', deptId: 'dept-recall', kind: '教程', subject: '教程 2/7：交付', body: ['去任务中心交付。'], trigger: { kind: 'tutorial', step: 2 }, hint: { text: '前往任务中心', page: 'task', taskTab: 'important' } },
    { id: 'tut-7', factionId: 'archive', deptId: 'dept-recall', kind: '教程', subject: '教程 7/7：分身', body: ['给沙猫指派采矿。'], trigger: { kind: 'tutorial', step: 7 } },
  ]

  it('到达该步才送达：提前不送、到达即送、幂等只送一次', () => {
    const { state, ctx } = world(TUT_MSGS)
    // 睁眼之前（序章演出之前，老档口径 ONB_OFF）：简报也不送
    state.onboarding.step = ONB_OFF
    tick(state, ctx, 1000)
    expect(state.commsDelivered?.['tut-0']).toBeUndefined()
    // 序章演出中（ONB_AWAKEN = 0）：简报与步骤 2 都不送
    state.onboarding.step = 0
    tick(state, ctx, 1000)
    expect(state.commsDelivered?.['tut-0']).toBeUndefined()
    expect(state.commsDelivered?.['tut-2']).toBeUndefined()
    expect(commsTriggerMet(state, ctx, { kind: 'tutorial', step: 2 })).toBe(false)
    // 到达步骤 2（进行态 = ONB_DELIVER = 2）：送达
    state.onboarding.step = ONB_DELIVER
    expect(commsTriggerMet(state, ctx, { kind: 'tutorial', step: 2 })).toBe(true)
    tick(state, ctx, 1000)
    expect(state.commsDelivered?.['tut-2']).toBeDefined()
    const at = state.commsDelivered!['tut-2']!
    tick(state, ctx, 5000)
    expect(state.commsDelivered!['tut-2']).toBe(at) // 时间戳不被刷新
    expect(state.logs.filter((l) => l.text.includes('教程 2/7'))).toHaveLength(1)
    // 步骤 7 仍未到：不送
    expect(state.commsDelivered?.['tut-7']).toBeUndefined()
  })

  it('简报态：tut-0 送达、发件方 = 舰载信息库 · 检索重启，点「开始教程」才进采集步骤', () => {
    const { state, ctx } = world(TUT_MSGS)
    state.onboarding.step = ONB_BRIEFING
    advanceComms(state, ctx)
    const briefing = commsInbox(state, ctx).find((e) => e.id === 'tut-0')
    expect(briefing).toBeDefined()
    expect(briefing!.from).toBe('信息库 · 检索重启') // 2026-09-11 船长：消息来源改为信息库检索重启
    expect(briefing!.alignment).toBe('系统')
    expect(briefing!.glyph).toBe('nav-ai') // 头像：船内系统用核心形图标
    expect(briefing!.action?.command).toBe('startTutorial')
    // 强调行要透传到界面（2026-09-11 船长：任务链高亮；漏传就像"没写"，界面静默不高亮）
    expect(briefing!.highlight).toEqual(['04 修复护卫舰。'])
    expect(briefing!.paragraphs).toContain(briefing!.highlight![0])
    // 此时还没进采集步骤
    expect(state.onboarding.step).toBe(ONB_BRIEFING)
    // 点动作 → 进采集步骤
    const r = runCommsAction(state, briefing!.action!.command)
    expect(r.ok).toBe(true)
    expect(state.onboarding.step).toBe(ONB_MINE)
    // 未知命令：报错不崩
    expect(runCommsAction(state, 'nope' as never).ok).toBe(false)
    // 没写 highlight 的消息不透传（界面按 undefined 处理，不会误高亮第一段）
    const other = world(TUT_MSGS)
    other.state.onboarding.step = ONB_DELIVER
    advanceComms(other.state, other.ctx)
    expect(commsInbox(other.state, other.ctx).find((e) => e.id === 'tut-2')!.highlight).toBeUndefined()
    /**
     * 跳转提示要带任务中心**内层**标签（2026-09-11 船长：步骤 2 跳转要切到「重要任务」）。
     * ⚠ **2026-09-14 起目标页变了**（船长：「将任务中心界面移出星图，放入左侧导航栏，通讯的上方」）：
     * 任务中心是**独立一级页** ⇒ `page = 'task'`，不再是星图页的 `tab: 'task'` 选项卡。
     */
    const tut2 = commsInbox(other.state, other.ctx).find((e) => e.id === 'tut-2')!
    expect(tut2.hint?.page).toBe('task')
    expect(tut2.hint?.tab).toBeUndefined()
    expect(tut2.hint?.taskTab).toBe('important')
  })

  it('简报态（0.5）能随存档往返保留——不会被归一化压成 0（存档真 BUG 回归）', () => {
    const { state, ctx } = world(TUT_MSGS)
    state.onboarding.step = ONB_BRIEFING
    const loaded = loadSaveFile(serializeSaveFile(state, 1)).state
    expect(loaded.onboarding.step).toBe(ONB_BRIEFING) // 修前是 0（退回序章演出）
    // 简报通讯在重载后仍能送达
    advanceComms(loaded, ctx)
    expect(loaded.commsDelivered?.['tut-0']).toBeDefined()
  })

  it('跳过教程（step → 99）后，未送的教程通讯全部补齐，收件箱留完整记录', () => {
    const { state, ctx } = world(TUT_MSGS)
    state.onboarding.step = ONB_DONE
    advanceComms(state, ctx)
    const inbox = commsInbox(state, ctx)
    expect(inbox.map((e) => e.id).sort()).toEqual(['tut-0', 'tut-2', 'tut-7'])
    expect(inbox.every((e) => e.kind === '教程')).toBe(true)
    expect(inbox[0]!.from).toBe('信息库 · 检索重启') // 教程来信的发件方 = 舰载信息库 · 检索重启
  })
})

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

describe('通讯 · 发件方解析（势力 + 部门；2026-09-11 通讯 v2）', () => {
  it('发件人写法由势力 + 部门拼出：玩家看到的仍是「势力名 · 部门名」', () => {
    const { state, ctx } = world()
    state.onboarding.step = ONB_DONE
    state.gameMs = COMMS_DAY_MS * 3
    advanceComms(state, ctx)
    const inbox = commsInbox(state, ctx)
    const welcome = inbox.find((e) => e.id === 'msg-start')!
    expect(welcome.from).toBe('深空工业协会 · 航行管制')
    expect(welcome.factionName).toBe('深空工业协会')
    expect(welcome.alignment).toBe('官方')
    expect(welcome.kind).toBe('剧情')
    expect(welcome.tone).toBe('#9fd8ff')
    expect(welcome.glyph).toBe('faction-octopus') // 章鱼头 = 官方章鱼人的代表符号（2026-09-11 船长定）
    expect(welcome.fromBrief).toContain('航道管理') // 势力 brief + 部门 brief 合并成悬停说明
    // 民间行会：立场与色调不同源，但同样是章鱼人（探明 galaxy-far 后才送达）
    state.exploredGalaxies = ['galaxy-hub', 'galaxy-far']
    advanceComms(state, ctx)
    const guild = commsInbox(state, ctx).find((e) => e.id === 'msg-galaxy')!
    expect(guild.from).toBe('打捞队工会 · 老陈')
    expect(guild.alignment).toBe('民间')
    expect(guild.tone).toBe('#6fe3f0')
  })

  it('缺部门时只显示势力名（不出现空的分隔点）', () => {
    const { state, ctx } = world([
      { id: 'msg-nod', factionId: 'dshi', kind: '提示', subject: '无部门', body: ['正文。'], trigger: { kind: 'day', days: 1 } },
    ])
    state.onboarding.step = ONB_DONE
    state.gameMs = COMMS_DAY_MS
    advanceComms(state, ctx)
    expect(commsInbox(state, ctx)[0]!.from).toBe('深空工业协会')
  })

  it('势力解析不到时降级显示原文 id（不抛错、不丢消息）', () => {
    const { state, ctx } = world()
    state.onboarding.step = ONB_DONE
    state.gameMs = COMMS_DAY_MS * 10
    advanceComms(state, ctx)
    const orphan = commsInbox(state, ctx).find((e) => e.id === 'msg-orphan')
    expect(orphan).toBeDefined()
    expect(orphan!.from).toBe('no-such-faction · dept-x') // 降级 = 原文 id，界面不崩
    expect(orphan!.factionName).toBe('')
    expect(orphan!.alignment).toBe('')
    expect(orphan!.tone).toBe('')
    // 日志同样用降级后的发件人，不抛错
    expect(state.logs.some((l) => l.text.includes('无主消息'))).toBe(true)
  })

  it('resolveCommsSender 直调：部门 id 写错时回落势力名（不显示错部门）', () => {
    const { ctx } = world()
    expect(resolveCommsSender(ctx, 'dshi', 'dept-not-exist').from).toBe('深空工业协会')
    expect(resolveCommsSender(ctx, 'dshi', 'dept-infra').from).toBe('深空工业协会 · 基建部')
    expect(resolveCommsSender(ctx, 'nope').from).toBe('nope')
  })

  it('剧本镜像的挂靠：立场/色调按势力解析，发件人写法与剧本 title 一致', () => {
    const { state, ctx } = world()
    state.onboarding.step = ONB_DONE
    onArriveAtGalaxy(state, ctx, 'galaxy-far')
    const entry = commsInbox(state, ctx).find((e) => e.id === commsDialogueKey('dlg-intro'))!
    expect(entry.from).toBe('深空工业协会 · 基建部')
    expect(entry.alignment).toBe('官方')
    expect(entry.signer).toBe('柯岚')
    expect(entry.tone).toBe('#9fd8ff')
  })

  it('剧本未挂靠势力时回落 title 原文（老数据不崩）', () => {
    const ctx: SimContext = makeTestCtx({
      quietEvents: true,
      dialogues: [
        { id: 'dlg-loose', title: '某部门 · 某人', lines: [{ speaker: '某人', text: '在吗？' }] },
      ],
    })
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    state.onboarding.step = ONB_DONE
    // 直接记账后读视图（未挂靠 = 不算立场）
    state.commsDelivered = { 'dlg:dlg-loose': 0 }
    const entry = commsInbox(state, ctx)[0]!
    expect(entry.from).toBe('某部门 · 某人')
    expect(entry.factionName).toBe('')
    expect(entry.tone).toBe('')
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

/**
 * 星系机制通讯（2026-09-12 船长定：「罗列目前的特殊机制，并在玩家探索到该具备特殊机制的星系后
 * 发一封通讯给玩家，讲解对应机制」）。
 *
 * 本批新增两条触发器，**都不写死"哪几个星系"的清单**：
 * - `lowSec`：阈值 = **安全等级 ≤ 0（含 0）**（`balance.encounter.lowSecMax`，与伏击掷骰同源
 *   ——2026-09-12 船长两条裁定「将伏击掷骰阈值降低为 0」＋「0 也算低安」）⇒ 安全等级被改判时自动跟随；
 * - `foeFamily`：读**敌卡数据**（`AnomalyDef.foeFamily` + `galaxyId`）⇒ 敌卡搬家时自动跟随；
 *   **只认星图可见卡**（滤 `hidden`，2026-09-14 船长定）。
 */
describe('通讯 · 星系机制通讯（探索到带特殊机制的星系后发一封讲解）', () => {
  const MECH_MSGS: readonly CommsMessageDef[] = [
    { id: 'msg-low', factionId: 'dshi', deptId: 'dept-survey', kind: '提示', subject: '低安须知', body: ['正文。'], trigger: { kind: 'lowSec' } },
    { id: 'msg-swarm', factionId: 'dshi', deptId: 'dept-survey', kind: '剧情', subject: '蜂群通报', body: ['正文。'], trigger: { kind: 'foeFamily', family: 'G' } },
  ]

  /** 星系：中安 0.2 · 低安零点 0 · 真低安 −0.7 · 高安边界 0.5（母港等默认星系不写 security = 高安）；G 族敌卡挂在一个指定星系 */
  function mechWorld(gCardGalaxy = 'galaxy-low', gCardHidden?: boolean) {
    const ctx: SimContext = makeTestCtx({
      quietEvents: true,
      commsMessages: MECH_MSGS,
      commsFactions: FACTIONS,
      galaxies: [
        galaxy('galaxy-mid', '中安带', { security: 0.2 }),
        galaxy('galaxy-zero', '零点', { security: 0 }),
        galaxy('galaxy-low', '深低安', { security: -0.7 }),
        galaxy('galaxy-edge', '高安边界', { security: 0.5 }),
      ],
      anomalies: [anomaly('ano-swarm', gCardGalaxy, { threat: 42, foeFamily: 'G', hidden: gCardHidden })],
    })
    const state: GameState = createInitialState({ nowWallMs: 0, seed: 7 })
    return { state, ctx }
  }

  it('lowSec：低安 = 安全等级 ≤ 0（含 0）；中安与高安都不算（2026-09-12 船长「0也算低安」）', () => {
    const { state, ctx } = mechWorld()
    const ids = (): string[] => commsInbox(state, ctx).map((e) => e.id)
    tick(state, ctx)
    expect(ids()).not.toContain('msg-low') // 只有母港（高安）
    state.exploredGalaxies.push('galaxy-edge') // 0.5 = 高安
    tick(state, ctx)
    expect(ids()).not.toContain('msg-low')
    state.exploredGalaxies.push('galaxy-mid') // 0.2 = 中安，不是低安
    tick(state, ctx)
    expect(ids()).not.toContain('msg-low')
    state.exploredGalaxies.push('galaxy-zero') // 0 = 低安（含 0，船长裁定）
    tick(state, ctx)
    expect(ids()).toContain('msg-low')
  })

  it('lowSec：送达幂等（重复推进只留一封）', () => {
    const { state, ctx } = mechWorld()
    state.exploredGalaxies.push('galaxy-low')
    tick(state, ctx)
    tick(state, ctx, 5000)
    expect(commsInbox(state, ctx).filter((e) => e.id === 'msg-low')).toHaveLength(1)
  })

  it('foeFamily：点亮"有该族敌卡"的星系才送，敌卡在哪个星系由数据决定（搬家自动跟随）', () => {
    const { state, ctx } = mechWorld() // G 卡挂在 galaxy-low
    state.exploredGalaxies.push('galaxy-mid') // 有星系、但该星系没有 G 卡 ⇒ 不送
    tick(state, ctx)
    expect(commsInbox(state, ctx).map((e) => e.id)).not.toContain('msg-swarm')
    state.exploredGalaxies.push('galaxy-low')
    tick(state, ctx)
    expect(commsInbox(state, ctx).map((e) => e.id)).toContain('msg-swarm')

    // 把 G 卡挪到另一个星系：判定跟着卡走（证明读的是数据，不是写死的星系 id）
    const moved = mechWorld('galaxy-mid')
    moved.state.exploredGalaxies.push('galaxy-mid')
    tick(moved.state, moved.ctx)
    expect(commsInbox(moved.state, moved.ctx).map((e) => e.id)).toContain('msg-swarm')
  })

  it('foeFamily：隐藏卡不算"有该族敌人的星系"——洞内卡挂母港也不会开局就送（2026-09-14 船长裁定）', () => {
    // 报障形状：`wh-exile-blockade`（G 族洞内卡，`hidden: true`）`galaxyId = 'galaxy-hub'` = 母港，
    // 而母港开局就在 `exploredGalaxies` 里 ⇒ 只看"卡所在星系已探明"会**从第 0 帧起恒真**，
    // 通讯一能送达（教程走完）就立刻发信，与玩家探明了哪片空域无关。
    const hidden = mechWorld('galaxy-hub', true)
    tick(hidden.state, hidden.ctx)
    expect(hidden.state.exploredGalaxies).toEqual(['galaxy-hub']) // 确实只探明了母港
    expect(commsInbox(hidden.state, hidden.ctx).map((e) => e.id)).not.toContain('msg-swarm')
    // 同形状但**不是**隐藏卡（星图可见）⇒ 仍需玩家自己扫出该星系才发信
    const real = mechWorld('galaxy-hub')
    tick(real.state, real.ctx)
    expect(commsInbox(real.state, real.ctx).map((e) => e.id)).toContain('msg-swarm')
    // 可见卡挂在别的星系上：那个星系没扫出来就不发
    const elsewhere = mechWorld('galaxy-low')
    tick(elsewhere.state, elsewhere.ctx)
    expect(commsInbox(elsewhere.state, elsewhere.ctx).map((e) => e.id)).not.toContain('msg-swarm')
    elsewhere.state.exploredGalaxies.push('galaxy-low')
    tick(elsewhere.state, elsewhere.ctx)
    expect(commsInbox(elsewhere.state, elsewhere.ctx).map((e) => e.id)).toContain('msg-swarm')
  })

  it('老档补送：已探明该星系的存档推进一帧即补送（幂等，不重复）', () => {
    const { state, ctx } = mechWorld()
    state.exploredGalaxies.push('galaxy-low') // 模拟"更新前就探明过"的老档：该星系 sec −0.7 且挂着 G 族敌卡
    advanceComms(state, ctx)
    advanceComms(state, ctx)
    // 两个触发面各自补送一封、且都只补一次（按送达时刻 + id 稳定排序）
    expect(commsInbox(state, ctx).map((e) => e.id)).toEqual(['msg-low', 'msg-swarm'])
  })
})

/**
 * 真数据回归（2026-09-14 船长报障：「蜂群通报依旧会在玩家过完教程后发送」）。
 * 用真卡表建上下文（`buildSimContext`）：**只探明母港**时四封机制通讯一律不许触发。
 * 根因 = 洞内隐藏卡（`packages/data/src/wormholeFoes.ts` 的五张 `wh-*`）统一挂 `galaxyId = 母港`，
 * 而母港开局就在 `exploredGalaxies` 里 ⇒ `foeFamily` 判定若不滤 `hidden` 就从第 0 帧起恒真。
 */
describe('通讯 · 真数据：机制通讯不在开局送达（2026-09-14 船长报障回归）', () => {
  const MECH_IDS = ['msg-auro-megastructure', 'msg-exile-swarm', 'msg-lowsec-rules', 'msg-redring-outpost'] as const

  it('只探明母港 ⇒ 四封机制通讯全不触发（母港挂着 G 族隐藏洞内卡也不发）', () => {
    const ctx = buildSimContext()
    const state = createInitialState({ nowWallMs: 0, seed: 11 })
    // 先把"污染源"钉住：确实有 G 族隐藏卡挂在母港（否则本用例会因数据搬家而假绿）
    const hiddenG = [...ctx.anomalies.values()].filter((a) => a.foeFamily === 'G' && a.hidden === true)
    expect(hiddenG.map((a) => a.galaxyId)).toContain(HOME_GALAXY_ID)
    expect(state.exploredGalaxies).toEqual([HOME_GALAXY_ID])
    for (const id of MECH_IDS) {
      const def = ctx.commsMessages.get(id)
      expect(def, `${id} 未登记`).toBeDefined()
      expect(commsTriggerMet(state, ctx, def!.trigger), `${id} 不该在开局触发`).toBe(false)
    }
  })

  it('扫出挂 G 族**可见**卡的星系 ⇒ 蜂群通报才触发（仍读卡数据、随搬家自动跟随）', () => {
    const ctx = buildSimContext()
    const state = createInitialState({ nowWallMs: 0, seed: 11 })
    const visibleG = [...ctx.anomalies.values()].filter((a) => a.foeFamily === 'G' && a.hidden !== true)
    expect(visibleG.length).toBeGreaterThan(0)
    const trigger = ctx.commsMessages.get('msg-exile-swarm')!.trigger
    for (const card of visibleG) {
      const probe = { ...state, exploredGalaxies: [...state.exploredGalaxies, card.galaxyId] }
      expect(commsTriggerMet(probe, ctx, trigger), `${card.id} @ ${card.galaxyId}`).toBe(true)
    }
  })
})

/**
 * **被袭自动撤离**（2026-09-14 船长：「添加新的通讯，当玩家第一次因为低安袭击导致舰船自动撤离时触发」）
 * ＋ **弹窗默认口径**（同日船长改判：「**所有除新手教程外的讯息也弹窗**」，并要求"已有弹窗在时不再叠窗口"）。
 *
 * 触发器 `{ kind: 'ambushRetreat' }` 读随档一次性标记 `state.ambushRetreatSeen`（两处置位在 `encounters.ts`：
 * 收手返港待命 · 应战中途自动脱离交火）；**老档不追溯**（缺字段 = 从未发生 ⇒ 不补发，船长裁定）。
 */
describe('通讯 · 被袭自动撤离 ＋ 弹窗默认口径', () => {
  const POPUP_MSGS: readonly CommsMessageDef[] = [
    // 教程类：条件已满足也**不弹**（船长唯一列的例外）
    { id: 'msg-tut-x', factionId: 'dshi', deptId: 'dept-survey', kind: '教程', subject: '教程样本', body: ['正文。'], trigger: { kind: 'explored', count: 1 } },
    // 普通提示：**默认弹**
    { id: 'msg-plain-x', factionId: 'dshi', deptId: 'dept-survey', kind: '提示', subject: '普通样本', body: ['正文。'], trigger: { kind: 'explored', count: 1 } },
    // 显式关闭：`popup: false` ⇒ 不弹
    { id: 'msg-quiet-x', factionId: 'dshi', deptId: 'dept-survey', kind: '提示', subject: '安静样本', body: ['正文。'], trigger: { kind: 'explored', count: 1 }, popup: false },
    // 新通讯本体
    { id: 'msg-retreat-x', factionId: 'dshi', deptId: 'dept-route-safety', kind: '提示', subject: '被袭撤离样本', body: ['正文。'], trigger: { kind: 'ambushRetreat' } },
  ]

  function popupWorld() {
    const ctx: SimContext = makeTestCtx({ quietEvents: true, commsMessages: POPUP_MSGS, commsFactions: FACTIONS })
    const state: GameState = createInitialState({ nowWallMs: 0, seed: 7 })
    return { state, ctx }
  }

  it('触发器：未发生过 ⇒ 不送；发生过 ⇒ 送达且只送一次（幂等）', () => {
    const { state, ctx } = popupWorld()
    tick(state, ctx)
    expect(commsInbox(state, ctx).map((e) => e.id)).not.toContain('msg-retreat-x')
    state.ambushRetreatSeen = true
    tick(state, ctx)
    expect(commsInbox(state, ctx).map((e) => e.id)).toContain('msg-retreat-x')
    tick(state, ctx, 5000)
    expect(commsInbox(state, ctx).filter((e) => e.id === 'msg-retreat-x')).toHaveLength(1)
  })

  it('弹窗默认口径：除教程外都弹 · `popup: false` 可关 · **同一拍只弹第一封**（其余只进收件箱）', () => {
    const { state, ctx } = popupWorld()
    tick(state, ctx)
    const q = commsPopupQueue(state)
    expect(q).not.toContain('msg-tut-x') // 新手教程类不弹（船长唯一例外）
    expect(q).toContain('msg-plain-x') // 普通通讯默认弹
    expect(q).not.toContain('msg-quiet-x') // 显式 `popup: false`
    // **同一拍只弹第一封**（船长 2026-09-14：「同一拍只弹第一封、其余只进收件箱」）：
    // 这一拍同时送达了 msg-plain-x / msg-quiet-x / …，只进了队首那一封
    expect(q).toHaveLength(1)
    expect(commsInbox(state, ctx).map((e) => e.id)).toContain('msg-quiet-x') // 其余照样进收件箱
    expect(commsUnreadCount(state, ctx)).toBeGreaterThan(1) // 未读提示照挂（导航栏会亮）
    // 下一拍再送达一封（撤离信）：这一拍也只有它 ⇒ 进同一队列（不是开第二个窗口）
    state.ambushRetreatSeen = true
    tick(state, ctx)
    expect(commsPopupQueue(state)).toEqual(['msg-plain-x', 'msg-retreat-x'])
    // 点掉队首 ⇒ 下一封顶上（界面只渲染队首那一封），且**视为已在通讯界面看过**
    const unreadBefore = commsUnreadCount(state, ctx)
    expect(dismissCommsPopup(state, 'msg-plain-x')).toBe(true)
    expect(commsPopupQueue(state)).toEqual(['msg-retreat-x'])
    expect(commsUnreadCount(state, ctx)).toBe(unreadBefore - 1)
    expect(commsInbox(state, ctx).find((e) => e.id === 'msg-plain-x')?.read).toBe(true)
    // 幂等再关：不再动已读状态
    expect(dismissCommsPopup(state, 'msg-plain-x')).toBe(false)
    expect(dismissCommsPopup(state, 'msg-retreat-x')).toBe(true)
    expect(commsPopupQueue(state)).toHaveLength(0)
  })

  it('存档往返：新档 false（只等真撤离）· 老档**按痕迹判断是否触发过**（船长二次裁定）', () => {
    const { state, ctx } = popupWorld()
    // 新档（本功能之后开的局）：`createInitialState` 显式写 false ⇒ 撤离信不送
    expect(state.ambushRetreatSeen).toBe(false)
    tick(state, ctx)
    expect(commsInbox(state, ctx).map((e) => e.id)).not.toContain('msg-retreat-x')
    // 真遇袭撤离 ⇒ 置位、送达，并随档保留
    state.ambushRetreatSeen = true
    tick(state, ctx)
    expect(commsInbox(state, ctx).map((e) => e.id)).toContain('msg-retreat-x')
    const loaded = loadSaveFile(serializeSaveFile(state, 1)).state
    expect(loaded.ambushRetreatSeen).toBe(true)
    expect(commsInbox(loaded, ctx).map((e) => e.id)).toContain('msg-retreat-x')

    // 新档的 false **也随档保留**（若省掉这个键，读回来会被误判成老档而错误补发——船长实测就撞上了这个）
    const fresh = popupWorld()
    tick(fresh.state, fresh.ctx)
    const freshLoaded = loadSaveFile(serializeSaveFile(fresh.state, 1)).state
    expect(freshLoaded.ambushRetreatSeen).toBe(false)
    advanceComms(freshLoaded, ctx)
    expect(commsInbox(freshLoaded, ctx).map((e) => e.id)).not.toContain('msg-retreat-x')

    /** 造一份"本功能上线前写的档"：删掉该字段（老档没有它），保留其它一切 */
    const legacySave = (withAmbush: boolean): GameState => {
      const w = popupWorld()
      tick(w.state, w.ctx)
      if (withAmbush) w.state.encounterZoneCooldown['galaxy-far'] = w.state.gameMs + 300_000 // 伏击命中过的痕迹
      const raw = JSON.parse(serializeSaveFile(w.state, 1)) as { state: Record<string, unknown> }
      delete raw.state.ambushRetreatSeen
      return loadSaveFile(JSON.stringify(raw)).state
    }

    // 老档 **没被伏击过**（痕迹为空）⇒ **不补发**（船长：「需要判断玩家是否触发过」）
    const legacyQuiet = legacySave(false)
    expect(legacyQuiet.ambushRetreatSeen).toBeUndefined()
    advanceComms(legacyQuiet, ctx)
    expect(commsInbox(legacyQuiet, ctx).map((e) => e.id)).not.toContain('msg-retreat-x')

    // 老档 **被伏击过**（`encounterZoneCooldown` 有键 = 伏击真的命中过）⇒ 补发
    const legacyAmbushed = legacySave(true)
    expect(legacyAmbushed.ambushRetreatSeen).toBeUndefined()
    expect(commsTriggerMet(legacyAmbushed, ctx, { kind: 'ambushRetreat' })).toBe(true)
    advanceComms(legacyAmbushed, ctx)
    expect(commsInbox(legacyAmbushed, ctx).map((e) => e.id)).toContain('msg-retreat-x')
  })
})
