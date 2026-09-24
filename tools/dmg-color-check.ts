/**
 * **伤害类型配色契约体检**（正式工具 · 2026-09-24 船长报障后入库）。
 *
 * 船长原话：「我发现新问题关于伤害类型颜色，不知道什么时候改错位了，**原先动能是黄色，能量是蓝色的**」
 * ＋玩家反馈：「他的**动能武器和高爆打能量弹药**」。
 *
 * 根因（两处报障同一个）：界面里有**两套**伤害类型徽标底色——
 * - `app-a-*`（弹药徽标）＋弹道/飘字/射程弧的 `DMG_COLOR`：**按类型配色**（动能=金 / 爆破=橙 / 能量=青）；
 * - `app-d-*`（悬浮卡上的伤害类型徽标）：v172 起写的是 **"dmg type = hp layer colors"**
 *   （动能→盾蓝 / 爆破→甲红 / 能量→结构黄）——**与前者正好相反**。
 * 于是同一个「动能」在悬浮卡上是蓝的、在弹药徽标上是金的；玩家把它读成能量，顺手选错弹药档。
 *
 * 现口径（本工具把它钉死）：**伤害类型 = 弹药类型 = 同一套底色**，两族在 `styles.css` 里**合并成同一条规则**
 * （结构上不可能再各写一份而漂移）；**层位色**（盾蓝 / 甲红 / 结构黄）只留给 `.app-p-*` 与血条。
 *
 * 判据（报错即红）：
 *   ① `.app-d-<系>` 与 `.app-a-<系>` 必须解析到**同一个 `--wui-*` token**（三系各一条）；
 *   ② 每个主题里三系底色**两两不同**，且**动能不比能量更蓝**（动能 r ≥ b、能量 b > r）——
 *      这正是"错位"的形状（错位时动能=蓝、能量=黄，②会立刻红）。
 *
 * 另出**读数**：逐主题打印三系色值 ＋ `DMG_COLOR`（弹道/飘字）用的 tone 值，供船长一眼核对。
 *
 * 用法：`npm run ui:dmg-color`（挂在 `ui:theme-check` 链上）· **只读**，不写任何文件。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CSS_CHIPS = join(process.cwd(), 'apps', 'desktop', 'src', 'renderer', 'src', 'styles.css')
const CSS_PALETTE = join(process.cwd(), 'packages', 'ui', 'src', 'index.css')

const TYPES = ['kinetic', 'explosive', 'plasma'] as const
type DmgType = (typeof TYPES)[number]

const errors: string[] = []
const check = (ok: boolean, msg: string): void => {
  if (!ok) errors.push(msg)
}

/** 拆出 CSS 里的规则（选择器 + 声明体），按文件顺序；**先去掉注释**，否则注释会粘进选择器文本 */
function rulesOf(css: string): Array<{ sels: string[]; body: string }> {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const out: Array<{ sels: string[]; body: string }> = []
  for (const m of bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    out.push({ sels: m[1]!.split(',').map((s) => s.trim()), body: m[2]! })
  }
  return out
}

/** 选择器串里有没有**恰好**这一条（`^`/`,` 起、`,`/`$` 止，避开 `.app-d-kinetic-x` 这类前缀命中） */
function hasSelector(rawSels: string, sel: string): boolean {
  return new RegExp(`(^|,)\\s*${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*($|,)`).test(rawSels)
}

/* ① 从 styles.css 取 `.app-d-<系>` / `.app-a-<系>` 用的 token（后出现的规则覆盖先出现的） */
const chipCss = readFileSync(CSS_CHIPS, 'utf8')
const chipToken: Partial<Record<`d${DmgType}` | `a${DmgType}`, string>> = {}
for (const { sels, body } of rulesOf(chipCss)) {
  const raw = sels.join(', ')
  for (const t of TYPES) {
    for (const family of ['d', 'a'] as const) {
      if (!hasSelector(raw, `.app-${family}-${t}`)) continue
      const bg = /background\s*:\s*rgb\(var\((--wui-[\w-]+)\)\)/.exec(body)
      if (bg) chipToken[`${family}${t}`] = bg[1]!
    }
  }
}
for (const t of TYPES) {
  const d = chipToken[`d${t}`]
  const a = chipToken[`a${t}`]
  check(
    d !== undefined && a !== undefined && d === a,
    `「${t}」两族底色不是同一个 token：app-d=${d ?? '（没解析到）'} · app-a=${a ?? '（没解析到）'}`,
  )
}

