import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ROOT } from './helpers/save-shell'

describe('股市跨布局导航', () => {
  it('classic 与 modern 共用主导航，股市位于末位；仅在交易所不可用时隐藏入口', () => {
    const app = readFileSync(resolve(ROOT, 'apps/desktop/src/renderer/src/App.tsx'), 'utf8')
    expect(app).toContain("{ key: 'exchange', label: '股市', icon: 'nav-exchange' }")
    // 2026-11-08 船长令「交易所不可用时自动隐藏股市入口」：可用时仍传完整 NAV_ITEMS，
    // 不可用时只过滤掉 exchange 这一项；两种布局共用同一份导航。
    expect(app).toContain(
      "navItems={exchangeAvailable ? NAV_ITEMS : NAV_ITEMS.filter((item) => item.key !== 'exchange')}",
    )
  })
})
