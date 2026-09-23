/**
 * **铁人账本 + 装载闸门 · 回归工具**（2026-09-23 铁人模式 S5）。
 *
 * 为什么要有它：账本读写（主 + 影子双写、取 max、坏文件容错）跑在 **Electron 主进程**里，
 * 日常闸门跑不到；而这一段恰恰是"提高 SL 成本"的承重墙。本工具**直接拉起生产实现**
 * （`apps/desktop/src/main/ironmanLedger.ts`，该文件刻意不 import electron），
 * 在系统临时目录里真写文件，再用 core 的 `ironmanLoadVerdict` 走一遍四种判据。
 *
 * 覆盖：
 * 1 空目录 ⇒ 代次 0；
 * 2 `bumpLedger` 落盘 ⇒ 主 + 影子两份都在，读回同一代次；
 * 3 **双写退化**：删主文件 / 主文件写坏 ⇒ 影子仍把代次顶住（取 max）；
 * 4 存档文本解析（`ironmanInfoOfSaveText`）；
 * 5 闸门四判据：更早的代次 ⇒ 拒绝（阈值 = max(当前, 账本)）· 同代 ⇒ 放行 ·
 *   两天前的旧档 ⇒ 救援放行（且救标记入库）· 一天前的旧档 ⇒ 拒绝；
 * 6 备份文件"档内保存时刻"读取（`savedAtOfBackup` 只读头 4KB）。
 *
 * 跑法：`npm run ironman:check`（失败即非零退出）
 */
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInitialState, ironmanLoadVerdict, serializeSaveFile, IRONMAN_RESCUE_MIN_AGE_MS } from '@whale/core'
import { ironmanLedgerStore, ironmanInfoOfSaveText, LEDGER_FILE_NAME, LEDGER_SHADOW_NAME } from '../apps/desktop/src/main/ironmanLedger'

let failed = 0
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) console.log(`✅ ${name}${detail ? ` —— ${detail}` : ''}`)
  else {
    failed++
    console.log(`❌ ${name}${detail ? ` —— ${detail}` : ''}`)
  }
}

/** 造一份"存档文本"：用引擎真实序列化，再按需改写 `savedAtWallMs`（判龄只看这个字段） */
function saveTextOf(seq: number, on: boolean, savedAtWallMs: number): string {
  const s = createInitialState({ nowWallMs: savedAtWallMs, seed: 7 })
  s.ironman = { on, seq, ...(on ? { sinceWallMs: savedAtWallMs } : {}) }
  const text = serializeSaveFile(s)
  return text.replace(/"savedAtWallMs"\s*:\s*\d+/, `"savedAtWallMs":${savedAtWallMs}`)
}

async function main(): Promise<void> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'whale-ironman-'))
  const ledger = ironmanLedgerStore(() => dir)
  const NOW = 1_800_000_000_000
  try {
    /* 1 · 空目录 */
    const empty = await ledger.readLedger()
    check('空目录 ⇒ 代次 0（不抛错）', empty.seq === 0 && empty.rescues === 0, `seq=${empty.seq} rescues=${empty.rescues}`)

    /* 2 · 落盘 + 双写 */
    await ledger.bumpLedger(7)
    const mainText = await fs.readFile(join(dir, LEDGER_FILE_NAME), 'utf8')
    const shadowText = await fs.readFile(join(dir, LEDGER_SHADOW_NAME), 'utf8')
    check('bump(7) ⇒ 主 + 影子两份都写', mainText === shadowText && JSON.parse(mainText).seq === 7)
    check('读回代次 7', (await ledger.readLedger()).seq === 7)

    /* 3 · 双写退化：删主 → 影子顶住；主写坏 → 仍取影子 */
    await fs.unlink(join(dir, LEDGER_FILE_NAME))
    check('主文件被删 ⇒ 影子仍给出 7', (await ledger.readLedger()).seq === 7)
    await fs.writeFile(join(dir, LEDGER_FILE_NAME), '{ 坏文件', 'utf8')
    check('主文件写坏 ⇒ 仍给出 7', (await ledger.readLedger()).seq === 7)
    await ledger.writeLedger({ seq: 7, updatedAtWallMs: NOW, rescues: 0 })

    /* 4 · 存档文本解析 */
    const info = ironmanInfoOfSaveText(saveTextOf(7, true, NOW))
    check('存档文本解析（on/seq/保存时刻）', info !== null && info.on && info.seq === 7 && info.savedAtWallMs === NOW, JSON.stringify(info))
    check('坏文本 ⇒ null（不抛错）', ironmanInfoOfSaveText('not json') === null)

    /* 5 · 闸门四判据（当前档 = 铁人代次 7，账本 = 7） */
    const older = ironmanLoadVerdict({ ironman: true, incomingSeq: 5, currentSeq: 7, ledgerSeq: 7, incomingSavedAtWallMs: NOW, nowWallMs: NOW })
    check('铁人档 · 更早代次 ⇒ 拒绝（阈值 7）', !older.ok && older.reason === 'rolled-back' && older.threshold === 7, JSON.stringify(older))
    const same = ironmanLoadVerdict({ ironman: true, incomingSeq: 7, currentSeq: 7, ledgerSeq: 7, incomingSavedAtWallMs: NOW, nowWallMs: NOW })
    check('铁人档 · 同代 ⇒ 放行（非救援）', same.ok && !same.rescue)
    const rescue = ironmanLoadVerdict({
      ironman: true,
      incomingSeq: 3,
      currentSeq: 7,
      ledgerSeq: 7,
      incomingSavedAtWallMs: NOW - IRONMAN_RESCUE_MIN_AGE_MS - 3_600_000,
      nowWallMs: NOW,
    })
    check('铁人档 · 两天前旧档 ⇒ 救援放行', rescue.ok && rescue.rescue)
    const tooNew = ironmanLoadVerdict({
      ironman: true,
      incomingSeq: 3,
      currentSeq: 7,
      ledgerSeq: 7,
      incomingSavedAtWallMs: NOW - IRONMAN_RESCUE_MIN_AGE_MS + 3_600_000,
      nowWallMs: NOW,
    })
    check('铁人档 · 一天前旧档 ⇒ 拒绝', !tooNew.ok)
    const normal = ironmanLoadVerdict({ ironman: false, incomingSeq: 3, currentSeq: 7, ledgerSeq: 7, incomingSavedAtWallMs: NOW, nowWallMs: NOW })
    check('普通档 ⇒ 一律放行', normal.ok && !normal.rescue)

    /* 6 · 备份档内保存时刻（只读头 4KB） */
    const bname = 'save-20260921-120000.json'
    await fs.writeFile(join(dir, bname), saveTextOf(6, true, NOW - 50 * 3_600_000), 'utf8')
    check('读备份档内保存时刻', (await ledger.savedAtOfBackup(bname)) === NOW - 50 * 3_600_000)
    check('备份缺字段/不存在 ⇒ 0', (await ledger.savedAtOfBackup('不存在.json')) === 0)

    /* 7 · 救援记账（只加计数，不动代次） */
    const after = await ledger.bumpLedger(0, true)
    check('救援记账 ⇒ rescues+1 且代次不回退', after.rescues === 1 && after.seq === 7, JSON.stringify(after))
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
  if (failed > 0) {
    console.log(`\n❌ 铁人账本回归：${failed} 项不通过`)
    process.exit(1)
  }
  console.log('\n✅ 铁人账本 + 装载闸门回归通过')
}

void main()
