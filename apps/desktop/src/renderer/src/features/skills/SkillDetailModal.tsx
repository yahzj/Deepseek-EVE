import { MAX_SKILL_LEVEL, PREREQ_MIN_LEVEL, skillLevelTimeMs } from '@whale/core'
import type { GameState, SkillDef, SkillPrereqGap } from '@whale/core'
import type { GameEngine } from '../../game/engine'
import { skillBranchText, skillGroupText } from '../../ui/labelsText'
import { tr } from '../../i18n/locale'
import { fmtDuration } from '../../i18n/fmt'
import { SkillDescText } from './skillShared'
import type { Status } from './types'

interface SkillDetailModalProps {
  open: SkillDef
  state: GameState
  engine: GameEngine
  tf: number
  statusOf: (def: SkillDef) => Status
  licenseMissingOf: (def: SkillDef) => boolean
  licensePriceOf: (def: SkillDef) => number | null
  licenseAsk: string | null
  buyLicense: (id: string) => void
  prereqTextOf: (gaps: readonly SkillPrereqGap[]) => string
  addPrereqs: (id: string) => void
  prereqNote: string
  isk: (value: number) => string
  setOpenId: (id: string | null) => void
}

export function SkillDetailModal({ open, state, engine, tf, statusOf, licenseMissingOf, licensePriceOf, licenseAsk, buyLicense, prereqTextOf, addPrereqs, prereqNote, isk, setOpenId }: SkillDetailModalProps) {
  return (
    <div className="app-modal-mask" onClick={() => setOpenId(null)}>
      <div className="app-modal app-skilltree-modal" onClick={(e) => e.stopPropagation()}>
        <div className="app-modal-head">
          <span className="app-report-title">
            {open.name}{' '}
            <span className="app-dim">
              {skillGroupText(open.group)}
              {open.branch !== undefined ? ` · ${skillBranchText(open.branch)}` : ''}
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
            const lastQueued =
              st.queued > 0
                ? (state.skills.queue.filter((x) => x.skillId === open.id).pop()?.targetLevel ?? st.lv)
                : st.lv
            /** 2026-09-27 训练许可：缺许可 ⇒ 不给训练按钮（改为"购买训练许可"，与 core 同一把尺） */
            const canAdd =
              !st.maxed &&
              st.locked.length === 0 &&
              !licenseMissingOf(open) &&
              lastQueued < MAX_SKILL_LEVEL
            const targetLv = lastQueued + 1
            const statusTxt = st.maxed
              ? tr('ui.SkillsPage.025')
              : st.isTraining
                ? tr('ui.SkillsPage.027')
                : st.queued > 0
                  ? tr('ui.SkillTree.011', { p1: st.queued })
                  : st.lv > 0
                    ? tr('ui.SkillTree.007')
                    : tr('ui.SkillTree.008')
            const prereqText = prereqTextOf(
              // 缺口按"各自要求等级"写（缺啥写啥）；都满足时按定义列出全部前置（练过就能往下走）
              st.locked.length > 0
                ? st.locked
                : (open.prereq ?? [])
                    .map((pid) => engine.ctx.skills.get(pid))
                    .filter((d): d is SkillDef => d !== undefined)
                    .map((d) => ({ def: d, needLevel: PREREQ_MIN_LEVEL })),
            )
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
                {/* 真前置（2026-09-22）：未满足 ⇒ 摆出还差哪些；满足 ⇒ 列出前置（练过就能往下走） */}
                {open.prereq !== undefined && open.prereq.length > 0 ? (
                  <div className="app-skilltree-row">
                    <span className="app-dim">{tr('ui.SkillTree.021')}</span>
                    <span
                      className={`app-skilltree-row-value${st.locked.length > 0 ? ' is-locked' : ''}`}
                    >
                      {prereqText}
                    </span>
                  </div>
                ) : null}
                <div className="app-skilltree-desc">
                  <SkillDescText text={open.description} />
                </div>
                {canAdd ? (
                  <div className="app-skilltree-row">
                    <span className="app-dim">{tr('ui.SkillTree.015')}</span>
                    <span className="app-skilltree-row-value">
                      {fmtDuration(Math.max(1, Math.round(skillLevelTimeMs(open, targetLv) * tf)))}
                      {tf < 1 ? tr('ui.SkillsPage.019') : ''}
                    </span>
                  </div>
                ) : null}
                <div className="app-skilltree-actions">
                  {canAdd ? (
                    <button
                      className="app-btn is-primary is-small"
                      title={tr('ui.SkillsPage.036', {
                        p1: fmtDuration(Math.max(1, Math.round(skillLevelTimeMs(open, targetLv) * tf))),
                      })}
                      onClick={() => engine.trainNextLevel(open.id)}
                    >
                      {st.queued > 0 || st.isTraining
                        ? tr('ui.SkillsPage.034', { p1: targetLv })
                        : tr('ui.SkillsPage.035', { p1: targetLv })}
                    </button>
                  ) : licenseMissingOf(open) ? (
                    <>
                      <span className="app-dim">
                        {tr('ui.SkillTree.025', { p1: isk(licensePriceOf(open) ?? 0) })}
                      </span>
                      <button
                        className={`app-btn is-small${licenseAsk === open.id ? ' is-primary' : ''}`}
                        onClick={() => buyLicense(open.id)}
                      >
                        {licenseAsk === open.id
                          ? tr('ui.SkillTree.026', { p1: isk(licensePriceOf(open) ?? 0) })
                          : tr('ui.SkillTree.023', { p1: isk(licensePriceOf(open) ?? 0) })}
                      </button>
                    </>
                  ) : st.locked.length > 0 ? (
                    <>
                      <span className="app-dim is-locked">{prereqText}</span>
                      {/* **一并加入前置**（船长 2026-09-23：选中技能后前置可直接进队列） */}
                      <button className="app-btn is-small" onClick={() => addPrereqs(open.id)}>
                        {tr('ui.SkillsPage.046')}
                      </button>
                      {prereqNote.length > 0 ? <span className="app-dim">{prereqNote}</span> : null}
                    </>
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
  )
}
