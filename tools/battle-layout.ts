/**
 * **战斗画面「同排不遮血条」几何核对**（`npm run battle:layout`）。
 *
 * 由来（船长 2026-09-14）：「**战斗画面中，同一排舰船的间距可以再拉开一些，目前会遮挡血条上的数字。**」
 *
 * 根因不是"间距不够"这一件事，而是**两条一起看**才行：
 * - 血条挂在舰体下方、**宽 185px**（`.app-bts-hpWrap`；我方与敌方都用这个宽度）、**居中**
 *   ⇒ 左右各探出 92.5px；
 * - 同排相邻两舰的间距 = `本列最宽舰 + LAY.ROW_GAP` ⇒ 旧的 `ROW_GAP = 4` 时，两艘 T3（宽 170）
 *   只隔 **174px**，而"血条半宽 92.5 + 净空隙 6 + 邻舰半宽 85 = 183.5" ⇒ **差 9.5px ⇒ 右端数字被压住**
 *   （把 `ROW_GAP` 临时回退成 4 跑本工具，会看到这一条红）。
 *
 * 本工具把这条**算术**固化成断言（纯函数 · 无浏览器 · 可回溯）：对若干编成与窗口尺寸直接调
 * `layout()` 拿**真实锚点**与 `myBarW`，核三件事：
 * ① **同排邻舰不压血条**：`血条半宽 + 净空隙 ≤ 同排间距 − 邻舰半宽`（同排两两都核）；
 * ② **血条宽度合规**：落在 `[MY_BAR_W_MIN, 185]`；**单舰路径不得出现 `myBarW`**（洞外逐像素不变）；
 * ③ **不出边界**（分层）：
 *    - **≥1440 宽 = 硬断言**（桌面常规窗口，含船长常用的 1600×900）；
 *    - **≤1280 宽 = 只打印 ⚠ 留档**：那一档"我方最左僚舰越出左边界"是**既有窄窗限制**
 *      （`ROW_GAP = 4` 时同样越界，本批把间距拉到 24 后加深约 20~30px）。根因是**主控锚点被钉在
 *      `me` 上**（距离尺 / 射程弧 / 弹道都在它身上），而镜像菱形还要往左占 `1.5×(列宽+间距)` ——
 *      窄窗里根本放不下（验算：1024 宽时连"间距取 0"都不够）⇒ **要不要治它请示船长**，
 *      不拿它当本批的失败项。
 *
 * ⚠ 这是**读数型**核对（几何事实），**不是观感结论** —— 好不好看仍由船长看。
 * ⚠ 敌方那侧的"血条堆叠"另有 `foeBarGeom`（本工具只核我方这条 + 不重叠的硬约束）。
 */
import { LAY, layout, MY_BAR_W_MIN } from '../apps/desktop/src/renderer/src/panels/battleViewCore'

/** 血条与邻舰船体之间要求的**最小净空隙**（px；与血条自带的那 6px 同源） */
const CLEAR = 6
/** `.app-bts-hpWrap` 的 CSS 默认宽度（单舰路径用它；这里同时当"上限"核对） */
const CSS_BAR_W = 185
/** 我方最左舰允许贴到的左边界（px；留一点余量更稳） */
const LEFT_MARGIN = 8

/** 编成 = 逐舰落画体积（主控在前） */
const FLEETS: Array<{ label: string; sizes: number[] }> = [
  { label: '4×T3 巡洋（洞内标准编队）', sizes: [170, 170, 170, 170] },
  { label: '2×T3（最小多舰）', sizes: [170, 170] },
  { label: '3×T3', sizes: [170, 170, 170] },
  { label: '主控 T3 + 3×护卫（混编）', sizes: [170, 90, 90, 90] },
  { label: '4×护卫（同排全小舰：逼出收窄）', sizes: [90, 90, 90, 90] },
  { label: '战列 + 3×巡洋（极端混编）', sizes: [205, 170, 170, 170] },
]
const WINDOWS_HARD: Array<{ W: number; H: number }> = [
  { W: 1600, H: 900 },
  { W: 1440, H: 900 },
]
const WINDOWS_WARN: Array<{ W: number; H: number }> = [
  { W: 1280, H: 800 },
  { W: 1024, H: 720 },
]
/** 敌侧固定用一个典型 3 舰编成（本工具只核我方这条报障；敌侧另有 `foeBarGeom`） */
const FOE_SIZES = [170, 170, 90]

let fail = 0
let warn = 0
const bad = (msg: string): void => {
  fail += 1
  console.log(`  ❌ ${msg}`)
}
const note = (msg: string): void => {
  warn += 1
  console.log(`  ⚠ ${msg}`)
}

console.log('════ 战斗画面几何核对（同排不遮血条 · 2026-09-14 船长报障）════')
console.log(
  `参数：ROW_GAP = ${LAY.ROW_GAP} · 血条 CSS 宽 = ${CSS_BAR_W} · 血条宽下限 = ${MY_BAR_W_MIN} · 净空隙要求 = ${CLEAR}px`,
)

