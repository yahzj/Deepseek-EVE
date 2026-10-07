import { PLANET_TEXT_IDS } from '@whale/core'
import { tr } from '../i18n/locale'

export function pt(key: string): string {
  return tr(PLANET_TEXT_IDS[key] ?? PLANET_TEXT_IDS['unknown']!)
}
