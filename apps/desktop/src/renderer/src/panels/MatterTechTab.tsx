/**
 * **谜质科技**子页（船长 2026-09-19：「消耗谜质和信用点。不消耗时间。主要研究对虫洞内的战斗和探索。
 * 另外含部分洞外工业科技。」＋「研究入口放在扫描虫洞界面内」）。
 *
 * 布局口径（同级相似项 = 工业页「蓝图书架」的功能标签页 + 卡片列表）：
 * - **三线 × 四层**：探索 / 战斗 / 工业三列，列内按层（T1~T4）分组，节点卡片一眼能扫完
 *   （名称 + 等级 `lv/max`）；**点卡片开二级详情窗**（说明 / 每级值 / 下一级费用 / 前置 / 研究按钮）；
 * - **固定尺寸、整页不滚**（一级页不滚红线）：23 个节点排在三列里，卡片紧凑、容器定高；
 * - 状态色沿用本仓既有的"可选 / 已满 / 前置未满"语言：可研究 = 亮框、已满级 = 金色、
 *   前置或货币不足 = 暗灰（悬停给原因，不弹窗）。
 *
 * 文案：界面文案一律走 `useL10n().t('中文原文')`（英文缺词条时回退中文，词典补录见 `i18n/dict.en.ts`）；
 * 节点名与说明来自数据表 `ctx.matterTech`（英文覆盖层 `EN_MATTER_TECH` 由 l10n 批接入）。
 */
import { useState } from 'react'
import { Glyph } from '../ui/Glyphs'
import { HintIcon } from '../ui/Hint'
import {
  matterTechCanResearch,
  matterTechCostAt,
  matterTechEssenceHeld,
  matterTechLevel,
  matterTechNodes,
} from '@whale/core'
import type { MatterTechBranch, MatterTechNodeDef } from '@whale/core'
import type { GameEngine } from '../game/engine'
import type { ToastFn } from '../pages/common'
import { useL10n } from '../i18n/locale'

/** 三条线（顺序 = 界面上从左到右；与数据表的 branch 值一一对应） */
const BRANCHES: ReadonlyArray<{ key: MatterTechBranch; label: string; icon: string; tone: string }> = [
  { key: 'explore', label: '虫洞探索', icon: 'target-lock', tone: '#8fd0ff' },
  { key: 'battle', label: '虫洞战斗', icon: 'turret', tone: '#e0a86a' },
  { key: 'industry', label: '洞外工业', icon: 'industrial', tone: '#9fd8a0' },
]

