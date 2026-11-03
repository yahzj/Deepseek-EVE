/**
 * 确定性检查：验证 Classic 布局下活动栏（ActivityBar）与技能训练、待机状态的样式属性
 * 确保完全 100% 对齐原版单行横向流视觉基准，防止因 Modern 窄列卡片式布局串味。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const ROOT = join(HERE, '..')
const CLASSIC_CSS_PATH = join(ROOT, 'apps/desktop/src/renderer/src/ui/layout-css/styles-classic.css')

interface Rule {
  sel: string
  raw: string
  body: string
}

function parseRules(text: string): Rule[] {
  const out: Rule[] = []
  let i = 0
  while (i < text.length) {
    const open = text.indexOf('{', i)
    if (open < 0) break
    const rawSel = text.slice(i, open)
    const sel = rawSel.replace(/\/\*[\s\S]*?\*\//g, '').trim().replace(/\s+/g, ' ')
    let depth = 0
    let j = open
    while (j < text.length) {
      if (text[j] === '{') depth++
      else if (text[j] === '}') {
        depth--
        if (depth === 0) break
      }
      j++
    }
    let ss = i
    const lead = /^\s*/.exec(rawSel)
    if (lead) ss = i + lead[0].length
    if (sel) out.push({ sel, raw: text.slice(ss, j + 1), body: text.slice(open + 1, j) })
    i = j + 1
  }
  return out
}

