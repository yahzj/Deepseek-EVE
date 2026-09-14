# 交接文档 · 大鲸鱼深空工业 · 2026-09-14 夜（一号 → 新一号）

> **给零上下文的接手人**：本卡一页读完即可开工。§0 一分钟开工 → §9 逐项打勾。
> 上一张同族卡：`docs/design/handoff-20260912-to-new-pilot1.md`（通用工作方式那几节仍然有效，
> 本卡只写**今天变了的东西**与新挂账，不重复抄）。

## 0. 一分钟开工

1. 工作区 = `H:\大鲸鱼\Deepseek-EVE`（主树 `main`，一号与船长独占；二号 `Deepseek-EVE-d2` / 三号 `Deepseek-EVE-verify`）。
2. 开跑四连（改任何东西都要）：
   ```
   npm run typecheck
   npm run test -w @whale/core
   npm run content:check
   npm run build   &&   npm run build --prefix web
   ```
   **当前基线（2026-09-14 归档时复跑）**：typecheck 四包 **0 错** · core **138 文件 / 1449 用例全绿** ·
   `content:check` **✅** · desktop ＋ web build **全绿**。工作区**干净**（`git status` 空）。
3. **未推送**：本地领先 `origin/main` **49 条**（含今天的虫洞上线批）。**推送要船长一句话**。
4. 铁律（一条都没变）：中文汇报结论先行 · 不启动子代理 · 不关任何浏览器进程 · 观感审查权在船长 ·
   施工/开发语不进玩家可见范围 · `git add` 只用**显式路径**（永不 `-A`）。
   ⚠ **今天新增一条**：**虫洞已上线**——当年那条「虫洞对玩家不可见（入口走调试开关、数据走 `unreleased`、
   文案不得提及虫洞）」的**施工期铁律已作废**（船长 2026-09-14 解闸，公开就叫「虫洞」）。

## 1. 工作区、推送闸门与铁律（今天的变化）

- **虫洞解闸三处**：星图「出港 · 扫描虫洞」标签 · 星图行动区的「进入虫洞」行 · 工业页「货柜拆解」档
  —— 全部**不再看 `debugEnabled()`**。玩家侧只剩**解锁门槛：协会声望 ≥ 40**（`WORMHOLE_SCAN_UNLOCK_STANDING`）。
- **数据整体出闸**：虫洞线 100+ 条 `unreleased` 一次摘净（虚空母矿 / 货柜 8 种 / 谜质 27 台 / AI 核心 3 种 /
  专属装备 28 + 图纸 28 / 专属舰船 15 + 图纸 15 / 族专属无人机 2 / 市场 36 张卡）。
  ⚠ **五张洞内敌卡仍 `hidden: true`**（虫洞专用遭遇，不进悬赏目录——与可见性无关）。
  ⚠ **`unreleased` 机制本身没退休**：别的未上线内容照旧用它挡。
- **体检契约翻面**（`tools/content-check.ts`）：原来"要求未上线 / 要求不得提及虫洞"的六族契约改写成
  **上线后必须成立**的断言。改契约前先读那些注释（每条都写了"为什么"）。
- **`tools/_ui-artifacts/`** 是 `.gitignore` 里登记过的探针工件目录（日志/截图放这儿，不入库）——
  不是垃圾，别删。

## 2. 今天（2026-09-14）一号交付的批次（按时间）

| # | 批次 | 提交 |
|---|---|---|
| 1 | 批次 4：内容原型（丙）+ 族徽（丁）+ 放弃已发现的虫洞 | `e338795e` |
| 2 | 虫洞库存卡片文案收窄 + 起始层恒 1 + 放弃改弹窗 | `a42f63df` |
| 3 | 自动探索改走「与主控探索同一个准备页」+ 选主控船则先换主控 | `ce6d2fa1` |
| 4 | 扫描虫洞解锁门槛 35 → 40 | `3eeea13b` |
| 5 | 「扫描虫洞」改成进洞自动停 | `07ca4b5c` |
| 6 | 「进洞自动停」扩到采矿/打捞 | `d0b32783` |
| 7 | 进洞自动停再加「长途运输」（带警告）＋ 远征明确不自动停 | `14997a7b` |
| 8 | **虫洞上线：解除对玩家的不可见** | `a361870e` |

> 每条在 `docs/roadmap.md` 顶部都有条目（含**船长原话照抄**、改动、验证、负向验证、取舍）。
> 出问题想溯源：先看 roadmap 同名条目，再看设计稿。

## 3. 虫洞线终态（上线态，接手先认这几条口径）

- **入口**：星图「出港 · 扫描虫洞」→ 扫满一个窗口（220 分钟 × 三技能乘算；调试 1 秒化）标出一处虫洞，
  库存上限 5 处；**解锁门槛 = 协会声望 40**（解锁发通讯 `msg-wormhole-unlock` + 直接弹窗）。
