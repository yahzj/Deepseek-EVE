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
 * ── 2026-09-14 扩展（「舰种体积」打开后补的盲区）─────────────────────────────
 * 船长当日改判「**直接打开阶梯（发布默认改 true）**」（战斗里舰体按舰种档缩放：T1 110 / T2 140 /
 * T3 170 / T4 205 / T5 240，僚机 ×0.53）。打开后 `layout()` 会多走一条分支：**敌编队整行过宽时
 * 等比收缩**（`fit ≥ 0.4`）。原版工具对此**是盲的**——它只喂 170/205/90 这几种宽度（都塞得下 ⇒
 * 永不触发收缩），于是"开关开关跑出来一模一样"。本次补三件事：
 *   ① 新增**阶梯真值编成**（4×T5 240 / 4×T1 110 / T2+T4 混编）⇒ 我方血条要在**最窄 110** 的舰旁边也不压字；
 *   ② 新增**能逼出收缩的敌排**（4×T5 240 在 1024/1280 宽下必然收缩）；
 *   ③ 敌排边界改用 `layout()` 返回的 **`sizes`（实际落画尺寸，含收缩）**核对——用输入尺寸核等于没核；
 *   ④ 新增 **`--tier=on|off`**（默认跟随代码里的发布默认值）：在首次调用前打 `localStorage` 桩，
 *      让同一份几何能在**两种口径**下 A/B 对照，并打印每档的收缩读数。
 *
 * ⚠ 这是**读数型**核对（几何事实），**不是观感结论** —— 好不好看仍由船长看。
 * ⚠ 敌方那侧的"血条堆叠"另有 `foeBarGeom`（本工具只核我方这条 + 不重叠的硬约束）。
 *
 * ── 2026-09-25 扩展（船长报障「第二排右舰血条压住左舰数字」）────────────────────
 * 船长原话：「**战斗画面中，将从上往下数第二排敌人的左右间距拉开一些，右边舰船的血条会遮挡左边
 * 舰船的数字。**」真因是 **DOM 与锚点两套算术**（本工具原先对敌排是**盲的**：只核"越没越界"，
 * 没有核 DOM 落点）⇒ 新增第五节与第六节：**敌排 DOM 列盒 == 锚点** ＋ **同排血条互不遮挡**
 * （对 6 种真实 H 族波次的体积真值，含僚机 ×0.53），并把"旧 DOM 会重叠多少"打进读数。
 * 首跑即抓到两件事：① 旧 DOM 在**旗舰卡第 4 波（船长报障那一场）第二排重叠 81.5px**；
 * ② `foeBarGeom` 的收窄分支用 `round` 会把净空吃到 5.5px（已改 `floor`，见 `battleViewCore`）。
 *
 * ⚠ **版本自检**（口径同「旧数据不可靠」：超过一个大版本必须核对是否与现状偏差过大）
 *   - 游戏版本：**v0.1.0**（`package.json`）· 存档结构：**v25**（`CURRENT_STATE_VERSION`）
 *   - 本工具最后核对：**2026-09-25**（当日核对：舰种阶梯**开**态 66 组全绿、收缩读数 1280 宽 ×0.92 /
 *     1024 宽 ×0.62~0.65；敌排 6 波 × 2 窗口共 46 机位"盒中心 == 锚点"全绿、血条零重叠）
 *   - 本工具最后跑过：**2026-09-25**
 *   - 判据：`CURRENT_STATE_VERSION − v25 ≥ 2` ⇒ **必须重跑核对**；`LAY.ROW_GAP` / `TIER_SIZE` / 血条 CSS
 *     宽度 / **敌排 DOM 的铺法（`foeRowBoxesOf` 的列盒与间距）** / `foeBarGeom` 的宽度分支 任一改动
 *     ⇒ **必须重跑**（本工具量的就是这几者的算术关系）
 */
