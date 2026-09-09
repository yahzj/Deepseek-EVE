/**
 * 技能页：训练队列 + 全部技能（紧凑行），主窗口宽版。
 * T2：连锁训练（同技能逐级追加）、取消保留进度可续接、队列条目顺延、
 * 说明内 ⟦效果数值⟧ 高亮、各级训练时长展示。
 */
import {
  HIDDEN_SKILL_IDS,
  MAX_SKILL_LEVEL,
  formatDurationMs,
  skillLevelTimeMs,
  skillQueueStatus,
  trainingTimeFactor,
} from '@whale/core'
import type { SkillDef } from '@whale/core'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Panel, ProgressBar } from '@whale/ui'
import { plainSkillDesc } from '../ui/skillText'
import type { PageProps } from './common'

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

/** "各级训练时长"提示串（技能行悬浮提示用；factor = 高效学习法缩时系数） */
export function levelTimesHint(def: SkillDef, factor = 1): string {
  const parts: string[] = []
  for (let lv = 1; lv <= MAX_SKILL_LEVEL; lv++) {
    parts.push(`Lv${lv} ${formatDurationMs(Math.round(skillLevelTimeMs(def, lv) * factor))}`)
  }
  return `各级训练时长：${parts.join(' · ')}`
}

/** 技能行时长（毫秒）：基础 × 高效学习法系数（引擎推进/预估同源） */
function effLevelMs(def: SkillDef | undefined, lv: number, factor: number): number {
  return def ? Math.max(1, Math.round(skillLevelTimeMs(def, lv) * factor)) : 0
}

export function SkillsPage({ engine, focusSkillId }: PageProps & { focusSkillId?: string | null }) {
  const [groupTab, setGroupTab] = useState<string>('all')
  // 目录搜索（2026-09-09 船长：标题内搜索栏，按名称/分类/说明锁定技能；输入时切搜索结果视图）
  const [skillQuery, setSkillQuery] = useState('')
  const groups = engine.groups
  // 战斗线预留技能（护盾操作/能量管理/船体加固）隐藏：不进目录、不可见
  const visibleSkills = engine.skills.filter(
    (s) => !HIDDEN_SKILL_IDS.includes(s.id) && (!focusSkillId || s.id === focusSkillId),
  )
  const q = skillQuery.trim().toLowerCase()
  const searchHits =
    q.length > 0
      ? visibleSkills.filter(
          (s) =>
            s.name.toLowerCase().includes(q) ||
            s.group.toLowerCase().includes(q) ||
            plainSkillDesc(s.description).toLowerCase().includes(q),
        )
      : null
  const tabCount = (g: string): number => visibleSkills.filter((s) => s.group === g).length
  return (
    <div className="page-stack page-wide page-fill">
      <Panel
        title="训练队列"
        right={<span className="app-dim">技能与采矿/远征/制造并行 · 取消训练保留本级进度，重排同一级自动续接</span>}
      >
        <QueueBlock engine={engine} />
      </Panel>
      {/* 船长拍板：技能目录整窗滚（队列面板固定在上） */}
      <Panel
        className="is-fill"
        title="技能目录"
        right={
          <span className="app-head-search-wrap">
            <input
              className="app-head-search"
              type="text"
              placeholder="搜索技能…"
              value={skillQuery}
              onChange={(e) => setSkillQuery(e.target.value)}
              spellCheck={false}
            />
            <span className="app-dim">
              {q.length > 0
                ? `匹配 ${searchHits?.length ?? 0} 技能`
                : `${visibleSkills.length} 技能 · 最高 5 级 · 金色数字=实际效果 · 悬停看各级时长`}
            </span>
          </span>
        }
      >
        {/* 分类筛选（参考任务中心 app-tasktab 样式）：全部 / 各技能分类；搜索时隐藏 */}
        {!searchHits ? (
          <div className="app-task-tabs" role="tablist">
            <button
              role="tab"
              aria-selected={groupTab === 'all'}
              className={`app-tasktab${groupTab === 'all' ? ' is-active' : ''}`}
              onClick={() => setGroupTab('all')}
            >
              全部
            </button>
            {groups.map((g) => (
              <button
                key={g}
                role="tab"
                aria-selected={groupTab === g}
                className={`app-tasktab${groupTab === g ? ' is-active' : ''}`}
                onClick={() => setGroupTab(g)}
              >
                {g}
                <span className="app-dim"> {tabCount(g)}</span>
              </button>
            ))}
          </div>
        ) : null}
        <div className="app-skill-groups-wide">
          {searchHits ? (
            <div className="app-skill-group">
              <div className="app-skill-group-tag">搜索结果（{searchHits.length}）</div>
              {searchHits.map((skill) => (
                <SkillWideRow key={skill.id} engine={engine} skill={skill} />
              ))}
              {searchHits.length === 0 ? (
                <div className="app-dim" style={{ padding: '6px 4px' }}>
                  没有匹配「{skillQuery.trim()}」的技能——换个关键词试试（支持名称/分类/说明）。
                </div>
              ) : null}
            </div>
          ) : focusSkillId ? (
            <div className="app-skill-group">
              <div className="app-skill-group-tag">教程聚焦</div>
              {visibleSkills.map((skill) => (
                <SkillWideRow key={skill.id} engine={engine} skill={skill} />
              ))}
              <div className="app-dim" style={{ padding: '6px 4px' }}>
                其余技能将在完成教程后开放浏览。
              </div>
            </div>
          ) : groupTab === 'all' ? (
            groups.map((group) => (
              <div key={group} className="app-skill-group">
                <div className="app-skill-group-tag">{group}</div>
                {visibleSkills
                  .filter((s) => s.group === group)
                  .map((skill) => (
                    <SkillWideRow key={skill.id} engine={engine} skill={skill} />
                  ))}
              </div>
            ))
          ) : (
            <div className="app-skill-group">
              <div className="app-skill-group-tag">{groupTab}</div>
              {visibleSkills
                .filter((s) => s.group === groupTab)
                .map((skill) => (
                  <SkillWideRow key={skill.id} engine={engine} skill={skill} />
                ))}
            </div>
          )}
        </div>
      </Panel>
    </div>
  )
}

