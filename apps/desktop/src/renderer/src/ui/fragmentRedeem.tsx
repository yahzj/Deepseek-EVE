/**
 * **「逆向解锁」按钮**（2026-09-19 玩家报障修）。
 *
 * 玩家原话：「玩家回收残骸集齐了 25 个蓝图碎片，但是找不到在哪换成蓝图」。
 * 病根：核心里 `redeemFragments`（碎片 → 永久蓝图）与 6 条 `FRAGMENT_RECIPES` 一直都在、用例也全绿，
 * **但渲染层一次都没接线**（`redeemFragments` 在 `apps/desktop` 下 0 处、`逆向` 二字 0 处），
 * 物品页「蓝图碎片」那一行只有一个禁用的「不在市场目录」⇒ 碎片只能烂在仓库；
 * 而碎片说明当时还写着"可在母港逆向解锁"——**文案承诺了一个不存在的入口**（MK3 三本书只从碎片出，
 * 这条路一断就等于 MK3 无法自制）。
 *
 * 口径：按钮状态**全部读 core 单点** `engine.fragmentRedeemRows()`（现有片数 / 门槛 / 已掌握 / 在空间站），
 * 与兑命令 `engine.redeemFragmentsAt()` 同源——界面不许自己再算一遍 `countItem + countWare`，
 * 否则会出现"按钮亮着、一点就报碎片不足"。物品页（仓库）与货仓页共用本组件，避免两处漂移。
 */
import type { ReactElement } from 'react'
import type { GameEngine } from '../game/engine'
import { tr, cmdText } from '../i18n/locale'

export function RedeemFragmentButton({
  engine,
  itemId,
  onToast,
}: {
  engine: GameEngine
  /** 碎片物品 id（`frag-<装备 id>`）；不是碎片 ⇒ 本组件返回 null（调用方保留原有按钮） */
  itemId: string
  onToast: (text: string, isError?: boolean) => void
}): ReactElement | null {
  const row = engine.fragmentRedeemRows().find((r) => r.fragmentItemId === itemId)
  if (!row) return null
  if (row.learned) {
    return (
      <button
        className="app-btn is-small"
        disabled
        title={tr("ui.fragmentRedeem.001", { p1: row.blueprintName })}
      >
        {tr("ui.fragmentRedeem.002")}
      </button>
    )
  }
  const enough = row.have >= row.need
  const tip = !enough
    ? tr("ui.fragmentRedeem.003", { p1: row.need - row.have, p2: row.have, p3: row.need, p4: row.blueprintName })
    : row.ready
      ? tr("ui.fragmentRedeem.004", { p1: row.need, p2: row.blueprintName })
      : tr("ui.fragmentRedeem.005", { p1: row.have, p2: row.need })
  return (
    <button
      className={`app-btn is-small${row.ready ? ' is-primary' : ''}`}
      disabled={!row.ready}
      title={tip}
      onClick={() => {
        const r = engine.redeemFragmentsAt(row.moduleId)
        if (!r.ok) onToast(cmdText(r) || tr('ui.fragmentRedeem.008'), true)
        else onToast(tr("ui.fragmentRedeem.006", { p1: row.blueprintName }))
      }}
    >
      {tr("ui.fragmentRedeem.007")} {row.have}/{row.need}
    </button>
  )
}
