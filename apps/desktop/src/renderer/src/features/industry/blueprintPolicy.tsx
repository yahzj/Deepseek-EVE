import { manualSlotOf, stationActivityStartBlockReason } from '@whale/core'
import type { GameState } from '@whale/core'
import type { GameEngine } from '../../game/engine'
import { cmdText } from '../../i18n/locale'
import { tr } from '../../i18n/locale'

/* ═══════════════ 组装机（2026-09-08 与精炼炉同款劳动者制：主控亲自 / AI 核心驱动；多蓝图 + 同蓝图多线） ═══════════════ */

/* 三张筛选表（门类 / 子类 / 图纸 / 学会）**已按基线⑤收编到 `ui/itemSubs.ts`**（2026-09-19 丙组）：
 * `MANU_TABS` · `manuSubsOf` · `BLUEPRINT_USE_TABS` · `BLUEPRINT_LEARN_TABS`。
 * 「图纸」与「学会」两个下级维度的「全部」键统一为 `SUB_ALL`（基线②）。
 *
 * ⚠ **2026-10-01：`bpFilterKeysOf` 也搬进 `ui/itemSubs.ts` 了** —— 它原先只住在本文件（下面的注释
 * 却写着"单点"），而工业 HUD 页的新书架也要同一把尺 ⇒ 提升为真单点（旧页与 HUD 页共用一份实现）。 */

/**
 * **虫洞专属图纸**（`bp-wh-*` / `sbp-wh-*`）——船长 2026-09-14：「虫洞专属的蓝图市场上没有卖，建议改为跳转虫洞。
 * 如果玩家声望不达标，就无法跳转」⇒ 这类卡不给"市场求购"（那里买不到），改给**去虫洞（遗迹打捞）**按钮 +
 * **虫洞解锁声望闸**（`WORMHOLE_SCAN_UNLOCK_STANDING`，与扫描虫洞页同一本账）。
 */
export function isWormholeBlueprint(bpId: string): boolean {
  return /^(bp|sbp)-wh-/.test(bpId)
}

/** 主控此刻不能"亲自再开一条制造线"的原因（null = 可开；AI 核心驱动不受此限；
 * 与精炼炉卡的手动判定同口径：手动工作位全局限 1 条（精炼炉/回收炉/制造线共用））。
 *
 * ⚠ **2026-09-21 船长令改口径**（「统一为能够直接切换（自动取消当前活动）」）：这里**不再**列
 * 「开采 / 打捞 / 远征 / 掩护巡逻 / 返航途中」——前两类**可自动停**（点下去先停掉它再开线 + 统一日志），
 * 远征由 core 的统一判据直接拒，返航途中是锁定态里的一条（但在 core 侧判）。界面只保留"同一个手动
 * 工作位"那两条：它们**不算切换活动**，停掉会丢掉手上那一批 ⇒ 照旧硬拒、由玩家自己决定。
 * 真正的把关单点在 core（`activityGate`）。 */
export function manualBuildNote(state: GameState, engine: GameEngine): string | null {
  /** 2026-10-02 模块化：判据改走 core 单点 `manualSlotOf`（返回值即"被哪一族的线占着"），
   *  不再各写一份 `.some(active && pilot)`；行为与旧实现等价（名册条目都是 active、停线即删，无 inactive 残留）。
   *  ⚠ 新增 `lab` 分支 = 行为口径对齐（经典页三张卡 + HUD 一致：主控开实验室时组装机手动键也置灰；
   *  core 本来就拒绝，这里只是少一次无效点击）。 */
  const slot = manualSlotOf(state)
  if (slot === 'manufacturing') return tr("ui.Industry.025")
  if (slot === 'refine') return tr("ui.Industry.026")
  if (slot === 'lab') return tr('ui.hud.212')
  const blocked = stationActivityStartBlockReason(state, engine.ctx, 'manufacturing')
  if (blocked) return cmdText(blocked)
  return null
}
