/**
 * **技能树排布体检**（正式工具 · 2026-09-22 建）——把"看代码判不了"的三件事**离线读坐标**钉住：
 *
 * ① **不越界**：每个六边形都要落在本图 `viewBox` 内（越界 = 画到框外，玩家看不到）；
 * ② **同行不重叠**：同一行的相邻六边形间距 ≥ `HEX_W + GAP_X`（重叠是布局最容易犯的错——
 *    2026-09-22 首次跑本条就抓到 3 处"同 rank 的父子挤在同一格"）；
 * ③ **挂得住 ＋ 不回头**（船长 2026-09-22：「前置技能优先摆左上角，上级技能优先摆在前置的下方」）：
 *    每个有子的节点**至少有一个子落在它正下方**（一族同层兄弟不可能都挤在正下方 ⇒ 只要求"挂得住"）·
 *    子不许跑到父的左边；同 rank 的层内连线不在此列。
 *    ⚠ **多前置合流豁免**（船长 2026-09-22 选「乙」）：同一节点有 ≥2 个同书前置时，它只能承**一个**父列，
 *    "两个父都挂得住"结构上不可能 ⇒ 子全是共享子的父跳过这两条，但**整族必须有一条向下生长的边**。
 *
 * 口径来源：`apps/desktop/src/renderer/src/ui/skillTreeLayout.ts`（**排布算法只有那一份**，
 * 本工具只读它算出来的坐标，不重写一遍）。这是**读数**，不是观感结论（观感审查权在船长）。
 *
 * 用法：`npm run skilltree:layout-check`
 *
 * **版本自检**：游戏版本 v0.1.0 · 存档结构 **v31** · 最后核对 2026-09-22 · 最后跑过 2026-09-22
 */
import { SKILLS, SKILL_BRANCHES } from '@whale/data'
import { GAP_X, HEX_H, HEX_W, layoutBook } from '../apps/desktop/src/renderer/src/ui/skillTreeLayout'

let bad = 0
const fail = (msg: string): void => {
  bad += 1
  console.log(`  ✗ ${msg}`)
}

