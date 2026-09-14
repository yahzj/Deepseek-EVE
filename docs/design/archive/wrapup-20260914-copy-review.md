# 主树文案审查修正批 · 会话收尾归档（2026-09-14）

> **生成即归档**：按 `docs/design/archive/README.md` §3.3 口径（"会话收尾时按船长「收尾归档」指示
> 直接生成的归档件，**不进一线目录**"）。
> **本会话定位**：船长指派的**审查 + 修正**会话，工作树 = 主树 `H:\大鲸鱼\Deepseek-EVE`（分支 `main`），
> 不是一号/二号/三号的常设身份。开工 = 船长原话「审核…文本和代码是否有纰漏。重点检查文案是否有多余解释
> 以及出现不符合游戏设定的词汇以及开发语言」→ 审查报告 → 「按照顺序修正」→ 「按你推荐的来修改」→ 「进行收尾归档」。
> **给接手人**：开工顺序 = 本件 → `AGENTS.md`（§2 四步闸门 / §3 验证闭环 / §4 工作区与合入纪律 /
> §5.1 禁子代理 / §5.2 冲突先提醒 / §6 三条硬规则）→ `docs/roadmap.md` 顶部变更记录 → 按船长派活读对应设计稿。

## 0. 当前快照（收尾时）

| 项 | 值 |
|---|---|
| 工作树 / 分支 | `H:\大鲸鱼\Deepseek-EVE` / `main` |
| 代码基线（开工时） | `7298e053`；会话期间 main 前进 2 笔（一号：`0f5c9715` 货仓整理/换位/拖拽三处摆位 BUG、`092e4a47` wh-all 全量验收档） |
| 本会话提交 | `ad66a51b`（审查修正批①：ISK→信用点 ＋ 开发词清理）· `48651317`（审查修正批②：第五类 7 项） |
| 验证（合并态复跑） | typecheck 四包 **0 错** · core **127 文件 / 1345 用例**全绿 · `content:check` ✅ |
| 工作区 | `main` 有**一号在途未提交改动**（`holdDropWithGrab` 拖拽偏移链 5 文件：Wormhole.tsx / engine.ts / index.ts / wormholeHold.ts / wormhole-hold.test.ts）——船长已裁定「**一号工作由他自己完成**」，本会话**未动、未提交**，收尾时原样保留 |
| 探针残留 | 本会话 0（扫描脚本全部放 `%TEMP%`，用完即弃）；`tools/_wh-drag-probe.ts`（一号遗留 · 未跟踪）未动 |
| 验收视图 | 船长默认看本地（`AGENTS.md` §1）；本批为纯文案改动，无需重启之外的特殊提醒 |

## 1. 本会话交付线（全部已合入 main）

| # | 交付 | 主要提交 | 状态 |
|---|---|---|---|
| 1 | **审查报告**（全量模式扫描：引号/反引号内字符串字面量、排除注释 ＋ 核心文案通读 ＋ `content:check` 复跑） | — | 已交付 |
| 2 | **修正批①**：ISK→信用点约 60 行（core 14 文件）＋ 开发词泄漏清理 9 处 ＋ 错字 1 处 ＋ 替换残留空格 8 处 ＋ `content:check` BANNED 增补 ISK/NPC ＋ 测试断言 3 处同步 | `ad66a51b`（23 文件 +88 −88） | 已合入 · 待验收 |
| 3 | **修正批②（第五类 7 项）**：现实词汇 3 处（流浪汉/极限漂移/0.03% 玩笑）· 船员违和 1 处 · NPC 台词「一键」2 处 · 序章 OK→正常 · 守墓人→守墓者（含 glossary 收口）· 冗长精简 2 处 | `48651317`（8 文件 +11 −11） | 已合入 · 待验收 |

## 2. 接手必读口径（本会话新增/改动，别踩）

