/**
 * **技能页（科技树 · 正式页 · 2026-09-22 船长令）**：
 * 「**没问题了，可以将技能科技树替换掉原先的技能目录。**」⇒ 本页从"调试可见的试作页"升为
 * 导航「技能」的正式页；旧版技能目录（`pages/SkillsPage.tsx`）退役删除，其中「训练队列」面板与
 * `SkillDescText` 搬进 `pages/skillShared.tsx` 继续用。
 *
 * **2026-09-20 船长令（试作页起点）**：「**现有页面先保留，新的页面暂时只有调试模式可见（导航栏多出一个技能测试入口）**」。
 *
 * ---
 *
 * **第二版（2026-09-22 船长令 · 参考图 `QQ图片20260922133622.png` 的样式语言）**：
 * - 「**1乙**：将同类效果的技能做成上下级关系」⇒ **真前置**（`SkillDef.prereq`，≥Lv1，`enqueueSkill` 校验）；
 * - 「**2**：将现有的技能再进行细分」＋「**做一个导航用于切换不同类型的技能书**」⇒ **技能书导航**
 *   （7 大类 → 该大类内的技能书，另有「全部」档；**按技能条数多的靠前**）；每本书一张小图；
 * - 「**3乙**」节点 = 图标 ＋ **全名（换行、最多两行）** ＋ `Lv x/5`（**短名先不采用**，船长令）；
 * - 「**4甲**」沿用仓内既有 **5 态色**（满级金 / 在练亮蓝 / 已排队淡蓝 / 已练淡绿 / 未学暗灰）＋ 在练加小角标；
 * - 「**5乙**」未解锁的节点**仍显示真图标、只压暗**（不画参考图那种 ▽ 占位）；
 * - 「**技能不用强行并列同一列。可以按照rank将部分单个技能放在后面（只是没有连线）**」⇒ **垂直位置由 rank
 *   决定**；有前置关系的按连线自上而下生长、占本层靠前位置；**没有连线关系的单个技能按 rank 落在本层靠后、
 *   一个线头都不画**；父与子同 rank 时画一条**层内横向短连线**。
 *
 * ⚠ 视觉红线：**六边形与连线一律 SVG 线稿**（`viewBox` ＋ 细描边 ＋ `currentColor`），**不用 CSS 拼形状**；
 * 筛选控件走既有家族（一级大类 `.app-tasktab` / 二级技能书 `.app-subtab`）。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  MAX_SKILL_LEVEL,
  PREREQ_MIN_LEVEL,
  formatDurationMs,
  skillLevelTimeMs,
  skillLockMissing,
  skillQueueStatus,
  trainingTimeFactor,
} from '@whale/core'
import type { SkillDef, SkillPrereqGap } from '@whale/core'
import { Panel } from '@whale/ui'
import { setSessionPick, sessionPick, useSessionScroll } from '../ui/sessionView'
import { QueueBlock, SkillDescText } from './skillShared'
/** 图标/列表切换：与手册·物品页·货仓页**同一实现**（`ui/itemView.tsx` 是全仓唯一那套） */
import { ItemViewBar, useItemView } from '../ui/itemView'
import { plainSkillDesc } from '../ui/skillText'
import { GAP_Y, HEX_H, HEX_W, PAD, TAG_W, hexPath, layoutBook, nameLines } from '../ui/skillTreeLayout'
import { Glyph, toneOf } from '../ui/Glyphs'
import { SKILL_BRANCHES, SKILL_TREE_POSITIONS } from '@whale/data'
import { skillBranchText, skillGroupText } from '../ui/labelsText'
import type { PageProps } from './common'
import { tr } from '../i18n/locale'

/** 排布算法抽到纯模块（可离线读坐标核对）：见 `ui/skillTreeLayout.ts` */

type Status = {
  lv: number
  isTraining: boolean
  queued: number
  maxed: boolean
  /** 前置缺口（**按等级**：每条带 `needLevel`；2026-09-23 起形状由 `SkillDef[]` 改为缺口数组） */
  locked: readonly SkillPrereqGap[]
  cls: string
}

