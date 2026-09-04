/**
 * 技能页：训练队列 + 全部技能（紧凑行），主窗口宽版。
 * T2：连锁训练（同技能逐级追加）、取消保留进度可续接、队列条目顺延、
 * 说明内 ⟦效果数值⟧ 高亮、各级训练时长展示。
 */
import {
  MAX_SKILL_LEVEL,
  formatDurationMs,
  skillLevelTimeMs,
  skillQueueStatus,
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

/** "各级训练时长"提示串（技能行悬浮提示用） */
export function levelTimesHint(def: SkillDef): string {
  const parts: string[] = []
  for (let lv = 1; lv <= MAX_SKILL_LEVEL; lv++) {
    parts.push(`Lv${lv} ${formatDurationMs(skillLevelTimeMs(def, lv))}`)
  }
  return `各级训练时长：${parts.join(' · ')}`
}

export function SkillsPage({ engine }: PageProps) {
  const [groupTab, setGroupTab] = useState<string>('all')
  const groups = engine.groups
  const tabSkills = (g: string): string[] => engine.skills.filter((s) => s.group === g).map((s) => s.id)
  return (
    <div className="page-stack page-wide">
      <Panel
        title="训练队列"
        right={<span className="app-dim">技能与采矿/远征/制造并行 · 取消训练保留本级进度，重排同一级自动续接</span>}
      >
        <QueueBlock engine={engine} />
      </Panel>
      <Panel title="技能目录" right={<span className="app-dim">{engine.skills.length} 技能 · 最高 5 级 · 金色数字=实际效果 · 悬停看各级时长</span>}>
        {/* 分类筛选（参考任务中心 app-tasktab 样式）：全部 / 各技能分类 */}
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
              <span className="app-dim"> {tabSkills(g).length}</span>
            </button>
          ))}
        </div>
        <div className="app-skill-groups-wide">
          {groupTab === 'all' ? (
            groups.map((group) => (
              <div key={group} className="app-skill-group">
                <div className="app-skill-group-tag">{group}</div>
                {engine.skills
                  .filter((s) => s.group === group)
                  .map((skill) => (
                    <SkillWideRow key={skill.id} engine={engine} skill={skill} />
                  ))}
              </div>
            ))
          ) : (
            <div className="app-skill-group">
              <div className="app-skill-group-tag">{groupTab}</div>
              {engine.skills
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
  const head = view.head
  return (
    <div>
      {head ? (
        <div className="app-qb-head">
          <div className="app-qb-bar">
            <ProgressBar
              value={head.percent}
              label={`正在训练：${head.skillName} → Lv${head.targetLevel} · 冲 Lv${head.intoLevel} · 剩 ${formatDurationMs(head.remainingMs)}`}
            />
          </div>
          <button
            className="app-btn is-small is-warn"
            title="取消训练：本级进度保留，重新排同一级自动续接；后面同技能条目自动顺延一级"
            onClick={() => engine.dequeueAt(0)}
          >
            取消
          </button>
        </div>
      ) : (
        <div className="app-dim app-train-idle">
          队列空闲。取消训练会保留本级已练进度——重新把该技能排为队首时自动续接。
        </div>
      )}
      {view.pending.length > 0 ? (
        <div className="app-train-pending">
          {view.pending.map((p, i) => (
            <span key={`${p.skillId}-${p.queueIndex}`} className="app-chip app-train-chip" title="移出队列：同技能的后续条目自动顺延一级">
              <span>
                第{i + 1}位 {p.skillName}→Lv{p.targetLevel}
              </span>
              {p.levelMs > 0 ? <span className="app-dim">{formatDurationMs(p.levelMs)}</span> : null}
              <button className="app-train-x" title="移出队列" onClick={() => engine.dequeueAt(p.queueIndex)}>
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}
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
  const title = `${plainSkillDesc(skill.description)}${def ? `｜${levelTimesHint(def)}` : ''}`

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
                <span className="app-sr-eta">该级约 {formatDurationMs(skillLevelTimeMs(def, lastQueued + 1))}</span>
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
                title={`排上后练这一级需 ${def ? formatDurationMs(skillLevelTimeMs(def, lastQueued + 1)) : ''}`}
              >
                追加→Lv{lastQueued + 1}
              </button>
              {def ? (
                <span className="app-sr-eta">该级约 {formatDurationMs(skillLevelTimeMs(def, lastQueued + 1))}</span>
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
          title={def ? `练这一级需 ${formatDurationMs(skillLevelTimeMs(def, current + 1))}` : undefined}
        >
          训练→Lv{current + 1}
        </button>
        {def ? <span className="app-sr-eta">本级约 {formatDurationMs(skillLevelTimeMs(def, current + 1))}</span> : null}
        {saved > 0 && def ? (
          <span className="app-sr-eta app-sr-resume">
            有保留进度 {Math.min(100, Math.round((saved / skillLevelTimeMs(def, current + 1)) * 100))}%，训练即续接
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