1. **`content:check` 只扫数据层**：BANNED 词表（已增补 `ISK`/`NPC`）与 lore 扫描都只覆盖 `packages/data/src`
   的描述/lore/通讯文本——**renderer 硬编码文案与 core 日志是体检盲区**（本次审查的问题大半落在这两处：
   Handbook 的 sec/口径、engine 的读档提示、市场 NPC 字样、core 全部 ISK 日志）。以后改这些位置的文案，
   复查手段 = 引号/反引号内字符串扫描（本轮套路见 §5.1/§5.2），工具扫不到别怪工具。
2. **货币玩家可见单点** = `MONEY_UNIT`「信用点」（`packages/core/src/money.ts`）；core 日志文案已全部迁
   「信用点」（含 `ISK 不足`→`信用点不足`、`X ISK/单位`→`X 信用点/单位`、`ISK 已入账`→`信用点已入账`等写法；
   数字与单位之间保留一个空格是全 UI 统一排版，不算残留）。内部字段名（`priceIsk`/`wallet.isk` 等）不动。
3. **NPC 玩家可见文案 → 「市场补给」**：engine.ts ×2、MarketPage.tsx ×2 已改；`save.ts` 那条迁移日志用
   「市场补给簿已清理退役商品」。
4. **「守墓者」命名已收口**：anomalies 卡名先改（2026-09-11 船长批），本次补 universe lore 与 glossary
   （「待审稿，属数据未改」→「已落码」）。全仓玩家可见文案 0 残留（`tools/*` 注释里的旧称属开发面，不算）。
5. **序章自检标记 = 「正常」**（原 OK）；`.app-pro-mark` 无固定宽度，两字不破版。
6. **手册「安全等级」行**：用「安全等级 ≥ 0.5 为高安，0 至 0.5 之间为中安，≤ 0 为低安」表述，
   不再出现 `sec` 字段名；同行的「（中安与高安不会）」重复括号已删。
7. **低安通讯（`messages.ts` msg-lowsec-rules）**：长途运输的机制长解释已精简为
   「**长途运输途中同样会被拦**（含低安航段的航线在「长途运输」页会标出来）」。

## 3. 挂着的未决项（等船长/一号，别自行开工）

| 项 | 内容 | 卡在哪 |
|---|---|---|
| **一号在途 5 文件** | `holdDropWithGrab` 拖拽偏移链（Wormhole/engine/index/wormholeHold/wormhole-hold.test）**未提交** | 船长裁定「一号工作由他自己完成」；接手时若还在，按 §4 不抢、不代提交 |
| **`tools/_wh-drag-probe.ts`** | 未跟踪临时探针（一号遗留，他 roadmap 条目里说"已清"但文件还在工作区） | 归一号收尾；本会话未动 |
| **「玩家」一词残留 4 处** | `market.ts:1620/1660/1697`「该商品不支持玩家出售。」建议→「该商品不支持出售。」；`industry.ts:831`「暂不支持玩家出售。」同；`engine.ts:1121`「可等玩家二手挂单」建议→「可等二手挂单」 | 审查时点名、未列入已批清单 ⇒ 等船长点头即改（一行一处） |
| **content:check 既有警告** | 蜂群机 `foe-drone-g-bee-exp` 已备未挂（三种机型两个机位换系必然空出一个） | 一号侧确认过是有意留档 |
| **推送** | 本会话两个提交未推；本地 main 领先 origin/main 数百条 | 按「先不推」惯例，船长说推才推 |

## 4. 关键落点

- **core（14 文件）**：`ai.ts` · `encounters.ts` · `events.ts`（含错字与 3 条叙事改写）· `expedition.ts` ·
  `hauling.ts` · `industry.ts` · `market.ts`（26 处）· `onboarding.ts` · `shipyard.ts` · `sideTasks.ts` ·
  `state.ts` · `wormholeBattle.ts` · `save.ts` ＋ `tests/{b1,market-buy-escrow}.test.ts`（断言同步）
