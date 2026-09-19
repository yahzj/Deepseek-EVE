/**
 * **提交消息助手**（2026-09-19 立 · 船长令「我看你的双引号被 PowerShell 弄坏了好多次了是否能提前规避」）。
 *
 * **要解决的问题（实测证据）**：本机 `pwsh` = **Windows PowerShell 5.1**，它把参数递给原生进程
 * （git / node / tsx…）时**自己拼一条命令行**，参数内的 `"` **既不被转义也不被保留**
 * （实测 `$s = 'a "b" c'` 经 `node -e … $s` 到达时变成 `a b c`）；长文本还会被**按空格/换行切碎成
 * 多个参数** ⇒ `git commit -m $msg` 会把消息切成一堆 pathspec，报 `did not match any file(s) known to git`。
 *
 * **本工具的做法：消息从 stdin 进来（不经命令行参数）** ⇒ 整类问题一次性绕开：
 * 1. 读 stdin 的全部**字节**（也支持 `--file <路径>`）；管道里的中文按 `[Console]::OutputEncoding`
 *    编码而来（本机 = utf-8；中文机器上可能是 GBK/936）⇒ **编码自检**：先按 UTF-8 严格解码，
 *    失败或出现替换符（U+FFFD）就改按 **GBK(936)** 再解一次（Node 自带 ICU，`TextDecoder('gbk')` 可用）；
 * 2. **体检**：空消息拒绝 · **半角双引号计数提醒**（到这一步已是无害文本，但引号很可能**在命令行那一步
 *    就已经被吞掉了** ⇒ 提醒改用「」或改用 `--file`）· 行尾归一为 LF · 写文件用**无 BOM UTF-8** ·
 *    疑似乱码特征字（GBK 误读 UTF-8 的典型产物）告警 · **逐行预览**让你肉眼确认中文与引号没坏；
 * 3. **落盘 + 转交**：写 `$TEMP/whale-commit-msg-*.txt` ⇒ `git commit -F <文件>` ⇒ **删临时文件**
 *    （不在仓库留垃圾）；git 自己的参数原样透传。
 *
 * 用法（在任一工作树里跑，默认对当前目录的仓库生效）：
 * ```
 * $msg = @'
 * feat(wh): 标题
 *
 * 正文可以多行，随便写「中文引号」和 `反引号`，都不会被 shell 弄坏。
 * '@
 * $msg | npm run commit:msg                       # 无参数：最常用，直接可用
 * $msg | npm run commit:msg '--' --amend          # ⚠ 传 git 参数要把分隔符写成 '--'（见下）
 * $msg | npx tsx tools/commit-msg.ts --add        # 或者干脆直连 tsx（不经 npm，参数最好使）
 * npm run commit:msg -- --file .git/COMMIT_EDITMSG   # --file / --repo 同样建议直连 tsx
 * ```
 * ⚠ **PowerShell 会吃掉第一个裸 `--`**（它把 `--` 当自己的"参数结束"标记）：实测
 * `npm run commit:msg -- --amend` 到不了脚本（npm 收不到转发分隔符 ⇒ 参数被当 npm 配置丢掉，
 * 甚至报 `npm warn Unknown cli config`）⇒ **要么把分隔符写成 `'--'`**（实测可用，npm 侧回声为
 * `tsx tools/commit-msg.ts --amend`）**，要么直连 `npx tsx tools/commit-msg.ts …`**。
 * 本工具自己的参数（`--file` / `--repo` / `--add` / `--dry-run`）也走同一条规矩。
 *
 * **版本自检**：游戏版本 v0.1.0 · 存档结构 **v29** · 最后核对 2026-09-19 · 最后跑过 2026-09-19
 *
 * ⚠ 本工具**只管提交消息**：不跑闸门、不改游戏数据、不碰存档；它是开发流程工具，与玩家可见内容无关。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/** 带值的自有参数（解析时吃掉下一个 token，不转交 git） */
const OWN_FLAGS_WITH_VALUE = new Set(['--repo', '--file'])
/** 「GBK 误读 UTF-8」的典型产物字（出现即高度可疑；只告警、不阻断） */
const MOJIBAKE_HINTS = ['娴', '嬭', '瘯', '鍜', '鏄', '涓', '绾', '諱', '锛', '銆', '鈥', '锟', '烫烫', '屯屯']

interface Cli {
  repo: string
  file: string | null
  add: boolean
  /** 只打印将要执行的 git 命令、不真的提交（排查参数透传用） */
  dryRun: boolean
  /** 原样转交 `git commit` 的参数 */
  rest: string[]
}

function parseCli(): Cli {
  const argv = process.argv.slice(2)
  const out: Cli = { repo: process.cwd(), file: null, add: false, dryRun: false, rest: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (OWN_FLAGS_WITH_VALUE.has(a)) {
      const v = argv[++i]
      if (v === undefined) fail(`${a} 后面缺参数`)
      if (a === '--repo') out.repo = v
      else out.file = v
      continue
    }
    if (a === '--add') {
      out.add = true
      continue
    }
    if (a === '--dry-run') {
      out.dryRun = true
      continue
    }
    if (a === '--') continue // npm 透传时可能留下分隔符本身：吃掉，不当 git 参数
    out.rest.push(a)
  }
  return out
}

function fail(msg: string): never {
  console.error(`❌ ${msg}`)
  process.exit(1)
}

/**
 * **按字节解码 + 编码自检**：UTF-8 优先，失败/出替换符时退 GBK(936)。
 * `via` 会写进汇报行——"下次还中招"时一眼看出走的是哪条路。
 */
