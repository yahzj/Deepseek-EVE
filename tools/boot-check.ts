/**
 * 载入首屏与自检代号体检（`npm run boot:check`）。
 *
 * 起因（船长 2026-11-21）：玩家卡在「正在启动星门引擎」时要知道卡在哪一步，失败要能对表定位。
 * 本检查把两类漏改挡在提交前：
 * - 工序/代号/界面标签在 bootProgress.ts 与本地化表之间缺项或 id 形态漂移；
 * - 首屏静态脚本（web/public/boot.js）与 web/index.html 的节点契约不一致（改一处忘另一处）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BOOT_CODES, BOOT_STAGES } from '../apps/desktop/src/renderer/src/game/bootProgress'
import { L10N } from '../packages/data/src/l10n/table'
import { idLiteralsIn, stripComments } from './text-scan'

const ROOT = process.cwd()
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8')
const readSource = (rel: string): string => stripComments(read(rel))
const problems: string[] = []
const check = (ok: boolean, message: string): void => {
  if (!ok) problems.push(message)
}

const ID_RE = /^ui\.boot\.\d{3}$/

// 一、工序表：id 形态、文案存在、进度单调、超时与代号自洽
check(BOOT_STAGES.length > 0, '工序表为空')
let lastPercent = -1
for (const stage of BOOT_STAGES) {
  const at = '工序 ' + stage.id
  check(ID_RE.test(stage.labelKey), at + ' 文案 id 形态应为 ui.boot.NNN：' + stage.labelKey)
  check(L10N[stage.labelKey] !== undefined, at + ' 缺少本地化文案：' + stage.labelKey)
  check(stage.percent > lastPercent, at + ' 进度必须严格递增（' + stage.percent + ' 不大于上一道）')
  check(stage.percent >= 0 && stage.percent <= 100, at + ' 进度越界：' + stage.percent)
  check(stage.slowMs >= 0 && stage.failMs >= 0, at + ' 超时阈值不能为负')
  check(!(stage.failMs > 0 && stage.slowMs > stage.failMs), at + ' slowMs 不能晚于 failMs')
  check(stage.failMs === 0 || stage.failCode !== null, at + ' 配置了 failMs 却没有 failCode')
  if (stage.failCode !== null) check(BOOT_CODES[stage.failCode] !== undefined, at + ' 引用了不存在的代号：' + stage.failCode)
  lastPercent = stage.percent
}
check(lastPercent === 100, '最后一道工序应到 100%（实际 ' + lastPercent + '）')

// 二、代号表：形态与标题/建议文案
const codeEntries = Object.entries(BOOT_CODES)
check(codeEntries.length > 0, '代号表为空')
for (const [code, def] of codeEntries) {
  check(/^SG-[0-9A-F]{2}$/.test(code), '代号形态应为 SG-XX：' + code)
  check(ID_RE.test(def.titleKey) && L10N[def.titleKey] !== undefined, code + ' 标题文案缺项：' + def.titleKey)
  check(ID_RE.test(def.adviceKey) && L10N[def.adviceKey] !== undefined, code + ' 建议文案缺项：' + def.adviceKey)
}

// 三、界面代码引用的 ui.boot.* 必须都在表里
const UI_FILES = [
  'apps/desktop/src/renderer/src/boot/BootGate.tsx',
  'apps/desktop/src/renderer/src/panels/SaveWriterGate.tsx',
]
for (const file of UI_FILES) {
  check(existsSync(join(ROOT, file)), '缺少文件：' + file)
  if (!existsSync(join(ROOT, file))) continue
  for (const { id, line } of idLiteralsIn(readSource(file))) {
    if (!id.startsWith('ui.boot.')) continue
    check(L10N[id] !== undefined, file + ':' + line + ' 引用不存在的文案 id：' + id)
  }
}

// 四、网页首屏契约：boot.js 用到的节点必须在 index.html 里，反向也在
const bootJs = read('web/public/boot.js')
const html = read('web/index.html')
check(/<script[^>]+src="\/boot\.js"/.test(html), 'web/index.html 缺少根绝对路径 /boot.js 引用（构建按 base 重写，不能写相对路径）')
check(html.includes('<script type="module"'), 'web/index.html 缺少模块入口')
const idsInJs = new Set<string>()
for (const m of bootJs.matchAll(/(?:byId|setText)\('([A-Za-z0-9_-]+)'/g)) idsInJs.add(m[1]!)
const REQUIRED_IDS = [
  'boot-splash',
  'boot-status-text',
  'boot-track-fill',
  'boot-fail',
  'boot-fail-title',
  'boot-fail-advice',
  'boot-fail-code',
  'boot-fail-note',
  'boot-retry',
  'boot-report',
  'boot-copy',
  'boot-fallback',
]
for (const id of REQUIRED_IDS) {
  check(html.includes('id="' + id + '"'), 'web/index.html 缺少节点 id="' + id + '"')
  check(idsInJs.has(id), 'web/public/boot.js 未使用节点 id="' + id + '"')
}
const copyOk = ['SG-01', 'SG-02', 'SG-03'].every((code) => bootJs.includes("'" + code + "'"))
check(copyOk, 'web/public/boot.js 缺少预置阶段 SG-01/02/03 文案')
check(bootJs.includes('handleScriptFailure') && bootJs.includes("'_fw'") && bootJs.includes('sessionStorage'),
  'web/public/boot.js 的脚本加载失败必须走自动重载（_fw 缓存刷新 + sessionStorage 防循环），不能直接判死')
check(bootJs.includes('引擎包脚本加载失败（'), 'web/public/boot.js 报 SG-03 时应在详情里带失败文件名与 HTTP 状态')

// 五、两个入口共用载入层；读取工序要上报细分位置（失败诊断能定位卡点）
for (const entry of ['web/src/main.tsx', 'apps/desktop/src/renderer/src/main.tsx']) {
  check(readSource(entry).includes('onNote: bootNote'), entry + ' 未把 onNote: bootNote 透传给启动链（读取超时将无法定位卡点）')
}
check(readSource('apps/desktop/src/renderer/src/game/engine.ts').includes("onNote?.('打开本地存档')"),
  'engine.start 的 read 工序缺少 onNote 分段上报')
check(readSource('apps/desktop/src/renderer/src/boot/BootGate.tsx').includes('export function bootNote'),
  'BootGate 缺少 bootNote（分段位置只能写进诊断详情）')

// 六、两个入口共用同一份载入层，且不保留重复实现
check(readSource('web/src/main.tsx').includes('boot/BootGate'), 'web/src/main.tsx 未接入共享 BootGate')
check(readSource('apps/desktop/src/renderer/src/main.tsx').includes('boot/BootGate'), '桌面入口未接入共享 BootGate')
check(!existsSync(join(ROOT, 'web/src/bootScreen.tsx')), 'web/src/bootScreen.tsx 已迁移到共享目录，不应保留重复实现')

if (problems.length === 0) {
  console.log('✅ 载入首屏体检通过：' + BOOT_STAGES.length + ' 道工序 · ' + codeEntries.length + ' 个自检代号 · 静态首屏节点契约一致')
  process.exit(0)
}
console.error('❌ 载入首屏体检未通过（' + problems.length + ' 处）：')
for (const problem of problems) console.error('  · ' + problem)
process.exit(1)
