/**
 * **属性表「同名两行」体检**（2026-09-26 · 船长报障「无人机舱有2个重复的」＋
 * 「用机动速度替换所有动力的位置」）。
 *
 * 为什么需要：装配页 / 图鉴详情窗的属性表是**拼装**出来的——`shipInfoLines` 给船体静态行，
 * 页面再追加装后合成行、合计行、右栏区块。拼装口径一变（新增字段、挪行、改名）就会出现
 * **同名两行并列两个数字**，代码里看不出来（两处各自正确），只有真机截图或本工具能发现。
 * 本工具把三处拼装口径按**真实顺序**复算一遍，按「同一张表内 label 唯一」判定。
 *
 * 覆盖：
 *   ① 装配页主属性表（`shipInfoLines` 过滤两张隐藏表 ＋ 机动速度 ＋ 无人机舱合计 ＋ 装后行）
 *   ② 手册·舰船图鉴详情窗（`shipInfoLines`＋`shipIndirectLines`，与 ① 同源但不过滤）
 *   ③ 手册·舰船蓝图产物（同上）
 *   ④ 舰队页悬停卡 = **当前属性**（`shipCurrentRowKeys`：基础行被装后行逐条顶替 ＋ 追加间接属性）
 *
 * 口径来源必须与实现同源（直接 import，不许抄一份）：`FIT_MAIN_HIDDEN_KEYS` /
 * `COMBAT_BASE_KEYS` 定义在 `ui/shipInfo.tsx`；页面追加行若改名，这里会跟着红——这正是护栏的目的。
 *
 * ⚠ 工具跑在 Node 里：tsx 走 classic JSX 运行时 ⇒ 先垫一个全局 `React.createElement` 再加载
 *   `shipInfo.tsx`（该模块的返回行里有 JSX 节点）。
 */
;(globalThis as unknown as { React: unknown }).React = {
  createElement: (...args: unknown[]) => ({ args }),
}

import { readFileSync } from 'node:fs'

import { COMBAT_BASE_KEYS, FIT_MAIN_HIDDEN_KEYS, fitHiddenBaseKeys, shipCodexBaseLines, shipCurrentLayout, shipIndirectLines, shipInfoLines } from '../apps/desktop/src/renderer/src/ui/shipInfo'
import { tr } from '../apps/desktop/src/renderer/src/i18n/locale'
import { SHIPS } from '@whale/data'

/** 装配页在基础行之后追加的行（顺序与 `pages/FitPage.tsx` 主表一致；只取名，不看值） */
const FIT_APPENDED_KEYS: readonly string[] = [
  tr('ui.FitPage.049'), // 机动速度（装后口径：航行技能 / 重甲机动代价）
  tr('ui.FitPage.035'), // 无人机舱（含甲板扩展）合计
  tr('ui.Handbook.010'), // 货舱容量（装后口径）——2026-10-02 船长报障「属性里看不到舰船当前货仓大小」补
  tr('ui.FitPage.039'), // 船体维修装置·运转消耗
  tr('ui.FitPage.042'), // 无消耗自愈件
  tr('ui.FitPage.045'), // 护盾抗性（装后）
  tr('ui.FitPage.046'), // 装甲抗性（装后）
  tr('ui.FitPage.005'), // 结构抗性（装后）
  tr('ui.FitPage.047'), // 命中率（装后）
  tr('ui.FitPage.048'), // 回避率（装后）
  tr('ui.FitPage.050'), // 跃迁速度（装后）
]

/** 同一序列里第 2 次及以后出现的 label */
function dupOf(keys: readonly string[]): string[] {
  const seen = new Set<string>()
  return keys.filter((k) => (seen.has(k) ? true : (seen.add(k), false)))
}

const problems: string[] = []