function QueueBlock({ engine }: { engine: PageProps['engine'] }) {
  const state = engine.state
  const view = skillQueueStatus(state, engine.ctx.skills)
  // 船长 2026-09-05：正在训练的那条由顶部活动窗口「技能训练」区展示；这里只显示"排队中"的技能。
  // 2026-09-08（船长）：队列总时长 + 顺序调整——前移到顶 = 交换式顶替当前训练（原训练退位保留进度）
  const totalMs =
    (view.head !== null ? view.head.remainingMs : 0) +
    view.pending.reduce((s, p) => s + p.remainingMs, 0)
  const lastIndex = state.skills.queue.length - 1
  return (
    <div>
      {totalMs > 0 ? (
        <div className="app-dim app-train-total">
          队列总时长 ≈ {formatDurationMs(totalMs)}
          {view.head !== null ? `（含训练中本级剩余 ${formatDurationMs(view.head.remainingMs)}）` : ''}——↑ 前移一位，最前一位再 ↑ = 顶替当前训练（原训练退回排队并保留进度）。
        </div>
      ) : null}
      {view.pending.length > 0 ? (
        <div className="app-train-pending">
          {view.pending.map((p) => (
            <span key={`${p.skillId}-${p.queueIndex}`} className="app-chip app-train-chip">
              <button
                className="app-train-arrow"
                title={p.queueIndex === 1 ? '移到最前 = 顶替当前训练：这条立刻开始练，原训练退回排队并保留本级进度' : '前移一位'}
                onClick={() => engine.moveQueueAt(p.queueIndex, p.queueIndex - 1)}
              >
                ↑
              </button>
              <span>
                第{p.queueIndex + 1}位 {p.skillName}→Lv{p.targetLevel}
              </span>
              {p.progressMs > 0 ? (
                <span className="app-dim">剩 {formatDurationMs(p.remainingMs)}</span>
              ) : p.levelMs > 0 ? (
                <span className="app-dim">{formatDurationMs(p.levelMs)}</span>
              ) : null}
              <button
                className="app-train-arrow"
                title={p.queueIndex < lastIndex ? '后移一位' : '已在队尾'}
                disabled={p.queueIndex >= lastIndex}
                onClick={() => engine.moveQueueAt(p.queueIndex, p.queueIndex + 1)}
              >
                ↓
              </button>
              <button className="app-train-x" title="移出队列：同技能的后续条目自动顺延一级" onClick={() => engine.dequeueAt(p.queueIndex)}>
                ×
              </button>
            </span>
          ))}
        </div>
      ) : (
        <div className="app-dim app-train-idle">
          无排队中的技能——正在训练的技能见顶部活动窗口；点下方技能行的「追加」继续排课。
        </div>
      )}
    </div>
  )
}

