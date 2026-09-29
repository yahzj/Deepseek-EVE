/**
 * **「净收益/h」只在调试模式下显示**（**2026-09-29 船长令**：
 * 「之前删掉的净收益/h是否还有留接口？」→「**我只想在调试模式下显示**」）。
 *
 * 沿革（为什么要专门钉一条）：
 * - 这条读数原在组装机/造船厂/精炼/残骸四类卡上（长解释 = `ui.Industry.111` / `ui.IndustryPage.106`）；
 * - **2026-09-23 船长令**「旧的『≈ ISK/h』毛估彻底拿掉（卡面与悬停都不再出现）」把它整段删了
 *   ⇒ 那两个 id 成了**孤儿**（0 调用点）；
 * - 本批按新令**只放回调试模式**：门禁 = `game/debugFlag.debugEnabled()`（本机 origin ∧ 本机开关；
 *   **发布版恒 false**）。
 *
 * 本文件钉两件事（都是"机器判不了但一错就漏给玩家"的）：
 *   ① 门禁真的在唯一组件里（`NetIncomeLine` 首行 `if (!debugEnabled()) return null`）；
 *   ② 三类卡都只经这一个组件出这行读数（**没有旁路**——旁路就等于发布版也漏）。
 *
 * ⚠ 口径（与正式工具 `npm run manufacture:econ` 的「劳动者价值/h」同式）：
 * `(整批产物值 − 整批料成本) ÷ 本批耗时 × 3600`，纯函数单点 = `ui/yieldView.netIskPerHourOf`。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { L10N } from '@whale/data'

const ROOT = join(__dirname, '..', '..', '..')
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8')
/** 去注释（口径同 `arch-guard` / `ui-subs-check`：注释里提到符号名不算调用） */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

describe('净收益/h · 仅调试模式（2026-09-29 船长令）', () => {
  it('① 门禁在唯一组件里：`NetIncomeLine` 必须首行判 `debugEnabled()`', () => {
    const view = read('apps/desktop/src/renderer/src/ui/yieldView.tsx')
    expect(view, '组件存在').toContain('export function NetIncomeLine')
    expect(view, '门禁 = 调试开关（发布版恒 false 的那一个）').toContain('if (!debugEnabled()) return null')
    expect(view, '口径单点存在').toContain('export function netIskPerHourOf')
  })

  it('② 三类卡都只经这一个组件出读数（无旁路 ⇒ 发布版不会漏）', () => {
    // 组装机/造船厂共用 BlueprintCard（Industry.tsx）；精炼卡在 IndustryPage.tsx
    const industry = read('apps/desktop/src/renderer/src/panels/Industry.tsx')
    expect(industry, '组装机/造船厂卡渲染该行').toContain('<NetIncomeLine')
    const page = read('apps/desktop/src/renderer/src/pages/IndustryPage.tsx')
    expect(page, '精炼卡渲染该行').toContain('<NetIncomeLine')
    // 门禁只许在这一个组件里判：哪个调用点自己再判一次 debugEnabled 都是旁路的开始
    // （⚠ 比对前先去注释——两处文件都在注释里解释过这条口径，注释提到符号名不算调用）
    for (const [name, src] of [
      ['Industry.tsx', industry],
      ['IndustryPage.tsx', page],
    ] as const) {
      expect(stripComments(src).includes('debugEnabled'), `${name} 不该自己判门禁（统一在 NetIncomeLine 里判）`).toBe(false)
    }
  })

  it('③ 文案：三条 id 中英齐备（净收益/h · 值 · 调试·本批耗时）', () => {
    expect(L10N['ui.Yield.007']!.zh).toBe('净收益/h')
    expect(L10N['ui.Yield.007']!.en).toBe('Net income/h')
    expect(L10N['ui.Yield.008']!.zh).toContain('{p1}')
    expect(L10N['ui.Yield.008']!.en).toContain('{p1}')
    expect(L10N['ui.Yield.009']!.zh).toContain('调试')
    expect(L10N['ui.Yield.009']!.en).toContain('Debug')
  })
})
