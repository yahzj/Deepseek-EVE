/**
 * 舰船页：我的舰队（耐久/维修/切换驾驶）+ AI 指挥中心 + 空间站商店。
 */
import { useState } from 'react'
import {
  AI_CORE_ORDER,
  aiCoreName,
  aiEfficiency,
  aiSlotsUsed,
  countAiCore,
  goodLockedReason,
  idleAiShipIds,
  isExplored,
  marketGoodOf,
  marketQuote,
  maxAiSlots,
  allFittedIds,
  shipRoleLabel,
} from '@whale/core'
import type { AiCoreType, FleetShipState } from '@whale/core'
import { aiWinPreview, durabilityOf, repairCostIsk, shipDisplayName } from '@whale/core'
import { Panel } from '@whale/ui'
import { ShipHover } from '../ui/shipInfo'
import { Glyph, NAV_TONES, ICO_TONES } from '../ui/Glyphs'
import type { PageProps } from './common'
import { isk } from './common'

/** 市场稀有度中文标签 */
function rarityLabel(rarity: 'common' | 'rare' | 'exotic'): string {
  return rarity === 'common' ? '常驻' : rarity === 'rare' ? '稀有' : '限定奇货'
}

/** 舰船页标签（MapPage/IndustryPage 同款 app-subtabs 规范，2026-09-05） */
export type ShipTab = 'fleet' | 'ai' | 'shop'
const SHIP_TABS: Array<{ key: ShipTab; label: string; icon: string; title?: string }> = [
  { key: 'fleet', label: '我的舰队', icon: 'nav-ship' },
  { key: 'ai', label: 'AI 指挥中心', icon: 'nav-ai', title: 'AI 副船：指派采矿/打捞/掩护巡逻（远征已下线，悬赏请主控出击）' },
  { key: 'shop', label: '舰船市场', icon: 'nav-shop' },
]

