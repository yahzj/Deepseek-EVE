import type { ReactElement } from 'react'
import type { GameEngine } from '../game/engine'
import { tr, cmdText } from '../i18n/locale'

export function RedeemFragmentButton({
  engine,
  itemId,
  onToast,
}: {
  engine: GameEngine
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