import {
  LAY,
  MY_BAR_W_MIN,
  TIER_SIZE,
  foeBarGeom,
  foeColLeft,
  foeRowBoxesOf,
  HP_BAR_H,
  layout,
  sizeByTierEnabled,
  sizeOfUnit,
} from '../apps/desktop/src/renderer/src/panels/battleViewCore'
import type { FoeFormation } from '../apps/desktop/src/renderer/src/panels/battleViewCore'

/** 血条与邻舰船体之间要求的**最小净空隙**（px；与血条自带的那 6px 同源） */
const CLEAR = 6
/** `.app-bts-hpWrap` 的 CSS 默认宽度（单舰路径用它；这里同时当"上限"核对） */
const CSS_BAR_W = 185
/** 我方最左舰允许贴到的左边界（px；留一点余量更稳） */
const LEFT_MARGIN = 8

/**
 * `--tier=on|off`：在**首次调用 `layout()` 之前**给 `localStorage` 打桩
 * （`battleViewCore` 首次询问时读一次并缓存 ⇒ 必须在任何布局调用前设置）。
 * 不给参数 = 跟随代码里的发布默认值。
 */
const tierArg = (process.argv.find((a) => a.startsWith('--tier=')) ?? '').slice('--tier='.length)
if (tierArg === 'on' || tierArg === 'off') {
  ;(globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string): string | null =>
      k === 'whale-idle:ship-size-tier' ? (tierArg === 'on' ? '1' : '0') : null,
    setItem: (): void => {},
  }
}

/** 编成 = 逐舰落画体积（主控在前）。带 `T#` 的条目用**阶梯真值**，能逼出"最窄舰旁边也要放下血条" */
const FLEETS: Array<{ label: string; sizes: number[] }> = [
  { label: '4×T3 巡洋（洞内标准编队）', sizes: [170, 170, 170, 170] },
  { label: '2×T3（最小多舰）', sizes: [170, 170] },
  { label: '3×T3', sizes: [170, 170, 170] },
  { label: '主控 T3 + 3×护卫（混编）', sizes: [170, 90, 90, 90] },
  { label: '4×护卫（同排全小舰：逼出收窄）', sizes: [90, 90, 90, 90] },
  { label: '战列 + 3×巡洋（极端混编）', sizes: [205, 170, 170, 170] },
  // ── 2026-09-14 扩展：阶梯真值（打开后这才是实际落画宽度）。**只列可达编成** ──
  //   可达性依据（洞内入场口径：最多 4 艘 · 折算总质量 ≤ 16,000 · T1 500 / T2 1,500 / T3 3,500 / T4 7,000）：
  //   ⚠ **T5 旗舰禁入虫洞**、且全游戏只有 2 艘旗舰 ⇒ "4×T5"（240×4）这类编成**玩家实现不了**，
  //     故不进本工具（放进来只会红、而且红的是不可达配置，属于自欺）。
  { label: '4×T1 护卫（阶梯最窄 110：血条最吃紧 · 质量 2,000）', sizes: [TIER_SIZE[1], TIER_SIZE[1], TIER_SIZE[1], TIER_SIZE[1]] },
  { label: '4×T2 驱逐（质量 6,000）', sizes: [TIER_SIZE[2], TIER_SIZE[2], TIER_SIZE[2], TIER_SIZE[2]] },
  { label: '2×T3 + 2×T2（洞内混编 · 质量 10,000）', sizes: [TIER_SIZE[3], TIER_SIZE[3], TIER_SIZE[2], TIER_SIZE[2]] },
  { label: '2×T4 战列（洞内最重可行 · 质量 14,000）', sizes: [TIER_SIZE[4], TIER_SIZE[4]] },
  { label: 'T4 + 2×T3（质量 14,000）', sizes: [TIER_SIZE[4], TIER_SIZE[3], TIER_SIZE[3]] },
]
const WINDOWS_HARD: Array<{ W: number; H: number }> = [
  { W: 1600, H: 900 },
  { W: 1440, H: 900 },
]
const WINDOWS_WARN: Array<{ W: number; H: number }> = [
  { W: 1280, H: 800 },
  { W: 1024, H: 720 },
]
/**
 * 敌侧编成（本工具只核"整行是否越界 + 收缩读数"；敌侧血条堆叠另有 `foeBarGeom`）。
 * 第 2/3 组是**故意撑爆**的：4×T5 在 1024/1280 宽下必然触发等比收缩 ⇒ 这正是原版工具的盲区。
 */
