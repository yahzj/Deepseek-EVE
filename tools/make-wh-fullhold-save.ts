/**
 * 「塞满货仓背包」测试存档生成器 —— 船长 2026-09-23：「**给我一个塞满货仓背包的存档**」。
 *
 * 这档给谁用（工作文档 `docs/design/hold-ux-20260922.md`）：把虫洞**货仓格板塞到满格**、
 * 并让格板下方的**物品列表长到要滚动**，供船长实机看三件事 ——
 *   ① 格区自己的滚动条（固定格高 + 超出滚动，2026-09-23 船长「格区独立滚动条"固定最小格高 + 超出滚动"」）；
 *   ② 残骸 / 稀有残骸在格区与列表里的**颜色区分**（按手册口径）；
 *   ③ 列表里**不同类物品之间的分隔线**。
 *
 * 用法：`npx tsx tools/make-wh-fullhold-save.ts [源档路径] [目标格数]`
 *   - 源档缺省 = `docs/test-saves/test-save-wh-all-20260914-145912.json`（**已入库**的「虫洞全量验收」档：
 *     第 2 层在途、层上有墓场/遗迹/矿脉现场；本工具**只读**它，不改不删。选入库档是为了可复现 ——
 *     船长导出的 `save-*.json` 不进仓库，拿它当缺省源在别的机器上跑不起来）；
 *   - 目标格数缺省 = 88（8 列 ⇒ 11 行；格区可视高度上限 520px、一格约 70px ⇒ 一定出滚动条）。
 *
 * 口径（**不手写散货坐标**）：`run.bag` 是**数量账本**、`run.hold.placements` 是**位置账本**。
 * 本工具只写「背包条目 + 形状件（货柜 / 谜质装置 / AI 核心）」，**散货件一律交给 core 的
 * `wormholeHoldSyncCargo` 落位** —— 生成出来的现场与游戏内「整理」按钮的结果同一把尺，
 * 免得造出"游戏自己都不认"的档。
 *
 * 容量口径：货仓格数 = ⌊编队合计货仓 ÷ 500⌋ ＋ 谜质「舱段扩展器」×8/台（`wormholeHoldCapacityOf`
 * 现算，与界面读数同源）。扩展器自己是 2×2＝4 格 ⇒ 每台净 +4 格。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { loadSaveFile, serializeSaveFile, WORMHOLE_ESSENCE_ITEM_ID, WORMHOLE_LUXURY_ITEM_IDS } from '@whale/core'
import type { GameState, WormholeHoldPlacement } from '@whale/core'
import { buildSimContext } from '@whale/data'
import { WORMHOLE_ORE_ITEM_ID, wormholeBagSlotsOfFleet, wormholeUnitsPerSlot } from '../packages/core/src/wormhole'
import { isRareWreck } from '../packages/core/src/salvage'
import {
  wormholeHoldCapacityOf,
  wormholeHoldSyncCargo,
  wormholeHoldUsage,
} from '../packages/core/src/wormholeSalvage'
import { findFreeSpot, makeHoldState, wormholeIsShapedItem, wormholeShapeOf } from '../packages/core/src/wormholeHold'

const OUT_DIR = join(process.cwd(), 'docs', 'test-saves')
const DEFAULT_SRC = join(OUT_DIR, 'test-save-wh-all-20260914-145912.json')
/** 背包里最多放几种物品（每种一件、每件 ≤ 一格）——够长到要滚动，又不至于把格板撑成几十行 */
const MAX_TYPES = 36

