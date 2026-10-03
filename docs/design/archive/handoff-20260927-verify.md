# 交接卡：新三号（2026-09-27 · 旧三号交班）

- **一句话**：本会话把「手册优化批（势力染色 ＋ 技能优化 ＋ 三次急救）」、**组装机流式加载（节点 −85.5%）**、
  **Steam 描述区配图（10 段 × 中英两套，22＋22 张）** 全部做完并合入 main；三棵树干净同步，可以直接接着干。
- 本卡写给**零上下文的下一任三号（核验/收尾）**：先读 `AGENTS.md` → `docs/catalog.md` → 本卡，再动手。
- 状态：**交接中**（旧三号已按 §8 归档本会话工作文档；本卡本身是交接件，按 §8 在工作结束后归档）

---

## §0 一分钟开工

| 项 | 值 |
|---|---|
| 工作树 | `H:\大鲸鱼\Deepseek-EVE-verify`（分支 **`verify`**，**不叫 d3**）· 主树 `H:\大鲸鱼\Deepseek-EVE`（`main`，**一号与船长独占**）· 二号 `...\Deepseek-EVE-d2`（`d2/workspace`） |
| 基线 | **`main` == `verify` == 本卡所在提交**（见 `git log --oneline -1` 两处对表）· 三号**永不写主树**：改动一律在 verify 提交，**确认主树干净**后 `git -C 主树 merge --ff-only verify` |
| 远端 | `origin` = `https://github.com/yahzj/Deepseek-EVE.git`（本机直连不通，推送要带代理；**推送闸门**：只在"确实完成"后推，等船长发话） |
| 六道闸门 | `npm run typecheck` · `npm run test -w @whale/core` · `npm run content:check` · `npm run l10n:check` · `npm run ui:rot-check` · `npm run ui:theme-check` |
| 改了 CSS 还要 | `npm run ui:layout-css`（生成件 `ui/layout-css/*`）＋ `npm run ui:layout-css:check` |
| 文档改动 | `npm run docs:index`（改完必跑）· `npm run docs:seal`（滚动窗口越窗即封存） |
| 出图（Steam） | `npm run shots:steam -- --lang zh\|en [--only n,n]`（见 §3-5） |

---

## §1 你的边界（与旧三号同一套）

1. **汇报开头先写「报告老大喵」**（**2026-09-27 船长令**，`AGENTS.md` §1 末条）——船长据此判断注意力是否集中。
2. **永不写主树**；合入前先 `git -C 主树 status --porcelain`（**只允许有别人的未跟踪文件**，不许有未提交改动）。
3. **禁止子代理 / workflow / Ralph**（§5.1，底层规则）——该读的自己读、该验的自己验。
4. **不许关闭浏览器进程**（§6，底层规则）——包括按进程名/命令行特征批量杀；自己起的实例留 PID、只收尾自己那一个。
5. **UI 观感归船长**：不许自己截图当"改好了"的依据；只报读数型事实（溢出/几何/帧数），并写明"这是读数、不是观感结论"。
6. **文档纪律（§8）**：开工先建 `docs/design/<主题>-<YYYYMMDD>.md`；工作期间**只改它**（＋代码/数据/测试），不往 roadmap 追加条目、不动词典现行词条；
   归档三步＝并入 roadmap/词典 → 删工作文档 → `docs:index`；**只归档自己的文档，别人的一律不碰**。
7. **编码纪律（§4）**：写中文盘用 .NET 显式 UTF-8（`WriteAllText` + `UTF8Encoding($false)`）；合并/批量写文档后自查 BOM / 行尾（本仓 docs 全是 **CRLF**）/ 乱码 `U+FFFD`。

---

## §2 旧三号本会话交付（提交号可直接 `git show`）

