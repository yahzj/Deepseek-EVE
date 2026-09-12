/**
 * **工具区 · 版本自检**（船长 2026-09-12：「工具区需要进行一个备注，和之前的旧数据规则一样，
 * 超过一个大版本的工具要检查是否和现在版本有较大偏差」）。
 *
 * 口径（与「超过一次大更新版本的旧数据不可靠」同源，落到工具上）：
 * - **大版本判据 = 存档结构版本**（`packages/core/src/state.ts` 的 `CURRENT_STATE_VERSION`，现 v24）——
 *   它是"数据形状变了"的权威信号（字段增删/迁移），工具最容易被它打穿；
 * - 每个工具在自己的头注释里写 **「版本自检」** 三条：`游戏版本` / `最后核对（日期）` / `最后跑过（日期）`；
 * - **判据**：`CURRENT_STATE_VERSION − 工具写入时的版本 ≥ 2` ⇒ 标 **需重检**；
 *   差 1 或没有记录 ⇒ 标 **待确认**（让船长/接手人看一眼再定）。
 *
 * 用法：`npx tsx tools/tools-audit.ts`（等价 `npm run tools:audit`）
 *
 * 说明：本工具**只读**头注释做体检，不执行任何工具（执行是标定/审计工具自己的事）。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CURRENT_STATE_VERSION } from '@whale/core'

const TOOLS_DIR = join(process.cwd(), 'tools')
/** 大版本差的阈值：≥2 ⇒ 需重检（船长口径「超过一个大版本」） */
const STALE_GAP = 2

interface ToolCheck {
  file: string
  /** 头注释里记录的游戏版本（缺 = 未登记） */
  gameVersion: string | null
  /** 头注释里记录的工具写入时的存档结构版本（`v24` 形式；缺 = 未登记） */
  stateVersion: number | null
  /** 最后核对日期（YYYY-MM-DD） */
  checkedAt: string | null
  /** 最后跑过日期（YYYY-MM-DD） */
  ranAt: string | null
}

function parseTool(path: string, file: string): ToolCheck {
  const text = readFileSync(path, 'utf8')
  // 只取文件头注释块（第一个 `*/` 之前），避免匹配到正文里的同类字样
  const head = text.slice(0, Math.max(0, text.indexOf('*/') + 2))
  const pick = (re: RegExp): string | null => {
    const m = re.exec(head)
    return m ? (m[1] ?? null) : null
  }
  const stateRaw = pick(/\*\*v(\d+)\*\*/) ?? pick(/存档结构[^\d]*v(\d+)/) ?? pick(/v(\d+)\s*（`CURRENT_STATE_VERSION`\)/)
  return {
    file,
    gameVersion: pick(/游戏版本[^\d]*v([\d.]+)/),
    stateVersion: stateRaw !== null ? Number(stateRaw) : null,
    checkedAt: pick(/最后核对[^\d]*(\d{4}-\d{2}-\d{2})/),
    ranAt: pick(/最后跑过[^\d]*(\d{4}-\d{2}-\d{2})/),
  }
}

function main(): void {
  const files = readdirSync(TOOLS_DIR)
    .filter((f) => f.endsWith('.ts'))
    .sort()
  const checks = files.map((f) => parseTool(join(TOOLS_DIR, f), f))

  const stale: ToolCheck[] = []
  const unknown: ToolCheck[] = []
  const fresh: ToolCheck[] = []
  for (const c of checks) {
    if (c.stateVersion === null) {
      unknown.push(c)
      continue
    }
    if (CURRENT_STATE_VERSION - c.stateVersion >= STALE_GAP) stale.push(c)
    else fresh.push(c)
  }

  console.log(`工具区版本自检 · 当前存档结构 v${CURRENT_STATE_VERSION} · 共 ${checks.length} 个工具\n`)
  const line = (c: ToolCheck): string =>
    `  ${c.file.padEnd(26)} 记录 v${c.stateVersion ?? '—'} · 最后核对 ${c.checkedAt ?? '—'} · 最后跑过 ${c.ranAt ?? '—'}`

  console.log(`【需重检】${stale.length} 个（记录版本落后 ≥ ${STALE_GAP} 个大版本）`)
  for (const c of stale) console.log(line(c))
  console.log(`\n【未登记版本自检】${unknown.length} 个（老工具，头注释里没有这三条）`)
  for (const c of unknown) console.log(line(c))
  console.log(`\n【在版本内】${fresh.length} 个`)
  for (const c of fresh) console.log(line(c))
  console.log(
    `\n提示：未登记的老工具不判"需重检"，但**照样要核对**——判据是"它上次核对时游戏是什么样"。\n` +
      `      建议按"最后改动日期"排优先级：越老越可能踩到已改动的口径（本仓已有先例：\n` +
      `      battle-calibrate 曾整表静默空转，见其头注释与 roadmap 的工具更新批）。`,
  )
}

main()