export function ShipPage({
  engine,
  onToast,
  tab,
  onTab,
  onGotoMarket,
  onGotoFit,
}: PageProps & {
  tab?: ShipTab
  onTab?: (t: ShipTab) => void
  onGotoMarket?: (goodKey: string) => void
  /** 进入某船的装配页（船长 2026-09-05：舰队卡片按钮直达该船装配） */
  onGotoFit?: (shipId: string) => void
}) {
  const state = engine.state
  const ctx = engine.ctx
  // 标签页（受控可选：App 跳 AI 中心时切到 ai）
  const [localTab, setLocalTab] = useState<ShipTab>('fleet')
  const activeTab = tab ?? localTab
  const setActiveTab = onTab ?? setLocalTab
  // T5：当前展开出售确认的船（同时只展开一艘）
  const [sellConfirmId, setSellConfirmId] = useState<string | null>(null)
  // T7：扫描在途换船＝警告确认（模式甲：确认后先终止扫描——进度保留——再切换）
  const [scanSwitchId, setScanSwitchId] = useState<string | null>(null)
  // T5-B：正在改名（输入框展开）的船实例 + 草稿
  const [renameId, setRenameId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')

  /** 舰队里所有船实例（v17：同型多艘各自成卡；当前驾驶在前） */
  const fleetEntries = Object.entries(state.fleet)
    .map(([uid, entry]) => ({ uid, ship: entry, def: ctx.ships.get(entry.defId ?? uid) }))
    .filter((x): x is { uid: string; ship: FleetShipState; def: NonNullable<ReturnType<typeof ctx.ships.get>> } => x.def !== undefined)
    .sort(
      (a, b) =>
        Number(b.uid === state.shipId) - Number(a.uid === state.shipId) ||
        a.def.tier - b.def.tier ||
        a.uid.localeCompare(b.uid),
    )

  function handleSwitch(id: string): void {
    // 扫描探索在途：先弹确认（终止扫描=已扫窗口进度保留，可续扫），确认后才执行
    if (state.scanning.active) {
      setScanSwitchId(id)
      return
    }
    const r = engine.changeShipAt(id)
    if (!r.ok) onToast(r.error ?? '切换失败', true)
  }

  /** 确认：终止扫描（进度保留）→ 切换驾驶 */
  function confirmScanSwitch(id: string): void {
    setScanSwitchId(null)
    const stop = engine.stopScanNow()
    if (!stop.ok) {
      onToast(stop.error ?? '终止扫描失败，未切换。', true)
      return
    }
    const r = engine.changeShipAt(id)
    if (!r.ok) onToast(r.error ?? '切换失败', true)
    else onToast('已终止扫描（进度保留，可续扫）并切换驾驶。')
  }

  function handleRepair(id: string): void {
    const r = engine.repairShipAt(id)
    if (!r.ok) onToast(r.error ?? '维修失败', true)
    else onToast('维修完成：结构/装甲已修复。')
  }

  /** T5：锁定/解锁防误售 */
  function handleToggleLock(id: string, currentlyLocked: boolean): void {
    const r = engine.lockShipAt(id, !currentlyLocked)
    if (!r.ok) onToast(r.error ?? '操作失败', true)
    else onToast(currentlyLocked ? '已解锁：恢复可出售。' : '已锁定：此船不可出售（防止误售）。')
  }

  function confirmSell(id: string): void {
    const r = engine.sellShipAt(id)
    if (!r.ok) onToast(r.error ?? '出售失败', true)
    else onToast('出售指令已受理：有收购单即时成交；没有则自动挂卖单（可撤单退回机库）。')
    setSellConfirmId(null)
  }

  /** 开始改名（恢复默认名 = 直接提交 null） */
  function startRename(id: string, currentCustom: string | null | undefined): void {
    setRenameId(id)
    setRenameDraft(currentCustom ?? '')
  }
  function submitRename(id: string, name: string | null): void {
    const r = engine.renameShipAt(id, name)
    if (!r.ok) onToast(r.error ?? '改名失败', true)
    else onToast(name === null ? '已恢复默认船名。' : `已命名为「${name.trim()}」。`)
    setRenameId(null)
    setRenameDraft('')
  }

  /** 出售确认前的本船预检：返回 { 模块名列表, 货仓单位 }（两者有任一即禁售并醒目提示） */
  function sellBlockers(shipState: FleetShipState | undefined): { modules: string[]; cargoUnits: number } {
    const modules: string[] = []
    if (shipState) {
      for (const modId of allFittedIds(shipState.fitted)) {
        modules.push(engine.ctx.modules.get(modId)?.name ?? modId)
      }
    }
    const cargoUnits = Object.values(shipState?.cargo ?? {}).reduce((a, b) => a + b, 0)
    return { modules, cargoUnits }
  }

  return (
    <div className="page-stack">
      {/* 舰队 / AI 指挥 / 舰船市场（MapPage/IndustryPage 同款 app-subtabs 规范） */}
      <div className="app-subtabs" role="tablist">
        {SHIP_TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={activeTab === t.key}
            className={`app-subtab${activeTab === t.key ? ' is-active' : ''}`}
            onClick={() => setActiveTab(t.key)}
            title={t.title}
          >
            <span className="app-tab-ico">
              <Glyph name={t.icon} size={15} color={NAV_TONES[t.icon]} />
            </span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {activeTab === 'fleet' ? (
        <>
      {/* ───── 我的舰队 ───── */}
      <Panel
        title="我的舰队"
        right={
          <span className="app-dim">
            {Object.keys(state.fleet).length} 艘 · 当前驾驶：
            {shipDisplayName(state, ctx, state.shipId)}
          </span>
        }
      >
        {scanSwitchId ? (
          <div className="app-sell-confirm" style={{ marginTop: 0, marginBottom: 8 }}>
            <div className="app-sell-warn" style={{ background: 'transparent' }}>
              ⚠ 扫描探索进行中：切换驾驶将终止本次扫描（已扫窗口进度保留，可对该星系续扫）。
            </div>
            <div className="app-sell-confirm-title">确认切换至「{shipDisplayName(state, ctx, scanSwitchId)}」？</div>
            <div className="app-sell-confirm-btns">
              <button className="app-btn is-small is-warn" onClick={() => confirmScanSwitch(scanSwitchId)}>
                终止扫描并切换
              </button>
              <button className="app-btn is-small" onClick={() => setScanSwitchId(null)}>
                取消
              </button>
            </div>
          </div>
        ) : null}
        <div className="app-ship-list">
          {fleetEntries.map(({ uid, ship: shipState, def }) => {
            const dur = durabilityOf(state, uid)
            const armor = shipState.armorPct ?? 1 // P0 承伤持久化：装甲残余（跨场保留）
            const kitCount = (['repairkit-civ', 'repairkit-mil'] as const).reduce((n, id) => n + (shipState.cargo[id] ?? 0), 0)
            const isCurrent = uid === state.shipId
            const repairCost = repairCostIsk(state, uid, engine.ctx)
            const isWorking = uid in state.aiAssignments
            const isLockedShip = state.shipLocks[uid] === true
            const displayName = shipDisplayName(state, engine.ctx, uid)
            const isRenaming = renameId === uid
            const blockers = sellBlockers(shipState)
            const blockCount = blockers.modules.length + (blockers.cargoUnits > 0 ? 1 : 0)
            // 出售估价：当前收购价（无报价就不写死数字）
            const sellGood = marketGoodOf(engine.ctx, 'ship', def.id)
            const sellBuy = sellGood ? marketQuote(state, engine.ctx, sellGood.key).buy : undefined
            const canSell = !isCurrent && !isWorking && !isLockedShip
            return (
              <ShipHover key={uid} ship={def} block>
                <div className={`app-ship-card${isCurrent ? ' is-current' : ''}`}>
                <div className="app-ship-top">
                  <span className="app-ship-name">
                    {displayName}
                    <em className={`app-chip app-role-chip is-${def.role}`}>{shipRoleLabel(def.role)}</em>
                    {def.priceIsk <= 0 && def.id !== 'sandcat' ? <em className="app-belt-flag">定制</em> : null}
                    {isLockedShip ? (
                      <em className="app-chip app-lock-chip" title="已锁定：此船不可出售（防误售）">
                        <span className="app-ico">
                          <Glyph name="ico-lock" size={11} color={ICO_TONES['ico-lock']} />
                        </span>
                        锁定
                      </em>
                    ) : null}
                  </span>
                  <span className="app-ship-top-right">
                    {isCurrent ? (
                      <span className="app-chip">驾驶中</span>
                    ) : isWorking ? (
                      <span className="app-chip">AI 执勤中</span>
                    ) : null}
                    <button
                      className="app-btn is-small"
                      title={`进入「${displayName}」的装配台——可直接为该船装配/卸下装备（不需要切换驾驶）`}
                      onClick={() => onGotoFit?.(uid)}
                    >
                      <span className="app-ico">
                        <Glyph name="nav-fit" size={13} color={NAV_TONES['nav-fit']} />
                      </span>
                      装配
                    </button>
                    {!isRenaming ? (
                      <button
                        className="app-btn is-small"
                        title={shipState.customName ? `已自定义名称——点击改名（或恢复默认）` : '自由改名（免费，10 字内，可重名；同型默认自动带 #N）'}
                        onClick={() => startRename(uid, shipState.customName)}
                      >
                        改名
                      </button>
                    ) : null}
                    <button
                      className={`app-btn is-small app-lock-btn${isLockedShip ? ' is-warn' : ''}`}
                      title={isLockedShip ? '已锁定防误售——点击解锁' : '锁定此船，防止误售（锁定后仍可驾驶/派 AI）'}
                      onClick={() => handleToggleLock(uid, isLockedShip)}
                    >
                      {isLockedShip ? (
                        '解锁'
                      ) : (
                        <>
                          <span className="app-ico">
                            <Glyph name="ico-lock" size={12} color={ICO_TONES['ico-lock']} />
                          </span>
                          锁定
                        </>
                      )}
                    </button>
                  </span>
                </div>
                {isRenaming ? (
                  <div className="app-rename-row">
                    <input
                      className="app-input app-rename-input"
                      value={renameDraft}
                      maxLength={10}
                      autoFocus
                      placeholder="新船名（10 字内，允许重名）"
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') submitRename(uid, renameDraft)
                        else if (e.key === 'Escape') setRenameId(null)
                      }}
                    />
                    <button
                      className="app-btn is-small is-primary"
                      disabled={renameDraft.trim().length === 0}
                      onClick={() => submitRename(uid, renameDraft)}
                    >
                      确定
                    </button>
                    {shipState.customName ? (
                      <button className="app-btn is-small" onClick={() => submitRename(uid, null)}>
                        恢复默认名
                      </button>
                    ) : null}
                    <button className="app-btn is-small" onClick={() => setRenameId(null)}>
                      取消
                    </button>
                  </div>
                ) : null}
                <div className="app-ship-spec">
                  货舱 {def.cargoM3.toLocaleString('zh-CN')} m³ · 循环 {def.cycleSeconds} 秒 × {def.oreUnitsPerCycle} 单位 · 动力 {Math.round(def.agility * 100)}%
                </div>
                <div className="app-dur-row">
                  <div className="app-dur-track">
                    <div className="app-dur-fill" style={{ width: `${Math.round(dur * 100)}%` }} />
                  </div>
                  <span
                    className={`app-dur-text${dur < 0.5 || armor < 0.5 ? ' is-bad' : dur < 1 || armor < 1 ? ' is-mid' : ''}`}
                    title={`结构（=原耐久，与装甲同为跨场保留的损伤；护盾损失不保留）${dur < 1 ? `：结构 ${Math.round(dur * 100)}%` : ''}${armor < 1 ? `，装甲 ${Math.round(armor * 100)}%` : ''}`}
                  >
                    结构 {Math.round(dur * 100)}%{armor < 1 ? ` · 装甲 ${Math.round(armor * 100)}%` : ''}
                  </span>
                  {(dur < 1 || armor < 1) && !isWorking ? (
                    <button
                      className="app-btn is-small is-warn"
                      onClick={() => handleRepair(uid)}
                      disabled={state.wallet.isk < repairCost}
                      title={`维修需 ${repairCost.toLocaleString('zh-CN')} ISK（结构+装甲一并修复；护盾无需维修）`}
                    >
                      维修 {repairCost.toLocaleString('zh-CN')}
                    </button>
                  ) : null}
                  {isCurrent && (dur < 1 || armor < 1) && kitCount > 0 ? (
                    <button
                      className="app-btn is-small"
                      onClick={() => {
                        const r = engine.useRepairKitNow()
                        if (!r.ok) onToast(r.error ?? '使用修理组件失败', true)
                        else onToast('已使用一枚修理组件（基础 HP×容量增幅，民用30/军用70）。')
                      }}
                      title="消耗驾驶船货仓 1 枚修理组件（民用优先）：基础回复 HP×容量增幅（民用30/军用70）——野外/回港前应急可用"
                    >
                      <span className="app-ico">
                        <Glyph name="ico-cross" size={12} color={ICO_TONES['ico-cross']} />
                      </span>
                      组件修复 ×{kitCount}
                    </button>
                  ) : null}
                </div>
                {canSell ? (
                  sellConfirmId === uid ? (
                    /* T5 二次确认：醒目标出货舱/装配未清空的阻止原因 */
                    <div className="app-sell-confirm">
                      <div className="app-sell-confirm-title">确认出售「{displayName}」？</div>
                      <div className="app-dim app-sell-confirm-note">
                        将按当前市场收购价即时成交；没有收购单时自动转为限价卖单（可随时撤销退回机库）。
                        {sellBuy !== undefined ? ` 预计到手约 ${isk(sellBuy)} ISK（税后以实际成交计）。` : ''}
                      </div>
                      {blockers.modules.length > 0 ? (
                        <div className="app-sell-warn">
                          ⚠ 该船仍装配着装备（{blockers.modules.join('、')}），必须先卸下才能出售！
                        </div>
                      ) : null}
                      {blockers.cargoUnits > 0 ? (
                        <div className="app-sell-warn">
                          ⚠ 货仓里还有 {blockers.cargoUnits.toLocaleString('zh-CN')} 单位货物——请先清空或卸入仓库！
                        </div>
                      ) : null}
                      <div className="app-sell-confirm-btns">
                        <button
                          className="app-btn is-small is-warn"
                          disabled={blockCount > 0}
                          title={blockCount > 0 ? '先卸下装备并清空货仓才能出售' : '确认按上述条件出售'}
                          onClick={() => confirmSell(uid)}
                        >
                          确认出售
                        </button>
                        <button className="app-btn is-small" onClick={() => setSellConfirmId(null)}>
                          取消
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="app-ship-bottom">
                      <span className="app-dim">货仓与装备随船保存</span>
                      <div className="app-ship-bottom-btns">
                        <button
                          className="app-btn is-small"
                          onClick={() => setSellConfirmId(uid)}
                          title="出售前需确认；有装备/货物会在此处醒目提示"
                        >
                          市价出售
                        </button>
                        <button className="app-btn is-small is-primary" onClick={() => handleSwitch(uid)}>
                          切换驾驶
                        </button>
                      </div>
                    </div>
                  )
                ) : !isCurrent && !isWorking ? (
                  /* T5-A 修正（船长反馈）：锁定只禁出售——锁定的闲置船仍可切换驾驶 */
                  <div className="app-ship-bottom">
                    <span className="app-dim">货仓与装备随船保存</span>
                    <div className="app-ship-bottom-btns">
                      <span className="app-chip app-lock-chip" title="已锁定：此船不可出售（防误售）">
                        <span className="app-ico">
                          <Glyph name="ico-lock" size={11} color={ICO_TONES['ico-lock']} />
                        </span>
                        已锁定
                      </span>
                      <button className="app-btn is-small is-primary" onClick={() => handleSwitch(uid)}>
                        切换驾驶
                      </button>
                    </div>
                  </div>
                ) : null}
                </div>
              </ShipHover>
            )
          })}
        </div>
      </Panel>
      </>
      ) : null}

      {activeTab === 'ai' ? <AiCommandPanel engine={engine} onToast={onToast} /> : null}

      {activeTab === 'shop' ? (
        <Panel
          title="舰船市场"
          right={<span className="app-dim">现货看订单簿 · 无货可挂收购单自动等补货</span>}
        >
        <div className="app-ship-list">
          {engine.ships
            .filter((def) => {
              for (const good of engine.ctx.marketGoods.values()) {
                if (good.kind === 'ship' && good.refId === def.id) return true
              }
              return false
            })
            .map((def) => {
              // v17：可重复拥有同型——统计机库内该型艘数（实例 uid 或以 defId 为键的第 1 艘）
              const ownedCount = Object.keys(state.fleet).filter(
                (k) => state.fleet[k]!.defId === def.id || k === def.id,
              ).length
              const good = [...engine.ctx.marketGoods.values()].find((g) => g.kind === 'ship' && g.refId === def.id)
              const quote = good ? marketQuote(state, engine.ctx, good.key) : null
              const ask = quote?.sell
              const lock = good ? goodLockedReason(state, good) : null
              return (
                <ShipHover key={def.id} ship={def} block>
                  <div className="app-ship-card">
                  <div className="app-ship-top">
                    <span className="app-ship-name">
                      {def.name}
                      <em className={`app-chip app-role-chip is-${def.role}`}>{shipRoleLabel(def.role)}</em>
                    </span>
                    <span className={`app-chip${good?.rarity === 'common' ? '' : good?.rarity === 'rare' ? ' is-rare' : ' is-exotic'}`}>
                      {good ? rarityLabel(good.rarity) : ''}
                    </span>
                  </div>
                  <div className="app-ship-spec">
                    货舱 {def.cargoM3.toLocaleString('zh-CN')} m³ · 循环 {def.cycleSeconds} 秒 × {def.oreUnitsPerCycle} 单位 · 动力 {Math.round(def.agility * 100)}%
                  </div>
                  <div className="app-ship-desc">{def.description}</div>
                  <div className="app-ship-bottom">
                    {ask !== undefined ? (
                      <span className="app-ship-price">现货 {isk(ask)} ISK</span>
                    ) : (
                      <span className="app-dim">暂无现货 · 挂收购单自动等货</span>
                    )}
                    {ownedCount > 0 ? (
                      <span className="app-chip" title="机库里已有同型舰船；可再购一艘（同型多艘自动编号）">
                        机库 ×{ownedCount}
                      </span>
                    ) : null}
                    {lock ? (
                      <span className="app-chip is-exotic" title={lock}>
                        <span className="app-ico">
                          <Glyph name="ico-lock" size={11} color={ICO_TONES['ico-lock']} />
                        </span>
                        {lock}
                      </span>
                    ) : null}
                    {good ? (
                      <button
                        className={`app-btn is-small${lock ? '' : ' is-primary'}`}
                        disabled={!onGotoMarket}
                        title={lock ?? '前往市场页查看该舰船订单——自动聚焦搜索该船，现货/挂单都在市场操作'}
                        onClick={() => onGotoMarket?.(good.key)}
                      >
                        去市场查看 / 下单
                      </button>
                    ) : null}
                  </div>
                  </div>
                </ShipHover>
              )
            })}
        </div>
      </Panel>
      ) : null}
    </div>
  )
}

