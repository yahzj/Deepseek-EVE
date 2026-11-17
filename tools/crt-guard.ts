import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const failures: string[] = []
const check = (condition: boolean, message: string) => {
  if (!condition) failures.push(message)
}
const read = (file: string) => readFileSync(join(ROOT, file), 'utf8')

const styles = read('apps/desktop/src/renderer/src/styles.css')
const crtEffect = read('apps/desktop/src/renderer/src/ui/crtEffect.ts')
const layouts = [
  'apps/desktop/src/renderer/src/ui/layout-css/styles-modern.css',
  'apps/desktop/src/renderer/src/ui/layout-css/styles-classic.css',
].map((file) => ({ file, css: read(file) }))

const rules: Array<{ selector: string; body: string }> = []
for (const match of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  rules.push({ selector: match[1].trim(), body: match[2] })
}
const crtRules = rules.filter((rule) => rule.selector.includes('data-ui-crt'))
const crtBackdrops: string[] = []
for (const rule of crtRules) {
  for (const match of rule.body.matchAll(/^\s*backdrop-filter:\s*([^;]+);/gm)) crtBackdrops.push(match[1].trim())
}
const warpFilters = crtBackdrops.filter((value) => value.includes('url(#whale-crt-warp)'))
const otherFilters = crtBackdrops.filter((value) => !value.includes('url(#whale-crt-warp)') && value !== 'none')
check(warpFilters.length === 1, `整屏曲面滤镜应只声明一次，实际 ${warpFilters.length} 次`)
check(otherFilters.length === 0, `CRT 不应再叠加其它整屏 backdrop-filter：${otherFilters.join(' / ')}`)
const warpOffRule = crtRules.find((rule) => rule.selector.includes("data-ui-crt-warp-off='1'"))
check(warpOffRule !== undefined && /backdrop-filter:\s*none/.test(warpOffRule.body), '缺少淡出后撤掉滤镜的规则（data-ui-crt-warp-off + backdrop-filter: none）')
const busyRule = crtRules.find((rule) => rule.selector.includes("data-ui-crt-scroll='1'") && rule.selector.includes('::before'))
check(busyRule !== undefined && /opacity:\s*0/.test(busyRule.body), '缺少滚动/战斗期间的淡出规则（data-ui-crt-scroll + opacity: 0）')

const roll = /@keyframes crt-roll\s*\{([\s\S]*?)\}/.exec(styles)?.[1] ?? ''
check(roll.includes('transform'), '滚动荧光带必须用 transform 动画（background-position 会每帧重绘整屏）')
check(!roll.includes('background-position'), '滚动荧光带不应再使用 background-position 动画')

const layerSelectors = [
  "html[data-ui-crt='on']::before",
  "html[data-ui-crt='on']::after",
  "html[data-ui-crt='on'] body::before",
  "html[data-ui-crt='on'] body::after",
]
for (const selector of layerSelectors) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const block = new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`).exec(styles)?.[1] ?? ''
  check(block.includes('pointer-events: none'), `CRT 图层缺少 pointer-events: none：${selector}`)
}

for (const { file, css } of layouts) {
  check(css.includes('whale-crt-warp'), `布局样式未包含 CRT 曲面规则（是否忘记跑 npm run ui:layout-css）：${file}`)
  check(css.includes('data-ui-crt-scroll'), `布局样式未包含 CRT 降级规则（是否忘记跑 npm run ui:layout-css）：${file}`)
}

check(crtEffect.includes('feImage'), 'CRT 滤镜应使用 feImage 位移贴图')
check(!crtEffect.includes('feGaussianBlur'), 'CRT 滤镜不应引入高斯模糊（每帧成本高）')
check(crtEffect.includes('feDisplacementMap'), 'CRT 滤镜应使用 feDisplacementMap 做桶形位移')
const scale = Number(/setAttribute\('scale',\s*'(\d+)'\)/.exec(crtEffect)?.[1] ?? Number.NaN)
check(Number.isFinite(scale) && scale <= 32, `位移强度应在 32 以内（当前 ${Number.isNaN(scale) ? '无法解析' : scale}）`)
const mapSize = Number(/const size = (\d+)/.exec(crtEffect)?.[1] ?? Number.NaN)
check(Number.isFinite(mapSize) && mapSize <= 256, `位移贴图不应大于 256（当前 ${Number.isNaN(mapSize) ? '无法解析' : mapSize}）`)

if (failures.length > 0) {
  for (const message of failures) console.error(`✗ ${message}`)
  process.exitCode = 1
} else {
  console.log('✓ CRT 静态契约通过（单层整屏滤镜 / 滚动降级 / transform 动画 / 图层不拦截点击 / 布局样式已生成）')
}
