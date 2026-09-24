/**
 * **把某份存档的「铁人模式」补偿性开启**（船长 2026-09-24 令 · 一次性/按需手工敲，**刻意不挂 npm script**）。
 *
 * 背景（船长原话要点）：「这个存档是**玩家误操作**的，**因为之前没提示**，所以作为**补偿**给其开铁人模式」。
 * 也就是说：这不是玩家自助（游戏内那条路按单向门**永久关闭**），而是**GM 补偿**。
 *
 * ## 它到底改什么（**只改一个字段块**）
 * `state.ironman` 由 `{on:false, seq, sinceWallMs, closedWallMs}` →
 * `{on:true,  seq, sinceWallMs}`（**删掉 `closedWallMs`**）。
 * - `on:true` ⇒ 铁人福利重新生效、代次恢复随落盘 +1；
 * - **删 `closedWallMs`** 是必须的：留着它 `enterIronman`（唯一入口）会一路 `return false`，
 *   那是船长 2026-09-23 定的单向门「**只能关闭、无法再次打开**」。本工具是**船长明令的越权补偿**，
 *   所以绕过它——但**不是**把门拆了：代码一个字不动，只改这份档的数据（这也是"外科式"的含义）。
 * - **保留 `seq`**：现值既是我方闸门的基准，也与存档外账本同高，写小反而会把自己拦在闸门外。
 * - **保留 `sinceWallMs`**：那是"哪一刻入的铁人"，补偿不应当改写历史。
 *
 * ## 安全纪律（与 `save-grant-ships.ts` 同款）
 * 1. **先关游戏**：游戏还在跑的话，它下一次自动保存会把本次改写**整个盖掉**；
 * 2. **双备份**：存档目录 `save-<stamp>.json` ＋ `%TEMP%\whale-ironman-backup-<stamp>.json`；
 * 3. **外科式改写**：不做 `JSON.parse` → 整体重写（那会重排键、可能改变原文件形态），
 *    而是**只替换 `"ironman":{…}` 这一段文本**，其余字节原样透传；
 * 4. **自检三条**：改写后仍能解析 · 语义只差这一个字段块 · 除该块外**逐字符相同**。
 *
 * 用法：`npx tsx tools/save-enable-ironman.ts <存档路径>`（不传 = `%APPDATA%\whale-idle\save.json`）
 * ⚠ **会写真档**。写完请让玩家/船长重开游戏。
 */
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ironmanOf } from '../packages/core/src/ironman'

interface IronmanLike {
  on?: boolean
  seq?: number
  sinceWallMs?: number
  closedWallMs?: number
}
interface SaveFile {
  format?: string
  version?: number
  savedAtWallMs?: number
  state?: { ironman?: IronmanLike; gameMs?: number; savedAtWallMs?: number }
}

const DEFAULT_SAVE = join(process.env.APPDATA ?? '', 'whale-idle', 'save.json')
const path = process.argv[2] ?? DEFAULT_SAVE
const stamp = ((): string => {
  const d = new Date()
  const p = (n: number, w = 2): string => String(n).padStart(w, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
})()

function die(msg: string): never {
  console.error(`❌ ${msg}`)
  process.exit(1)
}

/* ── 读 + 前置校验 ── */
let text: string
try {
  text = readFileSync(path, 'utf8')
} catch (e) {
  die(`读不到存档：${path}（${(e as Error).message}）`)
}
const before = JSON.parse(text) as SaveFile
if (before.format !== 'whale-idle-save') die(`这份文件不是本游戏存档（format=${String(before.format)}）`)
const st = before.state
if (!st) die('存档里没有 state')
const im = ironmanOf(st)

console.log('存档：', path)
console.log('  玩家        ：', String((st as { character?: { name?: string } }).character?.name ?? '—'))
console.log('  改写前 ironman：', JSON.stringify(st.ironman ?? null))
console.log('  代次 seq    ：', im.seq, '· 已开?', im.on ? '是' : '否', '· 曾关闭?', st.ironman?.closedWallMs !== undefined ? '是（单向门已落）' : '否')

if (st.ironman?.on === true) {
  console.log('ℹ 这份档**已经是铁人模式**，无需改动 ⇒ 直接退出。')
  process.exit(0)
}

/* ── 双备份 ── */
const dir = join(path, '..')
const bakA = join(dir, `save-${stamp}.json`)
const bakB = join(process.env.TEMP ?? '.', `whale-ironman-backup-${stamp}.json`)
copyFileSync(path, bakA)
copyFileSync(path, bakB)
console.log('  备份 1      ：', bakA)
console.log('  备份 2      ：', bakB)

/* ── 外科式改写：只动 `"ironman":{…}` 这一段 ── */
const next: IronmanLike = { on: true, seq: im.seq }
if (im.sinceWallMs !== undefined) next.sinceWallMs = im.sinceWallMs
const block = `"ironman":${JSON.stringify(next)}`
const re = /"ironman":\{[^{}]*\}/
if (!re.test(text)) die('没定位到 `"ironman":{…}` 这一段（存档形态可能变了，请人工看一眼）')
const out = text.replace(re, block)

/* ── 自检三条 ── */
const after = JSON.parse(out) as SaveFile
if (after.state?.ironman?.on !== true) die('自检失败：改写后 on 不是 true')
if (after.state?.ironman?.closedWallMs !== undefined) die('自检失败：closedWallMs 没删掉')
/** 深比较（**键序无关**：改写会重建 ironman 对象的键序，不能用 JSON 串比） */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b || a === null || b === null) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((x, i) => deepEqual(x, b[i]))
  }
  if (typeof a === 'object') {
    const ka = Object.keys(a as object)
    const kb = Object.keys(b as object)
    if (ka.length !== kb.length) return false
    return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
  }
  return false
}
const withoutIron = (s: SaveFile): SaveFile => {
  const c = JSON.parse(JSON.stringify(s)) as SaveFile
  if (c.state) delete c.state.ironman
  return c
}
if (!deepEqual(withoutIron(after), withoutIron(before))) {
  die('自检失败：除 ironman 之外还有字段被改动（已中止，未写盘；备份仍在）')
}
const stripIron = (s: string): string => s.replace(/"ironman":\{[^{}]*\},?/, '')
if (stripIron(out) !== stripIron(text)) die('自检失败：除 ironman 块外还有字节级差异（已中止，未写盘）')

writeFileSync(path, out, 'utf8')
console.log('')
console.log('✅ 已写入。改写后 ironman：', JSON.stringify(after.state?.ironman))
console.log('   代次 seq 保持：', after.state?.ironman?.seq, '（与账本同高，导入/导出不会被自家闸门拦）')
console.log('   ⚠ 请**重开游戏**后到「存档」页确认铁人区块显示为开启。')
