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
        title={`「${row.blueprintName}」已掌握：配方永久生效，这一路的碎片不再需要（也不会再掉落）。`}
      >
        已解锁配方
      </button>
    )
  }
  const enough = row.have >= row.need
  const tip = !enough
    ? `还差 ${row.need - row.have} 片（现有 ${row.have}/${row.need}）——碎片来自残骸回收的高威胁彩头；集齐后点这里换成「${row.blueprintName}」永久蓝图。`
    : row.ready
      ? `消耗 ${row.need} 片（货仓 + 仓库一起扣）换成「${row.blueprintName}」永久蓝图，之后可在工业页组装机无限次制造。`
      : `碎片已够（${row.have}/${row.need}）——逆向研究需停靠空间站（母港或已建成副站）。`
  return (
    <button
      className={`app-btn is-small${row.ready ? ' is-primary' : ''}`}
      disabled={!row.ready}
      title={tip}
      onClick={() => {
        const r = engine.redeemFragmentsAt(row.moduleId)
        if (!r.ok) onToast(r.error ?? '逆向研究失败', true)
        else onToast(`逆向研究完成：已解锁「${row.blueprintName}」，可到工业页组装机无限次制造。`)
      }}
    >
      逆向解锁 {row.have}/{row.need}
    </button>
  )
}
