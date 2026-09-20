/**
 * **成就徽章**（船长 2026-09-20：「继续之前的成就系统」· 第一批 = 徽章框架）。
 *
 * 布局口径（同级相似项 = 谜质科技子页 `MatterTechTab.tsx` 的二级详情窗 ＋ 任务中心卡片）：
 * - **二级窗口**（船长 2026-09-20 裁定）：不占一级导航、不碰「一级页不滚」红线；
 *   入口在任务中心「重要任务」页 → 点「成就」按钮打开。滚动只在这一层内。
 * - **两组分区**：「第一次」任务徽章 13 枚 · 次数链徽章 50 枚（按链分组，组内 1/4/7/10 档）；
 *   未达成的走灰阶剪影（可预见"还差什么"）。
 * - **同图案 · 颜色区分**（船长裁定）：图案来自数据表的 `pattern`，颜色来自 `tone`
 *   （两套都住 `data/src/achievements.ts`，本组件不写死任何色值）。
 * - 悬停说明走 `ui/Tooltip.tsx` 的 `hoverTipProps`（AGENTS §6：富内容一律走它，且**同一元素
 *   不许同时带 `title` 与 `hoverTipProps`**）。
 *
 * 文案：界面文案一律走 `useL10n().t('中文原文')`；徽章名与说明来自内容表 `ctx.achievements`
 * （英文覆盖层在本地化批接入——本批**未排入本地化排队**，见约定 §十一之二）。
 */
import { useState } from 'react'
import { Glyph } from '../ui/Glyphs'
import { hoverTipProps } from '../ui/Tooltip'
import { achievementCount, achievementOverview, chainAchievementGroups } from '@whale/core'
import type { AchievementDef } from '@whale/core'
import type { GameEngine } from '../game/engine'
import { useL10n } from '../i18n/locale'

/** 一枚徽章小卡（固定尺寸，防悬停内容变化引起跳动） */
function BadgeCard({
  def,
  earnedAt,
  label,
  lockedText,
}: {
  def: AchievementDef
  earnedAt: number | null
  label: string
  lockedText: string
}) {
  const got = earnedAt !== null
  return (
    <div
      className={`app-ach-badge${got ? ' is-earned' : ''}`}
      {...hoverTipProps([def.name, def.note, got ? label : lockedText])}
    >
      <span className="app-ach-badge-art">
        {/* 未达成 ⇒ 灰阶剪影（`color` 传灰，图案形状照旧 ⇒ 玩家看得出"还差哪一枚"） */}
        <Glyph name={`ach-${def.pattern}`} size={30} color={got ? def.tone : '#5a6472'} />
      </span>
      <span className="app-ach-name">{def.name}</span>
      {got ? <span className="app-ach-check">✓</span> : null}
    </div>
  )
}

/** 成就二级窗口（入口在任务中心） */
export function Achievements({ engine, onClose }: { engine: GameEngine; onClose: () => void }) {
  const { t } = useL10n()
  const state = engine.state
  const defs = engine.ctx.achievements
  const rows = achievementOverview(state, defs)
  const chains = chainAchievementGroups(state, defs)
  const taskRows = rows.filter((r) => r.def.source.kind === 'task')
  const owned = achievementCount(state)

  return (
    <div className="app-modal-mask" onClick={onClose}>
      <div className="app-modal app-ach-modal" onClick={(e) => e.stopPropagation()}>
        <div className="app-modal-head">
          <span className="app-report-title">
            {t('成就徽章')}
            <span className="app-dim">
              {' '}
              · {t('已获得 {n}/{total} 枚', { n: owned, total: rows.length })}
            </span>
          </span>
          <button className="app-btn is-small" onClick={onClose}>
            ✕ {t('关闭')}
          </button>
        </div>
        <div className="app-modal-body">
          <div className="app-ach-sec">{t('「第一次」任务')}</div>
          <div className="app-ach-grid">
            {taskRows.map((r) => (
              <BadgeCard
                key={r.def.id}
                def={r.def}
                earnedAt={r.earnedAt}
                label={t('已获得')}
                lockedText={t('尚未获得')}
              />
            ))}
          </div>
          <div className="app-ach-sec">{t('次数链进度')}</div>
          {chains.map((g) => (
            <div key={g.chainId} className="app-ach-chain">
              <div className="app-ach-chain-head">
                <span className="app-ach-chain-name">{g.name}</span>
                <span className="app-dim">{t('当前 {lv} 级', { lv: g.progress })}</span>
              </div>
              <div className="app-ach-grid">
                {g.badges.map((def) => (
                  <BadgeCard
                    key={def.id}
                    def={def}
                    earnedAt={rows.find((r) => r.def.id === def.id)?.earnedAt ?? null}
                    label={t('已获得')}
                    lockedText={t('尚未获得')}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** 任务中心里的入口按钮（与同级按钮同族样式：`app-btn is-small`） */
export function AchievementsButton({ engine }: { engine: GameEngine }) {
  const { t } = useL10n()
  const [open, setOpen] = useState(false)
  const owned = achievementCount(engine.state)
  const total = engine.ctx.achievements?.length ?? 0
  return (
    <>
      <button className="app-btn is-small" onClick={() => setOpen(true)}>
        <Glyph name="ach-first" size={14} /> {t('成就徽章')}
        <span className="app-dim">
          {' '}
          {owned}/{total}
        </span>
      </button>
      {open ? <Achievements engine={engine} onClose={() => setOpen(false)} /> : null}
    </>
  )
}
