# 交接文档 · 大鲸鱼深空工业 · 2026-09-11（一号 → 新一号）

> **给接手人的话**：你对本项目**零上下文**，这页就是全部起点。按 §0 的顺序读、按 §11 检查单核对，
> 半小时内进入可交付状态。**所有决策与状态都在仓库里**（文档 + 提交 + 测试），不在任何人的对话记忆里。
>
> 本会话（一号）已交付见 §4；**正在进行中的活见 §5（先看这里，船长正等你的第一步）**；
> 待船长动作的挂账见 §7；踩过的坑见 §10——§10 每条都真实发生过。

## 0. 一分钟开工

1. **读**：`AGENTS.md`（仓级约定，开工必读）→ 本页 → `docs/development-conventions.md`（权威正文，接手通读一次）
   → `docs/roadmap.md` 顶部 6 条（最近批次）。
2. **核对基线与工作区**：`git -C H:\大鲸鱼\Deepseek-EVE status --porcelain`（应为空）、`git worktree list`、
   `git log --oneline -5`、`git log --oneline origin/main..HEAD`（当前 **3 条未推送**，见 §1）。
3. **跑一次四连验证**（§9）：typecheck ×4 → core 测试 → content:check → desktop build。全绿才算环境可用。
4. **接活**：当前唯一的进行中事项 = **通讯 v2**（§5），它卡在四步闸门的**第 3 步（等船长显式确认）**——
   先看 §5 的"你要做的第一件事"。

## 1. 工作区、推送闸门与铁律

| 项 | 事实（2026-09-11 实测） |
|---|---|
| 主树 | `H:\大鲸鱼\Deepseek-EVE`（分支 `main`）——**一号与船长独占**；当前 HEAD `0321ac8`，工作区干净 |
| 二号工作区 | `H:\大鲸鱼\Deepseek-EVE-d2`（分支 `d2/workspace`）——**永不直接写主树**；HEAD `82ea695`，干净 |
| 三号工作区 | `H:\大鲸鱼\Deepseek-EVE-verify`（分支 `verify`，**不叫 d3**）——核验与收尾；HEAD `67167e4`，干净 |
| 真档（船长在玩的档） | `%APPDATA%\whale-idle\save.json`——**只读**；要给他测就生成测试档（`tools/make-test-save.ts` 会自动备份） |
| 推送闸门 | **有 3 条未推送**：`e022e3b`（推送回执 docs）、`2ebb6ea`（通讯页 v1）、`0321ac8`（通讯公告）。**船长 2026-09-11 明确选「先不推」**——不要自作主张推；`origin/main` = `b861966` |
| 线上现状 | GitHub Pages 线上产物 = `assets/index-9o0imOc6.js`（= 本地 `web/` 构建同名同体积）⇒ **线上还没有通讯页**（通讯页在这次未推送的批次里） |
| 推送方式 | 直连 GitHub 常被重置；系统代理 `127.0.0.1:7897` 开着时用**一次性**参数：`git -c http.proxy=http://127.0.0.1:7897 -c https.proxy=http://127.0.0.1:7897 push origin main`。**不要写持久代理配置**；代理没开先请船长开 |
| 提交标注 | 未完成/未验收的提交在信息里标「待验收/待发布」「待推送」 |