for (const br of SKILL_BRANCHES) {
  const defs = SKILLS.filter((s) => s.branch === br.id)
  const lay = layoutBook(br.id, defs)
  const at = new Map(lay.nodes.map((n) => [n.def.id, n]))

  /** ① 越界 */
  for (const n of lay.nodes) {
    const outX = n.x - HEX_W / 2 < 0 || n.x + HEX_W / 2 > lay.w + 0.01
    const outY = n.y - HEX_H / 2 < 0 || n.y + HEX_H / 2 > lay.h + 0.01
    if (outX || outY) {
      fail(`${br.id} 越界：${n.def.name} @ (${n.x}, ${n.y}) 图 ${lay.w}×${lay.h}`)
    }
  }

  /** ② 同行不重叠（按 y 分组，x 升序查相邻间距） */
  const rows = new Map<number, typeof lay.nodes>()
  for (const n of lay.nodes) {
    const arr = rows.get(n.y) ?? []
    arr.push(n)
    rows.set(n.y, arr)
  }
  for (const [, arr] of rows) {
    arr.sort((a, b) => a.x - b.x)
    for (let i = 1; i < arr.length; i += 1) {
      const gap = arr[i]!.x - arr[i - 1]!.x
      if (gap < HEX_W + GAP_X - 0.01) {
        fail(
          `${br.id} 同行重叠：${arr[i - 1]!.def.name} ↔ ${arr[i]!.def.name}（间距 ${gap.toFixed(1)} < ${HEX_W + GAP_X}）`,
        )
      }
    }
  }

  /**
   * ③ 对齐与不回头（船长 2026-09-22：「前置技能优先摆左上角，上级技能优先摆在前置的下方」）：
   *    - **3a 每个有子的节点，至少有一个子落在它正下方**（一族同层兄弟不可能都挤在正下方 ⇒ 只要求"挂得住"）；
   *    - **3b 子不许跑到父的左边**（列单调不回头）。
   *    同 rank 的层内连线不参与这两条（它本来就画在同一行上）。
   *
   * **多前置合流豁免（2026-09-22 船长选「乙」）**：同一个节点若有 **≥2 个同书前置**（第一批 =
   * 战斗书「护卫舰/驱逐舰/巡洋舰/战列操作」，两条前置都要 Lv1），它只能承**一个**父列 ⇒ 要求两个父都
   * "挂得住"是**结构上不可能**的事（一列只能承一个父：设父列 pA < pB，子要挂在 pA 下就得 x=pA，
   * 而 3b 要求每个子 x ≥ pB ⇒ pA ≥ pB，矛盾）。口径：
   *    - **一个父的子若全是"共享子"（该子在本图内还有别的更浅前置）⇒ 不判它 3a、也不判这些边的 3b**
   *      （此刻这些边是"汇流线"，子承的是另一个父的列）；
   *    - 但**整族不能都不落地**：若这一族的共享子没有一条边是"向下生长"的（存在某父与某共享子同列），
   *      仍报"没挂住"；
   *    - **独占子**（本图内只有一个父）照旧严格判 —— 单前置的书与改动前完全一致。
   */
  const kidsInBook = new Map<string, typeof lay.nodes>()
  /** 子 id → 本图内更浅的前置 id（≥2 个 = 共享子） */
  const shallowParents = new Map<string, string[]>()
  for (const n of lay.nodes) {
    const ps = (n.def.prereq ?? []).filter((pid) => at.has(pid) && at.get(pid)!.def.rank !== n.def.rank)
    shallowParents.set(n.def.id, ps)
    for (const pid of ps) {
      const arr = kidsInBook.get(pid) ?? []
      arr.push(n)
      kidsInBook.set(pid, arr)
    }
  }
  const isShared = (id: string): boolean => (shallowParents.get(id)?.length ?? 0) >= 2
  for (const [pid, kids] of kidsInBook) {
    const parent = at.get(pid)!
    const own = kids.filter((k) => !isShared(k.def.id))
    const shared = kids.filter((k) => isShared(k.def.id))
    if (own.length > 0) {
      if (!own.some((k) => Math.abs(k.x - parent.x) <= 0.01)) {
        fail(
          `${br.id} 没挂住：${parent.def.name} 的子（${own.map((k) => k.def.name).join('、')}）没有一个在它正下方`,
        )
      }
      for (const k of own) {
        if (k.x < parent.x - 0.01) {
          fail(`${br.id} 往回长：${k.def.name}（x=${k.x}）跑到了前置 ${parent.def.name}（x=${parent.x}）左边`)
        }
      }
      continue
    }
    // 全是共享子：整族只要有一条"向下生长"的边就算挂住（被承父列的那个父自己会照常判）
    if (shared.length > 0 && !familyHangs(shared)) {
      fail(
        `${br.id} 没挂住：${parent.def.name} 的子全是共享子（${shared.map((k) => k.def.name).join('、')}），且整族没有一条边向下生长`,
      )
    }
  }
  /** 这一族共享子里，是否有一个子正落在它的某个（本图内更浅的）前置下方且不往左回头 */
  function familyHangs(shared: typeof lay.nodes): boolean {
    return shared.some((k) =>
      (shallowParents.get(k.def.id) ?? []).some((pid) => {
        const p = at.get(pid)
        return !!p && Math.abs(k.x - p.x) <= 0.01
      }),
    )
  }

  console.log(
    `· ${br.id}（${br.group}）${defs.length} 格 · 行 ${lay.tiers.map((t) => `T${t}`).join('/')} · 图 ${Math.round(lay.w)}×${Math.round(lay.h)} · 连线 ${lay.edges.length}`,
  )
}

const cells = SKILL_BRANCHES.reduce((n, b) => n + SKILLS.filter((s) => s.branch === b.id).length, 0)
console.log(
  `\n技能树排布体检：${SKILL_BRANCHES.length} 本技能书 / ${cells} 格 —— 越界 0 · 同行重叠 0 · 没挂住/往回长 0 才算过（本次不合格 ${bad} 处）`,
)
if (bad > 0) {
  console.log('❌ 技能树排布体检未通过')
  process.exit(1)
}
console.log('✅ 技能树排布体检通过：无越界 · 同行不重叠 · 每个前置都挂着子且子不往回长')
