/**
 * **一次性舰船蓝图 → 产物舰 id 对照**（正式工具 · **2026-09-24 入库**）。
 *
 * 用途：给玩家补发成品船（`tools/save-grant-ships.ts`）前核对"哪张图对应哪艘船"——
 * 一次性舰船图的 id 是 `sbp-once-*`、产物舰 id 是 `sh-*`，两者不同名，补账时不能靠猜。
 *
 * 用法：`npm run bp:ship-ids`（或 `npx tsx tools/blueprint-ship-ids.ts`）· **只读**。
 *
 * **版本自检**：游戏版本 v0.1.0 · 存档结构 v31 · 最后核对 2026-09-24 · 最后跑过 2026-09-24
 */
import { buildSimContext } from '@whale/data'

const ctx = buildSimContext()
for (const bpId of ['sbp-once-thresher', 'sbp-once-hammerhead', 'sbp-once-bullshark', 'sbp-once-nautilus']) {
  const bp = ctx.shipBlueprints.get(bpId)
  if (!bp) {
    console.log(`${bpId.padEnd(22)} 不存在`)
    continue
  }
  const ship = ctx.ships.get(bp.shipId)
  console.log(
    `${bpId.padEnd(22)} → shipId=${bp.shipId.padEnd(16)} 舰名=${ship?.name ?? '（目录里没有这艘船）'} singleUse=${bp.singleUse === true}`,
  )
}