- **每处虫洞自带**：内容原型（`balanced/wreck/ruins/vein/combat`，权重 40/20/15/15/10）+ 敌族徽（A/C/D/E/G 等概率）
  + **起始层恒 1**（旧「1/2/3 随机」作废）；进洞前两者都可见，卡片只显示「原型名，发现于 X月X日」。
- **进洞门槛与自动停**（`wormholeEntryAutoStops`）：**扫描虫洞 / 开采 / 打捞 / 长途运输**四项不拦进洞，
  进洞那一刻**自动停掉**（停法与手点活动栏「停止」同一条 `state.ts` 单点；长途运输带 `warn` ⇒ 准备页发琥珀警告）；
  **远征不自动停、照旧拦住**（多阶段 + 战斗锚点）；扫描星系 / 巡逻 / 快递 / 亲自开炉开线同理照旧拦住。
- **洞内**：网格层盘面（六边形 · 扫描/前往/打捞/采集/开战/深入，各 1 回合）；打捞走族池；
  安全货柜 `box-relic-*`（2000 m³）与图纸货柜 `box-bp-*`（1000 m³）带回空间站**拆解台**开；
  谜质储存器 `mat-*`（27 台）洞内随行生效；AI 核心 `ai-core-*` 撤离即入核心账本；虚空母矿 `ore-voidmother` 是唯一虫洞原矿。
- **自动探索**：与主控探索**同一个准备页**（`WormholePanel` 的 `autoStockId` 模式）；最多 4 条副船、
  各占 1 枚 AI 核心、约 5 分钟、收益 = 手动期望 × 40% 直入仓库、**绝不丢船**、报告需确认；
  **选了主控船 ⇒ 派队时把主控换到自动挑出的空闲船上（弹窗写明换给谁）**，主控忙时直接不允许。
- **权威文档**：`docs/design/wormhole-extraction-endgame-20260912.md`（§「可见性与拍板」已改写为上线态）·
  `wormhole-discovery-scan-20260914.md` · 词典 **八之二～八之八**（八之八 = 上线）·
  `docs/design/wormhole-exclusive-20260913.md`（专属掉落）· `docs/design/wormhole-ai-core-drop-20260914.md`。

## 4. 挂账（当前 **4 条待船长裁 + 2 条我可顺手做**）

**等船长：**
1. **推送**：领先 origin 49 条，一条未推。
2. **公告待审 4 份**：`announcement-draft-20260914-wormhole-launch.md`（今天新写，**推荐先看这份**）·
   `…-20260914-release.md` · `…-20260914-push2.md` · `…-20260913-t4-battleship.md`。
   **未批不得写入 `packages/data/src/announcements.ts`**。
3. **两个小口径**：①**临时离开虫洞期间能不能扫虫洞**（现在 `wormholeScanBlockReason` 按"有没有趟在"判，
   比"临时离开即释放"严一点，未动）②**长途运输停运要不要弹二次确认**（现在只发警告条）。
4. **二号的「深层瓶颈」结论**：回合不是瓶颈（55→60 后终局仍余 5~7 回合），**层 2 的战斗强度/威胁成长**才是，
   给了三个处方选项待裁；**威胁档** 仍挂起（设计稿 §九 留档）。

**我可顺手做（等一句话或自行判断）：**
1. **剑鱼级 `sh-swordfish` 声明不一致**：舰船定义还挂 `unreleased`、市场卡没挂 —— 只是声明卫生
   （`unreleased` 在舰船/装备/蓝图这一层**没有运行时消费者**，玩家侧无影响）。
2. 历史卡 `handoff-20260913-wormhole-4ship-stage.md` 里还写着"施工期铁律"（建议加一行作废标注，不重写）。

## 5. 单点地图（今天动过、接手最可能碰的）