/**
 * **族徽判据契约**（**2026-09-27 立 · 船长报障**：「手册进入舰船图鉴会报错：
 * `Cannot read properties of null (reading 'toLowerCase')`」）。
 *
 * 背景：`factionOfExclusive(id)` 对"**不是任何势力专属**"的件返回 **`null`**（只有 id 查不到才是 `undefined`）。
 * 四个卡片构造器原先一律写 `factionOfExclusive(id) !== undefined ? { crest: … } : {}` —— `null !== undefined`
 * 为**真** ⇒ 非专属卡也带上 `crest: null` ⇒ `IconGrid` 画角标时 `c.crest.toLowerCase()` **把整页打崩**
 * （装备 / 舰船 / 物品 / 蓝图四页全中招，势力图鉴因卡片全是族字母反而看不出来）。
 *
 * 本契约是**源码级**的（这类 bug 跑不出类型错、也不是数据错，只有真机点开那一页才炸）：
 *   ① 不许再写 `factionOfExclusive(...) !== undefined`（判"有没有族"只许走 `crestFamOf()`）；
 *   ② `crestFamOf()` 必须在，且用 `?? undefined` 把 `null` 收窄；
 *   ③ `IconGrid` 画角标的判据必须是 `!= null`（同时挡 `null` 与 `undefined`）——最后一层防线。
 */