**铁律（违反会被船长纠）**
- **中文优先**：面向船长的一切（沟通、文档、注释、游戏文案、日志）都用中文，少用英文缩写（单位类如 ISK/m³ 可直接用）。
- **汇报结论先行**：列清「改了哪些文件 + 行为变化 + 验证结果 + 已知取舍」，不藏改动。
- **一级页不滚**：导航直系页整页无滚动条（星图/舰船/装配/物品/市场/工业/技能/**通讯**），滚动只进二级窗内部；**禁止硬裁内容**去迁就滚动。
- **视觉物件一律 SVG 线稿**，禁 CSS 拼形状（背景氛围光效可 CSS）。
- **UI 新增先复刻同级相似项**（同级 → 同页 → 同模块 → 全仓 `app-*` 家族），再最小差异。
- **公告需船长逐条批准**才写入 `packages/data/src/announcements.ts`；公告禁第一/第二人称，禁开发/验收话语。
- 术语以 `docs/glossary.md` 为权威，**新术语先登记再用**。
- 临时探针一律 `_` 前缀，收尾二选一：转正式工具 / 删除（仓库里 `_` 文件数应为 0）。

**本会话新增的两组口径（务必遵守，详见 §5）**
1. **通讯系统口径**：消息只**提示 + 跳转**（不在通讯页接取/完成任何任务）；回复接口**预留但不启用**（`COMMS_REPLIES_ENABLED = false`，玩家侧不出现空按钮）；送达**幂等**；通讯页只做收件箱与历史留档。
2. **世界观口径（船长 2026-09-11 新定）**：**官方势力 = 章鱼人**（口头就叫章鱼人，无更正式族名，协会对外自称「协会」）；**其他 NPC（打捞队工会等）也是章鱼人**（同族不同行会）；**章鱼人不追问船里是谁**，把玩家当**普通承包舰船**；玩家被称**「飞行员」**（职务称呼，与物种无关，自定义名 = 呼号）；**人类早已离开/消失在深空**，协会不谈、也帮不上（贯穿任务「寻找人类」保持"完成方法未知"）；**敌族关系留白**（F 族制式巡逻与协会的关系不在协会侧文档里定）。**玩家就是那条船（舰船 AI）**，不是坐在船里的人——文案避免「你的舰船」这类把玩家与船分开的说法。

## 2. 船长的工作方式

**四步闸门**（触发：新大功能/系统级/存档结构改动、涉及设计取舍或数值体系、需求模糊）：
1. **集中提问**（一次问完，用问答卡给选项 + 推荐项）；
2. **中文设计总结**（方案 + 取舍 + 涉及模块/数值 + 边界），结尾写「请确认」；
3. **等显式确认**（「可以/没问题/确认」才算；「没有反对」不算）；
4. **确认后实现**，并把决策落进 `docs/design/…`（标注状态：已确认）。

**经验**：船长回得快、回答极简（「行」「按甲」「不管」/直接给数）；**他给的数字就是结论，不要改**；
他问「是否可行/会不会被砍」时，**先去真实引擎里量化**再回答（他会追问数）；
他会**自己贴参考图**并只借其中一部分（例：这次只借"边框线条/圆角"，配色要求保持现有风格）。
**当前状态：通讯 v2 已走完第 1、2 步，正卡在第 3 步等确认——不要跳过直接写代码。**

## 3. 系统地图（按需查）

```
packages/core/src/   引擎：state / industry(精炼+回收+制造) / manufacturing / market / salvage / lairs / sideTasks
                     expedition / combat / equipment / inventory / save(读档迁移) / balance / **comms(通讯收件箱)**
packages/data/src/   静态数据：anomalies / modules / blueprints / marketCatalog / items / dialogues(剧本)
                     **messages(通讯消息表)** / **commsFactions(势力表，待建)** / announcements / context(装配 SimContext)
apps/desktop/src/renderer/src/
                     pages/(一级页：MapPage / IndustryPage / MarketPage / **CommsPage** …)
                     panels/(二级窗：Expedition 任务中心+星图、Handbook、BattleScreen …)
                     ui/(Glyph 图标库 **nav-mail**、shipInfo、…)、styles.css(app-* 家族 + **.app-comms-***)
tools/               content-check（含**通讯消息契约**）/ balance-check / bounty-econ / salvage-econ / faction-audit /
                     liquidity-audit / manufacture-econ / battle-calibrate / make-test-save …
docs/                development-conventions.md(权威) / glossary.md(术语) / roadmap.md(批次) / design/*(设计+交接) / review/*
```

**通讯系统落点（本会话新增，改动前先读这几处）**
- `packages/data/src/messages.ts`：7 条消息 + 七类触发器 `start|day|explored|galaxy|skill|isk|siteBuilt`；`hint = { text, page, tab? }`；`replies` 预留。
- `packages/core/src/comms.ts`：`advanceComms`（幂等送达 + 写一行日志）/ `commsTriggerMet` / `commsInbox` / `commsUnreadCount` / `markCommsRead` / `markAllCommsRead` / `commsGameClock` / `deliverDialogueToComms` / `COMMS_DAY_MS` / `COMMS_REPLIES_ENABLED`。
- 挂点：`core/engine.ts` 的 `advanceGame` 末尾（在 `advanceOnboardingAuto` 之后）；`core/station.ts` 三处挂起/播放剧本时镜像进收件箱（键 `dlg:<剧本 id>`）。
- 存档：`GameState.commsDelivered`（id → 送达游戏内毫秒）/ `commsRead`（只记 true），`save.ts` 两处归一化（**负数/非数值丢弃**、空键丢弃；两字段可选、**零迁移**）。
- 界面：`pages/CommsPage.tsx`（双列 + 点开即读 + 全部标记已读 + 跳转"前往"）；`App.tsx`（`PageKey` 增 `comms`、`NAV_ITEMS` 末位、`PAGE_NO_SCROLL` 增 `comms`、未读徽标与闪烁）；`ui/Glyphs.tsx`（`nav-mail` + `NAV_TONES`）；`styles.css`（`.app-comms-*` / `.app-nav-badge` / `app-nav-blink`）。
- 契约：`tools/content-check.ts` 的**「通讯消息契约」**（id 唯一、触发器引用的星系/技能/站点必须真实存在、跳转页与星图标签合法、玩家文案禁开发用词）。

## 4. 本会话（一号）已交付批次

| 批次 | 提交 | 要点 | 状态 |
|---|---|---|---|
| 文档健康审计与精简 | 见当天早些批次 | `docs/review/doc-health-20260911.md`（33 项未修漂移留档）+ README 重写、architecture 到 v24、glossary 口径修订、conventions 同步 | 已推送 |
| 消耗品市场规模 ×15/×6/×2 | 同上 | `marketCatalog.ts` 池与流量重算（动能弹 1,296,000/10,800 等），`tools/liquidity-audit.ts` 新增消耗品侧 | 已推送 |
| 齐射扣弹（门数） | 同上 | 多门武器齐射按门数扣弹、不足则停火（`combat.ts` `WeaponSpec.count`） | 已推送 |
| 低安续扫读档截断 | `34ab538` | `explore.ts maxScanWindowMs()`（22 分钟），`save.ts` 读档按它钳 | 已推送 |
| 跨族加成不显示 | `065daf3` | `shipInfo.tsx` `crossFamilyLines/Short` + `content:check`「模块跨族字段契约」 | 已推送 |
| 远端衰减三改 + 回调 | `33a46c1` → `11e52e2` | 动能炮台 0.5 / 敌方默认 0.5 / 激光最远端 ×0.1；窝点专属件逐件定（D 0.6 / A 0.35 / E 0.1） | 已推送 |
| 文案去开发腔 + 老公告去内部话语 | `56c9172` / `d6eac01` | 17 个文件（彩头→额外掉落等）+ 6 张老公告 9 条 bullet | 已推送 |
| 派系卡清空后消失 | `065b429` | 界面渲染分支修复 + core 回归用例（`bounty-tasks.test.ts` 39 例） | 已推送 |
| 稀有残骸「起炉即预占」（一件 = 一箱） | 前一晚批次 | 私有料账 `claimedUnits` + 开箱资格 `rareBoxEligible` 两道锁 | 已推送 |
| 修复「稀有残骸空了精炼炉还在运转」 | `b861966` | 根因 = 界面读公共库存而非炉内料账；连带修**两个读档丢字段的真 BUG**（料账归零即失效 / 开箱资格未落盘） | **已推送**（线上 `index-9o0imOc6.js`） |
| **通讯页 v1** | `2ebb6ea` | 7 条消息 + 七类触发器 + 通讯页（双列/未读闪烁/徽标/跳转）+ 剧本镜像 + 契约 + 10 例用例 | **未推送** |
| **通讯公告** | `0321ac8` | `announcements.ts` 首条（**25 → 26 条**），船长批准「按样稿发」 | **未推送** |
| 推送回执记录 | `e022e3b` / `1bea85f` | roadmap 记录两次推送与线上产物核对 | 未推送 |

**线上核对手法**（两次都用过，很好用）：推完等 Pages（约 1 分钟），拉 `https://yahzj.github.io/Deepseek-EVE/` 找 `assets/index-*.js`，
与本地 `cd web && npm run build` 的产物**同名同体积**即"同一份产物"，再逐字 grep 新文案确认已生效。

## 5. ★ 进行中：通讯 v2（卡在四步闸门第 3 步）

### 5.1 你要做的第一件事

船长已给出**全部裁定**（下面是原文口径），我已交出**修订设计总结**并请他确认；他随后要求**先写交接卡**。
⇒ **接手后第一件事**：把 §5.3 的设计总结复述给船长（或直接问那句待定项），拿到「可以/没问题」+ 一个字的选词，再开工。

### 5.2 船长裁定（原文口径，六 + 六 + 六）

**通讯功能本体（六问全选「甲」）**：①消息来源 = 数据表 + 触发条件；②与既有 T9 建站剧本**合并**（统一到通讯页）；
③消息带任务 = **只给提示 + 跳转**；④未读 = **逐条已读 + 图标闪烁 + 未读计数**；⑤版式 = **双列、列表内部滚动、一级页不滚**；
⑥回复 = **预留回复选项接口，但目前不启用**。

**界面（针对他给的参考图，逐条）**：①**只模仿边框线条**（比如圆角等），**颜色风格保持现有风格**；
②**不放头像**（丙）；③**不要「未解锁」占位行**（甲）；④装饰件与动效 = **极简**（去掉扫描线/人字纹/电量格/旋钮，除已有未读闪烁外不加动画）。

**世界观（六条）**：见 §1 末尾"世界观口径"。

### 5.3 已交出的修订设计总结（照此实现）

**A. 世界观铁律 6 条**（写进设定文档 + 做成契约）
1. 官方势力 = **章鱼人**（无更正式族名；协会对外自称「协会」）→ 势力数据加 `species: '章鱼人'`，**契约强制所有 NPC 势力都是章鱼人**（防设定漂移）。
2. 章鱼人**不追问船里是谁**，把玩家当**普通承包舰船** → 文案铁律：NPC 消息**不得出现**指涉玩家本质的词（AI / 智能 / 旧时代 / 人类），也不做特殊对待。
3. 其他 NPC（打捞队工会等）**也是章鱼人**，同族不同行会。
4. 玩家保留被称**「飞行员」**（协会职务称呼，与物种无关）；自定义名 = **呼号** → 现有 3 处文案**不动**。
5. **人类早已离开/消失在深空**；协会不谈、也帮不上。
6. 敌族关系**留白**（F 族制式巡逻与协会的关系一句"见敌族文档"，不编）。
   **＋ 我自查补的第 7 条（待船长点头）**：玩家**就是那条船** ⇒ 文案禁用「你的舰船」这类主体分离说法。

**B. 因它产生的现有文案改动（仅 1 处）**：`packages/data/src/messages.ts` 欢迎信
「协会的通讯终端已经为**你的舰船**开通」→ **「接到你这条船上」** 或 **「接入你的舰桥」**（船长二选一，**这是唯一待定项**）。
其余 6 条消息已逐条查过：无人类/AI/旧时代指涉、无"你的舰船"式说法，不动。

**C. 设定文档（新增 1 份）** `docs/design/npc-factions-20260911.md` —— **NPC 势力档案（协会侧）**：
①叙述铁律（上表 6+1 条）；②**深空工业协会**（章鱼人·官方）：8 部门表（航行管制 / 基建部 / 测绘处 / 工业部 / 冶炼组 / 训练处 / 财务处 / 航线安全），每部门写「职能 · 口吻 · 可发内容类型 · 已发消息」；
③**打捞队工会**（章鱼人·民间，老陈等）；④与既有系统的接口（只提示 + 跳转）；⑤预留势力（搬运行会 / 自由商队 / 深空救援队——登记不实现，待船长批）；
⑥命名与维护规则（新增势力/部门必须同步「数据 + 词典 + 契约」）。

**D. 势力入档为数据实体**
- **新增** `packages/data/src/commsFactions.ts`：字段 `id / name / species / alignment(官方·民间·中立) / tone(与既有系统同源取色) / glyph(复用既有 SVG 线稿图标名) / brief(界面 tooltip"这是谁") / kinds(该势力可发内容白名单) / departments[]`。
  本期 2 个势力：`dshi`（协会，8 部门）、`salvage-guild`（打捞队工会，1 部门）。
- **消息表改引用**：`from`（自由文本）→ `factionId + deptId? + signer? + kind(剧情·提示·委托)`；7 条就地改，**玩家看到的发件人写法不变**（仍是「深空工业协会 · 航行管制」）。
- **4 份剧本**挂靠 `dshi · 基建部`（`DialogueScriptDef` 增可选 `commsFactionId/commsDeptId`）。
- **core**：`SimContext` 增 `commsFactions`；`CommsEntryView` 增 `fromName / signer / tone / glyph / alignment / kind`；解析失败**降级显示原文，不崩**。
- **契约扩展**：势力/部门必须存在、`message.kind ∈ faction.kinds`、每个势力至少被引用一次、`species` 必须为章鱼人。
- **配色建议**（与既有系统同源）：协会 `#9fd8ff`（与 `nav-mail` 同族），打捞队工会 `#6fe3f0`（与 `nav-salvage` 同族）。

**E. 界面（按参考图只借线条，配色照旧）**
保留：**机身式大圆角外框 + 内嵌屏幕圆角框**（双层线）、左列**圆角行块**列表、屏幕下方**通栏胶囊「前往」**、
屏幕内三层信息（大标题 → 细分隔条[发件人 + 立场小片] → 正文），`brief` 作发件人悬停说明，内容类型小片放标题右侧。
不做：头像、未解锁占位行、扫描线/人字纹/噪点/电量格/旋钮等装饰、任何新增动画。
（v1 目前用的是"14 顶点不规则 SVG 外框"，v2 按此换成"圆角机身 + 内嵌屏幕"的线条语言。）

**F. 建议实现顺序**：`data/commsFactions.ts` → `data/messages.ts` 改引用 + `dialogues.ts` 挂靠 → `core/types.ts` 与 `core/comms.ts` 解析 → `save.ts`（无需改，势力不入档）→ `content-check` 契约扩展（含负向验证）→ `CommsPage`/`styles.css` 视觉改版 → core 用例补势力解析与降级 → 四连 + 产物核对 → 词典（术语）+ 设计稿（`docs/design/comms-20260911.md` 补 v2 口径）+ roadmap 条目。
**公告**：已批准的通讯公告（`2026-09-11-comms`）**不改**（发件人写法与"导航新增通讯"口径都没变），本批新增内容不另发公告。

## 6. 参考图（★ 图不在仓库里）

- 原始附件：`C:\Users\ya\.dsh\attachments\v1\objects\64\64a8dd5fe510bc0465fec4f1afd717704ce144cf3c48b785e98784ae3e2d45b3`（PNG，无扩展名，1173×529）。
- 工作副本：`H:\大鲸鱼\_ref-comms-ui.png`（**工作区根、不在仓库内**；用完请删）。
- 读图办法（本机）：**`describe_image` 工具不存在**；用 `Copy-Item` 拷成 `.png` 后调 **`read_image`**（当前模型可读图）。

**图的内容（我已读出，照此即可，不必再看图）**：
- **左：手持"清单"设备**——米白塑料机身、左缘竖排大字、顶部喇叭孔与传感器点、侧边两颗实体键、右上角一块深色缺口；
  内部纵向条目：**选中/新到那条 = 橙红实心底 + 黑字**，左上角 `NEW!` 斜标签，行内右侧**圆形头像**（右上角橙点），标题下一行小字；
  未选中行 = **深灰圆角块**，标题「未解锁」+ 一行暗色小字，右侧**圆形 × 徽章**。
- **右：复古 CRT 监视器**——米灰机身，左上角铭牌 `(()) INTER-KNOT VIEW`（信号小图标 + 名称），右上角指示灯；
  深色屏内：**大号白色标题**（右上角 `[名]` 小标签）→ **灰底小条「任务描述」+ 右侧三枚铃铛** → 正文一段；屏幕背景有**三角/人字纹**、
  左上与右下角**斜向扫描条纹**、右缘**噪点竖带**、右下角小字编号位；屏幕**下方**一颗**通栏深色胶囊主按钮「前往」**；
  右下角**绿色电量格 + 圆形旋钮**（上带小字），左下角喇叭孔。
- **风格**：卡带未来 / 复古终端（实体塑料机身 + 深色屏），唯一高饱和色是"新到/选中"的橙红。
- **船长只借其中的"边框线条/圆角"，配色要求保持现有风格** ⇒ 见 §5.3 E。

## 7. 其他挂账（等你向船长确认优先级）

| # | 事项 | 现状 | 需要谁 |
|---|---|---|---|
| 1 | 通讯 v2 的**唯一待定项** | 欢迎信「接到你这条船上」/「接入你的舰桥」二选一 | **船长一个字** |
| 2 | E 段（boss）顶格实测回传 | `docs/review/pending-decisions-20260910.md` §0：仍挂账 3 件（E 段回传 / 两处 `foeDmgMul` 标注 / P1 预警线提示形式），**只有这条需要船长动作** | 船长回传/指派 |
| 3 | 巡洋 T3 数值 / 渠道声望终审、渠道工船例外口径 | `roadmap.md` O6 行 + `pending-decisions-20260910.md` §表（工船不随尺寸入奇货：维持例外 or 全入奇货） | 船长一句话 |
| 4 | 早期设计稿漂移 | `docs/review/doc-health-20260911.md` §2 列了 33 项（已修高危 + 挂横幅），**按船长裁决"只修高危"** ⇒ 不要再大动 | 无需动作，留档 |
| 5 | `ore-veldspar` 价格不一致 | `items.ts:23` = 13 vs `marketCatalog.ts:35` = 12（已报船长，未选处置） | 船长裁决 |
| 6 | 通讯内容扩展 | 7 条消息只是第一批；剧情线与更多势力（搬运行会/自由商队/救援队）待排期 | 船长排期 |
| 7 | 两处 `foeDmgMul 0.35` 标注 | 收尾细节（见 pending-decisions §十一） | 随手收口 |

## 8. 他人在途（按 §4 纪律：只读观察，不触碰）

- **二号（d2 工作区）**：HEAD `82ea695`「取三号 B 族回交单与 C 族商讨稿 + 合并说明 + 蜃影全表明细」；
  之前批次含**舰种表（5 档基准速度）+ 敌舰级接入舰种基准速度 + A 族数值落地 + 单波次内增援（实现未启用）**，
  其 core 基线比 main 高（**827 例**）。
- **三号（verify 工作区）**：HEAD `67167e4`「C 族族格草案定案（船长五条裁定）」；同日另有 **B 族「武装拾荒者」设定定案**
  （已合入 main：`189fc5d`/`7bfe50e`/`4541c07`，落码清单 10 项**待落码**）。
- **并发提示**：三号会**直接往 main 树提交**（含 roadmap）。编辑文档前**先重读**；roadmap 冲突按船长口径**「两条都留」**解决；
  别人在途时**只读观察、报告证据**，不要抢改同一文件。

## 9. 验证闭环与常用命令

```bash
npm run typecheck            # core + data + ui + desktop 四包（tools/ 不在内！）
npm run test -w @whale/core  # 引擎全量用例（当前 823 通过 / 84 文件）
npm run content:check        # 内容契约体检（含「通讯消息契约」等 20+ 契约）
npm run build                # 桌面端构建（产物在 apps/desktop/out/renderer）
cd web && npm run build      # ★ 玩家实际在玩的网页版产物（Pages 用同一条命令）
npm run balance / bounty:econ / salvage:econ / faction:audit / liquidity:audit / manufacture:econ
npx tsx tools/make-test-save.ts <case>   # 生成实机测试存档（基于真档注入 + 自动备份）
```

**改 UI 的实机核验流程（无头 Chrome，沿用上一位交接件 §6）**：
`cd web && npm run build`（**会清空 `web/dist`**）→ **构建之后**再放探针 `web/dist/__probe.js` + 注入 `<script src="./__probe.js">`（用 edit 工具改 html）→
`cd web && npx vite preview --port 4173 --strictPort`（后台）→ `chrome --headless=old --disable-gpu --no-sandbox --user-data-dir=<临时> --window-size=1600,900 --virtual-time-budget=22000 --dump-dom <url>`
（Chrome 在 `C:\Program Files\Google\Chrome\Application\chrome.exe`）→ 探针把结果写进 `document.title` 的 `PROBE_BEGIN…PROBE_END` 段解析。

## 10. 已知坑与教训（都真实踩过）

1. **别用 PowerShell 改仓库里的中文文件**（`Set-Content`/`>`/here-string 会重编码成乱码）——中文一律用 read/write/edit 工具。
2. **PowerShell 命令里别用双引号包中文**（易触发解析错误）；用单引号，或把中文换成长度/字符码方式匹配。
3. **PowerShell 5.1 读 UTF-8 会乱码** ⇒ 检索中文用 grep/read 工具，不要靠 `Select-String`。
4. **`git commit -m` 里别出现直引号 `"`**（会截断命令）。
5. **构建会清空 `web/dist`** ⇒ 探针必须在构建之后放。
6. **`vite preview` 要在 `web/` 目录跑**，绑 `localhost` 而非 `127.0.0.1`。
7. **`tools/` 不在 typecheck 覆盖内** ⇒ 改完正式工具必须**跑一次**（例：`npm run content:check`）。
8. **导出路径**：`advanceRefining` 等只在 `packages/core/src/industry.ts`（core index 未导出）；核心 API 走 `@whale/core`。
9. **改数值先想契约会不会被打穿**（例：碎片 `need` 100→25 会让"按 need 反推档位"的代码失效，正确做法是加显式 `tier`）。
10. **别改船长真档**；要测就生成测试档。
11. **「归零/为假」的字段在读档时被丢会静默改变行为**：`claimedUnits`/`lockUnits`/`rareBoxEligible` 只收正数时，
    炉子会在读档后改吃公共库存 / 已开箱的余料再开一箱。**归一化必须区分"字段缺失"与"0/false"**（本会话真 BUG）。
12. **界面读的字段和引擎真正用的字段可能不是同一个**：稀有残骸的料在**炉内私有料账**里，而界面读**公共库存**
    ⇒ 玩家看到"残骸空了、炉子还在转"。任何"私有状态"都要在界面显式呈现。
13. **`npm run build` 只构建桌面端**；**玩家玩的是网页版**（`web/` 独立工程 + `.github/workflows/pages.yml` 推送 main 后自动构建）。
    改完要 `cd web && npm run build` 并核对产物，**推送后玩家才看得到**。
14. **线上构建能反查**：拉线上 `assets/index-*.js` 与本地构建**同名同体积**即同一份产物，再 grep 新文案即完成"上线闭环"。
15. **React `useMemo` 依赖对象（`state`）恒等不变**：要带上会变的字段（如 `state.gameMs`），否则列表不刷新。
16. **CSS 优先级**：单类 `.app-xxx` 覆盖不了 `.wui-panel.win-fixed-body .app-win-body`，要用同级复合选择器写。
17. **图片附件在** `~/.dsh/attachments/v1/objects/<sha 前两位>/<sha256>`（无扩展名）；拷成 `.png` 后用 `read_image` 读。
    **`describe_image` 工具在本机不存在**——别调。
18. **`git push` 直连 GitHub 常被重置**：用一次性 `-c http.proxy=http://127.0.0.1:7897`（别写持久配置）。

## 11. 接手检查单（逐项打勾）

- [ ] 读完 `AGENTS.md` + 本页；通读 `docs/development-conventions.md`
- [ ] `git status` 三棵树；确认 main 领先 origin **3 条**（`e022e3b` / `2ebb6ea` / `0321ac8`），**未经船长同意不要推**
- [ ] 四连验证全绿（typecheck ×4 / core 823 / content:check / build）
- [ ] 读 §5，把设计总结复述给船长 + 问那个二选一用词，拿到「可以」再动代码
- [ ] 读 §7 挂账，向船长确认当前优先级（通讯 v2 之前是否还有别的急件）
- [ ] 补看 `docs/design/comms-20260911.md`（通讯 v1 设计稿，状态=已确认）与 `docs/design/announcement-draft-comms-20260911.md`（公告已批）
- [ ] 若船长要实测通讯：**注意线上还没有通讯页**（未推送）；要实机看就先确认推送时机，或用无头 Chrome 本地起 `web/dist` 看
- [ ] 用完删除 `H:\大鲸鱼\_ref-comms-ui.png`（参考图工作副本，不在仓库内）
