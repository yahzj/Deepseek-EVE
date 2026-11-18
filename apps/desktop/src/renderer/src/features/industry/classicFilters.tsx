import '../../styles-unbox-ledger.css'
import { tr } from '../../i18n/locale'

export type FurnaceTab = 'all' | 'ore' | 'wreck' | 'box'

export const FURNACE_TABS: Array<{ key: FurnaceTab; label: string }> = [
  { key: 'all', get label() { return tr("ui.IndustryPage.001") } },
  { key: 'ore', get label() { return tr("ui.IndustryPage.002") } },
  { key: 'wreck', get label() { return tr("ui.IndustryPage.003") } },
  { key: 'box', get label() { return tr("ui.IndustryPage.004") } },
]

export type SubOpt = { key: string; label: string }

export const ORE_KIND_LABEL: Record<string, string> = {
  get ore() { return tr("ui.IndustryPage.005") },
  get gas() { return tr("ui.IndustryPage.006") },
  get ice() { return tr("ui.IndustryPage.007") },
}