function decodeBytes(raw: Buffer): { text: string; via: string } {
  const utf8 = raw.toString('utf8')
  if (!utf8.includes('\uFFFD')) return { text: utf8, via: 'utf-8' }
  try {
    const gbk = new TextDecoder('gbk').decode(raw)
    if (!gbk.includes('\uFFFD') && gbk.trim().length > 0) return { text: gbk, via: 'gbk(936) 回退' }
  } catch {
    /* 该 Node 没带该编码 ⇒ 保持 UTF-8 结果 */
  }
  return { text: utf8, via: 'utf-8（含替换符）' }
}

async function readStdin(): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const c of process.stdin) chunks.push(c as Buffer)
  return Buffer.concat(chunks)
}

async function main(): Promise<void> {
  const cli = parseCli()
  if (!existsSync(join(cli.repo, '.git'))) {
    console.log(`· 提示：${cli.repo} 下没有 .git（worktree 里 .git 是文件、应存在）——继续交给 git 判断`)
  }

  let text: string
  let via: string
  if (cli.file) {
    if (!existsSync(cli.file)) fail(`--file 指向的文件不存在：${cli.file}`)
    text = readFileSync(cli.file, 'utf8')
    via = `读取文件 ${cli.file}`
  } else {
    if (process.stdin.isTTY) {
      fail('没有从 stdin 收到消息。用法见本工具头注释：把消息 here-string 管进来，或用 --file <路径>')
    }
    const raw = await readStdin()
    if (raw.length === 0) fail('stdin 是空的：消息没传进来（here-string 是否忘了管进管道？）')
    const dec = decodeBytes(raw)
    text = dec.text
    via = dec.via
  }

  /** 归一：去 BOM、行尾统一 LF、去掉结尾多余空行（git 自己会补一个换行） */
  const msg = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/\n+$/, '')
  if (msg.trim().length === 0) fail('消息是空的（只有空白）——拒绝提交空消息')
  const lines = msg.split('\n')
  const subject = lines[0]!.trim()
  if (subject.length === 0) fail('首行（标题）为空')
  if (subject.length > 100) console.log(`⚠ 标题 ${subject.length} 字偏长（本仓习惯一条 ≤ 100 字）`)
  const quotes = (msg.match(/"/g) ?? []).length
  if (quotes > 0) {
    console.log(
      `⚠ 消息里有 ${quotes} 个半角双引号：到这里已是无害文本，但**引号很可能在命令行那一步就被 PowerShell 吞掉**了` +
        `（真被吞时本工具看不出来）⇒ 建议正文改用「」，或继续走 here-string + 管道（本路径安全）`,
    )
  }
  const hintHit = MOJIBAKE_HINTS.filter((h) => msg.includes(h))
  if (hintHit.length > 0) {
    console.log(`⚠ 疑似乱码特征字 ${hintHit.join(' ')}：请核对下面的预览，必要时改用 --file 传消息`)
  }

  console.log(`· 消息来源：${via} · ${lines.length} 行 / ${msg.length} 字 · 写出无 BOM UTF-8、行尾 LF`)
  console.log('· 预览（确认中文与引号没坏）：')
  for (const [i, l] of lines.entries()) console.log(`    ${String(i + 1).padStart(2, ' ')}│ ${l}`)

  const tmp = join(tmpdir(), `whale-commit-msg-${process.pid}.txt`)
  writeFileSync(tmp, `${msg}\n`, { encoding: 'utf8' })
  if (cli.dryRun) {
    console.log('· --dry-run：以下命令**不会真的执行**')
    if (cli.add) console.log(`    git -C ${cli.repo} add -A`)
    console.log(`    git -C ${cli.repo} commit -F ${tmp} ${cli.rest.join(' ')}`.trimEnd())
    try {
      unlinkSync(tmp)
    } catch {
      /* 忽略 */
    }
    return
  }
  try {
    if (cli.add) {
      const add = spawnSync('git', ['-C', cli.repo, 'add', '-A'], { stdio: 'inherit' })
      if (add.error) fail(`git 起不来：${add.error.message}`)
      if (add.status !== 0) fail(`git add -A 失败（exit ${add.status}）`)
    }
    const r = spawnSync('git', ['-C', cli.repo, 'commit', '-F', tmp, ...cli.rest], { stdio: 'inherit' })
    if (r.error) fail(`git 起不来：${r.error.message}`)
    if (r.status !== 0) {
      if (cli.rest.length === 0) {
        console.error(
          '· 提示：若你本意是传 git 参数（如 --amend）却看到"nothing staged / 没有要提交的改动"，' +
            "多半是 PowerShell 吃掉了第一个裸 `--` ⇒ 改写成 `npm run commit:msg '--' --amend`，" +
            '或直连 `npx tsx tools/commit-msg.ts --amend`',
        )
      }
      fail(`git commit 失败（exit ${r.status}）——消息文件已删除，改完重跑即可`)
    }
    const head = spawnSync('git', ['-C', cli.repo, 'log', '-1', '--format=%h %s'], { encoding: 'utf8' })
    const rec = spawnSync('git', ['-C', cli.repo, 'log', '-1', '--format=%B'], { encoding: 'utf8' })
    const recLines = (rec.stdout ?? '').replace(/\n+$/, '').split('\n').length
    console.log(`✅ 已提交：${(head.stdout ?? '').trim()}`)
    console.log(`· 仓库里记录的正文：${recLines} 行（与上面预览一致即可放心）`)
  } finally {
    try {
      unlinkSync(tmp)
    } catch {
      /* 临时文件删不掉不影响提交结果 */
    }
  }
}

void main()
