import { Glyph } from '../../ui/Glyphs'
import { Panel } from '@whale/ui'
import { hoverTipProps } from '../../ui/Tooltip'
import { achievementCount, achievementOverview } from '@whale/core'
import type { AchievementDef } from '@whale/core'
import type { GameEngine } from '../../game/engine'
import { tr } from '../../i18n/locale'
import { fmtDuration } from '../../i18n/fmt'

function BadgeCard({
  def,
  earnedAt,
  timeLine,
}: {
  def: AchievementDef
  earnedAt: number | null
  timeLine: string
}) {
  const got = earnedAt !== null
  const tip = (
    <>
      <span className="app-ship-hover-title">{def.name}</span>
      <div className="app-ach-tip-note">{def.note}</div>
      <div className="app-ach-tip-time">{timeLine}</div>
    </>
  )
  return (
    <div className={`app-ach-badge${got ? ' is-earned' : ''}`} {...hoverTipProps(tip)}>
      <span className="app-ach-badge-art">
        {/* 未达成 ⇒ 灰阶剪影（`color` 传灰，图案形状照旧 ⇒ 玩家看得出"还差哪一枚"） */}
        <Glyph name={`ach-${def.pattern}`} size={30} color={got ? def.tone : 'rgb(var(--wui-dim))'} />
      </span>
      <span className="app-ach-name">{def.name}</span>
      {got ? <span className="app-ach-check">✓</span> : null}
    </div>
  )
}

function badgeTimeLine(
  earnedAt: number | null,
  legacy: boolean,
): string {
  if (earnedAt === null) return tr('ui.Achievements.001')
  if (legacy) return tr('ui.Achievements.002')
  return tr('ui.Achievements.003', { t: fmtDuration(earnedAt) })
}

export function Achievements({ engine }: { engine: GameEngine }) {
  const state = engine.state
  const defs = engine.ctx.achievements
  const rows = achievementOverview(state, defs)
  const owned = achievementCount(state)

  return (
    <Panel
      className="is-fill win-fixed-body"
      title={tr('ui.Achievements.004')}
      right={<span className="app-dim">{tr('ui.Achievements.005', { n: owned, total: rows.length })}</span>}
    >
      <div className="app-win-body">
        <div className="app-ach-grid">
          {rows.map((r) => (
            <BadgeCard
              key={r.def.id}
              def={r.def}
              earnedAt={r.earnedAt}
              timeLine={badgeTimeLine(r.earnedAt, r.legacy)}
            />
          ))}
        </div>
      </div>
    </Panel>
  )
}
