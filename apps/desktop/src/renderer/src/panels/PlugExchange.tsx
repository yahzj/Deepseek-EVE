/**
 * **「章鱼人兑换」窗口**（**2026-09-26 船长令**，设计稿 `docs/design/ship-plug-20260926.md`）。
 *
 * 船长原话（照抄）：「**找章鱼人用声望兑换，玩家完成入侵后根据贡献获得一定量声望。**」
 * ＋「**声望真扣（就是意味着玩家一开始其实可以买5张）**」＋「**通讯内跳转**」
 * ＋（优化令）「**兑换商店过于简陋，你可以使用skill进行优化下**」。
 *
 * ## 版式口径（**整段沿用全仓既有的卡面词汇，不自造样式** —— 约定 §六）
 * - 弹层：`.app-modal` / `.app-modal-wide`（640px）/ `.app-modal-head` / `.app-modal-body`（自带内滚）；
 * - 卡片网格：`.app-belt-grid`（`minmax(240px, 1fr)` 自适应列）；
 * - 卡面：`.app-belt-card`（全仓卡面主族）＋ 卡头 `.app-belt-head` / `.app-belt-head-right`、
 *   说明 `.app-belt-desc`、产物行 `.app-belt-ore`、材料清单 `.app-bp-mats`（学组装机那张卡的版式）；
 * - 徽标：`.app-chip`（＋ `.is-rare` / `.is-exotic`）；按钮 `.app-btn.is-small`（主行动 `.is-primary`）。
 *
 * ⚠ **上一版为什么"简陋"**：我用了一套**根本不存在**的类名（`app-card` / `app-card-grid` /
 * `app-card-name` / `app-card-foot` —— styles.css 里只有 `.app-card-progress`）⇒ 12 张卡退化成
 * 无边框、无内边距、无间距的裸块。这一版逐条改成上面那份真实词汇表。
 * ⚠ **徽标不换行**（skill 的 UX 指引：紧凑标签整行显示、不许折行）⇒ 价格徽标取 `nowrap` 短值。
 *
 * ## 卡面给什么（船长嫌简陋的实质 = 信息量不足）
 * 上一版每张卡只有「图纸名 + 价格 + 按钮」三样。现在按组装机那张卡的**同一套信息层级**补齐：
 * ① 产物名（玩家真正换的东西是插件，不是"图纸"）；② **这枚插件在游戏里的实际效果**
 * （复用装配页同一把尺 `moduleShortEffect`）；③ 制造材料清单 ＋ 每项"现有 ×N"（换之前就知道造得起造不起）；
 * ④ 已学会 / 未学会状态徽标；⑤ 主行动按钮与不可换原因（声望还差多少）。
 */
import { useState } from 'react'
import {
  DSI_FACTION_ID,
  PLUG_BLUEPRINT_COST,
  countModule,
  countWare,
  matNeedCount,
  plugExchangeRowsOf,
  spendableStandingOf,
  standingOf,
} from '@whale/core'
import type { GameEngine } from '../game/engine'
import { tr } from '../i18n/locale'
import { Glyph } from '../ui/Glyphs'
import { toneOfAny } from '../ui/tones'
import { moduleShortEffect } from '../ui/shipInfo'

