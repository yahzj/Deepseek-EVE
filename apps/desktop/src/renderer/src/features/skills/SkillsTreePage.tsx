import { SkillBoostBlock } from './SkillBoostBlock'
import { SkillTreeCanvas } from './SkillTreeCanvas'
import { SkillDetailModal } from './SkillDetailModal'
import { SkillLicenseActions } from './SkillLicenseActions'
import type { Status } from './types'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  MAX_SKILL_LEVEL,
  skillLevelTimeMs,
  skillLicenseMissing,
  skillLicenseStandingBlock,
  skillLockMissing,
  skillQueueStatus,
  trainingTimeFactor,
} from '@whale/core'
import type { SkillDef, SkillPrereqGap } from '@whale/core'
import { Panel } from '@whale/ui'
import { setSessionPick, sessionPick, useSessionScroll } from '../../ui/sessionView'
import { QueueBlock, SkillDescText } from './skillShared'
import { ItemViewBar, useItemView } from '../../ui/itemView'
import { plainSkillDesc } from './text'
import { layoutBook } from './layout'
import { Glyph, toneOf } from '../../ui/Glyphs'
import { SKILL_BRANCHES, SKILL_TREE_POSITIONS } from '@whale/data'
import { skillBranchText, skillGroupText } from '../../ui/labelsText'
import type { PageProps } from '../../pages/common'
import { cmdText, tr } from '../../i18n/locale'
import { fmtDuration } from '../../i18n/fmt'

const STATE_CHIPS = [
  ['is-max', 'ui.SkillTree.004'],
  ['is-training', 'ui.SkillTree.005'],
  ['is-queued', 'ui.SkillTree.006'],
  ['is-has', 'ui.SkillTree.007'],
  ['is-none', 'ui.SkillTree.008'],
  ['is-locked', 'ui.SkillTree.017'],
] as const

