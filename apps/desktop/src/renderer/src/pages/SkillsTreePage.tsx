/**
 * **技能科技树（测试页 · 2026-09-20 船长令）**：「**现有页面先保留，新的页面暂时只有调试模式可见
 * （导航栏多出一个技能测试入口）**」。
 *
 * 它是什么：`pages/SkillsPage.tsx` 的**另一种看法**——把 82 条技能摆成 **7 列（技能组）× 5 层（rank 1→5，
 * 自上而下由浅入深）**的向下树；**节点只留「图标 ＋ 名称 ＋ Lv x/5」**，说明全文、各级时长与训练按钮
 * 全进"点节点才开的详情窗"⇒ 一屏字数从 ≈5,000 降到 ≈600（"精简技能"的正面回答）。
 *
 * ⚠ **本页不改任何规则**（**甲案 · 纯呈现**）：数据结构（`SkillDef`：id/name/group/rank/description）、
 * 训练时长公式、队列机制、存档键 `skills.trained` 一律沿用 ⇒ 与「技能」页学出来的结果逐字一致；
 * **没有前置**（未学节点也能直接练，与现状同）。
 *
 * 入口：导航「技能测试」——**只在调试模式可见**（`localStorage['whale-idle:debug'] === '1'` 后刷新，
 * 与既有 `panels/DebugPanel.debugEnabled()` 同一把开关）。正式页仍在，未动一行。
 *
 * 视觉语言：**复刻 `panels/MatterTechTab.tsx` 的"列 × 层 ＋ 节点卡"与全仓既有的
 * `.app-modal-mask/.app-modal/.app-modal-head/.app-modal-body` 弹层**（§6：不新造相似样式）。
 */
import { useMemo, useState } from 'react'
import {
  MAX_SKILL_LEVEL,
  formatDurationMs,
  skillLevelTimeMs,
  skillQueueStatus,
  trainingTimeFactor,
} from '@whale/core'
import type { SkillDef } from '@whale/core'
import { Panel } from '@whale/ui'
import { SkillDescText } from './SkillsPage'
import { plainSkillDesc } from '../ui/skillText'
import { Glyph, toneOf } from '../ui/Glyphs'
import type { PageProps } from './common'
import { tr } from '../i18n/locale'

/** 层 = rank（1 最浅 → 5 最深）；自上而下排列 */
const TIERS: readonly number[] = [1, 2, 3, 4, 5]

