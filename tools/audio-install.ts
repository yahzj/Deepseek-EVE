/**
 * **音效正式入库安装器**（2026-11-04）—— 音效台导出入库包 → 写入仓库正式素材。
 *
 * 用途：船长在本机音效台把成品音效逐条导入并试听后，点「导出正式入库包」得到
 * `whale-sfx-pack-*.zip`；本工具在仓库根校验该包（语义 id / 目录 / 扩展名 / 字节数 / CRC）
 * 并写入 `apps/desktop/src/renderer/src/assets/{sfx,bgm,ambient}/`，让桌面版与网页版构建
 * 都把它当正式素材（缺文件 = 静音；本机覆盖仍优先，入库后到音效台「全部清除」即可听到）。
 *
 * 运行：
 *   `npm run audio:install`                          # 自动找仓库根/下载目录里最新的入库包
 *   `npm run audio:install -- "C:\path\pack.zip"`    # 显式指定（注意 `--` 分隔）
 *   选项：`--dry-run` 只预览；`--keep-variants` 保留同事件旧扩展名文件
 *
 * 口径：
 * - 只认 `game/audio/sfxPack.ts` 的包格式 v1（store-only zip + manifest.json）；不写半个包：
 *   任何校验失败都直接退出 1，不改进程中途的素材目录；
 * - 同一事件重新入库时，默认移除目标目录里同语义 id 的**其它扩展名/变体文件**
 *   （否则新旧素材会被 `manifest.ts` 当成多份变体随机播放）；`--keep-variants` 可保留；
 * - 不读个人档、不改存档、不动 `cues.ts`：素材文件名与语义 id 的对应关系是既有约定；
 * - 写入后打印覆盖度与下一步（`audio:check` / 音效台全部清除 / `git status`）。
 *
 * **版本自检**：游戏版本 v0.1.0 · 存档结构 **v31** · 最后核对 2026-11-04 · 最后跑过 2026-11-04
 * 判据：`CURRENT_STATE_VERSION` 跨一个大版本，或音效语义清单/素材目录约定/包格式改动后必须重跑并更新本行。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  SFX_PACK_ASSETS_ROOT,
  SfxPackError,
  parseSfxPack,
} from '../apps/desktop/src/renderer/src/game/audio/sfxPack'
import type { SfxPackFile, SfxPackManifest } from '../apps/desktop/src/renderer/src/game/audio/sfxPack'
import { SFX_CUES, SFX_CUE_IDS } from '../apps/desktop/src/renderer/src/game/audio/cues'
import { isAudioFileName, matchSfxFileName } from '../apps/desktop/src/renderer/src/game/audio/rules'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PACK_NAME_RE = /^whale-sfx-pack-.*\.zip$/i

/** 素材目录的推荐体积上限（与三份 assets README 的建议一致；超了只警告不阻断） */
const SIZE_WARN_BYTES: Record<string, number> = {
  sfx: 300 * 1024,
  bgm: 5 * 1024 * 1024,
  ambient: 2 * 1024 * 1024,
}

export interface InstallOptions {
  /** 素材根目录（正常 = 仓库 assets；测试可传临时目录） */
  readonly assetsRoot: string
  /** 只预览，不写文件 */
  readonly dryRun?: boolean
  /** 保留同语义 id 的旧扩展名/变体文件 */
  readonly keepVariants?: boolean
}

export interface InstallReport {
  /** 清单里的全部目标相对路径（`<目录>/<id>.<ext>`） */
  readonly planned: readonly string[]
  /** 新写入的文件（相对路径） */
  readonly written: readonly string[]
  /** 覆盖已有同路径文件（相对路径） */
  readonly overwritten: readonly string[]
  /** 已存在且字节一致，未动（相对路径） */
  readonly skipped: readonly string[]
  /** 被移除的同事件旧扩展名/变体文件（相对路径；dry-run 时是"将移除"） */
  readonly removedVariants: readonly string[]
  /** 只警告、不影响成功的事项 */
  readonly warnings: readonly string[]
  /** 安装后素材目录覆盖度 */
  readonly coverage: { readonly covered: number; readonly total: number; readonly missing: readonly string[] }
  readonly dryRun: boolean
}