export function SkillsTreePage({
  engine,
  onToast,
  focusGroup,
}: PageProps & {
  focusGroup?: { group: string; branch?: string; seq: number } | null
}) {
  const state = engine.state
  const groups = engine.groups
  const skills = engine.skills
  const [openId, setOpenId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [sec, setSecState] = useState<'queue' | 'tree' | 'boost'>(
    () => (focusGroup != null ? 'tree' : ((sessionPick('skills.sec') as 'queue' | 'tree' | 'boost' | null) ?? 'tree')),
  )
  const setSec = (v: 'queue' | 'tree' | 'boost'): void => {
    setSecState(v)
    setSessionPick('skills.sec', v)
  }
  const [skillView, setSkillView] = useItemView('skills')
  const [prereqNote, setPrereqNote] = useState('')
  const [groupTab, setGroupTabState] = useState<string>(() => {
    const v = sessionPick('skills.group')
    return v !== null && groups.includes(v) ? v : groups[0] ?? ''
  })
  const [branchTab, setBranchTabState] = useState<string>(() => sessionPick('skills.branch') ?? '')
  const [stateTab, setStateTab] = useState<string>('')
  const setGroupTab = (v: string): void => {
    setGroupTabState(v)
    setSessionPick('skills.group', v)
  }
  const setBranchTab = (v: string): void => {
    setBranchTabState(v)
    setSessionPick('skills.branch', v)
  }
  const catalogScrollRef = useRef<HTMLDivElement | null>(null)
  useSessionScroll('skills.catalog.scroll', catalogScrollRef)
  const canvasScrollRef = useRef<HTMLDivElement | null>(null)
  useSessionScroll('skills.canvas.scroll', canvasScrollRef, skillView === 'grid')
  useEffect(() => {
    if (!focusGroup) return
    if (!groups.includes(focusGroup.group)) return
    setGroupTab(focusGroup.group)
    setBranchTab(skills.some(skill => skill.group === focusGroup.group && skill.branch === focusGroup.branch) ? focusGroup.branch ?? '' : '')
    setQuery('')
    setStateTab('')
    setOpenId(null)
    setSec('tree')
  }, [focusGroup?.seq])
  /**
   * **训练许可**（**2026-09-27 船长令**：「我想让学习技能有成本」）：收费档（rank4/5/6，rank6 为
   * **预留档**）与显式定价技能要先买许可才能排训练；已练到 Lv≥1仍视同已购。
   * 判据与 `enqueueSkill` 的拒因**同一把尺**（core `skillLicenseMissing`），界面不自己判。
   */
  const [licenseAsk, setLicenseAsk] = useState<string | null>(null)
  const isk = (n: number): string => n.toLocaleString('zh-CN')
  const licenseMissingOf = (s: SkillDef): boolean => skillLicenseMissing(state, s)
  /**
   * **购买训练许可**：**两段确认**（首击只警告、二击才付款）——50 万 / 200 万是大钱，防误点。
   * 判定与扣款全在 core（`buySkillLicense`），这里只负责回话。
   */
  const buyLicense = (skillId: string): void => {
    const def = engine.ctx.skills.get(skillId)
    if (!def) return
    const block = skillLicenseStandingBlock(state, def)
    if (block) { setLicenseAsk(null); onToast(cmdText(block), true); return }
    if (licenseAsk !== skillId) {
      setLicenseAsk(skillId)
      return
    }
    const r = engine.purchaseSkillLicense(skillId)
    setLicenseAsk(null)
    setPrereqNote(r.ok ? tr('ui.SkillTree.024', { p1: isk(r.price ?? 0) }) : cmdText(r))
    if (!r.ok) onToast(cmdText(r), true)
  }

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

  const prereqTextOf = (gaps: readonly SkillPrereqGap[]): string =>
    tr('ui.SkillTree.018', { p1: gaps.map((g) => `${g.def.name} Lv${g.needLevel}`).join('、') })

  const addPrereqs = (skillId: string): void => {
    const r = engine.enqueuePrereqChain(skillId)
    setPrereqNote(r.ok ? tr('ui.SkillsPage.047', { p1: r.added }) : (r.error ?? ''))
  }

  const books = useMemo(() => booksOf(groupTab), [skills, groupTab])
  const shown = branchTab === '' ? books : books.filter((b) => b.branch === branchTab)
  const stateScope = shown.flatMap((b) => b.defs)
  const statePass = (s: SkillDef): boolean => stateTab === '' || statusOf(s).cls === stateTab
  const stateCount = (cls: string): number => stateScope.filter((s) => statusOf(s).cls === cls).length
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
      {/**
       * **两个平级子页**（**2026-09-30 船长令**：「将技能页的训练队列和技能科技树分做 2 个平级的子页面，
       * 类似工业里的一样。**现在同时存在挤占屏幕太多了**」）。
       *
       * 做法 = **逐字照搬工业页那套**（`pages/IndustryPage.tsx` 的五个签）：同一家族
       * `.app-subtabs/.app-subtab` ＋ **会话级记忆**（`sessionPick('skills.sec')`，与
       * `industry.sec` 同一套 `ui/sessionView.ts` 口径）＋ 「进过一次就常驻、切换只切显示」。
       *
       * ⚠ **两块的内容一字未动**：拆的只是"同页上下叠"这层容器 ——
       * 上面那块（训练队列）本来就是自带面板的独立块；下面那块（树）整块搬进 `sec === 'tree'` 那一支。
       * ⚠ 「第一次学习技能」的跳转（`focusGroup`）**同时切到树**：不切的话玩家落在队列页，
       * 看不到刚被选中的那个大类（那次跳转的目的就是"去技能页练那门技能"）。
       */}
      <div className="app-subtabs" role="tablist">
        {/* ⚠ 顺序 = **技能科技树在前**（2026-09-30 追加令「技能科技树的子页面前移」）；
            两颗签的文案各复用既有 id，副标题由各自面板头承担。 */}
        <button
          role="tab"
          aria-selected={sec === 'tree'}
          className={`app-subtab${sec === 'tree' ? ' is-active' : ''}`}
          onClick={() => setSec('tree')}
        >
          <span>✦</span>
          <span>{tr('ui.SkillTree.001')}</span>
        </button>
        <button
          role="tab"
          aria-selected={sec === 'queue'}
          className={`app-subtab${sec === 'queue' ? ' is-active' : ''}`}
          onClick={() => setSec('queue')}
        >
          <span>⌛</span>
          <span>{tr('ui.SkillsPage.001')}</span>
        </button>
        {/* **技能加速**（**2026-09-30 船长令**：「在技能页面内新增一个子窗口『技能加速』，窗口内顶部显示
            玩家当前已经应用的技能加速效果和剩余时间，下方是列表，显示玩家还有多少技能加速类的道具」）
            —— 与上面两颗签**同一家族**（`.app-subtab` ＋ 会话记忆），内容走一个 `Panel` 子窗口容器。 */}
        <button
          role="tab"
          aria-selected={sec === 'boost'}
          className={`app-subtab${sec === 'boost' ? ' is-active' : ''}`}
          onClick={() => setSec('boost')}
        >
          <span>⚡</span>
          <span>{tr('ui.boost.001')}</span>
        </button>
      </div>
      {sec === 'boost' ? (
        /* ⚡ 技能加速：顶部＝当前生效与剩余时间，下方＝持有的加速道具清单（船长 2026-09-30 令）。
           ⚠ 实时读数只做**一条原子状态文本**（技能口径 UX「Contextual Live Badge Updates（High）：
           use one appropriate atomic status message / Don't make every badge a competing live region」）。*/
        <Panel className="is-fill" title={tr('ui.boost.001')}>
          <SkillBoostBlock engine={engine} onToast={onToast} />
        </Panel>
      ) : sec === 'queue' ? (
        /* 训练队列（"正在发生的事"）——拆页后它独占一整屏（原先与树上下叠，把树挤掉一大截） */
        <Panel
          className="is-fill"
          title={tr('ui.SkillsPage.001')}
          right={<span className="app-dim">{tr('ui.SkillTree.029')}</span>}
        >
          <QueueBlock engine={engine} />
        </Panel>
      ) : (
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
        {/**
         * **图例兼筛选器**（**2026-09-27 船长令**：这七颗标签"允许玩家点击，点击后筛选出对应类型的技能"）。
         *
         * 做法：`<span>` → `<button>`（复用同一批 `.app-skilltree-key` 类，只多一个 `is-active`）＋
         * 每颗带**计数**（计数口径见 `stateCount`：就是点下去能看到的条数）。
         * 交互：**单选取筛**——点一颗只看那一类，再点同一颗取消（回到全部）。
         * 筛选**不删节点、只压暗**（与搜索同一手法）：树的结构与前置连线照旧，玩家看得出"在哪一支上"。
         */}
        <div className="app-skilltree-legend">
          <span className="app-dim">{tr('ui.SkillTree.009')}</span>
          {STATE_CHIPS.map(([cls, id]) => (
            <button
              key={cls}
              type="button"
              className={`app-skilltree-key ${cls}${stateTab === cls ? ' is-active' : ''}`}
              aria-pressed={stateTab === cls}
              title={tr('ui.SkillTree.028', { p1: tr(id) })}
              onClick={() => setStateTab((cur) => (cur === cls ? '' : cls))}
            >
              {tr(id)}
              <span className="app-skilltree-key-n">{stateCount(cls)}</span>
            </button>
          ))}
          {stateTab !== '' ? (
            <button type="button" className="app-skilltree-key is-clear" onClick={() => setStateTab('')}>
              {tr('ui.SkillTree.027')}
            </button>
          ) : null}
        </div>

        {/* 树画布：每本技能书一张小图（六边形蜂窝 ＋ 真前置连线）；窄窗横滑、画布自身滚 */}
        <SkillTreeCanvas layouts={layouts} shown={shown} bookProgress={bookProgress} statusOf={statusOf} isHit={isHit} statePass={statePass} setOpenId={setOpenId} canvasScrollRef={canvasScrollRef} />
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
                {b.defs.filter((s) => isHit(s) && statePass(s)).map((s) => {
                  const st = statusOf(s)
                  const lastQ =
                    st.queued > 0
                      ? (state.skills.queue.filter((x) => x.skillId === s.id).pop()?.targetLevel ?? st.lv)
                      : st.lv
                  const nextLv = Math.min(MAX_SKILL_LEVEL, lastQ + 1)
                  const eta = fmtDuration(Math.max(1, Math.round(skillLevelTimeMs(s, nextLv) * tf)))
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
                        ) : licenseMissingOf(s) ? (
                          <SkillLicenseActions state={state} def={s} confirming={licenseAsk === s.id} onBuy={buyLicense} />
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
        {/**
         * **筛完为空**（2026-09-27 补）：状态筛选是"这一页里没有这一类"时点下去会一颗节点都不亮
         * ⇒ 必须给一句话，别让玩家以为点了没反应（与上面的搜索空态同款样式，两条可同时出现）。
         */}
        {stateTab !== '' && stateCount(stateTab) === 0 ? (
          <div className="app-dim app-skilltree-empty">
            {tr('ui.SkillTree.028', { p1: tr(STATE_CHIPS.find((c) => c[0] === stateTab)?.[1] ?? 'ui.SkillTree.017') })}
          </div>
        ) : null}
      </Panel>
      )}

      {/* 详情窗（点节点才开。**拆页后它仍留在树那一支之外**：它是"选了节点才开"的浮层，
          与当前在哪个子页无关 —— 关掉子页切换不会让它消失（玩家点开就看着，不会被切页吞掉）。 */}
      {open ? (
        <SkillDetailModal open={open} state={state} engine={engine} tf={tf} statusOf={statusOf} licenseMissingOf={licenseMissingOf} licenseAsk={licenseAsk} buyLicense={buyLicense} prereqTextOf={prereqTextOf} addPrereqs={addPrereqs} prereqNote={prereqNote} setOpenId={setOpenId} />
      ) : null}
    </div>
  )
}