| 提交 | 内容 | 状态 |
|---|---|---|
| `87617a06` · `8c69a29f` | **手册优化批**：势力按设定文档**族色染色**（真因＝`toneOf()` 只查一张表，`fam-*`/`ico-*` 全落灰兜底 ⇒ 新增跨表单点 `toneOfAny()`）＋ `ui-ux-pro-max` 技能驱动的 7 条优化（角标读屏名改势力全称 / 详情窗 Esc / 筛选胶囊 0 溢出核验 / `aria-label`·`aria-pressed` / 势力卡选中态 / 容器标题族徽）＋ 船长三答追加（敌卡副行两行 · 空态「清空搜索与筛选」按钮 `ui.Handbook.380` · `overflow-wrap: anywhere`） | 已合入 main |
| `e7431099` | **H 族专属装备漏掉无人机**：`drone-ink-heavy` 是**物品**而两处界面只按"模块 id"查表 ⇒ 新增共用构造点 `itemCellOf()`；手册侧已修（3 件齐）；**精炼炉侧只取证未改**（属数值面，三案等船长） | 已合入 main |
| `dbae43af` | **急救：手册四图鉴页白屏**（`crest: null` 让 `c.crest.toLowerCase()` 抛错，装备/舰船/物品/蓝图四页全中招）⇒ 收窄单点 `crestFamOf()` ＋ `IconGrid` 判据 `!= null` ＋ **新护栏「族徽判据契约」**（进 `ui:attr-check`） | 已合入 main |
| `e0a459bc` | **虫洞地点名 4/7 漏出英文键**（`PLACE_ID` 键用了"信号名"那一套）⇒ 按 core 真实取值域重写 ＋ 表类型收紧为 `Record<WormholePlace, string>`（**漏登记从此 typecheck 就红**）＋ 顺带补 `plug → 舰船插件` | 已合入 main |
| `0b79a6ae` | **归档（手册批等三份工作文档）**：并入 roadmap 6 条 ＋ glossary 3 条术语 · 删 3 份工作文档 · `docs:index` ＋ `docs:seal` | 已合入 main |
| `0a2ac44b` | **声望商店标题栏加章鱼人头像**（与通讯同款 `faction-octopus`，复用 `.app-comms-avatar`，最左侧）＋ **装备三级筛选挂为待办 T12** | 已合入 main |
| `d4843496` | **蓝图筛选收口**：删「已学会的一次性图纸」、把「未学会的一次性图纸」改名为「**一次性蓝图**」（组装机与造船厂共用的 `BLUEPRINT_LEARN_TABS` 单点） | 已合入 main |
| `c8dbc4b0` | **组装机改「视口懒挂载」**：新单点 `ui/LazyMount.tsx`（IO ＋ 上下各 1 屏 ＋ 等高空白占位 ＋ `display:contents` 不破网格 ＋ 跳转定位强制挂 ＋ 占位高自适应）；节点 **9,116 → 1,321（−85.5%）**、切换序列中位 1,677 → 531~887ms | 已合入 main |
| `5e194676` | **Steam 描述区配图**：10 段各一张 · 中英各一套（22＋22 张）＋ 出图工具 `tools/steam-shots.mjs` 转正入库（`npm run shots:steam`） | 已合入 main |
| 本卡 | **归档（懒挂载 ＋ Steam 配图两批）＋ 交接卡**（本条即落点） | 交接件 |

---

## §3 现状要点（接手前必须知道的口径与单点）

1. **取色单点**：`ui/tones.ts` 的 `toneOfAny(key)`（`TONES → ICO_TONES → NAV_TONES` 跨表兜底）。
   势力卡/势力详情敌人卡显式传 `FOE_ACCENT[族]`；**族色只有这一个来源**（与星图族标签、战场敌舰同源）。
2. **族徽判据**：判"有没有族"**只许走 `crestFamOf()`**（`factionOfExclusive` 对"不是专属"返回 **`null`**，写 `!== undefined` 会让 `crest: null` 进卡片 ⇒ 整页崩）；`IconGrid` 的判据是 `c.crest != null`；护栏 = `ui:attr-check` 的「族徽判据契约」。
3. **本地化单点的表类型已收紧**（漏登记 ⇒ typecheck 报错，不必靠人眼）：`PLACE_ID`（`Record<WormholePlace,string>`）· `ARCHETYPE_ID` · `SLOT_ID`（`Record<ModuleSlot,string>`）；色板 token 是**空格三元组**，当色值用**必须包 `rgb(...)`**（裸 `var()` 是无效声明）。
4. **懒挂载单点** `ui/LazyMount.tsx`：预制距离 1 屏 · 挂上不卸 · 占位高**必须贴近真卡高**（否则行高会随挂载塌）· 跳转定位那张要 `eager`。目前只有组装机用了它。
   ⚠ **未解决的瓶颈（船长已知）**：切到组装机那一下 ~100 ms 的提交耗时**不是建 DOM**，而是面板要算 171 条列表数据（逐条查 ctx/价格/持有量/材料）。