function SkillWideRow({ engine, skill }: { engine: PageProps['engine']; skill: SkillDef }) {
  const state = engine.state
  const current = state.skills.trained[skill.id] ?? 0
  const view = skillQueueStatus(state, engine.ctx.skills)
  const head = view.head
  const mine = state.skills.queue.filter((q) => q.skillId === skill.id)
  const isTraining = head !== null && head.skillId === skill.id
  const maxed = current >= MAX_SKILL_LEVEL
  const saved = state.skills.savedProgress[skill.id] ?? 0
  const lastQueued = mine.length > 0 ? mine[mine.length - 1]!.targetLevel : current
  const def = engine.ctx.skills.get(skill.id)
  const tf = trainingTimeFactor(state)
  const title = `${plainSkillDesc(skill.description)}${def ? `｜${levelTimesHint(def, tf)}` : ''}${tf < 1 ? '（高效学习法缩时已计入）' : ''}`

  // "轮到该技能还有多久"（只对已排队、非队首的展示）
  let waitMs = 0
  let position = 0
  if (mine.length > 0 && !isTraining) {
    position = state.skills.queue.findIndex((q) => q.skillId === skill.id)
    if (position > 0) {
      waitMs = head?.remainingMs ?? 0
      for (const p of view.pending) {
        if (p.queueIndex >= position) break
        waitMs += p.levelMs
      }
    }
  }

  const renderAction = (): ReactNode => {
    if (isTraining && head) {
      return (
        <div className="app-sr-training">
          <ProgressBar value={head.percent} label="" />
          <span className="app-sr-eta">
            冲 Lv{head.intoLevel} · {formatDurationMs(head.remainingMs)}
          </span>
          {lastQueued < MAX_SKILL_LEVEL ? (
            <>
              <button
                className="app-btn is-primary is-small"
                onClick={() => engine.trainNextLevel(skill.id)}
              >
                追加→Lv{lastQueued + 1}
              </button>
              {def ? (
                <span className="app-sr-eta">该级约 {formatDurationMs(effLevelMs(def, lastQueued + 1, tf))}</span>
              ) : null}
            </>
          ) : null}
        </div>
      )
    }
    if (mine.length > 0) {
      return (
        <div className="app-sr-training">
          <span className="app-chip is-dim">
            排队第{position}位
            {waitMs > 0 ? <span className="app-sr-eta"> · 约{formatDurationMs(waitMs)}后开练</span> : null}
          </span>
          {lastQueued < MAX_SKILL_LEVEL ? (
            <>
              <button
                className="app-btn is-primary is-small"
                onClick={() => engine.trainNextLevel(skill.id)}
                title={`排上后练这一级需 ${def ? formatDurationMs(effLevelMs(def, lastQueued + 1, tf)) : ''}`}
              >
                追加→Lv{lastQueued + 1}
              </button>
              {def ? (
                <span className="app-sr-eta">该级约 {formatDurationMs(effLevelMs(def, lastQueued + 1, tf))}</span>
              ) : null}
            </>
          ) : null}
        </div>
      )
    }
    if (maxed) return <span className="app-dim app-sr-max">已满级</span>
    return (
      <div className="app-sr-training">
        <button
          className="app-btn is-primary is-small"
          onClick={() => engine.trainNextLevel(skill.id)}
          title={def ? `练这一级需 ${formatDurationMs(effLevelMs(def, current + 1, tf))}` : undefined}
        >
          训练→Lv{current + 1}
        </button>
        {def ? <span className="app-sr-eta">本级约 {formatDurationMs(effLevelMs(def, current + 1, tf))}</span> : null}
        {saved > 0 && def ? (
          <span className="app-sr-eta app-sr-resume">
            有保留进度 {Math.min(100, Math.round((saved / effLevelMs(def, current + 1, tf)) * 100))}%，训练即续接
          </span>
        ) : null}
      </div>
    )
  }

  return (
    <div className={`app-skillrow app-skillrow-wide${isTraining ? ' is-training' : ''}`} title={title}>
      <div className="app-sr-main">
        <span className="app-sr-name">{skill.name}</span>
        <span className="app-sr-sub">
          {skill.group} · 难度 {skill.rank} · <SkillDescText text={skill.description} />
        </span>
      </div>
      <div className="app-sr-lv">
        <span className={current > 0 ? 'app-sr-lv-has' : ''}>Lv{current}</span>/5
      </div>
      <div className="app-sr-action app-sr-action-wide">{renderAction()}</div>
    </div>
  )
}
