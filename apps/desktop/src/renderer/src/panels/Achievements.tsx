/**
 * **成就徽章**（船长 2026-09-20：「继续之前的成就系统」· 第一批 = 徽章框架）。
 *
 * 布局口径（同级相似项 = 任务中心 `panels/Expedition.tsx` 的 `TaskPanel`）：
 * - **一级页 ＋ 页内"二级子窗口容器"**（船长 2026-09-20 口径）：本面板 `is-fill` ＋ `app-win-body`
 *   ⇒ **固定头 + 内容内滚**；**页面本体不滚**（一级页不滚红线），滚动只在这一层里。
 *   入口 = **左侧导航「成就」**（`App.tsx` 的 `NAV_ITEMS`）。
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
import { Glyph } from '../ui/Glyphs'
import { Panel } from '@whale/ui'
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

/** 成就面板（一级页内容：页内"二级子窗口容器"，固定头 ＋ 内容内滚） */
export function Achievements({ engine }: { engine: GameEngine }) {
  const { t } = useL10n()
  const state = engine.state
  const defs = engine.ctx.achievements
  const rows = achievementOverview(state, defs)
  const chains = chainAchievementGroups(state, defs)
  const taskRows = rows.filter((r) => r.def.source.kind === 'task')
  const owned = achievementCount(state)

  return (
    /**
     * **一级页内的"二级子窗口容器"**（船长 2026-09-20 口径）：
     * `is-fill` ＋ `app-win-body` ⇒ 本面板高度恒等于主窗口内容区、**固定头 + 内容内滚**
     * —— 与任务中心（`panels/Expedition.tsx` 的 `TaskPanel`）同一套结构：
     * **页面本体不滚**（一级页不滚红线），滚动只发生在下面这个内容容器里。
     */
    <Panel
      className="is-fill win-fixed-body"
      title={t('成就徽章')}
      right={<span className="app-dim">{t('已获得 {n}/{total} 枚', { n: owned, total: rows.length })}</span>}
    >
      <div className="app-win-body">
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
    </Panel>
  )
}

/** 侧栏导航项与页面头共用的读数（只报数，不自己渲染） */
export function achievementOwnedOf(engine: GameEngine): { owned: number; total: number } {
  return {
    owned: achievementCount(engine.state),
    total: engine.ctx.achievements?.length ?? 0,
  }
}
