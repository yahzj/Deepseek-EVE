/**
 * 改动分档判定（AGENTS.md §2.2 / 开发约定 §二，2026-11-05 船长指示落地）
 *
 * 按 git diff 的变更文件集合自动判定档位，只输出并执行该档必要检查，
 * 避免「改一个文档/一个价格」被套上跨域大功能的全量验证成本。
 *
 * 用法：
 *   npm run tier                  只判定，不执行
 *   npm run verify                判定并执行
 *   npm run verify -- --tier=T1   人工强制升档（拿不准时一律升档）
 *
 * 原则：取所有变更文件中的最高档；未知路径一律升 T1；改动规则/检查工具本身一律 T2。
 */
import { execFileSync, spawnSync } from 'node:child_process'

const ROOT = process.cwd()
const git = (args: string[]): string => execFileSync('git', args, {
  cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
})

type Tier = 'T0-data' | 'T0-docs' | 'T0-style' | 'T1' | 'T2'
const RANK: Record<Tier, number> = { 'T0-data': 0, 'T0-docs': 0, 'T0-style': 0, T1: 1, T2: 2 }

// 规则、依赖、检查工具本身改动影响全局，必须走全套
const T2_FILES = /^(AGENTS\.md|package(?:-lock)?\.json|tsconfig.*\.json|\.gitignore|\.github\/|docs\/development-conventions(?:-changelog)?\.md|docs\/catalog\.md|tools\/(?:change-tier|docs-index|content-check|data-quick-check|l10n-check|ui-rot-check|arch-guard)\.(?:ts|cjs|mjs))/
const DOC_FILE = /\.(md|mdx|txt)$/i
const STYLE_FILE = /\.(css|scss|less)$/i
const STATIC_NUMERIC = /^packages\/data\/src\/static\/(market|items)\.json$/

function tierOf(file: string): Tier {
  if (T2_FILES.test(file)) return 'T2'
  if (STATIC_NUMERIC.test(file)) return 'T0-data'
  if (STYLE_FILE.test(file)) return 'T0-style'
  if (DOC_FILE.test(file)) return 'T0-docs'
  return 'T1'
}

// ---- 变更集：已跟踪改动 + 未跟踪新文件（content-csv 是 gitignore 审查副本，不会出现） ----
const changed = [
  ...git(['diff', '--name-only', 'HEAD']).trim().split('\n'),
  ...git(['ls-files', '--others', '--exclude-standard']).trim().split('\n'),
].map((f) => f.trim().split('\\').join('/')).filter((f) => f && !f.startsWith('content-csv/'))
const unique = [...new Set(uniqueSorted(changed))]
function uniqueSorted(list: string[]): string[] { return [...new Set(list)].sort() }

const forced = process.argv.find((a) => a.startsWith('--tier='))?.slice('--tier='.length) as Tier | undefined
if (forced && !(forced in RANK)) {
  console.error(`未知档位 ${forced}，可用：T0-data / T0-docs / T0-style / T1 / T2`)
  process.exit(2)
}

if (unique.length === 0) {
  console.log('tier · 工作树无改动，无需检查')
  process.exit(0)
}

const perFile = unique.map((f) => ({ file: f, tier: tierOf(f) }))
// 三个 T0 子档权重相同，不能用 reduce 取最大值（初值会吞掉 T0-data / T0-style）。
// 规则：全为同一 T0 子档 → 该档；多种 T0 混在一起 → 升 T1；含 T1/T2 → 取最高。
const kinds = new Set(perFile.map((x) => x.tier))
const maxRank = Math.max(...perFile.map((x) => RANK[x.tier]))
let detected: Tier
if (maxRank >= 2) detected = 'T2'
else if (maxRank === 1) detected = 'T1'
else if (kinds.size === 1) detected = [...kinds][0] as Tier
else detected = 'T1'
// 人工指定只允许升档，不允许把自动判定的高风险改动降成快速通道
let tier: Tier = detected
if (forced) {
  if (RANK[forced] >= RANK[detected]) tier = forced
  else console.log(`提示: --tier=${forced} 低于自动判定 ${detected}，已保持 ${detected}（只允许升档）`)
}

// 纯文档改动且没碰 docs/ 时，连索引检查都不必跑
const touchesDocs = unique.some((f) => f.startsWith('docs/'))
const COMMANDS: Record<Tier, string[]> = {
  'T0-data': ['npm run data:quick'],
  'T0-docs': touchesDocs ? ['npm run docs:index -- --check'] : [],
  'T0-style': ['npm run ui:rot-check'],
  T1: ['npm run typecheck', 'npm run content:check', 'npm run l10n:check', 'npm run ui:rot-check'],
  T2: ['npm run typecheck', 'npm run content:check', 'npm run l10n:check', 'npm run ui:rot-check', 'npm run arch:guard', 'npm run scope:check'],
}
const commands = COMMANDS[tier]
const skipped = ['typecheck', 'content:check', 'l10n:check', 'ui:rot-check', 'arch:guard', 'scope:check', 'test -w @whale/core']
  .filter((s) => !commands.some((c) => c.includes(s)))

console.log(`档位: ${tier}${forced ? '（人工指定）' : '（自动判定）'}${tier !== detected ? ` · 自动判定为 ${detected}` : ''}`)
console.log(`变更: ${unique.length} 个文件`)
for (const { file, tier: t } of perFile.slice(0, 6)) console.log(`  [${t}] ${file}`)
if (perFile.length > 6) console.log(`  … 另有 ${perFile.length - 6} 个`)
console.log(`执行: ${commands.length ? commands.join('  →  ') : '（无需检查）'}`)
console.log(`跳过: ${skipped.join(' / ') || '（无）'}`)
if (tier === 'T0-data') console.log('提示: data:quick 报 ⚠ 或退出码非 0 → 自动升回 T1，改跑 npm run verify -- --tier=T1')
if (tier === 'T2') console.log('提示: 完整 test -w @whale/core 仍按 AGENTS §3 留到船长明确开始集中验收')

const run = process.argv.includes('--run')
if (!run) process.exit(0)

for (const cmd of commands) {
  console.log(`\n▶ ${cmd}`)
  const r = spawnSync(cmd, { cwd: ROOT, shell: true, stdio: 'inherit' })
  if (r.status !== 0) {
    console.error(`✗ 失败: ${cmd}（退出码 ${r.status}）`)
    if (tier.startsWith('T0')) console.error('  快速通道未通过 → 升回 T1：npm run verify -- --tier=T1')
    process.exit(typeof r.status === 'number' ? r.status : 1)
  }
}
console.log(`\n✓ ${tier} 验证通过（${commands.length} 条命令）`)