5. **Steam 出图**：`npm run shots:steam -- --lang zh|en`；产物在**仓库外** `H:\大鲸鱼\steam\`（`shots\` 1920×1080 · `shots-616\` 描述区宽 · `contact-sheet.html` 对照表）。
   存档**只读**：用 `docs/test-saves/user-backup-20260926-120117.json` 在内存里把 `state.character.name` 换成占位名，**真档一字未改**。
6. **Steam 现在是两条线**：一号在做**打包/上传**（`tools/steam-pack.ts` · `tools/steam-upload.ts` · `apps/desktop/electron-builder-steam.yml`，`4cb7758f`）；
   三号做**描述区配图**。⚠ 商店页文案终稿在 `docs/design/steam-store-draft-20260911.md`（其「英文版不做」一条已随双语批作废，**归档时需标注**）。
7. **`docs/design/` 下仍有别会话的工作文档**（`flagship-kill-record-*` · `weekend-window-96h-*` · `steam-packaging-*` · `full-flow-sweep-*`）——**不是三号的批，别替他们归档**。

---

## §4 别人在改什么（别踩）

- **一号**在 `main` 上最高频（本会话与他合并过 6 轮，冲突**几乎全落在** `docs/roadmap.md` / `docs/INDEX.md` / `package.json`；`docs/INDEX.md` 的解法＝**重新跑 `npm run docs:index`**，不要手工并）。
- **二号**在 `d2`（入侵/插件/工业线）。
- 主树工作区里可能出现别人的**未跟踪文件**（例：`tools/_battle-preview.ts`、`docs/exports/筛选清单-*.xlsx`）——**别 `git add -A`**，只 `git add` 你自己的路径。

---

## §5 本会话亲历的坑（照抄避雷）

1. **PowerShell 里 `git commit -m` 的中文消息含 ASCII 双引号会被吃掉**（本会话栽了两次：消息被截断、后半段变成 pathspec 报错）。
   ⇒ 消息里**只用「」**，或写进 `-F <文件>`；已 staged 的改动不会因此丢，补一次 commit 即可。
2. **静态预览服务会死**：`npx --yes serve -l 4174 dist` 挂后台任务，长时间不用后端口会拒连（探针直接读到**空白页/ECONNREFUSED**）；
   重新拉起来再跑。自起的无头 Chrome（`--remote-debugging-port=9223` ＋ 临时 profile）也要先 `curl /json/version` 确认活着。
3. **注档必须用 `Page.addScriptToEvaluateOnNewDocument`**（`localStorage.clear()` ＋ `setItem`），**不要**先加载再 `setItem` 再刷新——容易静默失败（页面已是空档 ⇒ 导航项都少几个）。
4. **localStorage 键**：存档 `whale:idle:save` · 语言 `whale-idle:locale`（`zh`/`en`）· 界面布局 `whale-idle:layout`（`modern`/`classic`，**不写＝classic**，`whale-idle:layout-set` 记"选过"）· 调试 `whale-idle:debug='1'`（🄰 本地才生效）。
5. **改完代码要 `cd web && npm run build`**，船长看的是**主树**的构建产物 ⇒ 合入后必须在主树再跑一次 `npm run build` ＋ `cd web && npm run build`，并提醒船长**重启本地游戏**。
6. **GUI 里点不到的页面，用**键位/下标**定位**（文案会随语言/版本变）：工业子页 `.app-subtab` = [精炼炉, 组装机, 造船厂, 蓝图书架]；星图子页 = [星图·远征, 矿带开采, 常驻悬赏, 残骸打捞, 长途运输, 扫描虫洞]。
7. **合并前先看主树有没有在途改动**：主树被别的会话推着走是常态（本会话遇到 4 次），`git merge main` 进 verify 解完冲突、闸门复跑，再合回 main。

---

## §6 未决项（都等船长点头，**别自己拍**）

1. **T12 · 装备三级筛选（MK1/MK2/MK3/势力装备/其他）** —— **挂起中**，船长原话与「现状 ＋ 7 问 ＋ 我的建议 ＋ 落点」全在 `docs/roadmap.md` 的「待办单（2026-09-27 起）」；点选后先出**设计总结**再落码。
2. **精炼炉 · H 族无人机三案**（普通残骸要不要也直出无人机）：甲＝维持现状（只从稀有残骸高级箱出 ×10）· 乙1＝一次 1 架（EV ≈ 守恒）· 乙2＝一次 10 架（EV ×2.85，不建议）——见 roadmap「三号交接开放项」。
3. **Steam 配图 5 问**：星图段用 `06a` 还是 `06b` · 右侧事件日志栏要不要收起后重拍 · 战斗帧留白要不要换更近卡面 · 616 宽版文字偏小是否改"裁切后再缩" · **商店「截图」区（5+ 张 1920×1080）**要不要现在拍。
4. **Steam 两条线合口径**：打包上传（一号）与商店物料（三号）需要船长指定谁统稿。
5. 手册剩四处括号（`武器类型加成` 尾注 · `命中率` 船体加成明细 · `跃迁速度` 耗时因子 · `槽位` 复数安装）——按"能不放就不放、要放先问"等点名。

---

## §7 建议的下一批顺序

1. 船长点 T12 → 走 §2 四步闸门（集中提问 → 设计总结 → 等确认 → 实现 ＋ 工作文档）。
2. 精炼炉无人机三案点一个（改动很小：引擎 `appendBase` 认物品 ＋ 卡面行同步）。
3. Steam：定 06a/06b 与"截图区"要不要补拍 → 我可用同一工具一次重出。
4. 顺手可做的核验（不改行为）：造船厂 / 蓝图书架的切换耗时瓶颈（**不在卡片数**，本会话已量到 39 个节点也要 1.06s）。
