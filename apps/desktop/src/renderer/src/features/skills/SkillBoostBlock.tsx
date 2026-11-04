import { SYNAPTIC_ACCELERANT_ITEM_ID, SYNAPTIC_ACCELERANT_MUL, consumableStockOf } from '@whale/core'
import type { GameEngine } from '../../game/engine'
import { Glyph, itemGlyphName } from '../../ui/Glyphs'
import { RowGlyph } from '../../ui/itemView'
import { cmdText, tr } from '../../i18n/locale'
import { fmtDuration } from '../../i18n/fmt'

export function SkillBoostBlock({ engine, onToast }: { engine: GameEngine; onToast: (m: string, bad?: boolean) => void }) {
  const state = engine.state
  const remainMs = engine.synapticAccelerantRemainMs()
  const stock = consumableStockOf(state, SYNAPTIC_ACCELERANT_ITEM_ID)
  const def = engine.ctx.items.get(SYNAPTIC_ACCELERANT_ITEM_ID)
  const mul = Math.round(1 / SYNAPTIC_ACCELERANT_MUL)
  /**
   * **循环使用开关**（**2026-10-01 船长令**：「给技能加速页面添加一个循环使用的开关。当当前加速效果
   * 过时时，自动使用相同效果的技能加速消耗品，离线期间也一样」）。
   * ⚠ 开关的判定与扣料**全在 core**（`consumables.syncBoostRenew`）：这里只读状态、只写状态，
   * 不自己判"该不该补"、也不自己扣道具。
   */
  const autoRenew = engine.boostAutoRenewOn()
  return (
    <div className="app-boost-block">
      {/* 顶部＝当前生效与剩余时间 —— **只在加速剂生效时整条出现**
          （**2026-10-02 船长令**：「因为之后还会获得 3 倍和 4 倍的加速剂，所以抬头需要在使用了加速剂
          才会出现」）⇒ 本条只剩"生效中"这一态，原先的"未生效"态（倍率 ＋ `ui.boost.002`「未生效」
          ＋ `ui.boost.007` 效果说明）连同那两条 id 一起撤掉。
          ⚠ 口径与**活动栏那枚加速读数**一致 —— 它本来就是 `remainMs > 0` 才出现（同族先例）。
          ⚠ 「自动续用」开关挂在这一条里，**跟着一起收**（船长同日四答取乙）：没生效就看不到开关
          ⇒ 用法是"先手动用一枚 ⇒ 抬头出现 ⇒ 这时才开得了自动续用"。
          core 侧没有卡死态：开关开着时 `syncBoostRenew` 会在剩余不足以练完当前这一级之前就补上
          （`remainMs` 不会掉到 0）；真没料了由它自己关掉开关并写一条 `core.consumable.015`。 */}
      {remainMs > 0 ? (
      <div className="app-boost-now is-on" role="status">
        <span className="app-boost-now-head">
          <Glyph name={iconKeyOfBoost()} size={15} color="currentColor" />
          <b>{tr('ui.ActivityBar.066', { p1: mul })}</b>
          <span className="app-dim">{tr('ui.boost.005', { p1: fmtDuration(remainMs) })}</span>
        </span>
        <span className="app-dim app-boost-now-note">
          {tr('ui.ActivityBar.067', { p1: fmtDuration(remainMs) })}
        </span>
        {/* 开关本体：与「使用」按钮同一套 `.app-btn` 形态（`is-small` ＋ `is-on`），不自造控件。
            ⚠ **2026-10-02 修（船长报障「自动续用不是开关」）**：文案**随状态显示开/关**
            （`ui.boost.010`/`011`）——原先无论开关状态都只印「自动续用」四个字，
            玩家看不出它到底开没开；`is-on` 高亮与 `aria-pressed` 照旧。 */}
        <button
          className={`app-btn is-small${autoRenew ? ' is-on' : ''}`}
          aria-pressed={autoRenew}
          title={tr('ui.boost.009')}
          onClick={() => {
            const r = engine.setBoostAutoRenewNow(!autoRenew)
            if (!r.ok) onToast(cmdText(r) || tr('ui.boost.008'), true)
          }}
        >
          {tr(autoRenew ? 'ui.boost.010' : 'ui.boost.011')}
        </button>
      </div>
      ) : null}
      {/* 下方：持有的加速类道具清单（今天只有突触加速剂；将来加同类道具就往这一支里塞行 ——
          **2026-10-02 船长令**：「之后还会获得 3 倍和 4 倍的加速剂」，届时在 `<ul>` 里按同一格
          再加一条 `<li>`，并把 core 的「使用 / 倍率 / 自动续用」泛化成按道具 id 取（那批要动存档
          字段，属四步闸门，船长同日四答取甲：本轮不做）） */}
      <div className="app-boost-list-head">{tr('ui.boost.003')}</div>
      {stock <= 0 ? (
        <div className="app-dim app-inv-empty">{tr('ui.boost.004')}</div>
      ) : (
        <ul className="app-inv-list">
          <li className="app-inv-row">
            <div className="app-inv-main">
              <span className="app-inv-name">
                {def !== undefined ? <RowGlyph glyph={itemGlyphName(def.id, def.kind)} /> : null} {def?.name ?? SYNAPTIC_ACCELERANT_ITEM_ID}
              </span>
              <span className="app-inv-count">{tr('ui.boost.006', { p1: stock.toLocaleString('zh-CN') })}</span>
              {/* **行内效果说明**（**2026-10-02 船长令**：「下方的持有的加速道具内也要说明不同的加速剂
                  的效果」；同日四答取**乙：直接渲染该道具的物品说明全文**）——一份文案三处同源
                  （物品页悬停卡 / 货仓页 / 本页都读 `def.description`，中英随 `overlayMap` 自动跟随），
                  将来 ×3/×4 各自带自己的说明 ⇒ 这一行一个字都不用改。 */}
              {def?.description !== undefined ? (
                <span className="app-dim app-inv-note">{def.description}</span>
              ) : null}
            </div>
            <div className="app-inv-btns">
              <button
                className="app-btn is-small is-warn"
                title={tr('ui.boost.012')}
                onClick={() => {
                  const r = engine.useSynapticAccelerantNow()
                  if (!r.ok) onToast(cmdText(r) || tr('ui.boost.012'), true)
                  else onToast(tr('ui.boost.013'))
                }}
              >
                {tr('ui.ItemsPage.056')}
              </button>
            </div>
          </li>
        </ul>
      )}
    </div>
  )
}

function iconKeyOfBoost(): string {
  return itemGlyphName(SYNAPTIC_ACCELERANT_ITEM_ID, 'consumable')
}
