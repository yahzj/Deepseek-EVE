/**
 * **技能科技树（测试页 · 2026-09-20 船长令；2026-09-22 第二版改「六边形蜂窝」）**：
 * 「**现有页面先保留，新的页面暂时只有调试模式可见（导航栏多出一个技能测试入口）**」。
 *
 * ---
 *
 * **第二版（2026-09-22 船长令 · 参考图 `QQ图片20260922133622.png` 的样式语言）**：
 * - 「**1乙**：将同类效果的技能做成上下级关系」⇒ **真前置**（`SkillDef.prereq`，≥Lv1，`enqueueSkill` 校验）；
 * - 「**2**：将现有的技能再进行细分」＋「**做一个导航用于切换不同类型的技能书**」⇒ **技能书导航**
 *   （7 大类 → 该大类内的技能书，另有「全部」档）；每本书一张小图；
 * - 「**3乙**」节点 = 图标 ＋ **全名（换行、最多两行）** ＋ `Lv x/5`（**短名先不采用**，船长令）；
 * - 「**4甲**」沿用仓内既有 **5 态色**（满级金 / 在练亮蓝 / 已排队淡蓝 / 已练淡绿 / 未学暗灰）＋ 在练加小角标；
 * - 「**5乙**」未解锁的节点**仍显示真图标、只压暗**（不画参考图那种 ▽ 占位）；
 * - 「**技能不用强行并列同一列。可以按照rank将部分单个技能放在后面（只是没有连线）**」⇒ **垂直位置由 rank
 *   决定**；有前置关系的按连线自上而下生长、占本层靠前位置；**没有连线关系的单个技能按 rank 落在本层靠后、
 *   一个线头都不画**；父与子同 rank 时画一条**层内横向短连线**。
 *
 * ⚠ 视觉红线：**六边形与连线一律 SVG 线稿**（`viewBox` ＋ 细描边 ＋ `currentColor`），**不用 CSS 拼形状**；
 * 界面只读规则（唯一一处写入是详情窗的「训练」按钮，与正式技能页同一条命令）。正式页 `pages/SkillsPage.tsx`
 * 仍未被本页改动。
 *
 * 入口：导航「技能测试」——**只在调试模式可见**（`localStorage['whale-idle:debug'] === '1'` 后刷新）。
 */
import { useMemo, useState } from 'react'
import {
  MAX_SKILL_LEVEL,
  PREREQ_MIN_LEVEL,
  formatDurationMs,
  skillLevelTimeMs,
  skillLockMissing,
  skillQueueStatus,
  trainingTimeFactor,
} from '@whale/core'
import type { SkillDef } from '@whale/core'
import { Panel } from '@whale/ui'
import { SkillDescText } from './SkillsPage'
import { plainSkillDesc } from '../ui/skillText'
import { GAP_Y, HEX_H, HEX_W, PAD, TAG_W, hexPath, layoutBook, nameLines } from '../ui/skillTreeLayout'
import { Glyph, toneOf } from '../ui/Glyphs'
import { SKILL_TREE_POSITIONS } from '@whale/data'
import { skillBranchText, skillGroupText } from '../ui/labelsText'
import type { PageProps } from './common'
import { tr } from '../i18n/locale'

/** 排布算法抽到纯模块（可离线读坐标核对）：见 `ui/skillTreeLayout.ts` */

type Status = {
  lv: number
  isTraining: boolean
  queued: number
  maxed: boolean
  locked: readonly SkillDef[]
  cls: string
}

