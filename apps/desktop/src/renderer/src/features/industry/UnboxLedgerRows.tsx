import { type ReactNode } from 'react'
import type { GameEngine } from '../../game/engine'
import type { UnboxBatchRecord } from '../../game/unboxLedger'
import '../../styles-unbox-ledger.css'
import { InfoHover, ItemHover, ModuleHover } from '../../ui/shipInfo'
import { blueprintHoverLines } from '../../ui/marketGoodHover'
import { fmtInt } from '../../i18n/fmt'
import { tr } from '../../i18n/locale'

/* 残骸回收按**档位**（普通 / 稀有）——2026-09-14 船长选甲；档名 2026-09-16 收口为「稀有残骸」。
 * 2026-09-19 乙组：表已按基线⑤收编到 `ui/itemSubs.ts`（`WRECK_SUBS`），物品页仓库 /
 * 手册物品图鉴 / 市场 三处读的是同一张表 ⇒ 本文件不再自带该表（标签仍走唯一表 id）。 */


/**
 * 主控此刻不能"亲自运转一台新炉"的原因（null = 可开；AI 核心驱动不受此限）。
 *
 * ⚠ **2026-09-21 船长令改口径**（「统一为能够直接切换（自动取消当前活动）」）：这里**不再**列
 * 「开采 / 打捞 / 远征 / 掩护巡逻」——它们要么**可自动停**（点下去会先停掉它再开炉，写一条统一日志），
 * 要么由 core 的统一判据直接拒（远征）。界面只管**位置**与**锁定态**这两类"点了也白点"的：
 * 野外/航行途中点不了炉子（`awayGalaxy` 非空），换港返航途中是统一判据里的锁定态。
 * 真正的把关单点在 core（`activityGate`）⇒ 这里置灰与否不再决定能否开工，只是少给玩家一次无效点击。
 */
/**
 * 一张精炼炉卡片（矿石/气体/冰/残骸统一；矿带卡结构 + 每台炉=一个劳动者单位）。
 * v20 语义（船长 2026-09-05）：同资源可多单位同时运转（主控 1 台 + 每枚 AI 核心 1 台）；
 * 2026-09-08 船长定：同时启用的 AI 核心总数受 AI 核心上限技能约束（与 AI 副船任务共用），
 * 核心库存只决定拥有/效率档。
 * 原料不锁定、每批实时扣取——运转中的单位以"名册行"列出（各自批进度条 + 停），
 * 下方按钮可继续加开单位；没有单位的卡保持静态数据与启动区。
 */
export function UnboxLedgerRows({ engine, record }: { engine: GameEngine; record?: UnboxBatchRecord }): ReactNode {
  const rows = record?.outputs ?? []
  if (rows.length === 0) return <div className="app-dim app-unbox-ledger-empty">{tr('ui.IndustryPage.150')}</div>
  return (
    <ul className="app-inv-list app-unbox-ledger-rows">
      {rows.map(({ itemId: id, units }) => {
        const item = engine.ctx.items.get(id)
        const module = engine.ctx.modules.get(id)
        const blueprint = engine.ctx.blueprints.get(id) ?? engine.ctx.shipBlueprints.get(id)
        const label = item?.name ?? module?.name ?? blueprint?.name ?? id
        const content = item
          ? <ItemHover item={item} nameOf={(itemId) => engine.ctx.items.get(itemId)?.name}>{label}</ItemHover>
          : module
            ? <ModuleHover mod={module}>{label}</ModuleHover>
            : blueprint
              ? <InfoHover {...blueprintHoverLines(engine.ctx, blueprint)}>{label}</InfoHover>
              : <span>{label}</span>
        return (
          <li className="app-inv-row app-unbox-ledger-row" key={id}>
            <span className="app-unbox-ledger-name">{content}</span>
            <strong className="app-unbox-ledger-qty">×{fmtInt(units)}</strong>
          </li>
        )
      })}
    </ul>
  )
}
