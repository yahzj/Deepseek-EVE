/**
 * **Steam 上传（SteamPipe）** —— 2026-09-27 船长令配套件（打包见 `tools/steam-pack.ts`）。
 *
 * Steam **只支持用 `steamcmd` 上传 build**（Steamworks 网页没有上传入口），所以本工具做三件事：
 *   1. 找到 `steamcmd`（顺序：`--steamcmd <路径>` → 环境变量 `STEAMCMD` → 常见安装位置 → PATH）；
 *   2. 找 `steam/app_build_<AppID>.vdf`（AppID 读 `steam/config.json`；没打包过就提示先跑 `steam:pack`）；
 *   3. 打印并（加 `--run` 时）执行：
 *        `steamcmd +login <账号> +run_app_build "<vdf 绝对路径>" +quit`
 *
 * 用法：
 *   npm run steam:upload                       # 只打印命令与前置检查（不执行）
 *   npm run steam:upload -- --user <账号> --run # 真的上传（会交互式要密码/邮箱令牌）
 *   npm run steam:upload -- --steamcmd "D:\steamcmd\steamcmd.exe" --run
 *
 * ⚠ 首次使用建议先手动跑一次 `steamcmd +login <账号>` 让 Steam 记住凭证与 Steam Guard，
 *   之后本工具都能一键上传；账号没有该 App 的权限时 steamcmd 会明确报错（找 Steamworks 管理员开权限）。
 *
 * **版本自检**（口径同「旧数据不可靠」）：
 *   - 游戏版本：**v0.1.0**（`package.json`）· 存档结构：**v31**（`CURRENT_STATE_VERSION`）
 *   - 本工具最后核对：**2026-09-27** · 最后跑过：**2026-09-27**
 *   - 触发复核：electron / electron-builder 大版本升级、或 `electron-builder.yml` 的 productName / 目标平台改动 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}

function findSteamCmd(): string | undefined {
  const explicit = argValue('--steamcmd') ?? process.env.STEAMCMD
  const candidates = [
    explicit,
    'C:\\steamcmd\\steamcmd.exe',
    join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Steam', 'steamcmd.exe'),
    join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Steam', 'steamcmd.exe'),
    'steamcmd',
  ].filter((x): x is string => typeof x === 'string' && x.length > 0)
  for (const c of candidates) {
    if (c === 'steamcmd') {
      const probe = spawnSync('where', ['steamcmd'], { encoding: 'utf8' })
      return probe.status === 0 ? 'steamcmd' : undefined
    }
    if (existsSync(c)) return c
  }
  return undefined
}

function main(): void {
  const cfgPath = join(ROOT, 'steam', 'config.json')
  if (!existsSync(cfgPath)) {
    console.error('✗ 缺 steam/config.json（appId / depotId / branch 都从这里读）。')
    process.exit(1)
  }
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8')) as { appId?: string; depotId?: string; branch?: string }
  const appId = (argValue('--appid') ?? cfg.appId ?? '').trim()
  const vdf = join(ROOT, 'steam', `app_build_${appId}.vdf`)
  if (!existsSync(vdf)) {
    console.error(`✗ 没找到 ${vdf.replace(ROOT + '\\', '')}：先跑 npm run steam:pack。`)
    process.exit(1)
  }
  if (!cfg.depotId || cfg.depotId.trim().length === 0) {
    console.error('✗ steam/config.json 里 depotId 还是空的：先在 Steamworks 建好 Depot 再填（点击路径见 steam:pack 的输出）。')
    process.exit(1)
  }
  const steamcmd = findSteamCmd()
  if (!steamcmd) {
    console.error('✗ 没找到 steamcmd。装一个（https://developer.valvesoftware.com/wiki/SteamCMD）后：')
    console.error('   · 传路径：npm run steam:upload -- --steamcmd "D:\\steamcmd\\steamcmd.exe" --run')
    console.error('   · 或设环境变量 STEAMCMD')
    process.exit(1)
  }
  const user = (argValue('--user') ?? process.env.STEAM_USER ?? '<你的 Steamworks 账号>').trim()
  const args = ['+login', user, '+run_app_build', vdf, '+quit']
  const cmdline = `"${steamcmd}" ${args.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`

  console.log('前置检查：')
  console.log(`  · steamcmd : ${steamcmd}`)
  console.log(`  · build 脚本: ${vdf.replace(ROOT + '\\', '')}`)
  console.log(`  · AppID ${appId} · DepotID ${cfg.depotId} · 分支 ${cfg.branch ?? 'default'}（setlive 在 app_build vdf 里）`)
  console.log('\n上传命令：')
  console.log(`  ${cmdline}\n`)

  if (!process.argv.includes('--run')) {
    console.log('（当前只是打印。要真上传就加 --run，并保证账号能交互输入密码 / Steam Guard 令牌。）')
    return
  }
  if (user.startsWith('<')) {
    console.error('✗ 没给账号：加 --user <账号>，或设环境变量 STEAM_USER。')
    process.exit(1)
  }
  execFileSync(steamcmd, args, { cwd: ROOT, stdio: 'inherit' })
}

main()
