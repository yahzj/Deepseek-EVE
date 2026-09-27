/**
 * **Steam 打包（SteamPipe 内容目录 ＋ 两个 vdf）** —— 2026-09-27 船长令：
 * 「**我需要一个打包工具，用于将游戏打包成可以上传 steam 发布运行的文件**」。
 *
 * 产出什么（Steam 端不需要安装包，这点和站外分发相反）：
 *   1. `apps/desktop/release/steam/win-unpacked/` —— **解包后的游戏目录**（= 要上传的内容根）；
 *   2. `steam/app_build_<AppID>.vdf` —— SteamPipe 的 build 脚本（引用下面的 depot）；
 *   3. `steam/depot_build_<DepotID>.vdf` —— depot 的内容映射（内容根 ＋ `*` 递归 ＋ 排除调试符号）。
 *
 * 用法：
 *   npm run steam:pack                  # 构建（electron-vite）→ electron-builder --dir → 生成两个 vdf
 *   npm run steam:pack -- --skip-build  # 复用现有 out/（调试打包参数时快很多）
 *   npm run steam:pack -- --test-appid  # 额外写 `steam_appid.txt`（**只在 Steam 外本地测试时用**，
 *                                       #   发布目录默认不写：Steam 启动时会自己注入 AppID）
 *   npm run steam:pack -- --depot 5260761 --branch beta   # 临时覆盖 config.json 里的值
 *
 * 上传（另一步，见 `tools/steam-upload.ts`）：产物生成后跑 `npm run steam:upload`。
 *
 * ⚠ 参数来源：`steam/config.json`（appId / depotId / branch / description）。**depotId 为空**时
 *   本工具仍会生成目录与 app_build vdf（depot 段留占位），并打印"怎么拿到 DepotID"的点击路径。
 *
 * **版本自检**（口径同「旧数据不可靠」）：
 *   - 游戏版本：**v0.1.0**（`package.json`）· 存档结构：**v31**（`CURRENT_STATE_VERSION`）
 *   - 本工具最后核对：**2026-09-27** · 最后跑过：**2026-09-27**
 *   - 触发复核：electron / electron-builder 大版本升级、或 `electron-builder.yml` 的 productName / 目标平台改动 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const ROOT = process.cwd()
const DESKTOP = join(ROOT, 'apps', 'desktop')
const STEAM_DIR = join(ROOT, 'steam')
const CONFIG_PATH = join(STEAM_DIR, 'config.json')
const STEAM_CONFIG = join(DESKTOP, 'electron-builder-steam.yml')
const UNPACKED = join(DESKTOP, 'release', 'steam', 'win-unpacked')
const BUILD_OUTPUT = join(STEAM_DIR, 'buildoutput')

/** 从 `electron-builder.yml` 读 productName（exe 名与它一致，不手抄） */
function productNameOf(): string {
  const yml = readFileSync(join(DESKTOP, 'electron-builder.yml'), 'utf8')
  const m = /^productName:\s*(.+)$/m.exec(yml)
  return (m?.[1] ?? 'app').trim()
}

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}

function run(cmd: string, args: string[], cwd: string): void {
  console.log(`\n▸ ${cmd} ${args.join(' ')}   （cwd: ${cwd.replace(ROOT, '.')}）`)
  execFileSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' })
}

/** SteamPipe 的键值文本格式（缩进两格；路径用双反斜杠） */
function vdf(lines: ReadonlyArray<readonly [string, string]>, blocks: ReadonlyArray<{ key: string; body: string[] }> = []): string {
  const out: string[] = ['"appbuild"', '{']
  for (const [k, v] of lines) out.push(`  "${k}" "${v.replace(/\\/g, '\\\\')}"`)
  for (const b of blocks) {
    out.push(`  "${b.key}"`, '  {')
    for (const l of b.body) out.push(`    ${l}`)
    out.push('  }')
  }
  out.push('}', '')
  return out.join('\n')
}

