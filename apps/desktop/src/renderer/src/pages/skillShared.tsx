/**
 * **技能页两版共用的小件**（**2026-09-22**：技能科技树升为正式「技能」页 ⇒ 原先塞在
 * `SkillsPage.tsx` 里的这两件搬到这里，旧页退役）。
 *
 * - `SkillDescText`：把说明里的 `⟦效果数值⟧` 渲染成高亮段（符号本身不显示）——树页详情窗与旧页卡片同源；
 * - `QueueBlock`：**训练队列面板**（"正在发生的事"，2026-09-10 船长定：它固定在上、不塞进树里）——
 *   显示排队中条目 ＋ 队首剩余，可上移/下移/顶到最前/取消（与 `engine.moveQueueAt/dequeueAt` 同源）。
 *   **2026-09-30 船长令**（「训练项右侧顶到窗口」＋「训练队列过于单一」）⇒ 每行补真实读数：
 *   行首六边形徽（技能树同款）· 技能书名 · 队首进度条与百分比 · 排队项「练这一级需 X」与「轮到还需 ≈X」。
 *   **同日船长报障**（「部分技能在队列中置顶无效」）⇒ 三个箭头改走 core 的 `queueMovePlan`：
 *   挪不动的（会排到前置之前 / 同技能按位置逐级排 ⇒ 挪了等于没挪）**置灰 ＋ 悬停说明原因**，
 *   点了也会就地讲清楚 —— 不再"点了没反应"。
 */
import { queueMovePlan, skillQueueStatus } from '@whale/core'
import type { PageProps } from './common'
import { cmdText, tr } from '../i18n/locale'
import { useState } from 'react'
import { fmtDuration } from '../i18n/fmt'
import { Glyph, toneOf } from '../ui/Glyphs'
import { skillBranchText, skillGroupText } from '../ui/labelsText'
import { hexPathAt } from '../ui/skillTreeLayout'

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

/**
 * **队列行首的六边形徽**（**2026-09-30 船长令**：「使用技能树内图标模式的菱形卡片」）——
 * 形状走 SVG：与技能树节点**同一个平顶六边形算法**（`ui/skillTreeLayout.ts` 的 `hexPathAt`，
 * 树上的 `hexPath` 也是它）＋ 同一个大类字形（`group-<大类>`，技能树 385/531/584 行就是这么用的）。
 * 色调取 `toneOf('group-…')` ＝ 技能树用的那套，**不新造配色**（§6 复刻同级相似项）。
 * ⚠ 大类不只靠颜色：字形形状本身按大类区分，另有 `title` 给出大类名。
 */
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

/** 技能训练队列面板（顶部那条；与技能树同页共存） */
export function QueueBlock({ engine }: { engine: PageProps['engine'] }) {
  const state = engine.state
  const view = skillQueueStatus(state, engine.ctx.skills)
  // 船长 2026-09-05：正在训练的那条由顶部活动窗口「技能训练」区展示；这里只显示"排队中"的技能。
  // 2026-09-08（船长）：队列总时长 + 顺序调整——前移到顶 = 交换式顶替当前训练（原训练退位保留进度）
  // 2026-09-30（船长）：「训练项右侧顶到窗口」＋「训练队列过于单一」⇒ 修溢出/对齐，并按行补真实读数：
  //   总时长与"轮到还需"都取自 core 的 `skillQueueStatus`（前缀和单点，界面不再各算一遍）。
  const totalMs = view.totalRemainingMs
  const lastIndex = state.skills.queue.length - 1
  /** 正在等确认的级联取消（null = 没弹确认条）；计划每次渲染现算（纯函数、无副作用） */
  const [askCancel, setAskCancel] = useState<number | null>(null)
  /**
   * **"这一步挪不动"的就地说明**（**2026-09-30 船长裁定甲**：不能让玩家"点了没反应"）。
   * 三个箭头都先问 core 的 `queueMovePlan`：不能挪 ⇒ 按钮置灰 ＋ `title` 写明原因；
   * 真点了 ⇒ 在**那一行自己的底下**把原因摆出来（⚠ 不放在列表末尾：17 条的队列里那条会落在屏幕外，
   * 等于没说 —— 与技能树页"一并加入前置"的回话同一手法：就地显示，不另起 toast）。
   */
  const [moveNote, setMoveNote] = useState<{ index: number; text: string } | null>(null)
  const cancelImpact = askCancel !== null ? engine.skillCancelImpactAt(askCancel) : null
  /** 挪一步：不可挪就把原因写在那一行下面，绝不静默 */
  const tryMove = (from: number, to: number): void => {
    const plan = queueMovePlan(state, from, to, engine.ctx.skills)
    if (!plan.ok) {
      setMoveNote({ index: from, text: cmdText(plan) || tr('ui.SkillsPage.051') })
      return
    }
    if (!engine.moveQueueAt(from, to)) {
      // 计划说能挪、引擎却拒绝 ⇒ 只可能是状态在两次判断之间变了；给一条兜底说明（不静默）
      setMoveNote({ index: from, text: tr('ui.SkillsPage.051') })
      return
    }
    setMoveNote(null)
  }
  const skillNameOf = (id: string): string => engine.ctx.skills.get(id)?.name ?? id
  /** 技能定义（拿大类/技能书；查不到时两个空白，行内自然少两段，不静默报错） */
  const defOf = (id: string): { group: string; branch: string } => {
    const def = engine.ctx.skills.get(id)
    return { group: def?.group ?? '', branch: def?.branch ?? '' }
  }
  /** 进度条：队首常显；排队项只在"已练了一部分"（承接进度）时显——其余保持清爽 */
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
              <span className="app-train-chip-main">
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
            return (
            <span key={`${p.skillId}-${p.targetLevel}`} className="app-chip app-train-chip">
              <span className="app-train-chip-main">
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