export function SkillsTreePage({ engine }: PageProps) {
  const state = engine.state
  const groups = engine.groups
  const skills = engine.skills
  const [openId, setOpenId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  /** 导航：先选大类，再选技能书（`''` = 该大类全部技能书） */
  const [groupTab, setGroupTab] = useState<string>(groups[0] ?? '')
  const [branchTab, setBranchTab] = useState<string>('')
  const q = query.trim().toLowerCase()
  const view = skillQueueStatus(state, engine.ctx.skills)
  const tf = trainingTimeFactor(state)

  const lvOf = (id: string): number => state.skills.trained[id] ?? 0
  const isHit = (s: SkillDef): boolean =>
    q.length === 0 ||
    s.name.toLowerCase().includes(q) ||
    s.group.toLowerCase().includes(q) ||
    plainSkillDesc(s.description).toLowerCase().includes(q)
  const hitN = q.length > 0 ? skills.filter(isHit).length : skills.length

  /** 状态（与正式技能页同一把尺：等级 / 是否在练 / 是否已排队 ＋ 真前置是否满足） */
  const statusOf = (s: SkillDef): Status => {
    const lv = lvOf(s.id)
    const isTraining = view.head !== null && view.head.skillId === s.id
    const queued = state.skills.queue.filter((x) => x.skillId === s.id).length
    const maxed = lv >= MAX_SKILL_LEVEL
    const locked = skillLockMissing(state, s, engine.ctx.skills)
    const cls =
      locked.length > 0
        ? 'is-locked'
        : maxed
          ? 'is-max'
          : isTraining
            ? 'is-training'
            : queued > 0
              ? 'is-queued'
              : lv > 0
                ? 'is-has'
                : 'is-none'
    return { lv, isTraining, queued, maxed, locked, cls }
  }

  /** 本大类下的技能书（按数据顺序 = `SKILL_BRANCHES` 的顺序）与各书成员 */
  const booksOf = (group: string): Array<{ branch: string; defs: SkillDef[] }> => {
    const out: Array<{ branch: string; defs: SkillDef[] }> = []
    for (const s of skills) {
      if (s.group !== group) continue
      const br = s.branch ?? 'b-unknown'
      const hit = out.find((b) => b.branch === br)
      if (hit) hit.defs.push(s)
      else out.push({ branch: br, defs: [s] })
    }
    return out
  }

  const books = useMemo(() => booksOf(groupTab), [skills, groupTab])
  const shown = branchTab === '' ? books : books.filter((b) => b.branch === branchTab)
  const layouts = useMemo(
    () => shown.map((b) => layoutBook(b.branch, b.defs, SKILL_TREE_POSITIONS)),
    [shown],
  )
  const bookProgress = (defs: readonly SkillDef[]): { p1: number; p2: number } => ({
    p1: defs.reduce((n, s) => n + Math.min(MAX_SKILL_LEVEL, lvOf(s.id)), 0),
    p2: defs.length * MAX_SKILL_LEVEL,
  })

  const open = openId !== null ? (engine.ctx.skills.get(openId) ?? null) : null

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
        <div className="app-skilltree-top">
          <span className="app-dim">{tr('ui.SkillTree.002')}</span>
          <span className="app-dim">{tr('ui.SkillTree.003')}</span>
        </div>

        {/* 导航一：7 个大类（沿用正式技能页的 `.app-tasktab` 家族） */}
        <div className="app-skilltree-nav">
          <div className="app-tasktabs" role="tablist">
            {groups.map((g) => (
              <button
                key={g}
                role="tab"
                aria-selected={groupTab === g}
                className={`app-tasktab${groupTab === g ? ' is-active' : ''}`}
                onClick={() => {
                  setGroupTab(g)
                  setBranchTab('')
                }}
              >
                <Glyph name={`group-${g}`} size={13} color={toneOf(`group-${g}`)} />
                {skillGroupText(g)}
              </button>
            ))}
          </div>
          {/* 导航二：该大类下的技能书（`全部` = 一次看全）——用**二级标签家族** `.app-subtabs/.app-subtab`
              （星图页/市场页/工业页的页内二级切换就是它）。⚠ 2026-09-22 船长报障「部分筛选的样式不统一？
              为什么是白底的」：原先这里误用了 `.app-chip`——那是**标签/徽标**家族（只设颜色与描边、**没有背景**），
              套在 `<button>` 上就露出浏览器默认的浅色底 ⇒ 现在统一回标签家族。 */}
          <div className="app-skilltree-books">
            <span className="app-dim">{tr('ui.SkillTree.016')}</span>
            <div className="app-subtabs" role="tablist">
              <button
                role="tab"
                aria-selected={branchTab === ''}
                className={`app-subtab${branchTab === '' ? ' is-active' : ''}`}
                onClick={() => setBranchTab('')}
              >
                {tr('ui.SkillTree.022')}
              </button>
              {books.map((b) => (
                <button
                  key={b.branch}
                  role="tab"
                  aria-selected={branchTab === b.branch}
                  className={`app-subtab${branchTab === b.branch ? ' is-active' : ''}`}
                  title={tr('ui.SkillTree.019', bookProgress(b.defs))}
                  onClick={() => setBranchTab(b.branch)}
                >
                  {skillBranchText(b.branch)}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="app-skilltree-legend">
          <span className="app-dim">{tr('ui.SkillTree.009')}</span>
          <span className="app-skilltree-key is-max">{tr('ui.SkillTree.004')}</span>
          <span className="app-skilltree-key is-training">{tr('ui.SkillTree.005')}</span>
          <span className="app-skilltree-key is-queued">{tr('ui.SkillTree.006')}</span>
          <span className="app-skilltree-key is-has">{tr('ui.SkillTree.007')}</span>
          <span className="app-skilltree-key is-none">{tr('ui.SkillTree.008')}</span>
          <span className="app-skilltree-key is-locked">{tr('ui.SkillTree.017')}</span>
        </div>

        {/* 树画布：每本技能书一张小图（六边形蜂窝 ＋ 真前置连线）；窄窗横滑、画布自身滚 */}
        <div className="app-skilltree-canvas">
          <div className="app-skilltree-bookrow">
            {layouts.map((lay) => {
              const meta = shown.find((b) => b.branch === lay.branch)
              return (
                <div className="app-skilltree-book" key={lay.branch}>
                  <div className="app-skilltree-book-head">
                    <span>{skillBranchText(lay.branch)}</span>
                    {meta ? <span className="app-dim">{tr('ui.SkillTree.019', bookProgress(meta.defs))}</span> : null}
                  </div>
                  <svg
                    className="app-skilltree-svg"
                    viewBox={`0 0 ${lay.w} ${lay.h}`}
                    width={lay.w}
                    height={lay.h}
                    role="list"
                  >
                    {lay.tiers.map((tier: number, i: number) => (
                      <text
                        key={tier}
                        className="app-skilltree-tier-tag"
                        x={PAD + TAG_W / 2}
                        y={PAD + i * (HEX_H + GAP_Y) + HEX_H / 2 + 4}
                        textAnchor="middle"
                      >
                        {`T${tier}`}
                      </text>
                    ))}
                    {lay.edges.map((e, i) =>
                      e.sameRank ? (
                        <line
                          key={`e${i}`}
                          className="app-skilltree-link"
                          x1={e.x1}
                          y1={e.y1}
                          x2={e.x2}
                          y2={e.y2}
                        />
                      ) : (
                        <path
                          key={`e${i}`}
                          className="app-skilltree-link"
                          d={`M ${e.x1} ${e.y1} C ${e.x1} ${(e.y1 + e.y2) / 2}, ${e.x2} ${(e.y1 + e.y2) / 2}, ${e.x2} ${e.y2}`}
                        />
                      ),
                    )}
                    {lay.nodes.map((n) => {
                      const st = statusOf(n.def)
                      const hit = isHit(n.def)
                      const lines = nameLines(n.def.name)
                      return (
                        <g
                          key={n.def.id}
                          role="listitem"
                          className={`app-skilltree-hex ${st.cls}${hit ? '' : ' is-dimmed'}`}
                          /* 悬停说明走自绘接管层（SVG 用 `data-tip`；**禁 `<title>` 子元素**，见 §6 与 content:check） */
                          data-tip={
                            st.locked.length > 0
                              ? `${n.def.name} · ${tr('ui.SkillTree.018', {
                                  p1: st.locked.map((d) => `${d.name} Lv${PREREQ_MIN_LEVEL}`).join('、'),
                                })}`
                              : `${n.def.name} · Lv${st.lv}/${MAX_SKILL_LEVEL}`
                          }
                          onClick={() => setOpenId(n.def.id)}
                        >
                          <path className="app-skilltree-hex-bg" d={hexPath(n.x, n.y)} />
                          {st.isTraining ? (
                            <circle
                              className="app-skilltree-dot"
                              cx={n.x + HEX_W * 0.31}
                              cy={n.y - HEX_H * 0.33}
                              r={4}
                            />
                          ) : null}
                          <g transform={`translate(${n.x - 11}, ${n.y - 34})`}>
                            <Glyph name={`group-${n.def.group}`} size={22} className="app-skilltree-glyph" />
                          </g>
                          {lines.map((ln, i) => (
                            <text
                              key={i}
                              className="app-skilltree-hex-name"
                              x={n.x}
                              /* 2026-09-22 船长：「六边形内的文字可以再往下移动，2 行的文字时会和图标重叠」
                                 ⇒ 图标上移一点、名字再下移（单行 +11 / 两行 +3 与 +15），与等级行也不打架 */
                              y={n.y + (lines.length === 1 ? 11 : i === 0 ? 3 : 15)}
                              textAnchor="middle"
                            >
                              {ln}
                            </text>
                          ))}
                          <text className="app-skilltree-hex-lv" x={n.x} y={n.y + 33} textAnchor="middle">
                            {st.maxed ? 'MAX' : `Lv${st.lv}/${MAX_SKILL_LEVEL}`}
                          </text>
                        </g>
                      )
                    })}
                  </svg>
                </div>
              )
            })}
            {layouts.length === 0 ? <div className="app-dim">{tr('ui.SkillTree.020')}</div> : null}
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

      {/* 详情窗（点节点才开）：说明全文 ＋ 前置 ＋ 下一级时长 ＋ 训练按钮（与正式技能页同一套动作） */}
      {open ? (
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
                const canAdd = !st.maxed && st.locked.length === 0 && lastQueued < MAX_SKILL_LEVEL
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
                const prereqText = tr('ui.SkillTree.018', {
                  p1: (open.prereq ?? [])
                    .map((pid) => `${engine.ctx.skills.get(pid)?.name ?? pid} Lv${PREREQ_MIN_LEVEL}`)
                    .join('、'),
                })
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
                          {st.queued > 0 || st.isTraining
                            ? tr('ui.SkillsPage.034', { p1: targetLv })
                            : tr('ui.SkillsPage.035', { p1: targetLv })}
                        </button>
                      ) : st.locked.length > 0 ? (
                        <span className="app-dim is-locked">{prereqText}</span>
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