| 点 | 落点 |
|---|---|
| 解锁门槛 | `packages/core/src/wormholeScan.ts` `WORMHOLE_SCAN_UNLOCK_STANDING = 40`（**必须**与 `data/messages.ts` 的解锁信触发器同值，`content:check` 硬契约） |
| 起始层恒 1 | `wormholeScan.ts` `WORMHOLE_STOCK_DEPTHS = [1]`（**别删那个 `rng()` 调用**——挪随机序列会改所有同种子盘面） |
| 原型 / 族徽 | `wormholeGrid.ts`（`WORMHOLE_ARCHETYPES` / 权重 / `wormholeRuinsShareFor`）· `wormholeFoes.ts`（`WORMHOLE_FAMILY_CARD` / `wormholeFamilyOfSeed`） |
| 进洞门槛与自动停 | `wormhole.ts` 的 `wormholeEntryAutoStops` / `wormholeShipEntryBusy` / `wormholeEntryBlockReason` + `state.ts` 的四个 halt 单点（`wormholeScanHalt` / `miningHalt` / `salvageHalt` / `haulingHalt`） |
| 族池 / 掉落 | `wormholeSalvage.ts`（`wormholeFamilyPoolOf` · 货柜开箱 `wormholeUnboxRoll`）· 工业页拆解台 `startUnboxRun` |
| 自动探索 | `wormholeAuto.ts`（`wormholeAutoMainHandover` 主控交接 · `WORMHOLE_AUTO_*` 常量） |
| 界面 | `panels/Wormhole.tsx`（准备/探索/背包三页 + 自动模式）· `panels/WormholeScan.tsx`（库存页）· `pages/MapPage.tsx`（标签） |
| 体检 | `tools/content-check.ts` 的「内容原型＋敌族锁定」「虫洞内容契约」「按族池」「拆解链路」四组 |

## 6. 今天真实踩过的坑（照抄级别）

1. **PowerShell 双引号 here-string 插值会毁源码**：今天 `.app-battle-screen` 的 CSS 与一处 TS 注释
   被 `$run` 插值啃成 `un.…`。**改源码一律用 `edit`/`write` 工具**；非要用 PS，就单引号 here-string +
   写前断言命中数 + 写后逐字复核。
2. **`edit` 工具会被并发写者打断**：报 `ReplaceFileW EIO (Win32 32)` 或"file changed since it was read"
   ⇒ 先 `read` 一次再改；**绝不要**用 `git checkout -- <file>` 回退（会把你自己的 WIP 一起抹掉）。
3. **roadmap 是并发热点**：二号/三号也在往顶部插条目 ⇒ 每次改前重读、锚点取**当行唯一前缀**、
   提交前 `git status` 核对文件清单。
4. **玩家文案里写 `**强调**` 会被体检点名**（文案纯净契约）：界面文本用 `<b>`，注释里随便写。
5. **`unreleased` 翻面要成套改**：删字段只是第一步——`content:check` 里六族"要求未上线"的契约、
   5 个用例文件、设计稿与词典都要同步，否则四闸门会红。
6. **改体检契约要"改写而不是删除"**：把"施工期要求"翻成"上线后必须成立"，别把守卫整条删掉。
7. **文档三自检**（合并/批量写文档后必做）：BOM/行尾与改前一致 · 全仓往返解码 0 乱码 ·
   与父提交比"父提交有的行还在"（缺行要能逐条解释成"我故意改写的旧条款"）。

## 7. 他人在途（今天）

- **三号/verify**：舰船仓库（`state.shipStore`）· 矿物改名统一 · 文案纯净契约 · 悬停提示补齐 ·
  窄窗/手机版若干 UI 收口。
- **二号/d2**：战报改造（四档判定 + 结构化 `battleReport`）· 虫洞回合数 55→60 · 经济复跑与工具。
- 共用文件（`styles.css` / `Glyphs.tsx` / `content-check.ts` / `Wormhole.tsx` / `roadmap.md`）**动前先看 mtime**。

## 8. 参考图（要查就翻这几份）

- 路线图与批次状态：`docs/roadmap.md`（顶部就是最新）
- 通用约定权威：`docs/development-conventions.md`（§一～§十四）
- 虫洞三稿：`wormhole-extraction-endgame-20260912.md` · `wormhole-discovery-scan-20260914.md` · `wormhole-exclusive-20260913.md`
- 词典：`docs/glossary.md`（八之二～八之八 = 虫洞那一族）
- 可复现测试档：`docs/test-saves/README.md`（虫洞档 `wh-all` / `wh-bag` / `wh-overload` / `wh-layer4`；
  `npx tsx tools/make-test-save.ts wh-all` 可重建；`wh-all` 档协会声望 **49**，已过 40 门槛）

## 9. 接手检查单（逐项打勾）

- [ ] 四连跑过一遍，读数与 §0 一致（不对先查"是不是别人刚合了东西"）。
- [ ] `git status` 干净；`git log --oneline -12` 认得出一号今天那 8 笔。
- [ ] 确认**未推送**（`git rev-list --count origin/main..HEAD` = 49 上下）——**不要自己推**。
- [ ] 读 §3 虫洞终态，再随机抽一条口径去代码里核对（例：`WORMHOLE_SCAN_UNLOCK_STANDING` 是否 40）。
- [ ] 读 §4 挂账；**别把挂账当已办**，也别替船长拍板推送/公告。
- [ ] 接手后第一件事：问船长「今天要推哪一批、公告批哪几份、A3 那两个小口径怎么定」——一次问完。
