import { useState } from 'react'
import {
  DSI_FACTION_ID,
  PLUG_BLUEPRINT_COST,
  UNIVERSAL_BLACKBOX_COST,
  UNIVERSAL_BLACKBOX_ITEM_ID,
  countModule,
  countWare,
  matNeedCount,
  materialDisplayIdOf,
  materialGroupIdsOf,
  plugExchangeRowsOf,
  spendableStandingOf,
  standingOf,
} from '@whale/core'
import type { GameEngine } from '../game/engine'
import { tr, cmdText } from '../i18n/locale'
import { Glyph } from '../ui/Glyphs'
import { toneOfAny } from '../ui/tones'
import { moduleShortEffect } from '../ui/shipInfo'

export function PlugExchangeBody({ engine, onToast }: { engine: GameEngine; onToast: (text: string) => void }): React.JSX.Element {
  const [, setTick] = useState(0)
  const rows = plugExchangeRowsOf(engine.state, engine.ctx).filter((r) => !r.learned)
  const spendable = spendableStandingOf(engine.state, DSI_FACTION_ID)
  const earned = standingOf(engine.state, DSI_FACTION_ID)
  const [ask, setAsk] = useState<{ kind: 'box' | 'blueprint'; moduleId?: string; name: string } | null>(null)
  const boxPrice = UNIVERSAL_BLACKBOX_COST
  const boxOwned = countWare(engine.state, UNIVERSAL_BLACKBOX_ITEM_ID)
  const buyBox = (): void => {
    const r = engine.exchangeUniversalBlackBoxAt()
    onToast(r.ok ? tr('ui.IndustryPage.144') : (cmdText(r) || tr('ui.IndustryPage.121', { p1: boxPrice })))
    setAsk(null)
    setTick((n) => n + 1)
  }

  const exchange = (moduleId: string): void => {
    const r = engine.exchangePlugBlueprintAt(moduleId)
    onToast(r.ok ? tr('ui.IndustryPage.123') : (cmdText(r) || tr('ui.IndustryPage.121', { p1: PLUG_BLUEPRINT_COST })))
    setAsk(null)
    setTick((n) => n + 1)
  }

  return (
    <>
      {rows.length === 0 ? <div className="app-dim app-exp-idle">{tr('ui.IndustryPage.137')}</div> : null}
      <div className="app-belt-grid">
        {/* **通用黑匣卡**：图纸兑完仍可购买；它是所有插件共用的料 */}
        <div className="app-belt-card app-shelf-card">
          <div className="app-belt-head">
            <span className="app-belt-name">
              <Glyph name="plug" size={15} /> {tr('ui.IndustryPage.141')}
            </span>
            <span className="app-belt-head-right">
              <span className="app-chip is-exotic" title={tr('ui.IndustryPage.120')}>
                {boxPrice}
              </span>
            </span>
          </div>
          {/* ⟪文案调整 2026-10-02⟫ 「与墨潮旗舰黑匣互为替代」→「与各族的旗舰黑匣互为替代」
              （依据 = 船长 2026-10-02 令「甲」：黑匣一件族一件，光环那件同样顶料） */}
          <div className="app-belt-feat is-strong">{tr('ui.IndustryPage.142')}</div>
          <div className="app-belt-ore">
            {tr('ui.IndustryPage.143')}
            <span className="app-dim"> {boxOwned.toLocaleString('zh-CN')}</span>
          </div>
          <div>
            {/* ⚠ 2026-09-29 船长报障后改：**先确认再扣声望**（与图纸卡同一套口径），不再一步直扣 */}
            <button
              className="app-btn is-small is-primary"
              disabled={spendable < boxPrice}
              onClick={() => setAsk({ kind: 'box', name: tr('ui.IndustryPage.141') })}
            >
              {tr('ui.IndustryPage.145')}
            </button>
          </div>
        </div>
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

              {/* 材料清单（整批所需 ＋ 各项现有）——**次要信息**：换之前能估"造不造得起"即可
                  ⚠ **等价组同尺**（2026-09-29 船长报障同批）：名字走 `materialDisplayIdOf`、
                  "现有"读数走组内合计 —— 与组装机那张卡、与引擎的缺料提示**完全同一把尺**，
                  免得这里说"墨潮旗舰黑匣"、那儿说"通用黑匣"。 */}
              {bp ? (
                <ul className="app-bp-mats">
                  {bp.materials.map((need) => {
                    const needCount = matNeedCount(engine.state, need.count)
                    const groupIds = materialGroupIdsOf(need.itemId)
                    const displayId = materialDisplayIdOf(engine.state, need.itemId)
                    const have = groupIds.reduce((sum, id) => sum + countWare(engine.state, id), 0)
                    const matName = engine.ctx.items.get(displayId)?.name ?? displayId
                    const split =
                      groupIds.length > 1
                        ? groupIds
                            .map((id) => ({ id, n: countWare(engine.state, id) }))
                            .filter((x) => x.n > 0)
                            .map((x) => `${engine.ctx.items.get(x.id)?.name ?? x.id} ${x.n.toLocaleString('zh-CN')}`)
                            .join(tr('ui.MatterTechTab.017'))
                        : ''
                    return (
                      <li key={need.itemId} className={`app-bp-mat${have < needCount ? ' is-short' : ''}`}>
                        {matName} ×{needCount.toLocaleString('zh-CN')}
                        <span className="app-dim">
                          （{tr('ui.IndustryPage.029')} {have.toLocaleString('zh-CN')}
                          {split !== '' ? `（${split}）` : ''}）
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
                  onClick={() => setAsk({ kind: 'blueprint', moduleId: row.moduleId, name: row.name })}
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
      {/**
       * **确认层**（船长令）：标题 = 兑换哪一件；正文两行 = 扣多少 / 扣完还剩多少 ＋ 一句说明
       * （声望不退）。样式整族复用 `.app-mkt-confirm*`（市场卖单那套）。
       * ⚠ 它是 `position: fixed; z-index: 96` 的**独立遮罩**（不属于弹层内滚区）⇒ 在子页里同样盖在全屏上。
       *
       * ⚠ **两件商品同一套确认**（**2026-09-29 船长报障**：「声望商店中，购买通用黑匣没有警告」）：
       * 图纸那两句讲"兑换即学会"，黑匣那两句讲"直接入物品仓库"——**只有措辞不同，扣款口径与不可退一样**。
       */}
      {ask !== null ? (
        <div className="app-mkt-confirm-mask" onClick={() => setAsk(null)}>
          <div className="app-mkt-confirm" onClick={(e) => e.stopPropagation()}>
            <div className="app-mkt-confirm-title">{tr('ui.IndustryPage.138', { p1: ask.name })}</div>
            <div className="app-mkt-confirm-row">
              <span>{tr('ui.Expedition.441')}</span>
              <b>{tr('ui.IndustryPage.119', { p1: spendable, p2: earned })}</b>
            </div>
            <div className="app-mkt-confirm-note">
              {ask.kind === 'box' ? (
                <>
                  {tr('ui.IndustryPage.146', { p1: boxPrice, p2: spendable - boxPrice })}
                  <br />
                  {tr('ui.IndustryPage.147')}
                </>
              ) : (
                <>
                  {tr('ui.IndustryPage.139', { p1: PLUG_BLUEPRINT_COST, p2: spendable - PLUG_BLUEPRINT_COST })}
                  <br />
                  {tr('ui.IndustryPage.140')}
                </>
              )}
            </div>
            <div className="app-mkt-confirm-btns">
              <button className="app-btn is-small" onClick={() => setAsk(null)}>
                {tr('ui.ActivityBar.004')}
              </button>
              <button
                className="app-btn is-small is-primary"
                onClick={() => (ask.kind === 'box' ? buyBox() : exchange(ask.moduleId ?? ''))}
              >
                {tr('ui.IndustryPage.120')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

export function PlugExchangeModal({
  engine,
  onToast,
  onClose,
}: {
  engine: GameEngine
  onToast: (text: string) => void
  onClose: () => void
}): React.JSX.Element {
  const spendable = spendableStandingOf(engine.state, DSI_FACTION_ID)
  const earned = standingOf(engine.state, DSI_FACTION_ID)
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
          <PlugExchangeBody engine={engine} onToast={onToast} />
        </div>
      </div>
    </div>
  )
}
