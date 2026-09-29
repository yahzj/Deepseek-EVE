/**
 * **弹道两端锚点核对**（正式入库 · 回归守卫）：把「开火事件 → 弹道起点/落点」这条**纯几何口径**
 * 钉成可复跑的读数。
 *
 * 为什么有这个工具（船长 2026-09-14 报障）：
 *   「**多个对多个敌人的战斗中，敌方的弹道依旧是瞄准我方最右上角的舰船。**」
 *   根因 = `BattleScreen` 里内联的解析在**敌方那一支**塌了两处：
 *     ① 拿**我方 tag** 去查 `rowFxTags`（只含敌方 tag）⇒ 恒 −1 ⇒ 起点塌成 `foe[0]`（不是实际开火的敌舰）；
 *     ② 落点**写死 `dst = layFx.me`**（我方主控锚）⇒ 敌方每一发都飞向主控。
 *   引擎侧一直是对的（`to: gtgt.spec.tag`，每发开火前重选靶），所以这是**纯演出层的坐标解析 bug**。
 *   当时的实现内联在 2300 行的组件里、渲染层又没有测试运行器 ⇒ **没有任何东西能拦住它**。
 *
 * 做法：把解析抽成 `battleViewCore.resolveBoltAnchors`（**纯函数** · 两侧对称），本工具直接调它，
 * 用合成的锚点表断言四种情形。这样"落点又塌回主控"这类回归会**立刻红**。
 *
 * ── **2026-09-29 追加（第二个同族缺陷）**：玩家报障「**舰队战中，僚舰的无人机攻击没有动画效果**」。
 * 病根同类：2026-09-14「逐舰机群」批把机体层 / 出击返航 / 弹道返航段都改成了**逐舰锚**，
 * **只漏了常驻型（哨戒）无人机的开火起点与机群坠落点**这两处 ⇒ 僚舰的哨戒机"只在悬停、从不攻击"
 * （曳光条从主控上方凭空冒出）。取锚口 = `battleViewCore.residentDroneFrom` / `droneOwnerAnchor`，
 * 本工具下半场把这两条口径**逐坐标**钉住（含"旧口径会算成什么"的负向对照）。
 *
 * 用法：`npm run battle:bolt`（或 `npx tsx tools/battle-bolt-anchor.ts`）。
 * 退出码：0 = 全过；1 = 有用例不通过（打印逐条对照）。
 */
import { resolveBoltAnchors, droneOwnerAnchor, residentDroneFrom } from '../apps/desktop/src/renderer/src/panels/battleViewCore'
import type { Anchor } from '../apps/desktop/src/renderer/src/panels/battleViewCore'

/** 合成锚点（刻意做成**互不相同**的坐标：一旦取错锚点，断言立刻看得见） */
const A_MAIN: Anchor = { x: 1000, y: 200 } // 主控（画面里最右上角那艘）
const A_ALLY1: Anchor = { x: 900, y: 320 }
const A_ALLY2: Anchor = { x: 800, y: 440 }
const F0: Anchor = { x: 100, y: 200 }
const F1: Anchor = { x: 100, y: 320 }
const F2: Anchor = { x: 100, y: 440 }

const meAnchors = new Map<string, Anchor>([
  ['player', A_MAIN],
  ['ally-1', A_ALLY1],
  ['ally-2', A_ALLY2],
])
const rowFxTags = ['foe-0', 'foe-1', 'foe-2']
const foeAnchors = [F0, F1, F2]

type Case = {
  name: string
  args: Parameters<typeof resolveBoltAnchors>[0]
  wantSrc: Anchor | null
  wantDst: Anchor | null
  /** 这条用例为什么重要（打印用） */
  why: string
}

