/**
 * 存档往返审计：只读仓内测试档，逐元素/长度/值比较第一次与第二次归一；
 * 另用真实引擎合成当前状态，对资源、训练、行情、奖励标记与实验线作首读保真检查。
 * 用法：npm run save:roundtrip-audit。低于当前版本的VERSION拒读单列；意外失败退出1。
 * 历史原档可能含非法值或退役字段，首读不作整对象相等断言；不读取个人存档。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildSimContext } from '@whale/data'
import { loadSaveFile, MIN_SUPPORTED_SAVE_VERSION, SaveError, serializeSaveFile } from '../packages/core/src/save'
import { createInitialState, type GameState } from '../packages/core/src/state'
import { advanceGame } from '../packages/core/src/engine'
import { startLabRun } from '../packages/core/src/lab'
import { compareSaveValues } from './save-roundtrip-compare'

const DIR = 'docs/test-saves'
const files = readdirSync(DIR).filter(f => f.endsWith('.json'))
const differences = new Map<string, number>()
let ok = 0, failed = 0, rejected = 0

function compare(before: unknown, after: unknown, label: string): void {
  for (const diff of compareSaveValues(before, after)) {
    const key = `${label} ${diff.kind}: ${diff.path}`
    differences.set(key, (differences.get(key) ?? 0) + 1)
  }
}

for (const f of files) {
  let version: unknown
  try {
    const text = readFileSync(join(DIR, f), 'utf8')
    const raw = JSON.parse(text) as { version?: unknown } | null
    version = raw?.version
    const first = loadSaveFile(text).state
    const second = loadSaveFile(serializeSaveFile(first, 0)).state
    compare(first, second, f)
    ok += 1
  } catch (e) {
    if (e instanceof SaveError && e.code === 'VERSION' && typeof version === 'number'
      && Number.isInteger(version) && version < MIN_SUPPORTED_SAVE_VERSION) {
      rejected += 1
      continue
    }
    failed += 1
    console.log(`✗ ${f}：${(e as Error).message}`)
  }
}

/** 只选有明确保真契约且本合成状态实际覆盖的字段，不把补默认值当成错误。 */
function projection(s: GameState) {
  // 无参考价的玩家商品没有行情，空数组由读档按既有规则省略；非空价格仍逐项严格比较。
  const priceHistory = Object.fromEntries(Object.entries(s.market.priceHistory).filter(([, prices]) => prices.length > 0))
  return {
    wallet: s.wallet, warehouse: s.warehouse, moduleBay: s.moduleBay, aiCores: s.aiCores,
    skills: s.skills, priceHistory, importantTasks: s.importantTasks,
    labRuns: s.labRuns, labLoops: s.labLoops,
  }
}

try {
  const ctx = buildSimContext()
  const state = createInitialState({ nowWallMs: 0, seed: 29 })
  advanceGame(state, 1000, ctx)
  state.wallet.isk = 123456
  state.warehouse.items['jump-fuel'] = 1000
  state.skills.queue = [{ skillId: 'mining', targetLevel: 1, progressMs: 12345 },
    { skillId: 'mining', targetLevel: 2, progressMs: 6789 }]
  state.skills.savedProgress['mining'] = 789
  state.importantTasks['first-scan'] = { done: true, delivered: 0 }
  state.market.priceHistory['ore-olivine'] = Array.from({ length: 48 }, (_, i) => i + 100)
  for (const site of ctx.stations.values()) state.stationSites[site.id] = { stage: site.tiers.length, delivered: {} }
  state.aiCores.basic = 2
  state.skills.trained[ctx.balance.aiCore.skillId] = 5
  const recipe = ctx.labRecipes.get('jump-fuel')!
  for (const material of recipe.materials) state.warehouse.items[material.itemId] = material.units * 10
  for (let i = 0; i < 2; i++) {
    const result = startLabRun(state, ctx, recipe.id, 'basic')
    if (!result.ok) throw new Error(`合成实验线开工失败: ${result.errorId}`)
  }
  state.labRuns![1]!.deliveryBlocked = true
  const first = loadSaveFile(serializeSaveFile(state, 0)).state
  compare(projection(state), projection(first), '当代合成状态首读')
  compare(first, loadSaveFile(serializeSaveFile(first, 0)).state, '当代合成状态第二轮')
} catch (error) {
  failed++
  console.log(`FAIL 当代合成状态: ${(error as Error).message}`)
}

console.log(`仓内样本: ${ok}份可读 / ${rejected}份旧版预期拒读 / ${failed}份意外失败`)
console.log(`全部数组元素、长度、类型与值差异: ${differences.size}处`)
for (const [key, count] of differences) console.log(`  ${key} (${count})`)
const passed = failed === 0 && differences.size === 0
console.log(passed ? 'PASS 存档往返及当代合成投影检查通过' : 'FAIL 存档审计存在意外失败或变形')
process.exitCode = passed ? 0 : 1