for (const win of [...WINDOWS_HARD, ...WINDOWS_WARN]) {
  const hard = WINDOWS_HARD.some((w) => w.W === win.W)
  for (const fleet of FLEETS) {
    const meSize = fleet.sizes[0]!
    const dims = { W: win.W, H: win.H, meW: meSize, foeW: 170 }
    // 米制三档：near 200 / vis 取中 / open 大数（几何与米数无关，量级与实战一致即可）
    const l = layout(dims, FOE_SIZES, (win.W * 0.6) / 2, win.W * 0.6, 200, meSize, fleet.sizes)
    const tag = `${fleet.label} @ ${win.W}×${win.H}`
    const barW = l.myBarW
    if (fleet.sizes.length <= 1) {
      bad(`${tag}：本工具只喂多舰编成`)
      continue
    }
    if (barW === undefined) {
      bad(`${tag}：多舰路径必须给出 myBarW（否则会用 185px 固定宽、可能遮数字）`)
      continue
    }
    if (barW < MY_BAR_W_MIN || barW > CSS_BAR_W) bad(`${tag}：myBarW = ${barW}，超出 [${MY_BAR_W_MIN}, ${CSS_BAR_W}]`)

    // ① 同排两两核对（同 y 视为同排：第二排整体低了一个排高 + 血条带 ⇒ 纵向已让开）
    for (let i = 0; i < l.my.length; i++) {
      for (let k = i + 1; k < l.my.length; k++) {
        const a = l.my[i]!
        const b = l.my[k]!
        if (Math.abs(a.y - b.y) > 0.5) continue
        const gap = Math.abs(a.x - b.x)
        const need = barW / 2 + CLEAR + Math.max(fleet.sizes[i]!, fleet.sizes[k]!) / 2
        if (gap + 0.001 < need) {
          bad(
            `${tag}：同排第 ${i}/${k} 条间距 ${gap.toFixed(1)}px < 需要 ${need.toFixed(1)}px` +
              `（血条半宽 ${(barW / 2).toFixed(1)} + 空隙 ${CLEAR} + 邻舰半宽 ${(Math.max(fleet.sizes[i]!, fleet.sizes[k]!) / 2).toFixed(1)}）`,
          )
        }
      }
    }
    // ③ 不出边界（**逐舰用各自的半宽** —— 拿主控宽度当全队会误报）
    const leftMost = Math.min(...l.my.map((p, i) => p.x - (fleet.sizes[i] ?? meSize) / 2))
    if (leftMost < LEFT_MARGIN) {
      const msg = `${tag}：我方最左舰贴到 ${leftMost.toFixed(1)}px（要求 ≥ ${LEFT_MARGIN}）`
      if (hard) bad(msg)
      else note(`${msg} —— 既有窄窗限制，见文件头说明`)
    }
    const rightMost = Math.max(...l.foe.map((p, i) => p.x + (FOE_SIZES[i] ?? 170) / 2))
    if (rightMost > win.W) {
      const msg = `${tag}：敌方最右舰越出右边界 ${(rightMost - win.W).toFixed(1)}px`
      if (hard) bad(msg)
      else note(`${msg} —— 既有窄窗限制`)
    }
  }
}

/* 单舰路径的"逐像素不变"自检：不传 mySizes ⇒ 不得返回 myBarW、且锚点仍只有 1 个 */
const single = layout({ W: 1600, H: 900, meW: 170, foeW: 170 }, [170, 170], 500, 900, 200, 170)
if (single.myBarW !== undefined) bad('单舰路径（不传 mySizes）不得返回 myBarW —— 那会改掉洞外逐像素口径')
if (single.my.length !== 1) bad(`单舰路径应只有 1 个我方锚点，实际 ${single.my.length}`)

/* 推导式复核：ROW_GAP 必须够两艘 T3 各自贴满 185 的血条（船长这条报障的主场景） */
const needGap = CSS_BAR_W / 2 + CLEAR + 170 / 2 - 170
if (LAY.ROW_GAP < needGap) {
  bad(`ROW_GAP = ${LAY.ROW_GAP} 不足：两艘 T3 同排需要 ≥ ${needGap.toFixed(1)}px，185px 血条的数字才不被压`)
}

if (fail === 0) {
  console.log(
    `\n✅ 几何核对通过：${FLEETS.length} 种编成 × ${WINDOWS_HARD.length} 种常规窗口（共 ${FLEETS.length * WINDOWS_HARD.length} 组）` +
      ` + 单舰路径自检 —— 同排血条不压邻舰数字、宽度合规、不出边界` +
      (warn > 0 ? `（另有 ${warn} 条窄窗既有留档，见上）` : ''),
  )
} else {
  console.log(`\n❌ 几何核对失败：${fail} 处`)
  process.exit(1)
}