export function SkillsTreePage({
  engine,
  focusGroup,
}: PageProps & {
  /**
   * **外部定位请求**（**2026-09-24 船长令**：「跳到技能页并自动选中工程」）：
   * 「第一次学习技能」卡片的跳转按钮与那封情报信的「前往」都带 `{ group:'工程', seq }` 进来
   * ⇒ 切到该大类并**清掉技能书筛选与搜索**（否则上回留下的筛选会把目标技能藏起来）。
   * `seq` 每次请求 +1 ⇒ 人在技能页时再点一次也能重新落位（同 `taskFocus` / `mapGoto` 的套路）。
   */
  focusGroup?: { group: string; seq: number } | null
}) {
  const state = engine.state
  const groups = engine.groups
  const skills = engine.skills
  const [openId, setOpenId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  /**
   * **图标 / 列表**（**2026-09-23 船长令**：「旧版技能页面的技能目录，合并到现有的技能树页面内，加一个类似
   * 其他页面图标/列表的切换按钮」＋口径「**玩家默认是技能树，切换列表显示旧目录**，但是搜索栏依旧在标题上，
   * 不嵌入旧目录。切换按钮就放搜索边上。」）：`icon`＝科技树（默认）、`list`＝旧目录那种分组行；
   * 两种形态共用页头搜索与页内「大类 / 技能书」导航、共用同一个详情窗与同一套训练动作。
   */
  const [skillView, setSkillView] = useItemView()
  /** 「一并加入前置」的回话（补了几项）——就地显示，不另起 toast 机制 */
  const [prereqNote, setPrereqNote] = useState('')
  /**
   * **导航：先选大类，再选技能书（`''` = 该大类全部技能书）** —— 两级都做**会话级记忆**
   * （2026-09-26 船长令「记住玩家上次选择的子页面」＋裁定「**两级都记，但是不记搜索**」）：
   * 记忆只在本进程内有效（见 `ui/sessionView.ts`），刷新/重开即回到默认。
   */
  const [groupTab, setGroupTabState] = useState<string>(() => {
    const v = sessionPick('skills.group')
    return v !== null && groups.includes(v) ? v : groups[0] ?? ''
  })
  const [branchTab, setBranchTabState] = useState<string>(() => sessionPick('skills.branch') ?? '')
  const setGroupTab = (v: string): void => {
    setGroupTabState(v)
    setSessionPick('skills.group', v)
  }
  const setBranchTab = (v: string): void => {
    setBranchTabState(v)
    setSessionPick('skills.branch', v)
  }
  /**
   * **滚动位置 · 会话级记忆**（只做"主列表那一条"）：
   * · 目录 Panel 的 `.wui-panel-body` 就是本页主列表的滚动体（`overflow:auto` 在共用件里）
   *   ⇒ 走 `Panel` 新开的 `bodyRef` 口拿到它（不传 bodyRef 的面板逐像素不变）；
   * · 图标视图（树画布）自己那支 `.app-skilltree-canvas` 在页面里，直接接。
   */
  const catalogScrollRef = useRef<HTMLDivElement | null>(null)
  useSessionScroll('skills.catalog.scroll', catalogScrollRef)
  const canvasScrollRef = useRef<HTMLDivElement | null>(null)
  useSessionScroll('skills.canvas.scroll', canvasScrollRef, skillView === 'grid')
  /**
   * **外部定位落位**（见 `focusGroup` 的说明）：只认 `seq` 变化 ⇒ 同一次请求不重复覆盖玩家自己的选择；
   * 组名不在本档技能表里（改名/老数据）时**什么都不做**，不把页面切成空白。
   */
  useEffect(() => {
    if (!focusGroup) return
    if (!groups.includes(focusGroup.group)) return
    /**
     * ⚠ 这里**有意**清掉技能书与搜索（否则上回留下的筛选会把目标技能藏起来）——按 2026-09-26 的
     * 会话记忆口径，这次清空**一并写进记忆**：跳转后离开再回来，看到的是玩家最后真正看到的那个视图。
     */
    setGroupTab(focusGroup.group)
    setBranchTab('')
    setQuery('')
  }, [focusGroup?.seq])
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

  /**
   * 本大类下的技能书与各书成员。**顺序 = 技能条数多的靠前**（**2026-09-22 船长令**：
   * 「**然后调整下子类的顺序，技能数量多的窗口优先靠前。**」）；条数相同则按 `SKILL_BRANCHES`
   * 的登记顺序兜底（稳定、可复现）。这个顺序同时决定「技能书」那一排与「全部」档里各本小图的先后。
   */
  const booksOf = (group: string): Array<{ branch: string; defs: SkillDef[] }> => {
    const out: Array<{ branch: string; defs: SkillDef[] }> = []
    for (const s of skills) {
      if (s.group !== group) continue
      const br = s.branch ?? 'b-unknown'
      const hit = out.find((b) => b.branch === br)
      if (hit) hit.defs.push(s)
      else out.push({ branch: br, defs: [s] })
    }
    const declared = (id: string): number => {
      const i = SKILL_BRANCHES.findIndex((b) => b.id === id)
      return i < 0 ? Number.MAX_SAFE_INTEGER : i
    }
    return out.sort((a, b) => b.defs.length - a.defs.length || declared(a.branch) - declared(b.branch))
  }

  /**
   * 前置缺口文案（**按等级**：`X Lv2`）——详情窗与列表行共用一份，界面不自己拼判据。
   * 2026-09-23 船长令「逻辑按等级实现」：等级取自 `SkillPrereqGap.needLevel`（缺省 Lv1）。
   */
  const prereqTextOf = (gaps: readonly SkillPrereqGap[]): string =>
    tr('ui.SkillTree.018', { p1: gaps.map((g) => `${g.def.name} Lv${g.needLevel}`).join('、') })

  /**
   * **一并加入前置**（2026-09-23 船长令；裁定甲「详情窗给按钮，点一下补齐」）：
   * 计划与入队都在 core / engine 侧（`planPrereqChain` → `enqueueSkill`），这里只负责回话。
   */
  const addPrereqs = (skillId: string): void => {
    const r = engine.enqueuePrereqChain(skillId)
    setPrereqNote(r.ok ? tr('ui.SkillsPage.047', { p1: r.added }) : (r.error ?? ''))
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
      {/* 训练队列（"正在发生的事"）固定在上——沿用旧技能目录那条面板（2026-09-10 船长定：它不塞进树里） */}
      <Panel title={tr('ui.SkillsPage.001')} right={<span className="app-dim">{tr('ui.SkillsPage.002')}</span>}>
        <QueueBlock engine={engine} />
      </Panel>
      <Panel
        className="is-fill"
        title={tr('ui.SkillTree.001')}
        bodyRef={catalogScrollRef}
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
            {/* 图标/列表切换（船长 2026-09-23：**放搜索边上**） */}
            <ItemViewBar mode={skillView} onChange={setSkillView} />
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

        {skillView === 'grid' ? (
          <>
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
        <div className="app-skilltree-canvas" ref={canvasScrollRef}>
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
                                  p1: st.locked.map((g) => `${g.def.name} Lv${g.needLevel}`).join('、'),
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
          </>
        ) : (
          /* **列表视图＝旧技能目录**（船长 2026-09-23：「切换列表显示旧目录，但是搜索栏依旧在标题上，
             不嵌入旧目录」）⇒ 用的是页头那个搜索框与页内既有「大类 / 技能书」导航，这里只换呈现形态：
             按技能书分组、一行一个技能（名称 / Lv / 说明高亮 / 状态 / 下一级时长 / 训练或补前置按钮）。 */
          <div className="app-skilltree-catalog">
            {shown.map((b) => (
              <div className="app-skill-group" key={b.branch}>
                <div className="app-skill-group-tag">
                  {skillBranchText(b.branch)}
                  <span className="app-dim"> {b.defs.length}</span>
                </div>
                {b.defs.filter(isHit).map((s) => {
                  const st = statusOf(s)
                  const lastQ =
                    st.queued > 0
                      ? (state.skills.queue.filter((x) => x.skillId === s.id).pop()?.targetLevel ?? st.lv)
                      : st.lv
                  const nextLv = Math.min(MAX_SKILL_LEVEL, lastQ + 1)
                  const eta = formatDurationMs(Math.max(1, Math.round(skillLevelTimeMs(s, nextLv) * tf)))
                  return (
                    <div className={`app-skill-row${st.cls === 'is-locked' ? ' is-locked' : ''}`} key={s.id}>
                      <div className="app-inv-main">
                        <span className="app-inv-name">
                          <span className="app-wh-hold-row-ico" style={{ color: toneOf(`group-${s.group}`) }}>
                            <Glyph name={`group-${s.group}`} size={15} color="currentColor" />
                          </span>
                          <button className="app-linklike" onClick={() => setOpenId(s.id)}>
                            {s.name}
                          </button>
                          <span className="app-dim">
                            {' '}
                            {st.maxed ? 'MAX' : `Lv${st.lv}/${MAX_SKILL_LEVEL}`}
                            {st.queued > 0 ? ` · ${tr('ui.SkillTree.011', { p1: st.queued })}` : ''}
                          </span>
                        </span>
                        <span className="app-dim app-skill-row-desc">
                          <SkillDescText text={s.description} />
                        </span>
                      </div>
                      <div className="app-inv-btns">
                        {st.maxed ? (
                          <span className="app-dim">{tr('ui.SkillsPage.025')}</span>
                        ) : st.locked.length > 0 ? (
                          <>
                            <span className="app-dim is-locked">{prereqTextOf(st.locked)}</span>
                            <button className="app-btn is-small" onClick={() => addPrereqs(s.id)}>
                              {tr('ui.SkillsPage.046')}
                            </button>
                          </>
                        ) : (
                          <>
                            <span className="app-dim">
                              {st.isTraining ? tr('ui.SkillsPage.027') : ''}
                              {tr('ui.SkillTree.015')} {eta}
                            </span>
                            <button
                              className="app-btn is-primary is-small"
                              title={tr('ui.SkillsPage.036', { p1: eta })}
                              onClick={() => engine.trainNextLevel(s.id)}
                            >
                              {st.queued > 0 || st.isTraining
                                ? tr('ui.SkillsPage.034', { p1: nextLv })
                                : tr('ui.SkillsPage.035', { p1: nextLv })}
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}
            {prereqNote.length > 0 ? <div className="app-dim app-skilltree-empty">{prereqNote}</div> : null}
          </div>
        )}
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
      ) : null}
    </div>
  )
}
