/**
 * **成就徽章**（船长 2026-09-20：「继续之前的成就系统」· 第一批 = 徽章框架）。
 *
 * 布局口径（同级相似项 = 任务中心 `panels/Expedition.tsx` 的 `TaskPanel`）：
 * - **一级页 ＋ 页内"二级子窗口容器"**（船长 2026-09-20 口径）：本面板 `is-fill` ＋ `app-win-body`
 *   ⇒ **固定头 + 内容内滚**；**页面本体不滚**（一级页不滚红线），滚动只在这一层里。
 *   入口 = **左侧导航「成就」**（`App.tsx` 的 `NAV_ITEMS`）。
 * - **单网格 · 不分系列**（船长 2026-09-20 改版：「**页面内不要分系列，所有成就卡片排列在一起**」）：
 *   原先的「『第一次』任务 / 次数链进度」两个分区标题与按链分组**都已去掉**，
 *   63 枚卡片排在同一个网格里，顺序 = 数据表顺序（任务 13 枚在前、链徽章按任务表顺序）。
 *   未达成的走灰阶剪影（可预见"还差什么"）。
 * - **同图案 · 颜色区分**（船长裁定）：图案来自数据表的 `pattern`，颜色来自 `tone`
 *   （两套都住 `data/src/achievements.ts`，本组件不写死任何色值）。
 * - 悬停说明走 `ui/Tooltip.tsx` 的 `hoverTipProps`（AGENTS §6：富内容一律走它，且**同一元素
 *   不许同时带 `title` 与 `hoverTipProps`**）。
 * - **悬停内容分三行**（船长 2026-09-20：「**名字要单独起一行。时间单独起一行。不要挤一块**」）：
 *   名字 / 说明 / 时间各占一行（结构照抄 `ui/shipInfo.tsx` 的舰船悬停富卡：
 *   标题用 `.app-ship-hover-title`、正文用块级元素；`.app-tip` 是 `white-space: pre-line` ⇒ 可多行）。
 *
 * 文案：界面文案一律走**唯一表的 id**（`useL10n().t('ui.…')` / 模块级 `tr('ui.…')`）；徽章名与说明来自内容表 `ctx.achievements`
 * （**卡名口径**见工作文档 `docs/design/achievement-display-20260920.md`：链徽章 = 档位词 ＋ 行当，
 * 例「见习探索家」；英文覆盖层在本地化批接入——本批**未排入本地化排队**，见约定 §十一之二）。
 */
import { Glyph } from '../ui/Glyphs'
import { Panel } from '@whale/ui'
import { hoverTipProps } from '../ui/Tooltip'
import { achievementCount, achievementOverview, formatDurationMs } from '@whale/core'
import type { AchievementDef } from '@whale/core'
import type { GameEngine } from '../game/engine'
import { tr } from '../i18n/locale'

/** 一枚徽章小卡（固定尺寸，防悬停内容变化引起跳动） */
function BadgeCard({
  def,
  earnedAt,
  timeLine,
}: {
  def: AchievementDef
  earnedAt: number | null
  /** **完成时间那一行**（船长：「还要记录成就完成时间」）——由调用方拼好（走 `t()`，不在这里拼串） */
  timeLine: string
}) {
  const got = earnedAt !== null
  /**
   * **悬停富卡：三行**（船长 2026-09-20「不要挤一块」）——
   * 名字行（金 · 加粗 · 独占一行）/ 说明行 / 时间行（暗色 · 上方虚线分隔）。
   * 三行都是块级 ⇒ 不会再挤成一段。
   */
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

/**
 * **徽章悬停的第三行**：未到手 / 到手（含完成时间）/ 老档补发（时间未记录）。
 *
 * 完成时间显示**游戏内时间**（`formatDurationMs`，与日志 `atGameMs`、顶栏"在线 X"同一把尺）；
 * 老档补发那批当年真实时刻不可知 ⇒ 明确写"时间未记录"，**不编假时间**。
 */
function badgeTimeLine(
  earnedAt: number | null,
  legacy: boolean,
): string {
  if (earnedAt === null) return tr('ui.Achievements.001')
  if (legacy) return tr('ui.Achievements.002')
  return tr('ui.Achievements.003', { t: formatDurationMs(earnedAt) })
}

/** 成就面板（一级页内容：页内"二级子窗口容器"，固定头 ＋ 内容内滚） */
export function Achievements({ engine }: { engine: GameEngine }) {
  const state = engine.state
  const defs = engine.ctx.achievements
  /**
   * **一张平表 · 一个网格**（船长 2026-09-20：「**不要分系列，所有成就卡片排列在一起**」）：
   * 不再按"任务 / 链"分区，也不再按链分组——`achievementOverview` 已按数据表顺序给全 63 枚
   * （任务 13 枚在前、链徽章按任务表顺序），直接铺进同一个 `.app-ach-grid` 即可。
   * 每枚自己的到手时刻也一并来自这张表 ⇒ 不需要再按链去反查。
   */
  const rows = achievementOverview(state, defs)
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

/** 侧栏导航项与页面头共用的读数（只报数，不自己渲染） */
export function achievementOwnedOf(engine: GameEngine): { owned: number; total: number } {
  return {
    owned: achievementCount(engine.state),
    total: engine.ctx.achievements?.length ?? 0,
  }
}