const CASES: Case[] = [
  {
    name: '敌方开火 · 目标是僚舰 ⇒ 落点必须是**那艘僚舰**（不是主控）',
    args: { side: 'foe', tag: 'foe-1', to: 'ally-2', rowFxTags, meAnchors, meFallback: A_MAIN, foeAnchors },
    wantSrc: F1,
    wantDst: A_ALLY2,
    why: '★船长报障的正身：旧口径落点写死主控 ⇒ 每一发都飞向最右上角',
  },
  {
    name: '敌方开火 · 目标是主控 ⇒ 落点主控（合法情形，与上一条配对）',
    args: { side: 'foe', tag: 'foe-2', to: 'player', rowFxTags, meAnchors, meFallback: A_MAIN, foeAnchors },
    wantSrc: F2,
    wantDst: A_MAIN,
    why: '别把"打主控"也一起改掉：只有 to 指向别的舰时才该换落点',
  },
  {
    name: '敌方开火 · 缺 to（旧事件/测试构造）⇒ 落点回落主控',
    args: { side: 'foe', tag: 'foe-0', rowFxTags, meAnchors, meFallback: A_MAIN, foeAnchors },
    wantSrc: F0,
    wantDst: A_MAIN,
    why: '向后兼容：老事件没有 to，行为必须与旧版一致',
  },
  {
    name: '敌方开火 · 单船路径（我方逐舰锚点表为空）⇒ 落点回落主控',
    args: { side: 'foe', tag: 'foe-1', to: 'player', rowFxTags, meAnchors: new Map(), meFallback: A_MAIN, foeAnchors },
    wantSrc: F1,
    wantDst: A_MAIN,
    why: '单船观感与旧版逐像素一致（layFx.my 不建表）',
  },
  {
    name: '我方开火 · 多舰 ⇒ 起点=发射舰、落点=目标敌舰',
    args: { side: 'me', tag: 'ally-1', to: 'foe-2', rowFxTags, meAnchors, meFallback: A_MAIN, foeAnchors },
    wantSrc: A_ALLY1,
    wantDst: F2,
    why: '2026-09-13 修过的那条（"弹道统一由第一艘射出"）不许回归',
  },
  {
    name: '我方开火 · 目标已撤队（行表里没有）⇒ 落点回落敌方首位',
    args: { side: 'me', tag: 'player', to: 'foe-9', rowFxTags, meAnchors, meFallback: A_MAIN, foeAnchors },
    wantSrc: A_MAIN,
    wantDst: F0,
    why: '阵亡撤队的旧尸骸兜底',
  },
]

let failed = 0
const eq = (a: Anchor | null, b: Anchor | null): boolean =>
  (a === null && b === null) || (!!a && !!b && a.x === b.x && a.y === b.y)
const fmt = (a: Anchor | null | undefined): string => (a ? `(${a.x},${a.y})` : '—')

console.log('════ 弹道两端锚点核对（battleViewCore.resolveBoltAnchors）════')
console.log('')
for (const c of CASES) {
  const got = resolveBoltAnchors(c.args)
  const ok = !!got && eq(got.src, c.wantSrc) && eq(got.dst, c.wantDst)
  if (!ok) failed += 1
  console.log(`${ok ? '✅' : '❌'} ${c.name}`)
  console.log(
    `     起点 ${fmt(got?.src)}（期望 ${fmt(c.wantSrc)}）· 落点 ${fmt(got?.dst)}（期望 ${fmt(c.wantDst)}）`,
  )
  console.log(`     ${c.why}`)
}
console.log('')
if (failed > 0) {
  console.error(`❌ 弹道锚点核对失败：${failed}/${CASES.length} 条不通过`)
  process.exit(1)
}
console.log(`✅ 弹道锚点核对通过：${CASES.length}/${CASES.length}（含船长报障"敌方弹道恒瞄主控"的正身用例）`)

/* ══════════ 下半场：**无人机"所属舰"锚点**（2026-09-29 玩家报障「僚舰的无人机攻击没有动画效果」）══════════
 *
 * 口径（两条，缺一不可）：
 * ① **常驻型（哨戒）无人机的开火起点** = 所属舰的伴飞位（舰位锚 ＋ `slots[0]`）；
 * ② **机群坠落/滑行终点** = 这一架自己的母舰机库口。
 * 单船 / 主控 / 旧事件缺 tag ⇒ 一律回落主控锚（改造前逐像素不变）。
 *
 * 负向对照（读数的关键）：旧口径给僚舰算出来的点 = **主控锚 ＋ 槽位** —— 与机体层用的
 * "僚舰锚 ＋ 槽位"差着**整整一个编队错位**，画面上就是"机体在僚舰旁悬停、曳光条从主控上方冒出"。
 */
