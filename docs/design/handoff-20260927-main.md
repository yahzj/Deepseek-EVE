# 交接卡：接一号班（主树 `main` · 2026-09-27）

- **一句话**：主树侧这一轮「报障修复 ＋ 全流程体检 ＋ Steam 打包工具」都已落码；**`main` 本地领先 `origin` 若干提交、尚未推送**，接手第一件事就是等船长一句话把本地提交推上去，然后按 §6 的挂账继续。
- 本卡写给**零上下文的接手人（下一个"一号"）**：先读 `AGENTS.md` → `docs/catalog.md` → 本卡，再动手。
- 状态：**交接中**（本轮工作文档已按 §8 归档进 `docs/roadmap.md` 最近批次 ＋ 封存卷；本卡本身是交接件，工作结束后归档）

---

## §0 一分钟开工

| 项 | 值 |
|---|---|
| 工作树 | 主树 `H:\大鲸鱼\Deepseek-EVE`（`main`，一号与船长独占）· 二号 `H:\大鲸鱼\Deepseek-EVE-d2`（`d2/workspace`）· 三号 `H:\大鲸鱼\Deepseek-EVE-verify`（`verify`） |
| 基线 | **开工先三处各跑 `git log --oneline -1` ＋ `git status --short` 对表**；合入前主树必须干净 |
| 远端 | `origin` = `https://github.com/yahzj/Deepseek-EVE.git` ⚠ **直连不通**，见 §5-1 |
| 主闸门 | `npm run typecheck` · `npm run test -w @whale/core` · `npm run content:check` · `npm run l10n:check` |
| UI 改动另加 | `npm run ui:rot-check` · `npm run ui:theme-check` · `npm run ui:tip-check` · 改了 CSS 必跑 `npm run ui:layout-css`（＋`:check`） |
| 结构改动 | `npm run build` · 随档字段另跑 `npm run save:roundtrip-audit` |
| 文档改动 | `npm run docs:index`（改完必跑）· 归档收尾 `npm run docs:seal -- --dry-run` 再执行 |
| 汇报口径 | **每次汇报第一行写「报告老大喵」**（船长 2026-09-27 令）· **思考呈现一律中文**（`AGENTS.md` §1） |

---

## §1 你的边界（与前几任一号同一套）

1. **主树只归一号与船长**：二号/三号永不写主树；你合入前先确认对方已提交（工作树干净）。
2. **完成即合入**：一件工作自测全绿后合回 `main`（先解冲突，主树干净才 merge）。
3. **推送闸门**：开发中只本地 commit；**只有船长说"推送"才推** origin（大更时公告稿要先过审入 `announcements.ts`）。
4. **归档三步（§8）**：工作期间只改自己的工作文档；船长验收 ＋ 合入后 ① 关键内容并入 roadmap/词典 ② 删工作文档 ③ 重跑 `docs:index`。
5. **禁止子代理 / workflow / Ralph**（§5.1）；**一律不许关浏览器**（§6，只 kill 自己起的 PID）；**UI 观感归船长**（读数型探针可以跑）。
6. **报障口径**（约定 §二）：玩家报障**不在本地存档** ⇒ 从代码与真引擎复现（探针 `tools/_*.ts` 用完即删），结论要写清 ①复现路径 ②根因（代码位置） ③玩家可见现象为什么长这样 ④改法与影响面。

---

## §2 本会话交付（提交号可直接 `git show`）

| 提交 | 内容 | 状态 |
|---|---|---|
| `b35b4f55` | **黑匣/旗舰残骸落点改物品仓库**（船长批「甲」）＋ **遭遇战收尾两支路同源**（原本"进函数时战斗已结束"那一支漏结算 ⇒ 击沉母舰的伤害/进度/黑匣全丢、面板永远「未击沉」） | 已推送 |
| `3201b8a0` | **旗舰战后章鱼人冷却 60 秒**（停工期不削血、不判得手；只有旗舰战触发；随档） | 已推送 |
| `93bb668a` | **H 族稀有残骸改混池**（主题件由"H 三件"改 D 高安组同款 `mod-shield-pla-2` ⇒ 专属只占 10%） | 已推送 |
| `4df253be` | **修玩家报障**：取消技能时"连带取消"清单误列同一批 10 项（判据补基线，只报/只删"因本次取消才失效"的项） | 已推送 |
| `3f3b884a` | 全流程体检记录（主闸门 13 项全绿 · 浏览器类 4/6 · 旧工具确证清单） | **本地未推送** |
| `4cb7758f` | **Steam 打包与上传工具**（`steam:pack` / `steam:upload` ＋ `electron-builder-steam.yml` ＋ `steam/config.json`，AppID 5260760） | **本地未推送** |
| 本轮归档提交 | roadmap 最近批次 ＋5 条（含封存 4 条进 `docs/archive/roadmap-2026-09-26.md`）· 删 5 份工作文档 | **本地未推送** |

