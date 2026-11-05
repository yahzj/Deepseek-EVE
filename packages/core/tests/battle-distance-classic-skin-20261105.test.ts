import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const root = new URL('../../../', import.meta.url)
const read = (path: string): string => readFileSync(new URL(path, root), 'utf8')
const css = read('apps/desktop/src/renderer/src/styles.css')

describe('新版战斗距离轴沿用旧版皮肤', () => {
  it('移除新版距离轴外框和数字标签皮肤，保留共用刻度和读数', () => {
    expect(css).not.toContain('.app-root.is-layout-modern .app-bts-axisTrack {')
    expect(css).not.toContain('.app-root.is-layout-modern .app-bts-cur-chip {')
    expect(css).toContain('.app-bts-scale {')
    expect(css).toContain('.app-bts-cur-chip {')
    const shared = read('apps/desktop/src/renderer/src/features/combat/battleDistanceAxis.css')
    expect(shared).not.toMatch(/is-layout-(?:modern|classic)/)
  })

  it('新版范围滑条及浏览器伪元素皮肤均排除战斗滑块', () => {
    const selectors = css.match(/[^{}]+\{/g)!.map(selector => selector.replace(/\/\*[\s\S]*?\*\//g, '').trim())
    const range = selectors.filter(selector => selector.includes('.app-root.is-layout-modern input[type="range"]'))
    expect(range).toHaveLength(5)
    for (const selector of range) expect(selector).toContain(':where(:not(.app-bts-knob))')
    expect(css).toContain('.app-bts-knob::-webkit-slider-runnable-track { height: 30px; background: transparent; border: none; }')
    expect(css).toContain('.app-root.is-mobile-rot .app-bts-knob::-webkit-slider-runnable-track { height: 46px; background: transparent; border: none; }')
  })

  it('新版全局零圆角规则不影响距离轴，其他元素保留原规则优先级', () => {
    expect(css).toContain('.app-root.is-layout-modern *:where(:not(.app-bts-axisTrack, .app-bts-axisTrack *))')
    expect(css).not.toContain('.app-root.is-layout-modern *,')
    expect(css).toContain('border-radius: 0 !important;')
  })

  it.each(['classic', 'modern'])('%s生成件与共用皮肤保持一致且不残留新版覆盖', layout => {
    const generated = read(`apps/desktop/src/renderer/src/ui/layout-css/styles-${layout}.css`)
    expect(generated).not.toContain('.app-root.is-layout-modern .app-bts-axisTrack {')
    expect(generated).not.toContain('.app-root.is-layout-modern .app-bts-cur-chip {')
    expect(generated).toContain('input[type="range"]:where(:not(.app-bts-knob))::-webkit-slider-runnable-track')
  })
})