export function MatterTechTab({ engine, onToast }: { engine: GameEngine; onToast: ToastFn }) {
  const { t } = useL10n()
  const state = engine.state
  const ctx = engine.ctx
  const nodes = matterTechNodes(ctx)
  /** 详情窗（二级窗）：`null` = 没开 */
  const [openId, setOpenId] = useState<string | null>(null)
  const essence = matterTechEssenceHeld(state)
  const spent = nodes.reduce((n, d) => n + matterTechLevel(state, d.id), 0)
  const total = nodes.reduce((n, d) => n + d.maxLevel, 0)

  /** 单节点当前状态：等级 / 能否研究 / 下一级费用 / 不能研究的原因 */
  const infoOf = (def: MatterTechNodeDef) => {
    const level = matterTechLevel(state, def.id)
    const can = matterTechCanResearch(state, ctx, def.id)
    const cost = level < def.maxLevel ? matterTechCostAt(def, level) : null
    return { level, can, cost }
  }

  const open = openId ? nodes.find((d) => d.id === openId) ?? null : null

  return (
    <div className="app-mt">
      <div className="app-mt-top">
        <span className="app-mt-essence" title={t('「虫洞谜质」：洞内撤离成功带回的研究材料，只收不卖')}>
          <Glyph name="essence" size={13} color="#c9a6ff" /> {t('虫洞谜质')} <b>{essence.toLocaleString('zh-CN')}</b> {t('枚')}
        </span>
        <span className="app-dim">
          {t('已点 {n}/{total} 级', { n: spent, total })} · {t('研究不消耗时间，点即生效')}
        </span>
        <HintIcon
          tip={t(
            '研究花费「虫洞谜质」与信用点，不消耗时间；效果一律即时生效。三条线分别作用于洞内探索（回合 / 采集 / 扫描 / 倍速）、洞内战斗（护盾装甲 / 命中回避 / 射程装填 / 威胁压制）与洞外工业（货柜拆解 / 虚空精炼 / 残骸解析）。部分节点有前置要求，需先点满前置的指定级数。',
          )}
        />
      </div>

      <div className="app-mt-cols">
        {BRANCHES.map((br) => (
          <div className="app-mt-col" key={br.key}>
            <div className="app-mt-col-head">
              <Glyph name={br.icon} size={13} color={br.tone} />
              <span style={{ color: br.tone }}>{t(br.label)}</span>
            </div>
            {[1, 2, 3, 4].map((tier) => {
              const row = nodes.filter((d) => d.branch === br.key && d.tier === tier)
              if (row.length === 0) return null
              return (
                <div className="app-mt-tier" key={tier}>
                  <span className="app-mt-tier-tag">{`T${tier}`}</span>
                  <div className="app-mt-tier-nodes">
                    {row.map((def) => {
                      const { level, can } = infoOf(def)
                      const cls = level >= def.maxLevel ? 'is-max' : can.ok ? 'is-ready' : 'is-locked'
                      return (
                        <button
                          key={def.id}
                          className={`app-mt-node ${cls}`}
                          title={
                            level >= def.maxLevel
                              ? t('{name}：已满级 {lv}/{max}', { name: def.name, lv: level, max: def.maxLevel })
                              : can.ok
                                ? t('{name}：{lv}/{max} 级 — 可研究下一级', { name: def.name, lv: level, max: def.maxLevel })
                                : t('{name}：{lv}/{max} 级 — {why}', {
                                    name: def.name,
                                    lv: level,
                                    max: def.maxLevel,
                                    why: can.error ?? '',
                                  })
                          }
                          onClick={() => setOpenId(def.id)}
                        >
                          <span className="app-mt-node-name">{def.name}</span>
                          <span className="app-mt-node-lv">
                            {level}/{def.maxLevel}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {open ? (
        <div className="app-modal-mask" onClick={() => setOpenId(null)}>
          <div className="app-modal app-mt-modal" onClick={(e) => e.stopPropagation()}>
            <div className="app-modal-head">
              <span className="app-report-title">
                {open.name}
                <span className="app-dim">
                  {' '}
                  · {t('{lv}/{max} 级', { lv: matterTechLevel(state, open.id), max: open.maxLevel })} ·{' '}
                  {t(BRANCHES.find((b) => b.key === open.branch)?.label ?? '')} T{open.tier}
                </span>
              </span>
              <button className="app-btn is-small" onClick={() => setOpenId(null)}>
                ✕ {t('关闭')}
              </button>
            </div>
            <div className="app-modal-body">
              <div className="app-mt-modal-note">{open.note}</div>
              {(() => {
                const { level, can, cost } = infoOf(open)
                return (
                  <>
                    <div className="app-mt-modal-row">
                      <span className="app-dim">{t('下一级费用')}</span>
                      {cost ? (
                        <span className="app-mt-cost">
                          <Glyph name="essence" size={12} color="#c9a6ff" /> {cost.essence} {t('枚')} ·{' '}
                          {cost.isk.toLocaleString('zh-CN')} {t('信用点')}
                        </span>
                      ) : (
                        <span className="app-mt-cost is-max">{t('已满级')}</span>
                      )}
                    </div>
                    <div className="app-mt-modal-row">
                      <span className="app-dim">
                        {t('前置')}
                        <HintIcon tip={t('前置未满时，先把前置节点点满到要求的级数再来。')} />
                      </span>
                      <span className="app-mt-modal-row-value">
                        {Object.keys(open.prereq ?? {}).length === 0
                          ? t('无')
                          : Object.entries(open.prereq ?? {})
                              .map(([id, need]) => {
                                const dep = nodes.find((d) => d.id === id)
                                const have = matterTechLevel(state, id)
                                return `${dep?.name ?? id} ${have}/${need}`
                              })
                              .join(t('、'))}
                      </span>
                    </div>
                    {!can.ok && level < open.maxLevel ? (
                      <div className="app-mt-modal-why">{can.error}</div>
                    ) : null}
                    <div className="app-mt-modal-actions">
                      <button
                        className="app-btn is-primary"
                        disabled={!can.ok}
                        title={can.ok ? t('研究一级（不消耗时间）') : (can.error ?? '')}
                        onClick={() => {
                          const r = engine.researchMatterTech(open.id)
                          if (r.ok) onToast(t('🔬 已研究：{name}', { name: open.name }))
                          else onToast(r.error ?? t('研究失败。'), true)
                        }}
                      >
                        {level >= open.maxLevel ? t('已满级') : t('研究一级（{ess} 谜质 · {isk} 信用点）', {
                          ess: cost?.essence ?? 0,
                          isk: (cost?.isk ?? 0).toLocaleString('zh-CN'),
                        })}
                      </button>
                      <span className="app-dim">
                        {t('现有虫洞谜质 {n} 枚', { n: essence.toLocaleString('zh-CN') })}
                      </span>
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
