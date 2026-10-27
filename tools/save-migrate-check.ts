/** 只读核验仓库测试档：v31 应可读，所有低版本应明确拒绝。 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { loadSaveFile, MIN_SUPPORTED_SAVE_VERSION, SaveError } from '../packages/core/src/save'
import { CURRENT_STATE_VERSION } from '../packages/core/src/state'
import { FIRST_TASKS } from '../packages/core/src/firstTasks'

const DIR = join(process.cwd(), 'docs', 'test-saves')
const files = readdirSync(DIR).filter((f) => f.endsWith('.json'))
let bad = 0
let okN = 0
let readableN = 0
let rejectedN = 0
const rows: string[] = []
for (const f of files) {
  const text = readFileSync(join(DIR, f), 'utf8')
  let raw: { version?: number; state?: Record<string, unknown> } = {}
  try {
    raw = JSON.parse(text) as typeof raw
  } catch {
    rows.push(`❌ ${f}：JSON 解析失败（跳过）`)
    bad += 1
    continue
  }
  if (typeof raw.version === 'number' && raw.version < MIN_SUPPORTED_SAVE_VERSION) {
    try {
      loadSaveFile(text)
      rows.push(`❌ ${f}（原 v${raw.version}）：**过旧档却被读进来了**——老迁移没删干净？`)
      bad += 1
    } catch (e) {
      const isVersionErr = e instanceof SaveError && e.code === 'VERSION'
      if (isVersionErr) {
        okN += 1
        rejectedN += 1
        rows.push(`✅ ${f}（原 v${raw.version} < 当前 v${MIN_SUPPORTED_SAVE_VERSION}）：已按预期拒载入`)
      } else {
        rows.push(`❌ ${f}（原 v${raw.version}）：拒载入的**错误码不对**（${(e as Error).message}）`)
        bad += 1
      }
    }
    continue
  }
  if (raw.version !== CURRENT_STATE_VERSION) {
    rows.push(`❌ ${f}（版本缺失或异常：${String(raw.version)}）`)
    bad += 1
    continue
  }
  try {
    const { state } = loadSaveFile(text)
    const problems: string[] = []
    if (state.version !== CURRENT_STATE_VERSION) problems.push(`版本 ${state.version} ≠ ${CURRENT_STATE_VERSION}`)
    const stepOk = state.onboarding.step === 99 || state.onboarding.step === 0
    if (!stepOk) problems.push(`step=${state.onboarding.step}`)
    const before = (raw.state ?? {}) as {
      wallet?: { isk?: number }
      aiCores?: Record<string, number>
      blueprintStock?: Record<string, number>
      importantTasks?: Record<string, { done?: boolean }>
    }
    if ((before.wallet?.isk ?? 0) !== state.wallet.isk) problems.push('钱包改变')
    if ((before.aiCores?.basic ?? 0) !== (state.aiCores.basic ?? 0)) problems.push('基础核心改变')
    if ((before.blueprintStock?.['bp-ammo-kinetic'] ?? 0) !== (state.blueprintStock['bp-ammo-kinetic'] ?? 0)) problems.push('弹药蓝图库存改变')
    for (const task of FIRST_TASKS) {
      if ((before.importantTasks?.[task.id]?.done === true) !== (state.importantTasks[task.id]?.done === true)) {
        problems.push(`任务进度改变：${task.id}`)
      }
    }
    if (problems.length > 0) {
      rows.push(`❌ ${f}（原 v${raw.version ?? '?'}）：${problems.join(' · ')}`)
      bad += 1
    } else {
      okN += 1
      readableN += 1
      rows.push(
        `✅ ${f}（v${state.version}）step=${state.onboarding.step} · 当前版本可读`,
      )
    }
  } catch (e) {
    rows.push(`❌ ${f}（原 v${raw.version ?? '?'}）：读取失败 ${(e as Error).message}`)
    bad += 1
  }
}

for (const r of rows) console.log(r)
console.log(`\n合计 ${files.length} 份：通过 ${okN} · 失败 ${bad}`)
console.log(`当前版本可读 ${readableN} 份 · 旧版本预期拒读 ${rejectedN} 份`)
process.exit(bad === 0 ? 0 : 1)
