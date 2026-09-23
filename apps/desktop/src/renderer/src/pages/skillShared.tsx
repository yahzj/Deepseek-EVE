/**
 * **技能页两版共用的小件**（**2026-09-22**：技能科技树升为正式「技能」页 ⇒ 原先塞在
 * `SkillsPage.tsx` 里的这两件搬到这里，旧页退役）。
 *
 * - `SkillDescText`：把说明里的 `⟦效果数值⟧` 渲染成高亮段（符号本身不显示）——树页详情窗与旧页卡片同源；
 * - `QueueBlock`：**训练队列面板**（"正在发生的事"，2026-09-10 船长定：它固定在上、不塞进树里）——
 *   显示排队中条目 ＋ 队首剩余，可上移/下移/顶到最前/取消（与 `engine.moveQueueAt/dequeueAt` 同源）。
 */
import { formatDurationMs, skillQueueStatus } from '@whale/core'
import type { PageProps } from './common'
import { tr } from '../i18n/locale'
import { useState } from 'react'

/** 把技能说明里的 ⟦效果数值⟧ 渲染成高亮段（符号本身不显示） */
export function SkillDescText({ text }: { text: string }) {
  const parts = text.split(/(⟦[^⟧]*⟧)/g).filter((p) => p.length > 0)
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('⟦') && p.endsWith('⟧') ? (
          <span key={i} className="app-eff">
            {p.slice(1, -1)}
          </span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  )
}

/** 技能训练队列面板（顶部那条；与技能树同页共存） */
export function QueueBlock({ engine }: { engine: PageProps['engine'] }) {
  const state = engine.state
  const view = skillQueueStatus(state, engine.ctx.skills)
  // 船长 2026-09-05：正在训练的那条由顶部活动窗口「技能训练」区展示；这里只显示"排队中"的技能。
  // 2026-09-08（船长）：队列总时长 + 顺序调整——前移到顶 = 交换式顶替当前训练（原训练退位保留进度）
  const totalMs = (view.head !== null ? view.head.remainingMs : 0) + view.pending.reduce((s, p) => s + p.remainingMs, 0)
  const lastIndex = state.skills.queue.length - 1
  /** 正在等确认的级联取消（null = 没弹确认条）；计划每次渲染现算（纯函数、无副作用） */
  const [askCancel, setAskCancel] = useState<number | null>(null)
  const cancelImpact = askCancel !== null ? engine.skillCancelImpactAt(askCancel) : null
  const skillNameOf = (id: string): string => engine.ctx.skills.get(id)?.name ?? id
  return (
    <div>
      {totalMs > 0 ? (
        <div className="app-dim app-train-total">
          {tr('ui.SkillsPage.010')} {formatDurationMs(totalMs)}
          {view.head !== null ? tr('ui.SkillsPage.032', { p1: formatDurationMs(view.head.remainingMs) }) : ''}
          {tr('ui.SkillsPage.011')}
        </div>
      ) : null}
      {view.pending.length > 0 ? (
        <div className="app-train-pending">
          {view.pending.map((p) => (
            <span key={`${p.skillId}-${p.queueIndex}`} className="app-chip app-train-chip">
              <button className="app-train-arrow" title={tr('ui.SkillsPage.012')} onClick={() => engine.moveQueueAt(p.queueIndex, 0)}>
                ⇈
              </button>
              <button
                className="app-train-arrow"
                title={p.queueIndex === 1 ? tr('ui.SkillsPage.013') : tr('ui.SkillsPage.014')}
                onClick={() => engine.moveQueueAt(p.queueIndex, p.queueIndex - 1)}
              >
                ↑
              </button>
              <span>{tr('ui.SkillsPage.040', { n: p.queueIndex + 1, name: p.skillName, lv: p.targetLevel })}</span>
              {p.progressMs > 0 ? (
                <span className="app-dim">{tr('ui.SkillsPage.041', { d: formatDurationMs(p.remainingMs) })}</span>
              ) : p.levelMs > 0 ? (
                <span className="app-dim">{formatDurationMs(p.levelMs)}</span>
              ) : null}
              <button
                className="app-train-arrow"
                title={p.queueIndex < lastIndex ? tr('ui.SkillsPage.015') : tr('ui.SkillsPage.016')}
                disabled={p.queueIndex >= lastIndex}
                onClick={() => engine.moveQueueAt(p.queueIndex, p.queueIndex + 1)}
              >
                ↓
              </button>
              <button
                className="app-train-x"
                title={tr('ui.SkillsPage.017')}
                onClick={() => {
                  /**
                   * **取消 + 依赖级联的确认**（**2026-09-23 船长令**：「训练队列内取消一个技能的同时会取消
                   * 所有依赖其前置的后续技能的训练。（但是假设前置是 LV1，你取消的是 LV2 并不会移除后续的
                   * 其他技能训练。）」；裁定甲「**会连带取消时先弹确认条列出**」）：
                   * 先问 core 的纯计划 `skillCancelImpactAt` —— 会连带取消别的项 ⇒ 弹确认条列出；
                   * 不会 ⇒ 直接取消（与原来的手感一致，不多一次点击）。
                   */
                  const impact = engine.skillCancelImpactAt(p.queueIndex)
                  if (impact && impact.also.length > 0) setAskCancel(p.queueIndex)
                  else engine.dequeueAt(p.queueIndex)
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : (
        <div className="app-dim app-train-idle">{tr('ui.SkillsPage.018')}</div>
      )}
      {/* **级联取消确认条**（只在"会连带取消"时出现）：先把要一起取消的项列清楚，再让玩家点确认 */}
      {askCancel !== null && cancelImpact !== null ? (
        <div className="app-train-ask">
          <span className="app-train-ask-title">
            {tr('ui.SkillsPage.048', { p1: cancelImpact.also.length })}
            {cancelImpact.also.map((it) => `${skillNameOf(it.skillId)} Lv${it.targetLevel}`).join('、')}
          </span>
          <span className="app-train-ask-actions">
            <button
              className="app-btn is-small is-danger"
              onClick={() => {
                engine.dequeueAt(askCancel)
                setAskCancel(null)
              }}
            >
              {tr('ui.SkillsPage.049')}
            </button>
            <button className="app-btn is-small" onClick={() => setAskCancel(null)}>
              {tr('ui.ActivityBar.004')}
            </button>
          </span>
        </div>
      ) : null}
    </div>
  )
}