export function PlugExchangeModal({
  engine,
  onToast,
  onClose,
}: {
  engine: GameEngine
  onToast: (text: string) => void
  onClose: () => void
}): React.JSX.Element {
  /** 本地重算计数：兑换只改 state 两本账与图书架，窗口自身要跟着重画 */
  const [, setTick] = useState(0)
  /**
   * **已兑换（= 已学会）的图纸不再列出**（**2026-09-26 船长令**：「**章鱼人的声望界面，兑换过的图纸
   * 就进行隐藏**」）。判据仍走行模型自带的 `learned`（`plugExchangeRowsOf` 单点：`learnedRecipes`
   * 含该图纸 id）⇒ 界面只做过滤，不新造判定。
   */
  const rows = plugExchangeRowsOf(engine.state, engine.ctx).filter((r) => !r.learned)
  const spendable = spendableStandingOf(engine.state, DSI_FACTION_ID)
  const earned = standingOf(engine.state, DSI_FACTION_ID)
  /**
   * **兑换前确认**（**2026-09-26 船长令**：「**玩家兑换时弹出一个确认，告诉玩家会扣除声望**」）：
   * 待确认的那一行（null = 没在确认）。确认层沿用全仓既有的 `.app-mkt-confirm*` 一族（不新造样式）。
   */
  const [ask, setAsk] = useState<{ moduleId: string; name: string } | null>(null)

  const exchange = (moduleId: string): void => {
    /** 走引擎命令（成功才落盘 ＋ 广播刷新；与 `learnBlueprintAt` 同款） */
    const r = engine.exchangePlugBlueprintAt(moduleId)
    onToast(r.ok ? tr('ui.IndustryPage.123') : (r.error ?? tr('ui.IndustryPage.121', { p1: PLUG_BLUEPRINT_COST })))
    setAsk(null)
    setTick((n) => n + 1)
  }

  return (
    <div className="app-modal-mask" onClick={onClose}>
      <div className="app-modal app-modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="app-modal-head">
          {/**
           * **章鱼人头像（最左侧）**（**2026-09-27 船长令**：「**声望商店内，顶上的标题处，能否加个和通讯内
           * 同款的章鱼人头像。放在最左侧**」）。
           *
           * 与通讯**同源同款**：图形 = `FACTION_OCTOPUS_GLYPH`（`faction-octopus` 线稿，全仓 NPC 头像的那一枚）、
           * 盒子与描边 = 通讯既有的 `.app-comms-avatar`（**不新造样式**），只在**尺寸**上按弹层标题栏收小
           * （标题栏高 40px 上下，56px 的原尺寸会把条子撑开 ⇒ 宽度/高度/圆角走内联，不新增 CSS 类）。
           *
           * ⚠ **不要照抄通讯那个 `tone` 字符串**：通讯侧给的是 `'var(--wui-tone-nav-mail)'`，而色板 token 是
           * **空格三元组** ⇒ 裸 `var()` 当色值用是**无效声明**、颜色会回落（见词典「色板 token 的三层」硬纪律 A）。
           * 这里取包好 `rgb()` 的单点 **`toneOfAny('nav-mail')`**（＝官方深空工业协会的通讯色），才是"同款"的**真色**。
           */}
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span
              className="app-comms-avatar"
              title={tr('ui.Expedition.441')}
              style={{ width: 26, height: 26, borderRadius: 7, marginTop: 0, color: toneOfAny('nav-mail'), borderColor: toneOfAny('nav-mail') }}
            >
              <Glyph name="faction-octopus" size={20} />
            </span>
            <span className="app-report-title">{tr('ui.Expedition.441')}</span>
          </span>
          {/* 两本账并排（船长口径：可支配 / 累计获得）——与卡面价格徽标同色系 */}
          <span className="app-chip" title={tr('ui.IndustryPage.119', { p1: spendable, p2: earned })}>
            {tr('ui.IndustryPage.119', { p1: spendable, p2: earned })}
          </span>
          <button className="app-btn is-small" onClick={onClose}>
            {tr('ui.App.086')}
          </button>
        </div>
        <div className="app-modal-body">
          {rows.length === 0 ? (
            <div className="app-dim app-exp-idle">{tr('ui.IndustryPage.133')}</div>
          ) : (
            <div className="app-belt-grid">
              {rows.map((row) => {
                /**
                 * 卡面要用的三份现算读数（都走 core 单点，不在界面里自己数）：
                 * - `mod`：产物插件定义（图标 / 短效果 / 材料清单的来源）；
                 * - `bp`：图纸定义（材料清单在这里）；蓝图目录用**全目录**（`ctx.blueprints`）——
                 *   兑换来的书还没学会时也必须在卡上列出材料；
                 * - `owned`：这件插件当前持有数（装备库），让玩家看清"已经有两件了"。
                 */
                const mod = engine.ctx.modules.get(row.moduleId)
                const bp = engine.ctx.blueprints.get(row.blueprintId)
                const owned = countModule(engine.state, row.moduleId)
                return (
                  /**
                   * ⚠ 卡面类名的两个**实测注意点**（这一版踩过）：
                   * - **不挂 `is-assembler`**：那条规则带 `content-visibility: auto`（组装机 151 张卡的屏外跳过），
                   *   弹层里只有十来张卡，不需要它；且它会把产物行从金色改回正文色 —— 与"金产物"口径相冲。
                   * - **已学会走 `.app-shelf-card.is-learned`**：`.app-belt-card.is-learned` **不存在**
                   *   （styles.css 里只有书架那一条）；两个类都是全仓卡面族，叠着用才是"学会了"的既有观感。
                   *   状态徽标同理走 `.app-chip.is-learned`（薄荷色，全仓既有）。
                   */
                  <div key={row.moduleId} className={`app-belt-card app-shelf-card${row.learned ? ' is-learned' : ''}`}>
                    {/**
                     * ⚠ **卡头 = 插件名，不是图纸名**（**2026-09-26 船长令**：「**兑换商品内应该重点强调插件的
                     * 效果，而不是消耗材料**」＋「**你将产物和图纸的位置弄反了**」）。
                     *
                     * 上一版照搬组装机那张卡的"卡头＝图纸名"口径 —— 那在组装机里是对的（一张图纸 = 一个配方，
                     * 产物在下面 `产物：` 行），**在本窗口是错的**：玩家来这里挑的是"要哪枚插件"，
                     * 图纸只是兑换的凭据 ⇒ 卡头给插件名，图纸降成下面一行。
                     */}
                    <div className="app-belt-head">
                      <span className="app-belt-name">
                        <Glyph name="plug" size={15} /> {row.name}
                      </span>
                      <span className="app-belt-head-right">
                        {row.learned ? (
                          <span className="app-chip is-learned">{tr('ui.IndustryPage.122')}</span>
                        ) : (
                          <span className="app-chip is-exotic" title={tr('ui.IndustryPage.120')}>
                            {row.cost}
                          </span>
                        )}
                      </span>
                    </div>

                    {/**
                     * **这枚插件的实际效果——本窗口信息层级里的主角**（船长令：「**重点强调插件的效果，
                     * 而不是消耗材料**」）。`.app-belt-feat` 是全仓卡面族里的"特性/效果"行（比说明行更亮），
                     * `is-strong` 再压一档字重 ⇒ "换了它能强多少"第一眼就看到；材料清单排在它后面、字号更小。
                     */}
                    <div className="app-belt-feat is-strong">{mod ? moduleShortEffect(mod) : ''}</div>

                    {/* 图纸行（**凭据**，不是主角）：图纸名 ＋ 已造件数 */}
                    <div className="app-belt-ore">
                      {tr('ui.Industry.135')}
                      {row.blueprintName}
                      <span className="app-dim">
                        （{tr('ui.IndustryPage.125')} {owned.toLocaleString('zh-CN')}）
                      </span>
                    </div>

                    {/* 材料清单（整批所需 ＋ 各项现有）——**次要信息**：换之前能估"造不造得起"即可 */}
                    {bp ? (
                      <ul className="app-bp-mats">
                        {bp.materials.map((need) => {
                          const needCount = matNeedCount(engine.state, need.count)
                          const have = countWare(engine.state, need.itemId)
                          const matName = engine.ctx.items.get(need.itemId)?.name ?? need.itemId
                          return (
                            <li key={need.itemId} className={`app-bp-mat${have < needCount ? ' is-short' : ''}`}>
                              {matName} ×{needCount.toLocaleString('zh-CN')}
                              <span className="app-dim">
                                （{tr('ui.IndustryPage.029')} {have.toLocaleString('zh-CN')}）
                              </span>
                            </li>
                          )
                        })}
                      </ul>
                    ) : null}

                    <div className="app-belt-actions">
                      {/**
                       * **点「兑换图纸」先弹确认**（**2026-09-26 船长令**：
                       * 「玩家兑换时弹出一个确认，告诉玩家会扣除声望」）——
                       * 行内不再有"已学会"分支（学过的行已经被过滤掉了）⇒ 这里只剩两种状态：
                       * 声望够（主行动）／不够（写明还差多少，且不可点）。
                       */}
                      <button
                        className={`app-btn is-small${row.affordable ? ' is-primary' : ''}`}
                        disabled={!row.affordable}
                        onClick={() => setAsk({ moduleId: row.moduleId, name: row.name })}
                      >
                        {row.affordable
                          ? tr('ui.IndustryPage.120')
                          : tr('ui.IndustryPage.121', { p1: row.cost - spendable })}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
      {/**
       * **确认层**（船长令）：标题 = 兑换哪一件；正文两行 = 扣多少 / 扣完还剩多少 ＋ 一句说明
       * （图纸直接进书架、声望不退）。样式整族复用 `.app-mkt-confirm*`（市场卖单那套）。
       */}
      {ask !== null ? (
        <div className="app-mkt-confirm-mask" onClick={() => setAsk(null)}>
          <div className="app-mkt-confirm" onClick={(e) => e.stopPropagation()}>
            <div className="app-mkt-confirm-title">{tr('ui.IndustryPage.134', { p1: ask.name })}</div>
            <div className="app-mkt-confirm-row">
              <span>{tr('ui.Expedition.441')}</span>
              <b>{tr('ui.IndustryPage.119', { p1: spendable, p2: earned })}</b>
            </div>
            <div className="app-mkt-confirm-note">
              {tr('ui.IndustryPage.135', { p1: PLUG_BLUEPRINT_COST, p2: spendable - PLUG_BLUEPRINT_COST })}
              <br />
              {tr('ui.IndustryPage.136')}
            </div>
            <div className="app-mkt-confirm-btns">
              <button className="app-btn is-small" onClick={() => setAsk(null)}>
                {tr('ui.ActivityBar.004')}
              </button>
              <button className="app-btn is-small is-primary" onClick={() => exchange(ask.moduleId)}>
                {tr('ui.IndustryPage.120')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