---

## §3 现状要点（接手前必须知道）

- **存档结构 v31**（`CURRENT_STATE_VERSION`）；真实档在 `%APPDATA%\whale-idle\save.json`（**只读**，绝不覆写）。
- **入侵已对玩家开放**：共享血条 `剩余 = 150,000 −（玩家已伤 ＋ 章鱼人已削）`，削血窗口正常 24h；**旗舰战后章鱼人停工 60 秒**（`ev.octopusHoldUntilWallMs`）。
- **战利品落点**：旗舰黑匣与稀有残骸走 `addWare` = **进物品仓库**（不再进驾驶船货舱）；`addItem` 在"驾驶船不在舰队里"时**兜底入仓库**。
- **H 族残骸**：`h-hi` 组主题件 = `mod-shield-pla-2`（通用 MK2）；H 三件（`FOE_LAIR_GEAR.H`）**只走稀有箱专属支（绝境档 10%）**。
- **技能队列**：取消级联只算"因本次取消才失效"的项（基线 `preexistingUnmet`）。
- **Steam**：`npm run steam:pack` 出 `apps/desktop/release/steam/win-unpacked/`（实测 72 文件 / 322.4 MB）＋ 生成 `steam/app_build_5260760.vdf`；`npm run steam:upload` 走 `steamcmd`。**DepotID 还没填、启动选项还没设、还没上传过**（见 §6）。
- 生成物**不入库**：`apps/desktop/release/`、`steam/buildoutput/`、生成的 `*.vdf` 都在 `.gitignore` 里。

---

## §4 别人在改什么（别替他们归档/删除）

`docs/design/` 下这些工作文档**不是你的**，只读、不要动：

- 二号：`assembler-lazy-mount-20260927.md` · `steam-shots-20260927.md` · `industry-ui-opt-20260926.md` · `ship-plug-20260926.md` · `ship-wreck-20260926.md` · `invasion-kill-roll-20260926.md` · `flagship-kill-record-20260927.md` · `weekend-window-96h-20260927.md` · `standing-clawback-blackbox-20260926.md` · `plug-cargo-and-fit-slot-20260926.md` · `ecm-stacking-copy-20260926.md` · `announcement-draft-20260926-battleships.md` · `handoff-20260926-to-pilot2.md`（旧二号的交接卡）
- 三号：`verify` 分支上的核验与收尾（其条目多在 roadmap 的「三号交接开放项」里）
- 一号（本卡之前那批）：`steam-packaging-20260927.md`（**仍在飞**，见 §6-1）

---

## §5 亲历的坑（照抄避雷）

1. **推送 GitHub 要绕 DNS**：本机 `github.com` 解析到 `20.205.243.166`（**不通**）。可用写法：
   `git -c http.curloptResolve=github.com:443:140.82.114.3 -c http.version=HTTP/1.1 push origin main`
   （本轮实测 `140.82.114.3` / `140.82.121.4` 轮流可用，失败就换 IP 重试；**别写进全局配置**——我临时设过、用完已还原）。
2. **roadmap 的最近批次是"新的在最前"**：`docs:seal` 的窗口 = **文件里前 20 条**，多出来的从**末尾**封存。
   ⚠ 本轮我按"追加到末尾"写，结果**自己的 5 条被当成最旧封存掉了**（已 `git checkout` 还原 ＋ 改成**前插**后重跑）。
   **新条目一律插在「## 最近批次」的说明行之后**（最新在最上面）。