function main(): void {
  const skipBuild = process.argv.includes('--skip-build')
  const testAppId = process.argv.includes('--test-appid')
  const cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as {
    appId?: string
    depotId?: string
    branch?: string
    description?: string
  }
  const appId = (argValue('--appid') ?? cfg.appId ?? '').trim()
  const depotId = (argValue('--depot') ?? cfg.depotId ?? '').trim()
  const branch = (argValue('--branch') ?? cfg.branch ?? 'default').trim()
  if (appId.length === 0) {
    console.error('✗ 缺 AppID：请在 steam/config.json 里填 appId，或传 --appid <数字>。')
    process.exit(1)
  }
  const productName = productNameOf()

  if (!skipBuild) run('npm', ['run', 'build', '-w', '@whale/desktop'], ROOT)
  else console.log('· --skip-build：复用现有 apps/desktop/out/')
  run('npx', ['electron-builder', '--win', '--dir', '--publish', 'never', '--config', STEAM_CONFIG], DESKTOP)

  const exe = join(UNPACKED, `${productName}.exe`)
  if (!existsSync(exe)) {
    console.error(`✗ 没找到可执行文件：${exe}\n  产物结构可能变了 ⇒ 看 apps/desktop/release/steam/ 下有什么。`)
    process.exit(1)
  }
  /** ⚠ `steam_appid.txt` 是"Steam 外本地测试"用的；发布目录默认不写（Steam 启动时自己注入 AppID） */
  if (testAppId) {
    writeFileSync(join(UNPACKED, 'steam_appid.txt'), `${appId}\n`, 'utf8')
    console.log(`· 已写 steam_appid.txt（${appId}）——仅本地测试用`)
  }

  mkdirSync(BUILD_OUTPUT, { recursive: true })
  const appVdf = join(STEAM_DIR, `app_build_${appId}.vdf`)
  const depotVdf = join(STEAM_DIR, `depot_build_${depotId || '<DepotID>'}.vdf`)
  const body = vdf(
    [
      ['appid', appId],
      ['desc', `${cfg.description ?? productName} · ${new Date().toISOString().slice(0, 10)}`],
      ['buildoutput', BUILD_OUTPUT],
      ['contentroot', UNPACKED],
      ['setlive', branch === 'default' ? '' : branch],
      ['preview', '0'],
    ],
    [
      {
        key: 'depots',
        body: [`"${depotId || '<DepotID>'}" "${depotVdf.replace(/\\/g, '\\\\')}"`],
      },
    ],
  )
  writeFileSync(appVdf, body, 'utf8')
  if (depotId) {
    writeFileSync(
      depotVdf,
      [
        '"DepotBuildConfig"',
        '{',
        `  "DepotID" "${depotId}"`,
        `  "contentroot" "${UNPACKED.replace(/\\/g, '\\\\')}"`,
        '  "FileMapping"',
        '  {',
        '    "LocalPath" "*"',
        '    "DepotPath" "."',
        '    "recursive" "1"',
        '  }',
        // 调试符号与临时件不进 depot（Steam 只发玩家要跑的东西）
        '  "FileExclusion" "*.pdb"',
        '  "FileExclusion" "**/*.pdb"',
        '  "FileExclusion" "steam_appid.txt"',
        '}',
        '',
      ].join('\n'),
      'utf8',
    )
  }

  const rel = (p: string): string => p.replace(ROOT + '\\', '').replace(ROOT + '/', '')
  console.log('\n✅ 打包完成')
  console.log(`   内容目录（要上传的东西）：${rel(UNPACKED)}`)
  console.log(`   可执行文件：${productName}.exe`)
  console.log(`   build 脚本：${rel(appVdf)}`)
  if (depotId) console.log(`   depot 脚本：${rel(depotVdf)}`)
  console.log('\n下一步：')
  if (!depotId) {
    console.log('   ① Steamworks → 该应用 → **SteamPipe → Depots → 新建 Depot**（命名「Windows」）')
    console.log('   ② 把那一行的 DepotID 填进 steam/config.json 的 depotId，再跑一次本命令')
  } else {
    console.log('   ① 把上面两行路径里的内容核对一遍（app_build 里 setlive = ' + (branch === 'default' ? '空（不自动切分支）' : branch) + '）')
    console.log('   ② 上传：npm run steam:upload   （或自己跑 steamcmd，命令见 tools/steam-upload.ts 的输出）')
  }
  console.log('   ③ Steamworks → 该应用 → 安装 → 通用安装设置 → **启动选项**：可执行文件填 ' + `${productName}.exe` + '，操作系统选 Windows')
  void dirname
  void resolve
}

main()