const FOE_SETS: Array<{ label: string; sizes: number[] }> = [
  { label: '敌 2×T3+1×T1', sizes: [170, 170, 90] },
  { label: '敌 4×T5（撑爆：逼出收缩）', sizes: [TIER_SIZE[5], TIER_SIZE[5], TIER_SIZE[5], TIER_SIZE[5]] },
  { label: '敌 4×T1（窄排）', sizes: [TIER_SIZE[1], TIER_SIZE[1], TIER_SIZE[1], TIER_SIZE[1]] },
]

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
console.log(
  `舰种阶梯 = ${sizeByTierEnabled() ? '开（2026-09-14 船长改判）' : '关（还原口径）'}` +
    `（${tierArg === '' ? '跟随代码默认' : `--tier=${tierArg}`} · 阶梯 T1~T5 = ` +
    `${[1, 2, 3, 4, 5].map((t) => TIER_SIZE[t as 1 | 2 | 3 | 4 | 5]).join('/')}）`,
)

for (const win of [...WINDOWS_HARD, ...WINDOWS_WARN]) {
  const hard = WINDOWS_HARD.some((w) => w.W === win.W)
  for (const fleet of FLEETS) {
    const meSize = fleet.sizes[0]!
    for (const foe of FOE_SETS) {
      const dims = { W: win.W, H: win.H, meW: meSize, foeW: 170 }
      // 米制三档：near 200 / vis 取中 / open 大数（几何与米数无关，量级与实战一致即可）
      const l = layout(dims, foe.sizes, (win.W * 0.6) / 2, win.W * 0.6, 200, meSize, fleet.sizes)
      const tag = `${fleet.label} vs ${foe.label} @ ${win.W}×${win.H}`
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
      /* ④ 敌排边界：**必须用 `l.sizes`（收缩后的实际落画尺寸）**——用输入尺寸核等于没核 */
      const foeRight = Math.max(...l.foe.map((p, i) => p.x + (l.sizes[i] ?? 0) / 2))
      const foeLeft = Math.min(...l.foe.map((p, i) => p.x - (l.sizes[i] ?? 0) / 2))
      if (foeRight > win.W) {
        const msg = `${tag}：敌方最右舰越出右边界 ${(foeRight - win.W).toFixed(1)}px`
        if (hard) bad(msg)
        else note(`${msg} —— 既有窄窗限制`)
      }
      if (foeLeft < 0) {
        const msg = `${tag}：敌方最左舰越出左边界 ${(-foeLeft).toFixed(1)}px`
        if (hard) bad(msg)
        else note(`${msg} —— 既有窄窗限制`)
      }
      /** 收缩读数（只在真的收缩时打，免得刷屏）：输入总宽 → 落画总宽 */
      const inW = foe.sizes.reduce((s, v) => s + v, 0)
      const outW = l.sizes.reduce((s, v) => s + v, 0)
      if (outW < inW - 0.5) {
        console.log(
          `  · 收缩 ${tag}：敌排总宽 ${inW} → ${outW}（×${(outW / inW).toFixed(2)}；` +
            `逐舰 ${foe.sizes.join('/')} → ${l.sizes.join('/')}）`,
        )
      }
      if (l.sizes.some((v) => v < 24)) bad(`${tag}：收缩后出现 < 24px 的舰体（下限 0.4 与 24 双双失效）`)
    }
  }
}