/* ② 从色板取每个主题下的实际色值（`:root` = 基线，`[data-theme='x']` 覆盖） */
const paletteCss = readFileSync(CSS_PALETTE, 'utf8')
type Block = { label: string; theme: string | null; tokens: Map<string, string> }
const blocks: Block[] = []
for (const { sels, body } of rulesOf(paletteCss)) {
  const sel = sels.join(', ')
  const theme = /\[data-theme='([^']+)'\]/.exec(sel)?.[1] ?? null
  if (!sel.includes(':root') && theme === null) continue
  const tokens = new Map<string, string>()
  for (const m of body.matchAll(/(--wui-[\w-]+)\s*:\s*([^;]+);/g)) tokens.set(m[1]!, m[2]!.trim())
  blocks.push({ label: sel, theme, tokens })
}
/** 某主题下的有效 token 表（按文件顺序覆盖） */
function resolveTheme(theme: string | null): Map<string, string> {
  const eff = new Map<string, string>()
  for (const b of blocks) {
    if (b.theme !== null && b.theme !== theme) continue
    for (const [k, v] of b.tokens) eff.set(k, v)
  }
  return eff
}
const themeNames: Array<string | null> = [null, ...[...new Set(blocks.map((b) => b.theme).filter((t): t is string => t !== null))]]
const rgbOf = (v: string | undefined): [number, number, number] | null => {
  const m = /^(\d+)\s+(\d+)\s+(\d+)$/.exec(v ?? '')
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

console.log('· 伤害类型徽标（app-d / app-a 共用）与 DMG_COLOR 逐主题读数：')
console.log('  主题        动能(chip)         爆破(chip)         能量(chip)         DMG_COLOR 三系一致')
for (const theme of themeNames) {
  const eff = resolveTheme(theme)
  const chips = TYPES.map((t) => rgbOf(eff.get(chipToken[`a${t}`] ?? '')))
  const tones = TYPES.map((t) => rgbOf(eff.get(`--wui-tone-${t}`)))
  const fmt = (c: [number, number, number] | null): string => (c ? c.join(' ').padEnd(15) : '（缺）'.padEnd(16))
  const same = TYPES.every((t, i) => JSON.stringify(chips[i]) === JSON.stringify(tones[i]))
  console.log(`  ${(theme ?? 'base').padEnd(10)} ${fmt(chips[0]!)} ${fmt(chips[1]!)} ${fmt(chips[2]!)} ${same ? '✅ 同值' : '· 近似（tone 微调）'}`)

  const [k, e, p] = chips as Array<[number, number, number] | null>
  check(k !== null && e !== null && p !== null, `主题 ${theme ?? 'base'}：三系底色没解析全`)
  if (k && e && p) {
    check(
      k.join() !== e.join() && e.join() !== p.join() && k.join() !== p.join(),
      `主题 ${theme ?? 'base'}：三系底色有重复（${k.join()} / ${e.join()} / ${p.join()}）`,
    )
    check(k[0] >= k[2], `主题 ${theme ?? 'base'}：动能不该比能量更蓝（动能 ${k.join()}）`)
    check(p[2] > p[0], `主题 ${theme ?? 'base'}：能量应偏蓝（能量 ${p.join()}）`)
    check(e[0] > e[1], `主题 ${theme ?? 'base'}：爆破应偏橙（爆破 ${e.join()}）`)
  }
}

if (errors.length > 0) {
  console.error('')
  for (const e of errors) console.error(`❌ ${e}`)
  console.error(`❌ 伤害类型配色契约未通过：${errors.length} 类问题`)
  process.exit(1)
}
console.log('')
console.log('✅ 伤害类型配色契约通过：两族共用同一套 token · 逐主题三系可分 · 动能不比能量蓝。')