function readExisting(path: string): Uint8Array | null {
  try {
    return new Uint8Array(readFileSync(path))
  } catch {
    return null
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/** 扫描素材目录，返回覆盖的语义 id（与 `manifest.ts` / `audio-check` 同口径） */
function scanCoverage(assetsRoot: string): InstallReport['coverage'] {
  const covered = new Set<string>()
  for (const dir of ['sfx', 'bgm', 'ambient'] as const) {
    const fullDir = join(assetsRoot, dir)
    if (!existsSync(fullDir)) continue
    for (const name of readdirSync(fullDir)) {
      if (!isAudioFileName(name)) continue
      const cueId = matchSfxFileName(name)
      if (cueId !== null) covered.add(cueId)
    }
  }
  const missing = SFX_CUE_IDS.filter((id) => !covered.has(id))
  return { covered: covered.size, total: SFX_CUE_IDS.length, missing }
}

/** 包内的一条素材目标绝对路径 */
function targetPathOf(assetsRoot: string, file: SfxPackFile): string {
  return join(assetsRoot, file.dir, basename(file.path))
}

/**
 * 校验并安装入库包字节。
 * 校验失败抛 `SfxPackError`（调用方决定打印/退出）；成功返回逐项报告。
 * **不**在中途失败：所有校验（解析）先完成，再统一写盘。
 */
export function installSfxPack(bytes: Uint8Array, options: InstallOptions): InstallReport {
  const parsed = parseSfxPack(bytes)
  const assetsRoot = options.assetsRoot
  const dryRun = options.dryRun === true
  const keepVariants = options.keepVariants === true
  const warnings: string[] = []
  const written: string[] = []
  const overwritten: string[] = []
  const skipped: string[] = []
  const removedVariants: string[] = []

  for (const { file, data } of parsed.files) {
    const relative = `${file.dir}/${basename(file.path)}`
    const dir = join(assetsRoot, file.dir)
    const target = targetPathOf(assetsRoot, file)
    const existing = readExisting(target)
    const identical = existing !== null && sameBytes(existing, data)
    if (identical) {
      skipped.push(relative)
      continue
    }
    if (existing !== null) {
      overwritten.push(relative)
      if (!dryRun) writeFileSync(target, data)
    } else {
      written.push(relative)
      if (!dryRun) {
        mkdirSync(dir, { recursive: true })
        writeFileSync(target, data)
      }
    }

    // 同事件旧文件（不同扩展名/变体）：默认移除，避免新旧素材随机混播。
    // 只在这次真要写/覆盖该事件时清理；字节一致而跳过时不动船长手工放的变体。
    let siblings: string[] = []
    try {
      siblings = existsSync(dir) ? readdirSync(dir) : []
    } catch {
      siblings = []
    }
    for (const name of siblings) {
      if (!isAudioFileName(name)) continue
      if (name === basename(file.path)) continue
      if (matchSfxFileName(name) !== file.cueId) continue
      const siblingRel = `${file.dir}/${name}`
      if (keepVariants) {
        warnings.push(`保留旧变体：${siblingRel}（会与新素材随机混播；确认不需要可手动删除或去掉 --keep-variants）`)
        continue
      }
      removedVariants.push(siblingRel)
      if (!dryRun) {
        try {
          rmSync(join(dir, name))
        } catch (err) {
          warnings.push(`移除旧变体失败：${siblingRel}（${err instanceof Error ? err.message : String(err)}）`)
        }
      }
    }

    const warnBytes = SIZE_WARN_BYTES[file.dir]
    if (warnBytes !== undefined && data.length > warnBytes) {
      warnings.push(`体积偏大：${relative} 为 ${(data.length / 1024 / 1024).toFixed(2)}MB（建议 ≤${(warnBytes / 1024 / 1024).toFixed(1)}MB）`)
    }
    if (file.ext !== 'mp3') {
      warnings.push(`扩展名建议 mp3：${relative}（Safari 网页版对 ogg 支持有限；mp3 是推荐格式）`)
    }
  }

  if (!existsSync(assetsRoot) && !dryRun) mkdirSync(assetsRoot, { recursive: true })
  const coverage = scanCoverage(assetsRoot)
  return { planned: parsed.files.map((entry) => `${entry.file.dir}/${basename(entry.file.path)}`), written, overwritten, skipped, removedVariants, warnings, coverage, dryRun }
}

/* ═══════════ CLI ═══════════ */

/** 在候选目录里找最新的 `whale-sfx-pack-*.zip`（只读目录，不写任何东西） */
export function findLatestPack(candidates: readonly string[]): string | null {
  let best: { path: string; mtimeMs: number } | null = null
  for (const dir of candidates) {
    if (dir === '' || !existsSync(dir)) continue
    let names: string[] = []
    try {
      names = readdirSync(dir).filter((name) => PACK_NAME_RE.test(name))
    } catch {
      continue
    }
    for (const name of names) {
      const path = join(dir, name)
      try {
        const mtimeMs = statSync(path).mtimeMs
        if (best === null || mtimeMs > best.mtimeMs) best = { path, mtimeMs }
      } catch {
        /* 读不到就跳过 */
      }
    }
  }
  return best?.path ?? null
}

interface CliArgs {
  readonly packPath: string | null
  readonly dryRun: boolean
  readonly keepVariants: boolean
  readonly help: boolean
}

function parseArgs(argv: readonly string[]): CliArgs {
  let packPath: string | null = null
  let dryRun = false
  let keepVariants = false
  let help = false
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') help = true
    else if (arg === '--dry-run') dryRun = true
    else if (arg === '--keep-variants') keepVariants = true
    else if (arg.startsWith('--pack=')) packPath = arg.slice('--pack='.length)
    else if (!arg.startsWith('--')) packPath = arg
    else throw new Error(`未知选项：${arg}（可用：--dry-run / --keep-variants / --help）`)
  }
  return { packPath, dryRun, keepVariants, help }
}

function printUsage(): void {
  console.log(`用法：npm run audio:install [-- <入库包路径>] [--dry-run] [--keep-variants]

  不带路径时，自动在仓库根、用户「下载」目录里找最新的 whale-sfx-pack-*.zip。
  入库包由 设置 →「声音」→「音效台」→「导出正式入库包」生成。
  --dry-run        只预览，不写文件
  --keep-variants  保留同一事件的旧扩展名/变体文件（默认移除）`)
}

function printReport(report: InstallReport): void {
  console.log(`\n${report.dryRun ? '· [--dry-run] 预览模式，未写文件' : '· 已写入素材'}`)
  console.log(`  新增 ${report.written.length} 条${report.dryRun ? '（将新增）' : ''}：${report.written.join('、') || '无'}`)
  console.log(`  覆盖 ${report.overwritten.length} 条${report.dryRun ? '（将覆盖）' : ''}：${report.overwritten.join('、') || '无'}`)
  if (report.skipped.length > 0) console.log(`  跳过 ${report.skipped.length} 条（字节一致）：${report.skipped.join('、')}`)
  if (report.removedVariants.length > 0) {
    console.log(`  ${report.dryRun ? '将移除' : '已移除'}同事件旧变体 ${report.removedVariants.length} 条：${report.removedVariants.join('、')}`)
  }
  for (const warning of report.warnings) console.log(`  ⚠ ${warning}`)
  const { covered, total, missing } = report.coverage
  console.log(`· 素材覆盖：${covered}/${total} 个语义事件`)
  if (missing.length > 0) console.log(`  · 仍未接入（缺 = 静音）：${missing.join('、')}`)
}

function main(argv: readonly string[]): number {
  let args: CliArgs
  try {
    args = parseArgs(argv)
  } catch (err) {
    console.error(`✗ ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }
  if (args.help) {
    printUsage()
    return 0
  }

  const assetsRoot = join(REPO_ROOT, SFX_PACK_ASSETS_ROOT)
  if (!existsSync(join(assetsRoot, 'sfx'))) {
    console.error(`✗ 找不到素材目录：${assetsRoot}（请在仓库根运行本工具）`)
    return 1
  }

  const packPath = args.packPath !== null ? resolve(args.packPath) : findLatestPack([REPO_ROOT, join(homedir(), 'Downloads'), join(homedir(), '下载')])
  if (packPath === null) {
    console.error('✗ 没找到入库包：先用音效台「导出正式入库包」，或显式指定路径')
    printUsage()
    return 1
  }
  if (!existsSync(packPath)) {
    console.error(`✗ 入库包不存在：${packPath}`)
    return 1
  }
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(readFileSync(packPath))
  } catch (err) {
    console.error(`✗ 读取入库包失败：${err instanceof Error ? err.message : String(err)}`)
    return 1
  }
  console.log(`· 入库包：${packPath}（${(bytes.length / 1024).toFixed(1)}KB）`)

  let manifest: SfxPackManifest
  try {
    // 先解析一次，错误信息统一由 SfxPackError 打印；安装函数内部会再解析（幂等、纯内存）
    manifest = parseSfxPack(bytes).manifest
  } catch (err) {
    if (err instanceof SfxPackError) {
      console.error(`✗ 入库包校验失败 ${err.errors.length} 项：`)
      for (const item of err.errors) console.error(`  - ${item}`)
    } else {
      console.error(`✗ 入库包校验失败：${err instanceof Error ? err.message : String(err)}`)
    }
    return 1
  }
  console.log(`· 清单：${manifest.files.length} 条素材 · 生成于 ${manifest.createdAt}`)
  for (const file of manifest.files) {
    const cueName = SFX_CUES[file.cueId]?.nameId ?? ''
    console.log(`    ${file.path}  ←  ${file.fileName}（${(file.bytes / 1024).toFixed(1)}KB${cueName ? `，${cueName}` : ''}）`)
  }

  let report: InstallReport
  try {
    report = installSfxPack(bytes, { assetsRoot, dryRun: args.dryRun, keepVariants: args.keepVariants })
  } catch (err) {
    console.error(`✗ 安装失败：${err instanceof Error ? err.message : String(err)}`)
    return 1
  }
  printReport(report)
  if (!report.dryRun) {
    console.log(`\n下一步：`)
    console.log(`  1) npm run audio:check            声音系统自检（素材目录/清单/本地化）`)
    console.log(`  2) 设置 →「声音」→「音效台」→「全部清除」  本机覆盖优先，清掉后才听到刚入库的正式素材`)
    console.log(`  3) git status                     核对新增素材与来源登记后提交`)
  }
  return 0
}

// 被 `audio-check` import 时不执行 CLI；只有直接 `tsx tools/audio-install.ts` 才跑
const invokedPath = process.argv[1] !== undefined ? resolve(process.argv[1]) : ''
if (invokedPath.endsWith('audio-install.ts')) {
  try {
    process.exitCode = main(process.argv.slice(2))
  } catch (err) {
    console.error(`✗ 入库失败：${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
  }
}