/* 单舰路径的"逐像素不变"自检：不传 mySizes ⇒ 不得返回 myBarW、且锚点仍只有 1 个 */
const single = layout({ W: 1600, H: 900, meW: 170, foeW: 170 }, [170, 170], 500, 900, 200, 170)
if (single.myBarW !== undefined) bad('单舰路径（不传 mySizes）不得返回 myBarW —— 那会改掉洞外逐像素口径')
if (single.my.length !== 1) bad(`单舰路径应只有 1 个我方锚点，实际 ${single.my.length}`)

/* ═══════════ 敌排：DOM 列盒 与 锚点 必须同位（2026-09-25 船长报障） ═══════════
 * 船长原话：「**战斗画面中，将从上往下数第二排敌人的左右间距拉开一些，右边舰船的血条会遮挡左边
 * 舰船的数字。**」
 *
 * 真因 = **DOM 与锚点两套算术**（血条宽度按锚点算、舰却画在别处）：
 * - 锚点（`layout()`）＝ `foeColLeft(列) ＋ 列宽/2`，列间距 = 列宽 ＋ `ROW_GAP`(24)；
 * - 旧 DOM ＝ 平铺 flex（`.app-bts-shipRow` 的 `gap: 4px`）＋ 逐舰 `marginLeft = (列宽 − 舰宽)/2`
 *   ⇒ 同排第 i 条的落点比锚点少 `Σ_{j<i}[(列宽_j − 舰宽_j)/2 ＋ 20]` px。
 * **为什么是"第二排"**：列宽取本列两舰的较大者，而**第二排多是僚机**（`sizeOfUnit(档, escort)`
 * 还要再 ×0.53）⇒ "窄舰坐宽列"最极端。实测（旗舰卡第 4 波：母舰 T5 主 ＋ 干扰/战巡/鱼雷僚机）：
 * 第二排两条的旧落点间距只有 **103.5px**，而血条宽度按锚点算 = **185px** ⇒ **右舰血条压住左舰血条
 * 81.5px**（左舰的"护/甲/结"数字整片被盖）；第一排因为主舰自己占满本列 ⇒ 只差 20px ⇒ 看不出来。
 *
 * 本节对**真实 H 族波次的体积真值**（含僚机 ×0.53）核两件事：
 * ⑤ **DOM 盒中心 == `layout()` 锚点**（相对编队左缘；盒 = `foeRowBoxesOf`，渲染用的就是它）；
 * ⑥ **同排血条互不遮挡**（用 `foeBarGeom` 的真实宽度与堆叠位移；两个方向都压住才算遮挡）。
 * 另打印"旧 DOM 会重叠多少"（把当年的算术留在读数里，不靠记忆）。
 */
const FLOW_GAP = 4 // `.app-bts-shipRow { gap: var(--wui-sp-4) }`（旧 DOM 的 flex 缝）
/** 真实 H 族波次的**落画体积**（主舰 `escort=false`，僚机 `escort=true` ⇒ `sizeOfUnit` 现算） */
const waveSizes = (tiers: Array<[tier: 1 | 2 | 3 | 4 | 5, escort: boolean]>): number[] =>
  tiers.map(([t, e]) => sizeOfUnit(t, e))
const FOE_WAVES: Array<{ label: string; sizes: number[] }> = [
  { label: '旗舰卡 W1 突击舰×4', sizes: waveSizes([[1, false], [1, true], [1, true], [1, true]]) },
  { label: '旗舰卡 W2 鱼雷舰×3＋干扰舰', sizes: waveSizes([[2, false], [2, true], [2, true], [3, true]]) },
  { label: '旗舰卡 W3 战巡×2＋干扰舰', sizes: waveSizes([[4, false], [4, true], [3, true]]) },
  {
    // 船长 2026-09-25 报障的那一场（"0% 血进旗舰战"打的就是这一波）
    label: '旗舰卡 W4 母舰＋干扰＋战巡＋鱼雷（报障场）',
    sizes: waveSizes([[5, false], [3, true], [4, true], [2, true]]),
  },
  { label: '主力卡 W2 战巡＋鱼雷×2＋干扰舰', sizes: waveSizes([[4, false], [2, true], [2, true], [3, true]]) },
  { label: '极端：主 T5 ＋ 3×僚 T1（列宽差最大）', sizes: waveSizes([[5, false], [1, true], [1, true], [1, true]]) },
]
/**
 * **旧 DOM（已删除的那套写法）的舰中心**——只用于打印"这条报障当年的算术"：
 * 平铺 flex ＋ 逐舰 `marginLeft = (列宽 − 舰宽)/2`；`perRow` = 本排已排到的右缘（含 4px 缝）。
 */