function stamp(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

function main(): void {
  const src = process.argv[2] ?? DEFAULT_SRC
  const argTarget = Math.floor(Number(process.argv[3] ?? 88))
  const target = Number.isFinite(argTarget) && argTarget > 0 ? argTarget : 88
  const state: GameState = loadSaveFile(readFileSync(src, 'utf8')).state
  const ctx = buildSimContext()
  const run = state.wormhole.run
  if (!run) {
    console.error(`源档没有在途虫洞（state.wormhole.run 为空）：${src}\n请换一份"洞内在途"的档。`)
    process.exit(1)
  }
  const notes: string[] = []
  notes.push(`源档：${src}（第 ${run.depth} 层 · 编队 ${run.fleet.join(' / ')}）`)

  /* ── 一、背包候选：普通残骸 → 稀有残骸 → 洞内原矿/精华/奢侈品（列表最上面就能看到两种残骸对照）── */
  const allIds = [...ctx.items.keys()]
  const normal = allIds.filter((id) => id.startsWith('wreck-') && !isRareWreck(id))
  const rare = allIds.filter((id) => id.startsWith('wreck-') && isRareWreck(id))
  const others = [WORMHOLE_ORE_ITEM_ID, WORMHOLE_ESSENCE_ITEM_ID, ...WORMHOLE_LUXURY_ITEM_IDS].filter((id) =>
    ctx.items.has(id),
  )
  const bagIds = [...normal.slice(0, 16), ...rare.slice(0, 10), ...others]
    .filter((id) => !wormholeIsShapedItem(id))
    .slice(0, MAX_TYPES)
  if (bagIds.length === 0) {
    console.error('候选散货为空（数据侧物品表异常）——中止。')
    process.exit(1)
  }

  /* ── 二、形状件：一串"看形状"的货柜/装置 + N 台舱段扩展器（后者加容量）── */
  // 先摆的这几种都在洞里出（安全货柜来自遗迹、图纸货柜来自各层、谜质装置用谜质换）
  const boxPlan = [
    'box-relic-a', // 安全货柜 3×2 = 6 格
    'box-valuables', // 贵重品货柜 2×2 = 4 格
    'box-military', // 军用备货 2×2 = 4 格
    'box-bp-shallow', // 图纸货柜 2×1 = 2 格
    'box-bp-mid',
    'box-relic-c',
    'mat-surveyor', // 谜质装置 2×2 = 4 格
    'mat-crane',
    'box-relic-d',
    'mat-nebula',
    'box-bp-deep',
  ].filter((id) => ctx.items.has(id))
  const boxCells = boxPlan.reduce((s, id) => {
    const sh = wormholeShapeOf(id)
    return s + sh.w * sh.h
  }, 0)
  const base = wormholeBagSlotsOfFleet(state, ctx, run.fleet)
  // 约束：① 总格数 ≥ target（保证出滚动条）② 扣掉扩展器自身占格后，仍装得下"背包件 + 形状件"
  const byRows = Math.ceil((target - base) / 8)
  const byRoom = Math.ceil((bagIds.length + boxCells - base) / 4)
  const expanders = Math.max(0, byRows, byRoom)
  const provisional = base + 8 * expanders
  notes.push(
    `编队基础格数 ${base}（⌊合计货仓 ÷ 500⌋）＋ 舱段扩展器 ×${expanders}（+8/台，自占 4 格）` +
      ` ⇒ 目标格数 ${provisional}`,
  )

  /* ── 三、落位：先扩展器 → 再货柜/装置 → 再 AI 核心补缝，全程给"背包件"留够格数 ── */
  run.hold = makeHoldState(8)
  run.tempGrid = makeHoldState(4)
  const hold = run.hold
  let seq = 0
  const put = (itemId: string, cap: number): boolean => {
    const sh = wormholeShapeOf(itemId)
    const spot = findFreeSpot(hold, sh, cap)
    if (!spot) return false
    seq += 1
    const piece: WormholeHoldPlacement = {
      id: `whfull${seq.toString(36)}`,
      itemId,
      kind: 'box',
      x: spot.x,
      y: spot.y,
      w: sh.w,
      h: sh.h,
    }
    hold.placements.push(piece)
    return true
  }
  let placedExpanders = 0
  for (let i = 0; i < expanders; i += 1) if (put('mat-expander', provisional)) placedExpanders += 1
  const cellsUsed = (): number => hold.placements.reduce((s, p) => s + p.w * p.h, 0)
  // **权威容量**：扩展器已进格板 ⇒ 现算（谜质装置里加格数的不止"舱段扩展器"一种，故以 core 读数为准）
  const capacity = wormholeHoldCapacityOf(state, ctx)
  const reserve = bagIds.length // 给散货件留的格数（每件 1 格）
  let placedBoxes = 0
  for (const id of boxPlan) {
    const sh = wormholeShapeOf(id)
    if (cellsUsed() + sh.w * sh.h + reserve > capacity) continue
    if (put(id, capacity)) placedBoxes += 1
  }
  let placedCores = 0
  const coreIds = ['ai-core-gamma', 'ai-core-beta', 'ai-core-alpha'].filter((id) => ctx.items.has(id))
  for (let guard = 0; guard < 96 && cellsUsed() + 1 + reserve <= capacity; guard += 1) {
    if (!put(coreIds[guard % coreIds.length]!, capacity)) break
    placedCores += 1
  }
  notes.push(
    `形状件落位：舱段扩展器 ×${placedExpanders} + 货柜/装置 ×${placedBoxes} + AI 核心 ×${placedCores}` +
      `（共占 ${cellsUsed()} 格）· 权威总格数 ${capacity}（8 列 ⇒ ${Math.ceil(capacity / 8)} 行）`,
  )

  /* ── 四、背包账本：每件 ≤ 一格（1 格/件），数量取整格或零头做对照 ── */
  run.bag = bagIds.map((itemId, i) => {
    const per = Math.max(1, wormholeUnitsPerSlot(ctx.items.get(itemId)?.unitM3 ?? 0))
    const units = i % 5 === 4 ? Math.max(1, Math.floor(per / 3)) : per
    return { itemId, units }
  })
  const sync = wormholeHoldSyncCargo(state, ctx)
  if (sync.unplaced.length > 0) {
    console.error(`⚠ 有 ${sync.unplaced.length} 件没落位（存档会带"未落位"现场）：${sync.unplaced.join(' / ')}`)
    process.exit(1)
  }

  /* ── 五、读数（与界面同源：`wormholeHoldUsage`）── */
  const usage = wormholeHoldUsage(state, ctx)
  const rows = Math.ceil(usage.capacity / 8)
  notes.push(
    `散货件 ×${bagIds.length}（普通残骸 ${normal.slice(0, 16).filter((id) => bagIds.includes(id)).length} 种 · ` +
      `稀有残骸 ${rare.slice(0, 10).filter((id) => bagIds.includes(id)).length} 种 · 其它 ` +
      `${others.filter((id) => bagIds.includes(id)).length} 种）`,
  )
  notes.push(
    `**读数**：占用 ${usage.used}/${usage.capacity} 格（散货 ${usage.cargoCells} + 形状 ${usage.shapeCells}）` +
      ` · 未落位 ${usage.unplacedCells} · 超载 ${usage.overload ? '是' : '否'} · 空余 ${usage.capacity - usage.used} 格`,
  )
  notes.push(`预期界面：货仓格区 ${rows} 行（约 ${rows * 70}px）> 可视上限 520px ⇒ **出现格区自己的滚动条**`)
  notes.push('首 6 种（列表顶部）：' + run.bag.slice(0, 6).map((s) => `${ctx.items.get(s.itemId)?.name ?? s.itemId}×${s.units}`).join(' / '))

  mkdirSync(OUT_DIR, { recursive: true })
  const outName = `test-save-wh-holdfull-${stamp()}.json`
  writeFileSync(join(OUT_DIR, outName), serializeSaveFile(state, Date.now()), 'utf8')
  console.log(`✅ 已生成测试档：${join(OUT_DIR, outName)}`)
  console.log('   注入清单：')
  for (const n of notes) console.log(`     - ${n}`)
  console.log('\n加载方法（详见 docs/test-saves/README.md）：')
  console.log('   1) 游戏内「存档管理 → 备份」；2) 退出游戏；3) 用本文件替换 %APPDATA%\\whale-idle\\save.json；')
  console.log('   4) 启动即测（洞内在途 · 第 10 层）；测完在游戏内用备份恢复原档。')
}

main()
