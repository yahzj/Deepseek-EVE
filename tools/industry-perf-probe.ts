/**
 * 工业页性能探针（`npm run industry:perf`）
 *
 * **用途**：玩家报障「点击工业内的不同子页面，会出现数秒的卡顿后才切换页面」。
 * 本探针把"卡顿在引擎计算"与"卡顿在渲染"**分开** —— 它只量引擎侧：
 * 直接跑 `pages/IndustryPage.tsx` 渲染路径里调用的那几个 core 函数，
 * 在**真实后期档**（`docs/test-saves` 里最大的几份）上计时。
 *
 * **实测读数（2026-09-21 · 后期档：物品目录 132 件 · 制造配方 151 · 舰船蓝图 57）**：
 * | 计算 | 耗时 |
 * |---|---|
 * | `visibleItemDefs(ctx)`（渲染每帧调用） | 0.01 ms |
 * | 可见矿石过滤（精炼页 `oreDefs` 同式） | 0.01 ms |
 * | `oreAvailable` × 全部残骸/货柜（`boxDefs` 同式） | 0.01 ms |
 * | `refineRunViews(state, ctx)` | 0.01 ms |
 * | 组装机：全配方 `findBuildable` + `ownsBlueprint` | 0.03 ms |
 *
 * ⇒ **引擎侧合计不到 0.1 ms**，与"数秒"差 4~5 个数量级
 * ⇒ **卡顿不在 core 计算、而在渲染/布局层**（本探针据此排除一半可能面）。
 */
import { readFileSync } from 'node:fs'
import { buildSimContext } from '../packages/data/src/index'
import { loadSaveFile } from '../packages/core/src/save'
import {
  visibleItemDefs,
  oreAvailable,
  refineRunViews,
  findBuildable,
  ownsBlueprint,
} from '../packages/core/src/index'

const ctx = buildSimContext()
/** 取几份后期档（物品/蓝图越全，读数越有代表性） */
const files = [
  'test-save-wh-logi-20260916-130744.json',
  'test-save-mt-lab-20260919-201207.json',
  'test-save-fragments-20260919-141735.json',
]

function bench(label: string, fn: () => void, times = 5): void {
  fn() // 预热
  const t0 = performance.now()
  for (let i = 0; i < times; i++) fn()
  const per = (performance.now() - t0) / times
  console.log(`  ${label.padEnd(46)} ${per.toFixed(2)} ms/次`)
}

for (const f of files) {
  const p = `docs/test-saves/${f}`
  let state
  try {
    // ⚠ `loadSaveFile(text: string)` —— **吃字符串**、返回 `{ state, savedAtWallMs }`
    //（第一版我传了 `JSON.parse(...)` 的对象，被下面的 catch 静默吞掉 ⇒ 探针什么都不打印）
    state = loadSaveFile(readFileSync(p, 'utf8')).state
  } catch (e) {
    console.log(`  （跳过 ${f}：${String(e).slice(0, 80)}）`)
    continue
  }
  console.log(`\n=== ${f} ===`)
  console.log(`  物品目录 ${ctx.items.size} 件 · 制造配方 ${ctx.blueprints.size} · 舰船蓝图 ${ctx.shipBlueprints.size}`)
  bench('visibleItemDefs(ctx)（渲染每帧调用）', () => void visibleItemDefs(ctx))
  bench('可见矿石过滤（ISSUE 页 oreDefs 同式）', () => {
    for (const d of visibleItemDefs(ctx)) if (d.kind !== 'wreck' && d.refine?.length) void d.id
  })
  bench('oreAvailable × 全部残骸/货柜（boxDefs 同式）', () => {
    for (const d of ctx.items.values()) {
      if (d.kind === 'wreck' || d.kind === 'container') oreAvailable(state, d.id)
    }
  })
  bench('refineRunViews(state, ctx)', () => void refineRunViews(state, ctx))
  bench('组装机：全配方 findBuildable + ownsBlueprint', () => {
    for (const b of ctx.blueprints.values()) {
      void ownsBlueprint(state, b.id)
      void findBuildable(ctx, b.id)
    }
  })
}
