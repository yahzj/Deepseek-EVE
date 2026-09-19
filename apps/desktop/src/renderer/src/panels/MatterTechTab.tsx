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
import { tr } from '../i18n/locale'

/** 三条线（顺序 = 界面上从左到右；与数据表的 branch 值一一对应） */
const BRANCHES: ReadonlyArray<{ key: MatterTechBranch; label: string; icon: string; tone: string }> = [
  { key: 'explore', label: tr("ui.MatterTechTab.001"), icon: 'target-lock', tone: '#8fd0ff' },
  { key: 'battle', label: tr("ui.MatterTechTab.002"), icon: 'turret', tone: '#e0a86a' },
  { key: 'industry', label: tr("ui.MatterTechTab.003"), icon: 'industrial', tone: '#9fd8a0' },
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
        <span className="app-mt-essence" title={t("ui.MatterTechTab.004")}>
          <Glyph name="essence" size={13} color="#c9a6ff" /> {t("ui.MatterTechTab.005")} <b>{essence.toLocaleString('zh-CN')}</b> {t("ui.MatterTechTab.006")}
        </span>
        <span className="app-dim">
          {t("ui.MatterTechTab.007", { n: spent, total })} · {t("ui.MatterTechTab.008")}
        </span>
        <HintIcon
          tip={t(
            "ui.MatterTechTab.009",
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
                      const { level, can, cost } = infoOf(def)
                      const cls = level >= def.maxLevel ? 'is-max' : can.ok ? 'is-ready' : 'is-locked'
                      /**
                       * ⟪文案调整 2026-09-19⟫ 悬停文案两次改判（船长）：
                       * ① 「玩家鼠标悬停科技时，应该显示**科技效果**，**而不是科技前置条件**」
                       *    ⇒ 原「{名称}：{x}/{y} 级 — 前置未满：…」 → 改讲效果；
                       * ② 「名称+等级为一行，**效果单独起一行**，最后的『可研究下一级（5 谜质 + 6,000,000 信用点）』
                       *    这种**再另起一行**」⇒ 单行「 · 」拼接 → **三行**。
                       * 现行 = 行 1 名称 · 等级；行 2 效果（数据表 note，每级值就在里面）；行 3 现在能不能点。
                       * **前置未满 / 谜质不足的具体原因**只在二级详情窗里讲（那里有完整前置进度行），悬停不重复。
                       *
                       * 机制：本仓悬停走全局接管层（`ui/Tooltip.tsx`），`.app-tip` 是 **`white-space: pre-line`**
                       * ＋ `max-width: 300px` ⇒ **`\n` 就是换行**（⚠ 上一轮我在这里写"换行不生效"是记错了，已改）。
                       * 行文本**逐行过 `t()`**（每行一条干净的词典 key；不要拼成一条含 `\n` 的 key——三号那边不好翻）。
                       */
                      const tipLines = [
                        tr('ui.MatterTechTab.023', { name: def.name, lv: level, max: def.maxLevel }),
                        def.note,
                        level >= def.maxLevel
                          ? tr('ui.SkillsPage.025')
                          : can.ok
                            ? tr('ui.MatterTechTab.025', {
                                ess: cost?.essence ?? 0,
                                isk: (cost?.isk ?? 0).toLocaleString('zh-CN'),
                              })
                            : tr('ui.MatterTechTab.026'),
                      ]
                      return (
                        <button
                          key={def.id}
                          className={`app-mt-node ${cls}`}
                          title={tipLines.join('\n')}
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
                  · {t("ui.MatterTechTab.013", { lv: matterTechLevel(state, open.id), max: open.maxLevel })} ·{' '}
                  {t(BRANCHES.find((b) => b.key === open.branch)?.label ?? '')} T{open.tier}
                </span>
              </span>
              <button className="app-btn is-small" onClick={() => setOpenId(null)}>
                ✕ {t("ui.FitPage.055")}
              </button>
            </div>
            <div className="app-modal-body">
              <div className="app-mt-modal-note">{open.note}</div>
              {(() => {
                const { level, can, cost } = infoOf(open)
                return (
                  <>
                    <div className="app-mt-modal-row">
                      <span className="app-dim">{t("ui.MatterTechTab.014")}</span>
                      {cost ? (
                        <span className="app-mt-cost">
                          <Glyph name="essence" size={12} color="#c9a6ff" /> {cost.essence} {t("ui.MatterTechTab.006")} ·{' '}
                          {cost.isk.toLocaleString('zh-CN')} {t("ui.FirstTasks.003")}
                        </span>
                      ) : (
                        <span className="app-mt-cost is-max">{t("ui.SkillsPage.025")}</span>
                      )}
                    </div>
                    <div className="app-mt-modal-row">
                      <span className="app-dim">
                        {t("ui.MatterTechTab.015")}
                        <HintIcon tip={t("ui.MatterTechTab.016")} />
                      </span>
                      <span className="app-mt-modal-row-value">
                        {Object.keys(open.prereq ?? {}).length === 0
                          ? t("ui.BattleScreen.001")
                          : Object.entries(open.prereq ?? {})
                              .map(([id, need]) => {
                                const dep = nodes.find((d) => d.id === id)
                                const have = matterTechLevel(state, id)
                                return `${dep?.name ?? id} ${have}/${need}`
                              })
                              .join(t("ui.MatterTechTab.017"))}
                      </span>
                    </div>
                    {!can.ok && level < open.maxLevel ? (
                      <div className="app-mt-modal-why">{can.error}</div>
                    ) : null}
                    <div className="app-mt-modal-actions">
                      <button
                        className="app-btn is-primary"
                        disabled={!can.ok}
                        title={can.ok ? t("ui.MatterTechTab.018") : (can.error ?? '')}
                        onClick={() => {
                          const r = engine.researchMatterTech(open.id)
                          if (r.ok) onToast(t("ui.MatterTechTab.019", { name: open.name }))
                          else onToast(r.error ?? t("ui.MatterTechTab.020"), true)
                        }}
                      >
                        {level >= open.maxLevel ? t("ui.SkillsPage.025") : t("ui.MatterTechTab.021", {
                          ess: cost?.essence ?? 0,
                          isk: (cost?.isk ?? 0).toLocaleString('zh-CN'),
                        })}
                      </button>
                      <span className="app-dim">
                        {t("ui.MatterTechTab.022", { n: essence.toLocaleString('zh-CN') })}
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