- **data（4 文件）**：`tutorialSteps.ts` · `skills.ts` · `travelEvents.ts` · `dialogues.ts` · `universe.ts` · `messages.ts`
- **renderer（6 文件）**：`game/engine.ts` · `pages/MarketPage.tsx` · `panels/{Handbook,Expedition,TutorialGuide,PrologueScreen}.tsx`
- **工具**：`tools/content-check.ts`（BANNED 增补 `ISK`/`NPC`）
- **文档**：`docs/glossary.md`（守墓者收口）· `docs/roadmap.md`（本会话 2 条）· `docs/design/archive/README.md`（§3.3 增行）· 本件

## 5. 血泪清单（本会话真踩过的）

1. **字符串扫描必须覆盖反引号模板字符串**：第一轮只扫 `'` 与 `"` ⇒ 漏了 42 处 ISK（`events.ts:267` 黑市开价、
   market.ts 一组挂单日志等全是第二轮补扫才抓出来）。扫描字符集 = `['"\`]`。
2. **过滤按「片段」不按「行」**：为排除 `wallet.isk` 这类标识符做整行排除 ⇒ 同一行里的真字符串一起被漏掉
   （`ai.ts:206` / `industry.ts:864` / `market.ts:1245` 差点漏改）。正确做法 = 先取引号内片段，再对片段判词。
3. **全局替换类修改后必须复扫**：改完主体再扫一次才抓出 `sideTasks.ts:743/773`、`engine.ts:1079`、
   `Handbook.tsx:167` 三处漏网；收尾自检 = 复扫 ＋ grep 残留模式。
4. **edit 工具跨轮失效**：上一轮 read 过的文件本轮编辑会被拒（"file has not been read"）；同轮内 read 任意
   片段即可解锁整文件——批处理时**先集中 read、再集中 edit**。
5. **测试计数会随并行会话合入变化**：本会话期间 1339 → 1345 是别人新增用例，不是我的改动引入；
   中途一次 vitest exit 1 是并行 job 相互干扰，重跑即绿——收尾以**最后一次干净运行**为准。
6. **PowerShell 写 .ps1 无 BOM 会被 GBK 读乱**：临时脚本要么 ASCII-only、要么带 BOM；仓库文档一律**无 BOM ＋ CRLF**
   （全仓一致），新写文件用 write 工具（LF）后必须 .NET 归一为 CRLF，再自查 BOM/行尾与乱码。

## 6. 交接时先做这三件事

1. **核基线**：`git -C H:\大鲸鱼\Deepseek-EVE log --oneline -3`；`git status` 里**一号在途改动可能还在**
   （§3 第一行）——**别顺手 commit 别人的文件**，提交永远按路径点名 `git add`。
2. **读**：本件 → `AGENTS.md` → `docs/roadmap.md` 顶部 5 条 → 按船长派活读对应设计稿。
3. **等派活**：§3 未决项不要自行推进；任何改动走四步闸门；UI 类改动交船长看观感，别拿截图当"改好了"。

## 7. 推送与更新状态

- **未推**：本会话两个提交保持本地（按「先不推」惯例）。线上（Pages）与手机网页版因此不含本批文案修正。
- 推送口径照旧：只推代码与已过船长审核的公告；推后照例写「推送回执」进 `docs/roadmap.md`。

---

_起草：主树审查修正批（`H:\大鲸鱼\Deepseek-EVE`）· 2026-09-14 · 状态：**会话收尾归档件（生成即归档）** ·_
_基线：开工 `7298e053` → 收尾 `48651317`（main 途中并有一号 `0f5c9715`/`092e4a47` 两笔）· 合并态三连全绿（typecheck 四包 0 错 / core 127 文件 1345 用例 / content:check ✅）·_
_工作区剩一号在途未提交 5 文件 ＋ 其遗留探针 `tools/_wh-drag-probe.ts`（均未动，按船长裁定交一号处置）_