export function SkillsTreePage({ engine }: PageProps) {
  const state = engine.state
  const groups = engine.groups
  const skills = engine.skills
  /** 详情窗（二级窗）：`null` = 没开；做法与谜质科技树/市场详情同一套 */
  const [openId, setOpenId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const view = skillQueueStatus(state, engine.ctx.skills)
  const tf = trainingTimeFactor(state)

  const lvOf = (id: string): number => state.skills.trained[id] ?? 0
  /** 搜索命中（名称 / 组 / 说明）——命中节点点亮、其余压暗（比"切成结果列表"更贴树） */
  const isHit = (s: SkillDef): boolean =>
    q.length === 0 ||
    s.name.toLowerCase().includes(q) ||
    s.group.toLowerCase().includes(q) ||
    plainSkillDesc(s.description).toLowerCase().includes(q)
  const hitN = q.length > 0 ? skills.filter(isHit).length : skills.length

  /** 每列按层索引（只算一次；技能表在会话内不变） */
  const byGroupTier = useMemo(() => {
    const map = new Map<string, Map<number, SkillDef[]>>()
    for (const s of skills) {
      let tiers = map.get(s.group)
      if (!tiers) {
        tiers = new Map<number, SkillDef[]>()
        map.set(s.group, tiers)
      }
      const list = tiers.get(s.rank) ?? []
      list.push(s)
      tiers.set(s.rank, list)
    }
    return map
  }, [skills])

  /** 该组已练级数 / 总级数（列头读数） */
  const progressOf = (g: string): { done: number; total: number } => {
    const list = skills.filter((s) => s.group === g)
    const done = list.reduce((n, s) => n + Math.min(MAX_SKILL_LEVEL, lvOf(s.id)), 0)
    return { done, total: list.length * MAX_SKILL_LEVEL }
  }

  const open = openId !== null ? (engine.ctx.skills.get(openId) ?? null) : null

  /** 节点状态（与「技能」页同一把尺：等级 / 是否在练 / 是否已排队） */
  const statusOf = (s: SkillDef) => {
    const lv = lvOf(s.id)
    const isTraining = view.head !== null && view.head.skillId === s.id
    const mine = state.skills.queue.filter((x) => x.skillId === s.id)
    const maxed = lv >= MAX_SKILL_LEVEL
    const cls = maxed ? 'is-max' : isTraining ? 'is-training' : mine.length > 0 ? 'is-queued' : lv > 0 ? 'is-has' : 'is-none'
    return { lv, isTraining, mine, maxed, cls }
  }

  return (
    <div className="page-stack page-wide page-fill">
      <Panel
        className="is-fill"
        title={tr('ui.SkillTree.001')}
        right={
          <span className="app-head-search-wrap">
            <input
              className="app-head-search"
              type="text"
              placeholder={tr('ui.SkillsPage.004')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              spellCheck={false}
            />
            <span className="app-dim">{tr('ui.SkillsPage.031', { p1: hitN })}</span>
          </span>
        }
      >
        {/* 页头说明：本页只是"换个看法"＋ 调试模式可见（不写开发用语进玩家词典，故走 l10n id 中英双语） */}
        <div className="app-skilltree-top">
          <span className="app-dim">{tr('ui.SkillTree.002')}</span>
          <span className="app-dim">{tr('ui.SkillTree.003')}</span>
        </div>
        <div className="app-skilltree-legend">
          <span className="app-dim">{tr('ui.SkillTree.009')}</span>
          <span className="app-skilltree-key is-max">{tr('ui.SkillTree.004')}</span>
          <span className="app-skilltree-key is-training">{tr('ui.SkillTree.005')}</span>
          <span className="app-skilltree-key is-queued">{tr('ui.SkillTree.006')}</span>
          <span className="app-skilltree-key is-has">{tr('ui.SkillTree.007')}</span>
          <span className="app-skilltree-key is-none">{tr('ui.SkillTree.008')}</span>
        </div>
        {/* 树画布：7 列固定最小宽 ⇒ 窄屏横滑（不挤压节点），画布自身滚（一级页仍不滚） */}
        <div className="app-skilltree-canvas">
          <div className="app-skilltree-cols">
            {groups.map((g) => {
              const prog = progressOf(g)
              const tiers = byGroupTier.get(g)
              return (
                <div className="app-skilltree-col" key={g}>
                  <div className="app-skilltree-col-head">
                    <Glyph name={`group-${g}`} size={14} color={toneOf(`group-${g}`)} />
                    <span style={{ color: toneOf(`group-${g}`) }}>{g}</span>
                    <span className="app-dim">{tr('ui.SkillTree.012', { p1: prog.done, p2: prog.total })}</span>
                  </div>
                  {TIERS.map((tier) => {
                    const row = tiers?.get(tier) ?? []
                    if (row.length === 0) return null
                    return (
                      <div className="app-skilltree-tier" key={tier}>
                        <span className="app-skilltree-tier-tag">{`T${tier}`}</span>
                        <div className="app-skilltree-nodes">
                          {row.map((s) => {
                            const st = statusOf(s)
                            const hit = isHit(s)
                            return (
                              <button
                                key={s.id}
                                className={`app-skilltree-node ${st.cls}${hit ? '' : ' is-dimmed'}`}
                                title={`${s.name} · Lv${st.lv}/${MAX_SKILL_LEVEL}`}
                                onClick={() => setOpenId(s.id)}
                              >
                                <Glyph name={`group-${s.group}`} size={13} color={toneOf(`group-${s.group}`)} />
                                <span className="app-skilltree-node-name">{s.name}</span>
                                <span className="app-skilltree-node-lv">
                                  {st.maxed ? 'MAX' : `Lv${st.lv}`}
                                </span>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
        {q.length > 0 && hitN === 0 ? (
          <div className="app-dim app-skilltree-empty">
            {tr('ui.SkillsPage.006')}
            {query.trim()}
            {tr('ui.SkillsPage.007')}
          </div>
        ) : null}
      </Panel>

      {/* 详情窗（点节点才开）：说明全文 ＋ 下一级时长 ＋ 训练按钮（与「技能」页同一套动作） */}
      {open ? (
        <div className="app-modal-mask" onClick={() => setOpenId(null)}>
          <div className="app-modal app-skilltree-modal" onClick={(e) => e.stopPropagation()}>
            <div className="app-modal-head">
              <span className="app-report-title">
                {open.name}{' '}
                <span className="app-dim">
                  {open.group}
                  {tr('ui.SkillsPage.044', { r: open.rank })}
                </span>
              </span>
              <button className="app-btn is-small" onClick={() => setOpenId(null)}>
                {tr('ui.App.086')}
              </button>
            </div>
            <div className="app-modal-body">
              {(() => {
                const st = statusOf(open)
                const lastQueued = st.mine.length > 0 ? st.mine[st.mine.length - 1]!.targetLevel : st.lv
                const canAdd = !st.maxed && lastQueued < MAX_SKILL_LEVEL
                const targetLv = lastQueued + 1
                const statusTxt = st.maxed
                  ? tr('ui.SkillsPage.025')
                  : st.isTraining
                    ? tr('ui.SkillsPage.027')
                    : st.mine.length > 0
                      ? tr('ui.SkillTree.011', { p1: st.mine.length })
                      : st.lv > 0
                        ? tr('ui.SkillTree.007')
                        : tr('ui.SkillTree.008')
                return (
                  <>
                    <div className="app-skilltree-row">
                      <span className="app-dim">{tr('ui.SkillTree.013')}</span>
                      <span className="app-skilltree-row-value">
                        {st.maxed ? 'MAX' : `Lv${st.lv}/${MAX_SKILL_LEVEL}`}
                      </span>
                      <span className="app-dim">{tr('ui.SkillTree.014')}</span>
                      <span className="app-skilltree-row-value">{statusTxt}</span>
                    </div>
                    <div className="app-skilltree-desc">
                      <SkillDescText text={open.description} />
                    </div>
                    {canAdd ? (
                      <div className="app-skilltree-row">
                        <span className="app-dim">{tr('ui.SkillTree.015')}</span>
                        <span className="app-skilltree-row-value">
                          {formatDurationMs(Math.max(1, Math.round(skillLevelTimeMs(open, targetLv) * tf)))}
                          {tf < 1 ? tr('ui.SkillsPage.019') : ''}
                        </span>
                      </div>
                    ) : null}
                    <div className="app-skilltree-actions">
                      {canAdd ? (
                        <button
                          className="app-btn is-primary is-small"
                          title={tr('ui.SkillsPage.036', {
                            p1: formatDurationMs(Math.max(1, Math.round(skillLevelTimeMs(open, targetLv) * tf))),
                          })}
                          onClick={() => engine.trainNextLevel(open.id)}
                        >
                          {st.mine.length > 0 || st.isTraining
                            ? tr('ui.SkillsPage.034', { p1: targetLv })
                            : tr('ui.SkillsPage.035', { p1: targetLv })}
                        </button>
                      ) : (
                        <span className="app-dim">{tr('ui.SkillsPage.020')}</span>
                      )}
                    </div>
                  </>
                )
              })()}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
