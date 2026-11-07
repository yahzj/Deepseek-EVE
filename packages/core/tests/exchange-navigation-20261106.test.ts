import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ROOT } from './helpers/save-shell'

describe('股市跨布局导航', () => {
  it('classic 与 modern 共用未过滤的主导航，股市位于末位', () => {
    const app = readFileSync(resolve(ROOT, 'apps/desktop/src/renderer/src/App.tsx'), 'utf8')
    expect(app).toContain("{ key: 'exchange', label: '股市', icon: 'nav-exchange' }")
    expect(app).toContain('navItems={NAV_ITEMS}')
    expect(app).not.toContain("NAV_ITEMS.filter((item) => item.key !== 'exchange')")
  })
})