/* ═══════════════ AI 指挥中心 ═══════════════ */

function AiCommandPanel({ engine, onToast }: PageProps) {
  const state = engine.state
  const slots = maxAiSlots(state, engine.ctx)
  const used = aiSlotsUsed(state)
  const idleShips = idleAiShipIds(state)

  const [shipId, setShipId] = useState('')
  const [coreType, setCoreType] = useState<AiCoreType>('basic')
  const [mode, setMode] = useState<'mining' | 'expedition' | 'salvage'>('mining')
  const [beltId, setBeltId] = useState(engine.belts[0]?.id ?? '')
  const [anomalyId, setAnomalyId] = useState('')
  const [salvageGalaxyId, setSalvageGalaxyId] = useState('')

  function handleBuyCore(): void {
    const r = engine.buyBasicCoreAt()
    if (!r.ok) onToast(r.error ?? '购买失败', true)
    else onToast('购买指令已受理：现货立即入核心库；无现货已挂收购单（到货自动入库）。')
  }

  function handleAssign(): void {
    if (!shipId) {
      onToast('先选择一艘空闲舰船。', true)
      return
    }
    const r =
      mode === 'mining'
        ? engine.assignAiMiningAt(shipId, coreType, beltId)
        : mode === 'salvage'
          ? engine.assignAiSalvageAt(shipId, coreType, salvageGalaxyId)
          : engine.assignAiExpeditionAt(shipId, coreType, anomalyId)
    if (!r.ok) onToast(r.error ?? '指派失败', true)
    else onToast('AI 任务已下达。')
  }

  /** 取消执行中的 AI 任务（船长 2026-09-05：活动栏简略后须在 AI 指挥中心内可直接取消） */
  function handleCancelAi(sid: string): void {
    if (engine.cancelAiTaskAt(sid)) onToast('AI 任务已取消（核心已归还）。')
    else onToast('取消失败：任务状态异常。', true)
  }

  /**
   * 可选悬赏（入口过滤与核心同源：声望 + 已亲手首胜；是否可派给某副船 = 该船自身装配的
   * AI 最终成功率 ≥80%，逐船现算并显示在副船下拉框内——不再按"先选船"过滤目标列表）。
   */
  const pickableAnomalies =
    mode === 'expedition'
      ? engine.anomalies
          .filter((a) => {
            if (standingOfState(state) < a.standingReq) return false
            if (!state.completedBounties.includes(a.id)) return false // 需手动首胜解锁自动远征
            return true
          })
          .sort((a, b) => a.threat - b.threat)
      : []
  const selAnomaly =
    mode === 'expedition' && anomalyId ? engine.anomalies.find((a) => a.id === anomalyId) : undefined
  /** 该副船（按自身装配/技能，favor 口径）对当前所选悬赏的最终成功率；未选悬赏 = null */
  const aiChanceOf = (id: string): number | null => (selAnomaly ? aiWinPreview(state, engine.ctx, selAnomaly, id) : null)

  return (
    <Panel
      title="AI 指挥中心"
      right={<span className="app-dim">名额 {used}/{slots}</span>}
    >
      {/* 名额与核心库 */}
      <div className="app-ai-status">
        <span className="app-dim">
          「人工智能专家」Lv{state.skills.trained['ai-expert'] ?? 0} → 可同时指挥 {slots} 艘副船
          {slots === 0 ? '（先到「技能」页训练该技能）' : ''}
        </span>
        <div className="app-core-badges">
          {AI_CORE_ORDER.map((type) => (
            <span key={type} className={`app-chip${countAiCore(state, type) > 0 ? '' : ' is-dim'}`}>
              {aiCoreName(type)} ×{countAiCore(state, type)}（{Math.round(aiEfficiency(state, engine.ctx, type) * 100)}%）
            </span>
          ))}
          <button className="app-btn is-small is-primary" onClick={handleBuyCore}>
            市场购入基础核心{marketQuote(state, engine.ctx, 'core-basic').sell !== undefined ? ` · ${isk(marketQuote(state, engine.ctx, 'core-basic').sell!)} ISK` : '（暂缺货·可挂单）'}
          </button>
        </div>
      </div>

      {/* 指派表单 */}
      {slots > 0 ? (
        <div className="app-ai-assign">
          <select
            className="app-select"
            value={shipId}
            onChange={(e) => setShipId(e.target.value)}
            title={
              mode === 'expedition' && selAnomaly
                ? '成功率 = 该副船按自身装配/技能的 AI 最终成功率（含 favor）；低于 80% 不可自动远征'
                : '选择空闲舰船'
            }
          >
            <option value="">
              {mode === 'expedition' && selAnomaly ? `— 选副船（远征 ${selAnomaly.name}）—` : '— 选择空闲舰船 —'}
            </option>
            {idleShips.map((id) => {
              const rate = aiChanceOf(id)
              const ok = rate === null || rate >= 0.8
              return (
                <option key={id} value={id} disabled={!ok}>
                  {shipDisplayName(state, engine.ctx, id)}（结构 {Math.round(durabilityOf(state, id) * 100)}%
                  {rate === null ? '' : ok ? ` · 成功率 ${Math.round(rate * 100)}%` : ` · 成功率 ${Math.round(rate * 100)}%（<80% 不可派）`}）
                </option>
              )
            })}
          </select>
          <select className="app-select" value={coreType} onChange={(e) => setCoreType(e.target.value as AiCoreType)}>
            {AI_CORE_ORDER.filter((t) => countAiCore(state, t) > 0).map((t) => (
              <option key={t} value={t}>{aiCoreName(t)}（{Math.round(aiEfficiency(state, engine.ctx, t) * 100)}%）</option>
            ))}
          </select>
          <select
            className="app-select"
            value={mode}
            onChange={(e) => setMode(e.target.value as 'mining' | 'expedition' | 'salvage')}
          >
            <option value="mining">采矿任务</option>
            <option value="salvage">打捞任务</option>
            {/* AI 远征软下线（船长 2026-09-05）：选项保留但禁选；悬赏请主控亲自出击 */}
            <option value="expedition" disabled title="已下线：AI 自动打悬赏收益过高——悬赏请主控亲自出击">
              远征任务（已下线）
            </option>
          </select>
          {mode === 'mining' ? (
            <select className="app-select" value={beltId} onChange={(e) => setBeltId(e.target.value)}>
              {engine.belts.map((b) => {
                const standing = standingOfState(state)
                // 与星图页矿带卡片同一套锁定：声望 或 所在星系未探索（V13）
                const unexplored = b.galaxyId ? !isExplored(state, b.galaxyId) : false
                const locked = (b.standingReq ?? 0) > standing || unexplored
                return (
                  <option key={b.id} value={b.id} disabled={locked}>
                    {unexplored
                      ? `✧ ${b.name}（所在星系未探索——先到出港页扫描）`
                      : locked
                        ? `✕ ${b.name}（需声望 ${b.standingReq}，当前 ${standing}）`
                        : `${b.name}（${engine.ctx.items.get(b.oreId)?.name}）`}
                  </option>
                )
              })}
            </select>
          ) : mode === 'salvage' ? (
            <select className="app-select" value={salvageGalaxyId} onChange={(e) => setSalvageGalaxyId(e.target.value)}>
              <option value="">— 选星系（需已探索且有敌群残骸） —</option>
              {[...engine.ctx.galaxies.values()]
                .filter((g) => isExplored(state, g.id) && engine.anomalies.some((a) => a.galaxyId === g.id))
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
            </select>
          ) : (
            <select
              className="app-select"
              value={anomalyId}
              onChange={(e) => {
                const id = e.target.value
                setAnomalyId(id)
                // 已选副船若对该目标成功率 <80%（不达自动远征门槛）→ 清空让玩家重选
                if (id && shipId) {
                  const a = engine.anomalies.find((x) => x.id === id)
                  if (a && aiWinPreview(state, engine.ctx, a, shipId) < 0.8) setShipId('')
                }
              }}
              title="悬赏需已亲手首胜；副船成功率按其自身装配现算（见左侧舰船下拉）"
            >
              <option value="">— 选悬赏（声望·已首胜） —</option>
              {pickableAnomalies.map((a) => (
                <option key={a.id} value={a.id}>
                  {engine.ctx.galaxies.get(a.galaxyId)?.name}·{a.name}（威胁 {a.threat}）
                </option>
              ))}
            </select>
          )}
          <button
            className="app-btn is-primary is-small"
            onClick={handleAssign}
            disabled={
              !shipId ||
              (mode === 'expedition' && !anomalyId) ||
              (mode === 'salvage' && !salvageGalaxyId)
            }
          >
            指派任务
          </button>
        </div>
      ) : (
        <div className="app-dim app-inv-empty">人工智能专家 Lv0：先训练技能，再购买基础 AI 核心即可指挥第一艘副船。</div>
      )}

      {/* 执行中列表 */}
      <div className="app-bay-title">执行中（{used}）</div>
      {used === 0 ? (
        <div className="app-dim app-inv-empty">没有正在执行的 AI 任务。</div>
      ) : (
        <ul className="app-inv-list">
          {Object.entries(state.aiAssignments).map(([sid, assignment]) => {
            const task = assignment.task
            const eff = aiEfficiency(state, engine.ctx, assignment.coreType)
            let desc = ''
            if (task.kind === 'mining') {
              const belt = engine.ctx.belts.get(task.beltId)
              const phaseLabel = task.phase === 'returning' ? '返航中' : task.phase === 'outbound' ? '出航中' : '采掘中'
              desc = `采矿 ${belt?.name ?? task.beltId} · ${phaseLabel} · 本趟 ${task.tripUnits} 单位`
            } else if (task.kind === 'expedition') {
              const a = engine.ctx.anomalies.get(task.anomalyId)
              const remain = Math.max(0, task.finishAtGameMs - state.gameMs)
              desc = `远征 ${a?.name ?? task.anomalyId} · 剩余约 ${Math.floor(remain / 60_000)} 分钟`
            } else if (task.kind === 'salvage') {
              const g = engine.ctx.galaxies.get(task.galaxyId)
              const phaseLabel = task.phase === 'returning' ? '返航卸货' : task.phase === 'outbound' ? '出航' : '打捞中'
              desc = `打捞 ${g?.name ?? task.galaxyId} · ${phaseLabel}（本趟约 ${Math.round(task.tripM3 * 10) / 10} m³）`
            } else {
              const g = engine.ctx.galaxies.get(task.galaxyId)
              desc =
                task.phase === 'out'
                  ? `前往 ${g?.name ?? task.galaxyId} 掩护巡逻（去程中）`
                  : `掩护巡逻：${g?.name ?? task.galaxyId}`
            }
            return (
              <li key={sid} className="app-inv-row">
                <div className="app-inv-main">
                  <span className="app-inv-name">{shipDisplayName(state, engine.ctx, sid)}</span>
                  <span className="app-inv-count">
                    {desc} · {aiCoreName(assignment.coreType)}（效率 {Math.round(eff * 100)}%）
                  </span>
                </div>
                <div className="app-inv-btns">
                  <button
                    className="app-btn is-small is-warn"
                    onClick={() => handleCancelAi(sid)}
                    title={`取消 ${shipDisplayName(state, engine.ctx, sid)} 的 AI 任务：副船召回，核心归还核心库`}
                  >
                    取消任务
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

function standingOfState(state: { standings: Record<string, number> }): number {
  return state.standings['dsi'] ?? 0
}