function parseDeclarations(body: string): Map<string, { value: string; important: boolean }> {
  const map = new Map<string, { value: string; important: boolean }>()
  // 剥掉注释
  const clean = body.replace(/\/\*[\s\S]*?\*\//g, '')
  const parts = clean.split(';')
  for (const part of parts) {
    const colon = part.indexOf(':')
    if (colon < 0) continue
    const prop = part.slice(0, colon).trim().toLowerCase()
    const valRaw = part.slice(colon + 1).trim()
    if (!prop || !valRaw) continue
    const important = valRaw.includes('!important')
    const value = valRaw.replace(/!important/g, '').trim()
    map.set(prop, { value, important })
  }
  return map
}

function runCheck() {
  console.log('[check-classic-activitybar] 开始读取 styles-classic.css...')
  const css = readFileSync(CLASSIC_CSS_PATH, 'utf8')
  const rules = parseRules(css)

  /**
   * 收集特定选择器的层叠后样式。
   * 规则顺序：越靠后出现，且在同等或者更高特异性/important下覆盖前面。
   */
  function resolveProperty(targetSel: string, prop: string): string | undefined {
    let resolved: { value: string; important: boolean } | undefined
    for (const r of rules) {
      if (r.sel === targetSel) {
        const decls = parseDeclarations(r.body)
        const d = decls.get(prop)
        if (d) {
          if (!resolved || (!resolved.important && d.important) || (resolved.important === d.important)) {
            resolved = d
          }
        }
      }
    }
    return resolved?.value
  }

  const assertions: Array<{
    sel: string
    prop: string
    expected: string | RegExp
    desc: string
  }> = [
    // 1. 活动项 .app-activitybar-item
    {
      sel: '.app-root.is-layout-classic .app-activitybar-item',
      prop: 'flex-direction',
      expected: 'row',
      desc: '活动项 flex-direction 必须复位为 row 单行流（非 column 竖向卡片）',
    },
    {
      sel: '.app-root.is-layout-classic .app-activitybar-item',
      prop: 'display',
      expected: 'flex',
      desc: '活动项 display 必须为 flex',
    },
    {
      sel: '.app-root.is-layout-classic .app-activitybar-item',
      prop: 'align-items',
      expected: 'center',
      desc: '活动项 align-items 必须居中对齐 center',
    },
    {
      sel: '.app-root.is-layout-classic .app-activitybar-item',
      prop: 'justify-content',
      expected: 'space-between',
      desc: '活动项 justify-content 必须两端对齐 space-between',
    },
    {
      sel: '.app-root.is-layout-classic .app-activitybar-item',
      prop: 'box-sizing',
      expected: 'border-box',
      desc: '活动项 box-sizing 必须为 border-box',
    },

    // 2. 单行容器 .app-activitybar-line
    {
      sel: '.app-root.is-layout-classic .app-activitybar-line',
      prop: 'flex-wrap',
      expected: 'nowrap',
      desc: '活动行 flex-wrap 必须为 nowrap（非 wrap 折行）',
    },
    {
      sel: '.app-root.is-layout-classic .app-activitybar-line',
      prop: 'display',
      expected: 'flex',
      desc: '活动行 display 必须为 flex',
    },

    // 3. 内容包裹 .app-activitybar-main
    {
      sel: '.app-root.is-layout-classic .app-activitybar-main',
      prop: 'flex',
      expected: /1\s+1\s+auto/,
      desc: '活动内容主体 flex 必须为 1 1 auto',
    },
    {
      sel: '.app-root.is-layout-classic .app-activitybar-main',
      prop: 'min-width',
      expected: '0',
      desc: '活动内容主体 min-width 必须为 0',
    },

    // 4. 标题 .app-activitybar-label
    {
      sel: '.app-root.is-layout-classic .app-activitybar-label',
      prop: 'white-space',
      expected: 'nowrap',
      desc: '活动标题 white-space 必须为 nowrap',
    },
    {
      sel: '.app-root.is-layout-classic .app-activitybar-label',
      prop: 'flex',
      expected: /0\s+0\s+auto/,
      desc: '活动标题 flex 必须为 0 0 auto',
    },

    // 5. 说明 .app-activitybar-sub
    {
      sel: '.app-root.is-layout-classic .app-activitybar-sub',
      prop: 'white-space',
      expected: 'nowrap',
      desc: '活动说明 white-space 必须为 nowrap',
    },
    {
      sel: '.app-root.is-layout-classic .app-activitybar-sub',
      prop: 'text-overflow',
      expected: 'ellipsis',
      desc: '活动说明 text-overflow 必须为 ellipsis',
    },

    // 6. 细条横向进度条 .app-activitybar-track
    {
      sel: '.app-root.is-layout-classic .app-activitybar-track',
      prop: 'flex',
      expected: /1\s+1\s+auto/,
      desc: '活动进度条 flex 必须为 1 1 auto 自适应横贯',
    },
    {
      sel: '.app-root.is-layout-classic .app-activitybar-track',
      prop: 'width',
      expected: 'auto',
      desc: '活动进度条 width 必须为 auto（解除 90px 固定宽度扼杀）',
    },
    {
      sel: '.app-root.is-layout-classic .app-activitybar-track',
      prop: 'height',
      expected: '4px',
      desc: '活动进度条 height 必须为 4px 细条',
    },

    // 7. 时间读数 .app-activitybar-time
    {
      sel: '.app-root.is-layout-classic .app-activitybar-time',
      prop: 'white-space',
      expected: 'nowrap',
      desc: '活动时间读数 white-space 必须为 nowrap',
    },

    // 8. 操作按钮 .app-activitybar-item .app-btn
    {
      sel: '.app-root.is-layout-classic .app-activitybar-item .app-btn',
      prop: 'white-space',
      expected: 'nowrap',
      desc: '活动项操作按钮 white-space 必须为 nowrap',
    },
    {
      sel: '.app-root.is-layout-classic .app-activitybar-item .app-btn',
      prop: 'margin-left',
      expected: 'auto',
      desc: '活动项操作按钮 margin-left 必须为 auto 靠右对齐',
    },

    // 9. 待机文案 .app-activitybar-idle
    {
      sel: '.app-root.is-layout-classic .app-activitybar-idle',
      prop: 'white-space',
      expected: 'nowrap',
      desc: '待机文案 white-space 必须为 nowrap 不折行',
    },
    {
      sel: '.app-root.is-layout-classic .app-activitybar-idle',
      prop: 'display',
      expected: 'block',
      desc: '待机文案 display 必须为 block',
    },
  ]

  let passed = 0
  let failed = 0

  for (const a of assertions) {
    const val = resolveProperty(a.sel, a.prop)
    const ok = val !== undefined && (typeof a.expected === 'string' ? val === a.expected : a.expected.test(val))
    if (ok) {
      console.log(`  ✅ [PASS] ${a.desc} (得到 "${val}")`)
      passed++
    } else {
      console.error(`  ❌ [FAIL] ${a.desc} (期望: ${a.expected}, 实际得到: "${val}")`)
      failed++
    }
  }

  console.log(`\n[check-classic-activitybar] 检查完成：通过 ${passed} / 失败 ${failed}`)
  if (failed > 0) {
    process.exit(1)
  }
}

runCheck()
