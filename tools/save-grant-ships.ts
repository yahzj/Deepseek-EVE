/**
 * **给存档补发成品舰船**（正式工具 · **2026-09-24 入库**；船长令：「你直接将 2 艘舰船成品给予玩家」）。
 *
 * 背景：玩家的一条一次性舰船蓝图在造时被"重复清剿抢主控 → 停机"掐掉（详见
 * `docs/design/one-time-blueprint-loss-20260924.md`），船长裁决**直接补成品船**。
 *
 * 🔴 **本工具会写真档**（全仓极少数会写玩家存档的工具之一）——只有船长明确下令补账时才用：
 * 安全纪律（真档只读原则的例外通道）：
 *  ① 先做**双备份**：与游戏自身同名的 `save-<时间戳>.json`（放存档目录，游戏自己的备份列表能认）
 *     外加一份到 `%TEMP%`；
 *  ② **外科式改写**：只在原文里替换 `"shipStore":{…}` 这一段，其余字节**一字不动**
 *     （不重新序列化整档 ⇒ 不动 `savedAtWallMs`、不动离线结算基准、不动键序）；
 *  ③ 写完**自检**：能被 JSON.parse、`shipStore` 恰好只多了指定的那几艘、其余状态与原档逐值相同；
 *  ④ 只在**游戏没在跑**时执行（运行时它会在下一次自动保存把改动覆盖掉）。
 *  ⑤ **刻意不挂 npm script**：不给"顺手跑一下"留入口；要补账就照下面的完整命令手动敲。
 *
 * 用法：
 *   npx tsx tools/save-grant-ships.ts <存档路径> <舰id>:<艘数> [<舰id>:<艘数> …]
 * 例：npx tsx tools/save-grant-ships.ts "$env:APPDATA/whale-idle/save.json" sh-hammerhead:1 sh-bullshark:1
 * （对照表见 `npm run bp:ship-ids`；改完用 `npm run save:diff` 复核）
 *
 * **版本自检**：游戏版本 v0.1.0 · 存档结构 v31 · 最后核对 2026-09-24 · 最后跑过 2026-09-24
 */
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const [, , savePathArg, ...grants] = process.argv
if (!savePathArg || grants.length === 0) {
  console.error('用法：npx tsx tools/_grant-ships.ts <存档路径> <舰id>:<艘数> [<舰id>:<艘数> …]')
  process.exit(1)
}
const savePath = savePathArg

const want = new Map<string, number>()
for (const g of grants) {
  const m = /^([a-z0-9-]+):(\d+)$/.exec(g)
  if (!m) {
    console.error(`参数看不懂：${g}（应为 <舰id>:<艘数>）`)
    process.exit(1)
  }
  want.set(m[1]!, (want.get(m[1]!) ?? 0) + Number(m[2]!))
}

const stamp = ((): string => {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `save-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
})()

const raw = readFileSync(savePath, 'utf8')

/* ① 双备份（备份失败就绝不动原档） */
const backupHere = join(dirname(savePath), `${stamp}.json`)
const backupTemp = join(process.env.TEMP ?? '.', `whale-save-before-grant-${stamp}.json`)
copyFileSync(savePath, backupHere)
copyFileSync(savePath, backupTemp)
console.log(`① 备份：${backupHere}`)
console.log(`         ${backupTemp}`)

/* ② 外科式改写 shipStore */
const parsed = JSON.parse(raw) as { state: { shipStore?: Record<string, number> } }
const before = { ...(parsed.state.shipStore ?? {}) }
const after: Record<string, number> = { ...before }
for (const [shipId, n] of want) after[shipId] = (after[shipId] ?? 0) + n

const storeRe = /"shipStore":\{[^}]*\}/
if (!storeRe.test(raw)) {
  console.error('✗ 没在原文里找到 `"shipStore":{…}` 这一段——为安全起见中止（未改动原档）')
  process.exit(1)
}
const nextRaw = raw.replace(storeRe, `"shipStore":${JSON.stringify(after)}`)
writeFileSync(savePath, nextRaw, 'utf8')

/* ③ 自检 */
const check = JSON.parse(readFileSync(savePath, 'utf8')) as { state: { shipStore?: Record<string, number> } }
const okStore = JSON.stringify(check.state.shipStore) === JSON.stringify(after)
for (const [shipId, n] of want) {
  if ((check.state.shipStore?.[shipId] ?? 0) !== (before[shipId] ?? 0) + n) {
    console.error(`✗ ${shipId} 没加上去——请用备份回滚：${backupHere}`)
    process.exit(1)
  }
}
// 其余状态逐值相同（把 shipStore 归一后比对整档文本）
const strip = (s: string): string => s.replace(storeRe, '"shipStore":{}')
const untouched = strip(raw) === strip(nextRaw)

console.log(`② 已写入：${savePath}`)
console.log(`   舰船仓库：${JSON.stringify(before)} → ${JSON.stringify(after)}`)
console.log(`③ 自检：shipStore ${okStore ? '✅' : '✗'} · 其余字节未动 ${untouched ? '✅' : '✗'}（文件 ${raw.length} → ${nextRaw.length} 字节）`)
if (!okStore || !untouched) {
  console.error(`✗ 自检没过——请用备份回滚：${backupHere}`)
  process.exit(1)
}
console.log('④ 提醒：请确保游戏**没有开着**再启动它（运行中的实例会用下一次自动保存覆盖本次改动）。')
