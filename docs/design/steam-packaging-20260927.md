# Steam 打包与上传（2026-09-27 · 一号 · main）

> 状态：**第一步已落码并本机验证通过**（第二步 = Steamworks 集成，等船长定）
> **船长原话（照抄）**：「**我需要一个打包工具，用于将游戏打包成可以上传 steam 发布运行的文件**」
> ＋「**大鲸鱼-深空工业（5260760），应用界面内抬头后面这个是appid吗？其余先按你推荐来，我有些忘记了要怎么做**」

## 0. 先回答船长那问

**是，`5260760` 就是 AppID**——Steamworks 应用页标题后面括号里的那串数字 = 该应用的 AppID（上传脚本、`steam_appid.txt`、启动选项都用它）。

⚠ **顺带发现一处名字不一致**（不影响上传，但要你定）：
Steamworks 那边显示的是「**大鲸鱼-深空工业**」，而仓库里 `electron-builder.yml` 的 `productName` 是「**大鲸鱼-深空放置**」
⇒ 产物可执行文件叫 `大鲸鱼-深空放置.exe`、Steam 库里的显示名走 Steamworks 那边。要统一的话告诉我改哪边
（改 Steamworks 显示名 = 你去后台改；改 exe 名 = 我改 `productName`，同时启动选项里的 exe 名要跟着改）。

## 1. 本批落了什么

| 文件 | 作用 |
| --- | --- |
| `apps/desktop/electron-builder-steam.yml` | Steam 专用打包配置：**只出未打包目录**（Steam 端不需要安装包），其余全部继承 `electron-builder.yml` |
| `tools/steam-pack.ts` ＋ `npm run steam:pack` | 一条命令：构建（electron-vite）→ `electron-builder --dir --win` → 写 `steam/app_build_<AppID>.vdf` 与 `steam/depot_build_<DepotID>.vdf` → 打印下一步 |
| `tools/steam-upload.ts` ＋ `npm run steam:upload` | 找 `steamcmd` → 校验 vdf → 打印（`--run` 时执行）`steamcmd +login <账号> +run_app_build <vdf> +quit` |
| `steam/config.json` | 参数：`appId`（已填 5260760）· `depotId`（**待你建 Depot 后填**）· `branch`（default/beta）· `description` |
| `.gitignore` | 加 `steam/buildoutput/`（steamcmd 的 build 缓存；config 与 vdf 照旧入库） |

**产物**（本机实测）：`apps/desktop/release/steam/win-unpacked/` = **72 个文件 / 322.4 MB**，
其中 `大鲸鱼-深空放置.exe` 172 MB（**未签名**，与 CI 口径一致）。

## 2. 操作手册（船长照着点就行）

### ① 建 Depot（一次性）
Steamworks → 该应用「大鲸鱼-深空工业 (5260760)」→ **SteamPipe → Depots → 添加 Depot** → 命名 `Windows` →
建好后那一行显示一个数字 ID（形如 `5260761`）⇒ **把这个 DepotID 填进 `steam/config.json` 的 `depotId`**。

### ② 设启动选项（一次性）
Steamworks → 该应用 → **安装 → 通用安装设置 → 启动选项** → 添加一条：
**可执行文件 = `大鲸鱼-深空放置.exe`** · **操作系统 = Windows**（若改了 productName，这里同步改）。

### ③ 装 steamcmd 并首次登录（一次性）
下载 `steamcmd`（Valve 官方）→ 跑一次 `steamcmd +login <你的 Steamworks 账号>`，按提示过 Steam Guard
（这一步让本机记住凭证，之后上传不用再输）。路径不是默认的话：`set STEAMCMD=D:\steamcmd\steamcmd.exe`。

### ④ 打包（每次要传新版时）
```
npm run steam:pack                  # 构建 + 出目录 + 生成两个 vdf
npm run steam:pack -- --skip-build  # 只重出目录（调试参数时快）
npm run steam:pack -- --branch beta # 临时传测试分支
```

### ⑤ 上传
```
npm run steam:upload                          # 只打印命令与前置检查（不执行）
npm run steam:upload -- --user <账号> --run   # 真上传（要交互输密码/令牌）
```
⚠ Steam 端**只能**用 `steamcmd` 上传 build（Steamworks 网页没有上传入口）。
`app_build` 里的 `setlive` 默认留空 ⇒ 上传后**不会自动切分支**，你在 Steamworks 的 Builds 页手动「Set Build Live」。

### ⑥ 验证
Steam 客户端 → 库 → 该应用（你的账号要有该 App 的权限）→ 安装 → 启动；
本地想绕开 Steam 直接试跑：加 `--test-appid` 打包（会写 `steam_appid.txt`），双击 `大鲸鱼-深空放置.exe`。

## 3. 口径与边界（**没做的**都写在这）

- **未接 Steamworks SDK** ⇒ 目前**没有**成就 / 覆盖层 / 云存档 / 创意工坊；存档照旧在 `%APPDATA%\whale-idle`
  （与绿色版/网页版互通，不因上 Steam 而搬家）。
- **exe 未签名**：Steam 内启动无影响；站外双击会有 SmartScreen 提示（与 CI 现状一致）。
- **只 Windows x64**（与现有 `electron-builder.yml` 一致）；要 macOS/Linux 另开一批（macOS 还要签名＋公证）。
- zip / NSIS 安装包**保留**（站外分发用），Steam 只吃 `win-unpacked/`。
- 未加 CI 的 Steam 上传 job（需要仓库 secrets：`STEAM_USERNAME` / `STEAM_PASSWORD` / `STEAM_GUARD_CODE`）——要就说。

## 4. 验证读数

- `npm run steam:pack` 实跑通过：`packaging platform=win32 arch=x64 electron=31.7.7 appOutDir=release\steam\win-unpacked`
  （Electron 预编译包命中本机缓存，**离线可打**）。
- 产物：72 文件 / 322.4 MB；`Get-AuthenticodeSignature` = **NotSigned**（预期）。
- `steam/app_build_5260760.vdf` 生成正确（appid / desc / buildoutput / contentroot / setlive / depots 段俱在，
  路径转义为双反斜杠）；depotId 未填时打印"怎么拿到 DepotID"的点击路径并以占位符生成。
- `npm run steam:upload` 在 depotId 为空时按预期停下并给出指引。
- `npm run tools:audit`：两个新工具已登记版本自检（`记录 v31 · 最后核对 2026-09-27 · 最后跑过 2026-09-27`）。

## 5. 归档待办（船长验收 ＋ 合入后）

关键内容并入 roadmap 一条（含"Steam 上传只走 steamcmd"与 AppID/Depot 的填法），随后删本工作文档并重跑 `docs:index`。
