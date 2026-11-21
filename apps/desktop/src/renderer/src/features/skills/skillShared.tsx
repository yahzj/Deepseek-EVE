import { queueMovePlan, skillQueueStatus } from '@whale/core'
import type { PageProps } from '../../pages/common'
import { cmdText, tr } from '../../i18n/locale'
import { useState } from 'react'
import { fmtDuration } from '../../i18n/fmt'
import { Glyph, toneOf } from '../../ui/Glyphs'
import { skillBranchText, skillGroupText } from '../../ui/labelsText'
import { hoverTipProps } from '../../ui/Tooltip'
import { hexPathAt } from './layout'

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

function QueueHexBadge({ group }: { group: string }) {
  return (
    <span className="app-train-hex-wrap" style={{ color: toneOf(`group-${group}`) }} title={skillGroupText(group)}>
      <svg className="app-train-hex" viewBox="0 0 26 26" width={26} height={26} aria-hidden="true">
        <path className="app-train-hex-bg" d={hexPathAt(13, 13, 26, 22)} />
        <g transform="translate(5.5, 5.5)">
          <Glyph name={`group-${group}`} size={15} color="currentColor" />
        </g>
      </svg>
    </span>
  )
}

function queueSkillTip(def: { name: string; description: string; group: string; branch?: string }, targetLevel: number) {
  return (
    <>
      <span className="app-ship-hover-title">{def.name}</span>
      <div className="app-skill-queue-tip-meta">
        {skillGroupText(def.group)}
        {def.branch !== undefined ? ` · ${skillBranchText(def.branch)}` : ''}
        {` · Lv${targetLevel}`}
      </div>
      <div className="app-skill-queue-tip-desc"><SkillDescText text={def.description} /></div>
    </>
  )
}