function oldDomCenters(fm: FoeFormation, sizes: readonly number[]): number[] {
  const out: number[] = []
  const perRow = [0, 0]
  for (let i = 0; i < sizes.length; i++) {
    const s = fm.slots[i]!
    const size = sizes[i]!
    const left = perRow[s.row]! + ((fm.colW[s.col] ?? size) - size) / 2
    perRow[s.row] = left + size + FLOW_GAP
    out.push(left + size / 2 + (s.row === 1 ? fm.shift : 0))
  }
  return out
}

console.log('\n════ 敌排：DOM 列盒 vs 锚点（2026-09-25 船长报障「第二排右舰血条压住左舰数字」）════')
let domChecked = 0
let oldWorst = 0
let oldWorstAt = ''
for (const win of WINDOWS_HARD) {
  for (const wave of FOE_WAVES) {
    const dims = { W: win.W, H: win.H, meW: 170, foeW: 170 }
    const l = layout(dims, wave.sizes, (win.W * 0.6) / 2, win.W * 0.6, 200, 170)
    const fm = l.formation
    const n = l.sizes.length
    const tag = `${wave.label} @ ${win.W}×${win.H}`
    /** 舰底 y（＝所在排的排底；同排相等）——血条几何按它分排 */
    const bottoms = l.foe.map((a, i) => a.y + ((l.sizes[i] ?? 0) * 0.46) / 2)
    const bars = foeBarGeom(
      l.foe.map((a) => a.x),
      bottoms,
      l.foeBottom,
    )
    /** 编队块的左缘（`layout()` 里 `rowLeft` 的同一式）——DOM 盒坐标的零点 */
    const rowLeft = l.foeLeft + (dims.foeW - fm.rowW) / 2
    /** 新版 DOM 的逐舰中心（相对编队左缘）＝ 盒左缘之和 ＋ 盒中心 */
    const domX: number[] = []
    for (let i = 0; i < n; i++) {
      const s = fm.slots[i]!
      const boxes = foeRowBoxesOf(fm, s.row, n)
      const boxLeft = boxes.slice(0, s.col).reduce((acc, b) => acc + b.width + LAY.ROW_GAP, 0)
      // 盒左缘必须与 `foeColLeft` 逐像素一致（两处公式不同源就等于没修）
      if (Math.abs(boxLeft - foeColLeft(fm, s.col)) > 0.001) {
        bad(`${tag}：第 ${i} 条所在列的盒左缘 ${boxLeft} ≠ foeColLeft ${foeColLeft(fm, s.col)}`)
      }
      const center = boxLeft + (boxes[s.col]?.width ?? 0) / 2 + (s.row === 1 ? fm.shift : 0)
      domX.push(center)
      /** ⑤ DOM 盒中心 == 锚点（相对编队左缘） */
      const anchorRel = l.foe[i]!.x - rowLeft
      domChecked += 1
      if (Math.abs(center - anchorRel) > 0.001) {
        bad(
          `${tag}：第 ${i} 条（第 ${s.row + 1} 排第 ${s.col + 1} 列）DOM 中心 ${center.toFixed(1)} ≠ 锚点 ${anchorRel.toFixed(1)}` +
            `（差 ${(center - anchorRel).toFixed(1)}px ⇒ 舰体与弹道/血条错位）`,
        )
      }
    }
    /** ⑥ 同排血条互不遮挡：两个方向（横向 ＋ 纵向）都压住才算遮挡 */
    for (let i = 0; i < n; i++) {
      for (let k = i + 1; k < n; k++) {
        const bi = bars[i]!
        const bk = bars[k]!
        const xGap =
          Math.abs(domX[i]! + bi.dx - (domX[k]! + bk.dx)) - (bi.width + bk.width) / 2
        const yGap = Math.abs(bottoms[i]! + bi.dy - (bottoms[k]! + bk.dy)) - HP_BAR_H
        if (xGap < CLEAR - 0.001 && yGap < -0.001) {
          bad(
            `${tag}：血条 ${i}/${k} 互相压住（横向净空 ${xGap.toFixed(1)}px < ${CLEAR} · 纵向重叠 ${(-yGap).toFixed(1)}px）` +
              ` ⇒ 「护/甲/结」数字会被盖`,
          )
        }
      }
    }
    /** 旧 DOM 的读数（留档：这条报障当年长什么样） */
    const oldX = oldDomCenters(fm, l.sizes)
    let waveOldWorst = 0
    let waveOldAt = ''
    for (let i = 0; i < n; i++) {
      for (let k = i + 1; k < n; k++) {
        if (fm.slots[i]!.row !== fm.slots[k]!.row) continue
        const bi = bars[i]!
        const bk = bars[k]!
        if (bi.dy !== bk.dy) continue // 堆叠分支：当年也是纵向排开
        const overlap = (bi.width + bk.width) / 2 - Math.abs(oldX[i]! + bi.dx - (oldX[k]! + bk.dx))
        if (overlap > waveOldWorst) {
          waveOldWorst = overlap
          waveOldAt = `第 ${fm.slots[i]!.row + 1} 排 第 ${i}/${k} 条`
        }
      }
    }
    if (waveOldWorst > 0.05) {
      console.log(
        `  · 旧 DOM 会重叠 ${waveOldWorst.toFixed(1)}px（${waveOldAt}）：${wave.label} @ ${win.W}` +
          ` —— 间距 ${oldX.map((v) => v.toFixed(0)).join('/')}（新版 ${domX.map((v) => v.toFixed(0)).join('/')}）`,
      )
    }
    if (waveOldWorst > oldWorst) {
      oldWorst = waveOldWorst
      oldWorstAt = `${wave.label} ${waveOldAt}`
    }
  }
}
console.log(
  `· 新版 DOM（列盒）：${domChecked} 个机位核过 —— 盒中心 == 锚点；同排血条不互压` +
    `（${FOE_WAVES.length} 种真实波次 × ${WINDOWS_HARD.length} 种常规窗口）`,
)
if (oldWorst > 0) {
  console.log(
    `· 旧 DOM（平铺 flex ＋ marginLeft 居中，已删除）最坏一处：${oldWorst.toFixed(1)}px 重叠 —— ` +
      `${oldWorstAt}（这就是船长看到的那一幕）`,
  )
}

/* 推导式复核：ROW_GAP 必须够两艘 T3 各自贴满 185 的血条（船长这条报障的主场景） */
const needGap = CSS_BAR_W / 2 + CLEAR + 170 / 2 - 170
if (LAY.ROW_GAP < needGap) {
  bad(`ROW_GAP = ${LAY.ROW_GAP} 不足：两艘 T3 同排需要 ≥ ${needGap.toFixed(1)}px，185px 血条的数字才不被压`)
}

const groups = FLEETS.length * FOE_SETS.length
if (fail === 0) {
  console.log(
    `\n✅ 几何核对通过：${FLEETS.length} 种我方编成 × ${FOE_SETS.length} 种敌排 × ${WINDOWS_HARD.length} 种常规窗口（共 ${groups * WINDOWS_HARD.length} 组）` +
      ` + 单舰路径自检 —— 同排血条不压邻舰数字、宽度合规、不出边界（含收缩后）` +
      (warn > 0 ? `（另有 ${warn} 条窄窗既有留档，见上）` : ''),
  )
} else {
  console.log(`\n❌ 几何核对失败：${fail} 处`)
  process.exit(1)
}
