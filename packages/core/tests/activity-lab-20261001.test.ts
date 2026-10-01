/**
 * **实验室产线纳入主控登记表**（**2026-10-01 船长令**：「**实验室的主控活动并不占用主控，是BUG。
 * 建议将这方面做一个规则，主控在做什么的时候天然排查其他主控可以做的活。**」）。
 *
 * 根因：`MainActivityKind` 里原先没有 `lab`、`mainActivityOf` 也不读 `state.labRuns` ⇒
 * 「起线侧通、**占用侧不通**」——实验室在跑时门禁以为主控空着，采矿/打捞/远征/长途运输/建站交付
 * 都能同时开工（主控双占）。本批把它补进登记表（档 = **先警告再切**，与"亲自开炉/亲自开线"同档）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import { addWare } from '../src/inventory'
import { startLabRun } from '../src/lab'
import { activityOverview, shipBusyLabel } from '../src/activity'
import { aiCoreIndustryUsed } from '../src/ai'
import {
  AUTO_HALT_KINDS,
  HALT_COST,
  INTERRUPTIBLE,
  KIND_LABEL,
  WARN_KINDS,
  mainActivityOf,
} from '../src/activityGate'

type LabRun = NonNullable<ReturnType<typeof createInitialState>['labRuns']>[number]

/** 造一份"实验室有一条在跑的线"的档（只喂判据要读的字段，其余保持新档原样） */
function stateWithLab(worker: string) {
  const s = createInitialState({ nowWallMs: 0, seed: 7 })
  s.labRuns = [{ active: true, worker } as unknown as LabRun]
  return s
}

describe('主控活动登记表 · 实验室（2026-10-01 船长令）', () => {
  it('**主控亲自运转**的实验室线占主控 ⇒ 门禁认得出它是哪一项（改前返回 null = 主控双占）', () => {
    expect(mainActivityOf(stateWithLab('pilot'))).toBe('lab')
  })

  it('**AI 核心驱动**的实验室线不占主控（与 AI 开炉 / AI 开线同款，维持不变）', () => {
    expect(mainActivityOf(stateWithLab('ai-core-1'))).toBe(null)
  })

  it('分档 = **先警告再切**（不在"可自动停"那一档）· 可中断 · 名称与取消代价齐备', () => {
    expect(WARN_KINDS).toContain('lab')
    expect(AUTO_HALT_KINDS).not.toContain('lab')
    expect(INTERRUPTIBLE.lab).toBe(true)
    expect(KIND_LABEL.lab).toBe('实验室')
    expect(HALT_COST.lab).toContain('停线')
  })
})

/**
 * **活动栏接入**（2026-10-01 第二批 · 同一件工作的收尾）。
 *
 * 门禁认出 `'lab'` 之后还差"界面看得见"：`activityOverview` 原先完全不读 `state.labRuns`
 * ⇒ 玩家主控亲自运转实验室时，活动窗口里既没有这条活、也没有「停线」入口。
 * 本组用**真命令**（`startLabRun`）建现场，钉三件事：① 主控那条**出一行**且带停线入口
 * ② AI 核心驱动那条走**与 AI 开炉/开线同一套机制**（进「副AI活动」组 ＋ 计入站内工业占用）
 * ③ 忙态文案认得这一档。
 *
 * ⚠ 口径来源：**船长 2026-10-01 令**「**实验室和工业的其他页面没有本质区别，所以 AI 和活动栏图标
 * 都使用一样的机制**」——实验室只是工业的又一条产线，不另立一套显示/计数规则。
 */
describe('活动栏 · 实验室产线（2026-10-01 接入）', () => {
  const ctx = buildSimContext()
  const RECIPE = 'jump-fuel'

  /** 造"实验室已解锁 ＋ 料够跑一批"的档（解锁判据 = 已建成空间站 ≥ 1 座，用 `stationSites` 直接写满） */
  function labReady(): GameState {
    const s = createInitialState({ nowWallMs: 0, seed: 5 })
    for (const site of ctx.stations.values()) s.stationSites[site.id] = { stage: site.tiers.length, delivered: {} }
    for (const m of ctx.labRecipes.get(RECIPE)!.materials) addWare(s, m.itemId, m.units)
    return s
  }

  it('主控亲自运转 ⇒ 活动栏出一行（kind=lab · 停线入口 · stopParam = 线号）', () => {
    const s = labReady()
    expect(startLabRun(s, ctx, RECIPE, 'pilot').ok).toBe(true)
    const runId = s.labRuns![0]!.id
    const row = activityOverview(s, ctx).find((a) => a.kind === 'lab')
    expect(row, '主控在跑实验线；活动栏却看不见它').toBeDefined()
    expect(row!.id).toBe(`lab:${runId}`)
    expect(row!.stopable).toBe(true)
    expect(row!.stop).toBe('stop-lab')
    expect(row!.stopParam).toBe(String(runId))
    // 读数齐备：标签带配方名（玩家要知道在造什么）、进度条与剩余时间都给
    expect(row!.label).toContain(ctx.labRecipes.get(RECIPE)!.name)
    expect(row!.percent).toBe(0)
    expect(row!.remainingMs).toBeGreaterThan(0)
  })

  it('AI 核心驱动 ⇒ 与 AI 开炉 / AI 开线**同一套机制**：进「副AI活动」组 · 计入站内工业占用', () => {
    const s = labReady()
    s.skills.trained['ai-expert'] = 2 // AI 核心上限（= 核心操作学等级）留出第二枚，好验"上限守得住"
    s.aiCores['basic'] = 2
    expect(startLabRun(s, ctx, RECIPE, 'basic').ok).toBe(true)
    // ① 活动栏：AI 那条走 kind:'ai' ＋ aiGroup:'industry'（不占玩家活动位）
    const row = activityOverview(s, ctx).find((a) => a.kind === 'ai' && a.id.startsWith('ai-prod-l'))
    expect(row, 'AI 驱动的实验室线没有并入 AI 那一族').toBeDefined()
    expect(row!.aiGroup).toBe('industry')
    expect(row!.aiWorkKind).toBe('craft')
    expect(activityOverview(s, ctx).some((a) => a.kind === 'lab'), 'AI 驱动的线不该占玩家活动位').toBe(false)
    // ② 占用：它同样占核心 ⇒ 计入站内工业占用（上限守卫读的就是这个数）
    expect(aiCoreIndustryUsed(s)).toBe(1)
    expect(shipBusyLabel(s, ctx, s.shipId)).toBeNull()
    /**
     * ③ **上限守得住**：上限 2 枚，先占掉 2 条其它 AI 线 ⇒ 再起 AI 实验线必须被拒。
     * 改前 `aiCoreIndustryUsed` 不数实验室线（本条用例前半段就是那个漏法的反证：
     * 上限 1 枚时也照样能起 AI 实验线）。
     */
    s.refineRuns.push({ id: 9, active: true, worker: 'basic', blueprintId: 'bp-titanium', count: 1 } as never)
    const blocked = startLabRun(s, ctx, RECIPE, 'basic')
    expect(blocked.ok, 'AI 核心上限已满却还能起线').toBe(false)
  })

  it('船忙文案认得「主控亲自运转实验室」（core.busy.030）', () => {
    const s = labReady()
    expect(startLabRun(s, ctx, RECIPE, 'pilot').ok).toBe(true)
    expect(shipBusyLabel(s, ctx, s.shipId)?.errorId).toBe('core.busy.030')
    expect(shipBusyLabel(s, ctx, s.shipId)?.error).toBe('亲自运转实验室中')
  })
})