function crestContract(): string[] {
  const out: string[] = []
  // ⚠ 先剥注释再扫：这段契约自己的说明里就写着那个反面写法（不然工具会被自己的注释判红）
  const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  const hand = strip(readFileSync(new URL('../apps/desktop/src/renderer/src/panels/Handbook.tsx', import.meta.url), 'utf8'))
  // 2026-10-02 批次 4s：卡片构造器与详情窗从 Handbook.tsx 拆到 handbookDetail.tsx ⇒ 反面写法要两个文件一起扫
  const handDetail = strip(readFileSync(new URL('../apps/desktop/src/renderer/src/panels/handbookDetail.tsx', import.meta.url), 'utf8'))
  /**
   * **2026-09-27 迁出单点**：判据与可读名从 `Handbook.tsx` 搬到了 `ui/labelsText.ts`
   * （船长报障「物品仓库内的势力装备，左上角没有角标，能否将所有功能相同的同类型的图标规则进行统一下」
   * ⇒ 物品页仓库 / 货仓的 `ItemGlyphGrid` 与手册图鉴的 `IconGrid` 共用一份）。
   * 契约随之改成：**查单点文件**（判据收窄 ＋ 可读名），再核对**两处网格**都用 `!= null` 兜底。
   */
  const labels = strip(readFileSync(new URL('../apps/desktop/src/renderer/src/ui/labelsText.ts', import.meta.url), 'utf8'))
  const itemView = strip(readFileSync(new URL('../apps/desktop/src/renderer/src/ui/itemView.tsx', import.meta.url), 'utf8'))
  // ① 反面写法：判"有没有族"不许直接比 `!== undefined`（该函数"不是专属"返回 null）
  for (const [name, src] of [['Handbook.tsx', hand], ['handbookDetail.tsx', handDetail], ['itemView.tsx', itemView], ['labelsText.ts', labels]] as const) {
    const badNarrow = [...src.matchAll(/factionOfExclusive\([^)]*\)\s*!==\s*undefined/g)]
    if (badNarrow.length > 0) {
      out.push(`${name} 有 ${badNarrow.length} 处 \`factionOfExclusive(...) !== undefined\` —— 该函数"不是专属"返回 null，这么判会把 null 放进卡片（判据请走 crestFamOf()）`)
    }
  }
  // ② 单点必须把 null 收窄成一种"没有"
  if (!/function crestFamOf\([\s\S]{0,200}?\?\? undefined/.test(labels)) {
    out.push('labelsText.ts 缺 `crestFamOf()`（把 null/undefined 收窄成一种"没有"的单点）')
  }
  // ③ 两处网格画角标的判据都必须是 `!= null`（同时挡 null 与 undefined）——最后一层防线
  if (!/\{c\.crest != null \? \(/.test(hand)) {
    out.push('Handbook.tsx 的 IconGrid 画角标判据不是 `c.crest != null` —— null 会漏进去、整页 toLowerCase 崩')
  }
  if (!/\{c\.crest != null \? \(/.test(itemView)) {
    out.push('itemView.tsx 的 ItemGlyphGrid 画角标判据不是 `c.crest != null` —— null 会漏进去、整页 toLowerCase 崩')
  }
  return out
}
/**
 * **装配页"标签比对"契约**（**2026-10-02 立** · 船长报障「装配界面的属性中无法查看舰船当前货仓大小」查出来的）。
 *
 * 病根：装配页主表用**中文字面量**比对 `shipInfoLines` 的 label 来隐藏基础行
 * （`l.k !== '货舱容量'` 这类），但那些 label 早已走 `tr(ui.Handbook.00x)` **按语言出词** ⇒
 * zh 下恰好命中、**en 下一律不命中**（英文界面里基础行照常显示，与装后行重复）。
 * 契约：`FitPage.tsx` 里**不许**再出现 `l.k !== '中文…'` 这种比对，必须走单点 `fitHiddenBaseKeys()`。
 */
function fitLabelContract(): string[] {
  const out: string[] = []
  const strip = (x: string): string => x.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  const fit = strip(readFileSync(new URL('../apps/desktop/src/renderer/src/pages/FitPage.tsx', import.meta.url), 'utf8'))
  const bad = [...fit.matchAll(/l\.k\s*!==\s*'[^']*[\u4e00-\u9fff][^']*'/g)].map((m) => m[0])
  if (bad.length > 0) {
    out.push(`FitPage.tsx 有 ${bad.length} 处**中文字面量比对 label**（${bad.slice(0, 3).join(' / ')}）—— 英文界面下不命中，请改走 \`fitHiddenBaseKeys()\``)
  }
  if (!/fitHiddenBaseKeys\(\)\.includes\(l\.k\)/.test(fit)) {
    out.push('FitPage.tsx 的主表过滤没走单点 `fitHiddenBaseKeys()`（口径要与 ui/shipInfo.tsx 同源）')
  }
  return out
}
problems.push(...crestContract())
problems.push(...fitLabelContract())
for (const ship of SHIPS) {
  // ① 装配页主表：基础行过滤两张隐藏表 ⇒ 再接追加行（顺序与 FitPage 一致）
  const fitMain = [
    ...shipInfoLines(ship)
      // ⚠ 装配页**原地**过滤的那几条基础行走它自己的单点（2026-10-02 起；此前本工具与页面各按各的判据）
      .filter((l) => !fitHiddenBaseKeys().includes(l.k) && !FIT_MAIN_HIDDEN_KEYS.includes(l.k) && !COMBAT_BASE_KEYS.has(l.k))
      .map((l) => l.k),
    ...FIT_APPENDED_KEYS,
  ]
  const dupFit = dupOf(fitMain)
  if (dupFit.length > 0) problems.push(`${ship.id}（装配页主表）重复：${[...new Set(dupFit)].join(' / ')}`)

  // ② 手册图鉴详情窗 / ③ 蓝图产物（2026-09-26 船长报障「点击舰船图鉴内的舰船，当中的属性还是
  //    有动力，而没有机动速度」）：与装配页**同一口径**——主属性位报「机动速度」、动力只出现在
  //    下面的间接属性块里。
  // ⚠ 2026-09-27 收口：行口径**直接 import 单点 `shipCodexBaseLines`**，不再在本工具里手抄一份。
  //    此前本工具抄的过滤（同时滤「动力」与「无人机舱」）与 Handbook 两支实现**三份互不相同**，
  //    于是船长报障「而且还缺少无人机舱属性」时，这个体检照样是绿的（伪护栏）。
  //    现行规则 = 滤「动力」＋ **只滤掉无舱船的「无人机舱 = 无」**（有舱的船必须报出来）。
  const codexRows = [...shipCodexBaseLines(ship), ...shipIndirectLines(ship)]
  const codex = codexRows.map((l) => l.k)
  const dupCodex = dupOf(codex)
  if (dupCodex.length > 0) problems.push(`${ship.id}（图鉴档案 / 蓝图产物）重复：${[...new Set(dupCodex)].join(' / ')}`)
  if (!codex.includes(tr('ui.FitPage.049'))) {
    problems.push(`${ship.id}（图鉴档案 / 蓝图产物）缺「机动速度」行 —— 图鉴与装配页同口径，机动速度必须顶在动力位`)
  }
  if (codex.filter((k) => k === tr('ui.Handbook.012')).length !== 1) {
    problems.push(`${ship.id}（图鉴档案 / 蓝图产物）「动力」应恰好出现一次（在间接属性块里），实际 ${codex.filter((k) => k === tr('ui.Handbook.012')).length} 次`)
  }
  // **有舱就必须报「无人机舱」**（2026-09-27 船长报障的正是这条：有舱的船在档案窗里看不到机舱）
  if ((ship.droneBayM3 ?? 0) > 0 && !codex.includes(tr('ui.FitPage.010'))) {
    problems.push(`${ship.id}（图鉴档案 / 蓝图产物）有机舱却没报「无人机舱」行 —— 船长 2026-09-27 报障的正是这条`)
  }
  // 反之，无舱的船不许白占一行「无人机舱 = 无」
  if ((ship.droneBayM3 ?? 0) <= 0 && codex.includes(tr('ui.FitPage.010'))) {
    problems.push(`${ship.id}（图鉴档案 / 蓝图产物）没有机舱却报了「无人机舱 = 无」—— 无舱的船不该白占一行`)
  }

  // ④ 舰队页悬停卡（当前属性，2026-09-26 船长令）：基础行被装后行**逐条顶替**（位置不变、值换掉），
  //    **不带间接属性块**（船长同日复令「不要显示显示间接属性，过于臃肿」）。除"不重名"外还钉住：
  //    a) 行数守恒（不许凭空多行或少行）；b) 顶替键必须真在基础行里生效；c) 间接属性的键一个都不许出现。
  const hasBay = (ship.droneBayM3 ?? 0) > 0
  const hover = shipCurrentLayout(ship, hasBay)
  const dupHover = dupOf(hover.keys)
  if (dupHover.length > 0) problems.push(`${ship.id}（舰队页悬停卡）重复：${[...new Set(dupHover)].join(' / ')}`)
  // 行数守恒：卡的最终行 = 基础行 − 被"移走"的键（被顶替的键仍在原位，不扣）
  const hiddenSet = new Set(hover.hidden)
  const expected = shipInfoLines(ship).filter((l) => !hiddenSet.has(l.k)).length
  if (hover.keys.length !== expected) {
    problems.push(`${ship.id}（舰队页悬停卡）行数 ${hover.keys.length} ≠ 应显示 ${expected}（装后行必须逐条顶替、不许增删）`)
  }
  const baseKeys = new Set(shipInfoLines(ship).map((l) => l.k))
  const finalKeys = new Set(hover.keys)
  for (const k of hover.replaced) {
    if (!baseKeys.has(k)) problems.push(`${ship.id}（舰队页悬停卡）「${k}」被登记为装后顶替，但基础行里没有这个键 —— 玩家看到的仍会是基础值`)
    else if (!finalKeys.has(k)) problems.push(`${ship.id}（舰队页悬停卡）「${k}」被登记为装后顶替，却没出现在最终行里（装后值被吞掉）`)
  }
  for (const k of hover.hidden) {
    if (hover.replaced.includes(k)) problems.push(`${ship.id}（舰队页悬停卡）「${k}」同时进了顶替与移走两张名单（拼装口径自相矛盾）`)
  }
  if (hasBay && !hover.replaced.includes(tr('ui.FitPage.010'))) {
    problems.push(`${ship.id}（舰队页悬停卡）有机舱却没把「无人机舱」换成装后合计行`)
  }
  // e) 间接属性块不许回流（船长 2026-09-26：「看了下，不要显示显示间接属性，过于臃肿」）
  for (const k of shipIndirectLines(ship).map((l) => l.k)) {
    if (finalKeys.has(k)) problems.push(`${ship.id}（舰队页悬停卡）出现了间接属性行「${k}」—— 悬停卡不带间接属性块（完整数据看装配页）`)
  }
}

console.log(`属性表同名体检：${SHIPS.length} 艘 × 4 处拼装口径（装配页主表 / 图鉴档案 / 蓝图产物 / 舰队页悬停卡）`)
if (problems.length > 0) {
  for (const p of problems.slice(0, 20)) console.log(`  ✗ ${p}`)
  console.log(`\n❌ 属性表同名体检未过：${problems.length} 处同名两行（同一张表里 label 必须唯一）`)
  console.log('   修法：多半是"页面追加行"与 `shipInfoLines` 的基础行撞名——把基础行登记进 `FIT_MAIN_HIDDEN_KEYS`，')
  console.log('   或把追加行改名（两条同名行会并列两个数字，玩家会认为是重复条目）。')
  process.exit(1)
}
console.log('✅ 属性表同名体检通过：四处拼装口径均无同名两行')
// 新增契约的绿字（2026-10-02）：与族徽契约一样，判据通过也要看得见"它跑过了"
console.log('✅ 装配页标签比对契约通过：主表过滤走单点 fitHiddenBaseKeys()（无中文字面量比对 ⇒ 中英同口径）')
console.log('✅ 族徽判据契约通过：判"有没有族"只走 crestFamOf()（单点 = ui/labelsText.ts），IconGrid 与 ItemGlyphGrid 都用 `!= null` 兜底（null 不再能打崩图标卡）')
