/**
 * **实验室产线纳入主控登记表**（**2026-10-01 船长令**：「**实验室的主控活动并不占用主控，是BUG。
 * 建议将这方面做一个规则，主控在做什么的时候天然排查其他主控可以做的活。**」）。
 *
 * 根因：`MainActivityKind` 里原先没有 `lab`、`mainActivityOf` 也不读 `state.labRuns` ⇒
 * 「起线侧通、**占用侧不通**」——实验室在跑时门禁以为主控空着，采矿/打捞/远征/长途运输/建站交付
 * 都能同时开工（主控双占）。本批把它补进登记表（档 = **先警告再切**，与"亲自开炉/亲自开线"同档）。
 */
import { describe, expect, it } from 'vitest'
import { createInitialState } from '../src/state'
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