const SLOT = { x: 30, y: -22 } // 现网两个常驻机型（雷鸥哨戒 / 构件哨戒）的唯一槽位
const D_CASES: Array<{ name: string; args: Parameters<typeof residentDroneFrom>[0]; want: Anchor; why: string }> = [
  {
    name: '僚舰的哨戒机 ⇒ 起点 = **僚舰锚** ＋ 槽位（不是主控）',
    args: { tag: 'ally-1', meAnchors, meFallback: A_MAIN, slot: SLOT },
    want: { x: A_ALLY1.x + SLOT.x, y: A_ALLY1.y + SLOT.y },
    why: '★本次报障的正身：旧口径（layFx）算出来是主控那份 ⇒ 僚舰的无人机"从不攻击"',
  },
  {
    name: '主控的哨戒机 ⇒ 起点 = 主控锚 ＋ 槽位（合法情形，与上一条配对）',
    args: { tag: 'player', meAnchors, meFallback: A_MAIN, slot: SLOT },
    want: { x: A_MAIN.x + SLOT.x, y: A_MAIN.y + SLOT.y },
    why: '别把"主控自己那条"也一起改掉（改造前像素一致是硬要求）',
  },
  {
    name: '旧事件缺 tag ⇒ 回落主控锚（向后兼容）',
    args: { meAnchors, meFallback: A_MAIN, slot: SLOT },
    want: { x: A_MAIN.x + SLOT.x, y: A_MAIN.y + SLOT.y },
    why: '老档/工具构造的事件没有 tag，行为必须与旧版一致',
  },
  {
    name: '单船路径（逐舰锚点表为空）⇒ 回落主控锚',
    args: { tag: 'ally-1', meAnchors: new Map(), meFallback: A_MAIN, slot: SLOT },
    want: { x: A_MAIN.x + SLOT.x, y: A_MAIN.y + SLOT.y },
    why: '单船路径不建表 ⇒ 逐像素与改造前一致',
  },
]
console.log('')
console.log('════ 无人机"所属舰"锚点核对（residentDroneFrom / droneOwnerAnchor）════')
console.log('')
for (const c of D_CASES) {
  const got = residentDroneFrom(c.args)
  const ok = eq(got, c.want)
  if (!ok) failed += 1
  /** 旧口径会给什么（= 主控锚 ＋ 槽位）——用来一眼看出"差多少" */
  const legacy = { x: A_MAIN.x + SLOT.x, y: A_MAIN.y + SLOT.y }
  console.log(`${ok ? '✅' : '❌'} ${c.name}`)
  console.log(`     起点 ${fmt(got)}（期望 ${fmt(c.want)}）· 旧口径会给 ${fmt(legacy)}`)
  console.log(`     ${c.why}`)
}
/** 坠落点的取锚口（`droneOwnerAnchor`）：僚舰 / 主控两条各一 */
for (const [tag, want, why] of [
  ['ally-2', A_ALLY2, '僚舰的机体被点防打下来 ⇒ 朝**它自己**的机库口滑（旧口径朝主控滑）'],
  ['player', A_MAIN, '主控那条一字不变'],
] as const) {
  const got = droneOwnerAnchor({ tag, meAnchors, meFallback: A_MAIN })
  const ok = eq(got, want)
  if (!ok) failed += 1
  console.log(`${ok ? '✅' : '❌'} 坠落点取锚 · tag=${tag} ⇒ ${fmt(got)}（期望 ${fmt(want)}）`)
  console.log(`     ${why}`)
}
console.log('')
if (failed > 0) {
  console.error(`❌ 无人机锚点核对失败：合计 ${failed} 条不通过`)
  process.exit(1)
}
console.log(
  `✅ 无人机锚点核对通过：${D_CASES.length + 2}/${D_CASES.length + 2}` +
    `（含玩家报障"僚舰无人机从不攻击"的正身用例）`,
)
