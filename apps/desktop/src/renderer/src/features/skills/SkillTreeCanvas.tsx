import type { Ref } from 'react'
import type { SkillDef } from '@whale/core'
import { MAX_SKILL_LEVEL } from '@whale/core'
import { Glyph } from '../../ui/Glyphs'
import { skillBranchText } from '../../ui/labelsText'
import { tr } from '../../i18n/locale'
import { GAP_Y, HEX_H, HEX_W, PAD, TAG_W, hexPath, nameLines } from './layout'
import type { BookLayout } from './layout'
import type { SkillBook, Status } from './types'

interface SkillTreeCanvasProps {
  layouts: readonly BookLayout[]
  shown: readonly SkillBook[]
  bookProgress: (defs: readonly SkillDef[]) => { p1: number; p2: number }
  statusOf: (def: SkillDef) => Status
  isHit: (def: SkillDef) => boolean
  statePass: (def: SkillDef) => boolean
  setOpenId: (id: string) => void
  canvasScrollRef: Ref<HTMLDivElement>
}

export function SkillTreeCanvas({ layouts, shown, bookProgress, statusOf, isHit, statePass, setOpenId, canvasScrollRef }: SkillTreeCanvasProps) {
  return (
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
                  /** 搜索与状态筛选**同一手法**：不命中（任一没过）就压暗，节点与连线照旧留在树上 */
                  const dimmed = !hit || !statePass(n.def)
                  const lines = nameLines(n.def.name)
                  return (
                    <g
                      key={n.def.id}
                      role="listitem"
                      className={`app-skilltree-hex ${st.cls}${dimmed ? ' is-dimmed' : ''}`}
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
  )
}