3. **`docs:seal` 会重建窗口区**：跑之前先 `--dry-run` 看"不保留的段头"；窗口区"一行都不许丢"由工具自己守（守恒校验）。
4. **`docs/INDEX.md` 冲突的固定解法**：直接 `npm run docs:index` 重生成再 `git add`。
5. **改 CSS 必跑 `npm run ui:layout-css`**：渲染层用的 `ui/layout-css/styles-{modern,classic}.css` 是**生成件**，不重出则改动"看不见"（`ui:layout-css:check` 会拦）。
6. **`write` 工具产 LF，本仓约定 CRLF 无 BOM**：新建/批量写中文盘用 .NET `WriteAllText` ＋ `UTF8Encoding($false)`；写完自检 `BOM=False`、`LF-only 行数=0`。
7. **`Set-Content` / `Out-File` 会毁中文**（历史事故）：一律走 .NET 或 node `fs.writeFileSync(..., 'utf8')`。
8. **tools 不进 typecheck**：字段名拼错静默变 `undefined`（`tools:audit` 只查版本自检登记）。新工具头注请带三条自检（游戏版本 / 存档结构 / 最后核对＋跑过）。
9. **探针与浏览器纪律**：临时探针 `_` 前缀、用完删除；自己起 Chrome 要 `--remote-debugging-port=9333`（别用 9222）、`--user-data-dir` 独立、**记 PID 只 kill 自己那一个**；预览用 `npm run preview --prefix web -- --port 4199 --strictPort`；环境变量 `UI_APP_URL` / `UI_CDP_URL`。
10. **夹具驱动型 UI 探针现在是坏的**（`ui:probe` / `ui:geom` / `ui:overflow`）：输入档要按 v31 重导；按船长令「旧工具用的时候再更新」⇒ **用到再修**。
11. **`git stash` 回退验证**（红-绿）本轮用过两次：只 stash 源文件、跑用例确认变红、再 `stash pop`——比手改回去安全。
12. **PowerShell 内联脚本改文件**：`.Replace()` 传三个参数会抛错（.NET 没有那个重载），**本轮把 `encounters.ts` 写成过 0 字节**（已从 HEAD 还原重做）。批量改文件一律写成脚本 ＋ 改完立刻校验字节数/内容。

---

## §6 挂账（等船长裁决 / 下一批）

| # | 事项 | 现状 / 下一步 |
|---|---|---|
| 1 | **Steam 打包第二步：Steamworks SDK 集成**（成就 / 覆盖层 / 云存档） | 未开工，等船长定；引入 `steamworks.js` 才谈得上，存档仍在 `%APPDATA%\whale-idle` |
| 2 | **Steam 上传的前置操作（要船长在后台点）** | ① Steamworks → 该应用 → SteamPipe → Depots **新建 Depot**（记下 DepotID 填进 `steam/config.json`）② 安装 → 通用安装设置 → **启动选项**：可执行文件 `大鲸鱼-深空放置.exe`、操作系统 Windows ③ 装 `steamcmd` 并首登 ④ 上传后到 Builds 页 **Set Build Live Now** |
| 3 | **Steam 应用名统一** | Steamworks 显示「大鲸鱼-深空工业」、产物名是「大鲸鱼-深空放置」；船长说"应该用后者" ⇒ 他在后台改 **Application Name**（App Admin → Edit Steamworks Settings），产物侧不用动 |
| 4 | **`ui:battle-fit` 那条 2px** | 复跑 7 次全绿、**未复现**、未改 CSS；可选：给探针加"布局稳定后再量"的等待（船长未点） |
| 5 | **`docs/exports/筛选清单-20260927-094030.{txt,xlsx}`** | 未入库（船长问过用途、未定留删） |
| 6 | **文档外置提议**（把工作文档搬出仓库 `H:\大鲸鱼\工作文档\`） | 船长「**那先算了吧**」⇒ 维持现状（工作文档仍在 `docs/design/`，推送时会带上） |
| 7 | **旧工具重检清单**（`tools:audit` 的 20 个"需重检" ＋ 52 个"未登记"） | 船长「**用到时再更新**」⇒ 不做批量重检 |
| 8 | **「思考呈现全中文」要不要写进规则** | 船长「**先不用**」⇒ 规则文本不动，但**执行照旧**（思考呈现全中文） |
| 9 | **本地领先 origin 的提交** | 体检记录 `3f3b884a` · Steam 打包 `4cb7758f` · 本轮归档提交 —— **等船长口令推送** |

---

## §7 交接检查单（接手照做）

- [ ] 读 `AGENTS.md` §0/§2/§4/§6/§8 ＋ `docs/catalog.md`（按任务类型挑文档）
- [ ] 三棵树对表：`git log --oneline -1` / `git status --short`；主树干净才谈合入
- [ ] `git fetch origin` 对远端（见 §5-1 的 IP 写法）；确认本地领先哪些提交
- [ ] 跑一遍主闸门拿基线读数（typecheck / core / content / l10n）
- [ ] 自己的工作建工作文档 `docs/design/<主题>-<YYYYMMDD>.md`（状态：进行中 ＋ 船长原话照抄）
- [ ] 收尾：归档三步（roadmap 条目**前插**）＋ 等船长口令推送 ＋ 汇报"改了哪些文件 / 行为变化 / 验证结果 / 已知取舍"，**第一行写「报告老大喵」**