export function QueueBlock({ engine }: { engine: PageProps['engine'] }) {
  const state = engine.state
  const view = skillQueueStatus(state, engine.ctx.skills)
  const totalMs = view.totalRemainingMs
  const lastIndex = state.skills.queue.length - 1
  const [askCancel, setAskCancel] = useState<number | null>(null)
  const [moveNote, setMoveNote] = useState<{ index: number; text: string } | null>(null)
  const cancelImpact = askCancel !== null ? engine.skillCancelImpactAt(askCancel) : null
  const tryMove = (from: number, to: number): void => {
    const plan = queueMovePlan(state, from, to, engine.ctx.skills)
    if (!plan.ok) {
      setMoveNote({ index: from, text: cmdText(plan) || tr('ui.SkillsPage.051') })
      return
    }
    if (!engine.moveQueueAt(from, to)) {
      setMoveNote({ index: from, text: tr('ui.SkillsPage.051') })
      return
    }
    setMoveNote(null)
  }
  const skillNameOf = (id: string): string => engine.ctx.skills.get(id)?.name ?? id
  const defOf = (id: string): { group: string; branch: string } => {
    const def = engine.ctx.skills.get(id)
    return { group: def?.group ?? '', branch: def?.branch ?? '' }
  }
  const barOf = (progressMs: number, levelMs: number): number | null =>
    levelMs > 0 && progressMs > 0 ? Math.min(100, Math.max(0, (progressMs / levelMs) * 100)) : null
  return (
    <div>
      {totalMs > 0 ? (
        <div className="app-dim app-train-total">
          {tr('ui.SkillsPage.010')} {fmtDuration(totalMs)}
          {view.head !== null ? tr('ui.SkillsPage.032', { p1: fmtDuration(view.head.remainingMs) }) : ''}
          {tr('ui.SkillsPage.011')}
        </div>
      ) : null}
      {view.head !== null || view.pending.length > 0 ? (
        <div className="app-train-pending">
          {/**
           * **队首也列进队列、排第一**（**2026-09-23 船长追加**：「正在训练的的首位技能也要加入训练队列内
           * （排第一）」）：队首本来就是 `state.skills.queue[0]`，只是原先这一步面板只画 `pending`
           * ⇒ 玩家看不到"第一位是谁"。现在按 `1..N` 编号一起列（下面 pending 的 `p.queueIndex + 1`
           * 天然接上 2、3…）。**只能往下挪、不能往上**（它已经在第一位）⇒ 只给 ↓ 与 ×。
           */}
          {view.head !== null ? (
            <span className="app-chip app-train-chip is-head">
              <span
                className="app-train-chip-main"
                {...(engine.ctx.skills.get(view.head.skillId) !== undefined
                  ? hoverTipProps(queueSkillTip(engine.ctx.skills.get(view.head.skillId)!, view.head.intoLevel))
                  : {})}
              >
                <QueueHexBadge group={defOf(view.head.skillId).group} />
                <span className="app-dim">{tr('ui.SkillsPage.027')}</span>
                <span className="app-train-name">
                  {tr('ui.SkillsPage.040', { n: 1, name: view.head.skillName, lv: view.head.intoLevel })}
                </span>
                <span className="app-dim app-train-branch">{skillBranchText(defOf(view.head.skillId).branch)}</span>
                {/* 进度条复刻活动窗口「技能训练」那条（`.app-activitybar-*`），百分比/剩余都来自 core 的队首读数 */}
                <span className="app-activitybar-track app-train-bar">
                  <span className="app-activitybar-fill" style={{ width: `${Math.round(view.head.percent)}%` }} />
                </span>
                <span className="app-train-pct">{`${Math.round(view.head.percent)}%`}</span>
                <span className="app-dim">{tr('ui.SkillsPage.041', { d: fmtDuration(view.head.remainingMs) })}</span>
              </span>
              {/* 操作按钮排在信息**下方**（2026-09-25 船长令：不该挤在右侧、应靠卡牌底边）；
                  2026-09-30 船长核定：仍在信息下方一行，**靠右对齐**；同日起"挪不动"的要置灰并说明原因 */}
              <span className="app-train-chip-act">
                <button
                  className={`app-train-arrow${lastIndex < 1 ? ' is-off' : ''}`}
                  aria-disabled={lastIndex < 1}
                  title={lastIndex < 1 ? tr('ui.SkillsPage.016') : tr('ui.SkillsPage.015')}
                  onClick={() => {
                    if (lastIndex < 1) {
                      setMoveNote({ index: 0, text: tr('ui.SkillsPage.016') })
                      return
                    }
                    tryMove(0, 1)
                  }}
                >
                  ↓
                </button>
                <button
                  className="app-train-x"
                  title={tr('ui.SkillsPage.017')}
                  onClick={() => {
                    const impact = engine.skillCancelImpactAt(0)
                    if (impact && impact.also.length > 0) setAskCancel(0)
                    else engine.dequeueAt(0)
                  }}
                >
                  ×
                </button>
              </span>
              {/* 挪不动时：把原因写在**这一行自己的底下**（2026-09-30 甲案） */}
              {moveNote !== null && moveNote.index === 0 ? <span className="app-train-note">{moveNote.text}</span> : null}
            </span>
          ) : null}
          {view.pending.map((p) => {
            /**
             * **三个箭头各自先问一句"挪得动吗"**（2026-09-30 船长裁定甲）——
             * `queueMovePlan` 与 `engine.moveQueueAt` 同一套判据（core 单点），这里只负责把它翻译成
             * "置灰 + 说明"。⚠ 用 `aria-disabled` 而不是 `disabled`：原生 disabled 元素收不到悬停/点击，
             * 说明与点击回话都会丢掉（本页末尾原本"队尾 ↓ 只有 title"就是这个毛病，这里一并改掉）。
             */
            const planTop = queueMovePlan(state, p.queueIndex, 0, engine.ctx.skills)
            const planUp = queueMovePlan(state, p.queueIndex, p.queueIndex - 1, engine.ctx.skills)
            const atTail = p.queueIndex >= lastIndex
            const planDown = atTail ? null : queueMovePlan(state, p.queueIndex, p.queueIndex + 1, engine.ctx.skills)
            /** 队尾的 ↓ 与"挪不动"的箭头同一副长相（暗一档 + 不给手型），点一下都会就地说明 */
            const downOff = atTail || (planDown !== null && !planDown.ok)
            const def = engine.ctx.skills.get(p.skillId)
            return (
            <span key={`${p.skillId}-${p.targetLevel}`} className="app-chip app-train-chip">
              <span
                className="app-train-chip-main"
                {...(def !== undefined ? hoverTipProps(queueSkillTip(def, p.targetLevel)) : {})}
              >
                <QueueHexBadge group={defOf(p.skillId).group} />
                <span className="app-train-name">
                  {tr('ui.SkillsPage.040', { n: p.queueIndex + 1, name: p.skillName, lv: p.targetLevel })}
                </span>
                <span className="app-dim app-train-branch">{skillBranchText(defOf(p.skillId).branch)}</span>
                {barOf(p.progressMs, p.levelMs) !== null ? (
                  <span className="app-activitybar-track app-train-bar">
                    <span className="app-activitybar-fill" style={{ width: `${Math.round(barOf(p.progressMs, p.levelMs)!)}%` }} />
                  </span>
                ) : null}
                <span className="app-dim">
                  {p.progressMs > 0
                    ? tr('ui.SkillsPage.041', { d: fmtDuration(p.remainingMs) })
                    : tr('ui.SkillsPage.036', { p1: fmtDuration(p.levelMs) })}
                </span>
                {/* 「轮到还需」＝ core 给的前缀和（前面所有条目剩余之和）⇒ 一眼看出"前面还压着多久" */}
                <span className="app-dim app-train-eta">{tr('ui.SkillsPage.050', { p1: fmtDuration(p.etaMs) })}</span>
              </span>
              {/* 操作按钮（排序箭头 + 取消）排在信息**下方**（2026-09-25 船长令：靠卡牌底边，不挤右侧）；
                  2026-09-30 船长核定：仍在信息下方一行，**靠右对齐**；同日起"挪不动"的要置灰并说明原因 */}
              <span className="app-train-chip-act">
                <button
                  className={`app-train-arrow${planTop.ok ? '' : ' is-off'}`}
                  aria-disabled={!planTop.ok}
                  title={planTop.ok ? tr('ui.SkillsPage.012') : cmdText(planTop)}
                  onClick={() => tryMove(p.queueIndex, 0)}
                >
                  ⇈
                </button>
                <button
                  className={`app-train-arrow${planUp.ok ? '' : ' is-off'}`}
                  aria-disabled={!planUp.ok}
                  title={
                    !planUp.ok
                      ? cmdText(planUp)
                      : p.queueIndex === 1
                        ? tr('ui.SkillsPage.013')
                        : tr('ui.SkillsPage.014')
                  }
                  onClick={() => tryMove(p.queueIndex, p.queueIndex - 1)}
                >
                  ↑
                </button>
                <button
                  className={`app-train-arrow${downOff ? ' is-off' : ''}`}
                  aria-disabled={downOff}
                  title={planDown === null ? tr('ui.SkillsPage.016') : planDown.ok ? tr('ui.SkillsPage.015') : cmdText(planDown)}
                  onClick={() => {
                    if (atTail) {
                      setMoveNote({ index: p.queueIndex, text: tr('ui.SkillsPage.016') })
                      return
                    }
                    tryMove(p.queueIndex, p.queueIndex + 1)
                  }}
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
              {/* 挪不动时：把原因写在**这一行自己的底下**（2026-09-30 甲案）——不放到列表末尾去，
                  否则长队列里"点了看不到说明"，等于没说 */}
              {moveNote !== null && moveNote.index === p.queueIndex ? (
                <span className="app-train-note">{moveNote.text}</span>
              ) : null}
            </span>
            )
          })}
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
