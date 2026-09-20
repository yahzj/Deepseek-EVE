# 英语本地化 · 交接卡（2026-09-19 · 三号）

> 交接对象：接手继续做「《大鲸鱼-深空放置》英语本地化」的会话（一号/二号/新助手皆可）。
> 工作文档（过程记录与分期）：`docs/design/l10n-en-20260919.md` · 术语权威：`docs/glossary-en.md`。
> 本卡只讲**怎么接着干**：状态 · 流程 · 坑 · 剩余 · 验收。

## 0. 30 秒速览（**2026-09-20 三号复核后刷新——原 §1/§3 读数已过期**）

| 项 | 值 |
|---|---|
| 分支 | `verify40`（三号工作树 `H:\大鲸鱼\Deepseek-EVE-verify`）；**已并 main 至 `bad7601e`**（2026-09-20 并，52 条） |
| 纪律 | **船长令：翻译全部完成前不合入 main**（只本地提交）；main 侧由一号维护 |
| 唯一表 | `packages/data/src/l10n/table.ts` —— **2,912 条**（`id → { zh, en }`） |
| 接线 | 渲染层 `t()`/`tr()` 调用点 **≈3,495 处**（63 个源文件） |
| 剩余读数 | 渲染层含中日韩字面量 **251 条**（2026-09-20 实测；界面批开工前 323） |
| 未做 | **core 引擎文案 ≈617 处**（`addLog(` 316 · `error: '中文'` 301）· **主进程文案 ≈10 处** · **P4 逐页溢出读数表** |
| 已验证 | typecheck 四包 0 错 · core 用例全绿 · `content:check` · `ui:rot-check` · `build` · `docs:index --check` 全绿 |

## 0.1 2026-09-20 三号这一轮做了什么（下次接手先看这段）

1. **并 main（卡 §8 第一件事）**：52 条，12 处冲突 / 27 个冲突块，口径「保留 ID 制、采纳对方结构」。
   顺带**删掉 main 侧旧词典制残留** `i18n/dict.en.ts`（我方 P1b 已废止该机制）；补 18 条新造表项；
   4 处旧写法 `t('中文')` → `tr(id)`。提交 `90d2cf01`。
2. **界面批第一块：虫洞面板**（原 51 条未译 → 0）。提交 `0bd77d0e`。
   ⚠ **方法学（下次照做）**：剩余未译**绝大多数是"被 `{}` 切碎的 JSX 文本断片"**
   （`<span>第 <b>{n}</b> 层</span>` 这种），正式两件套**不覆盖这类**——
   要「读源码 → 整段替换成 `tr(id, {参数})` → 补表」手工做；断片必须**并回整句**再翻
   （例：`第 {n} 层` 一条、`共 {n} · 抛弃 {x}` 一条），否则英文语序会错位。
3. 顺手做了**表去重自检**（重复键 0 · BOM 无 · 往返解码乱码 0）——⚠ 手工插条目极易撞号/重复，改完必查。

## 1. 接手先跑这 6 条（确认现状，别凭记忆）

```powershell
cd H:\大鲸鱼\Deepseek-EVE-verify
git log --oneline -3                      # 应为三号 2026-09-20 的本地提交
npm run typecheck                         # 四包 0 错
npm run test -w @whale/core               # 全绿
npm run l10n:check                        # 表 2912 · 未译 251（报告口径不阻断）
npm run content:check ; npm run ui:rot-check ; npm run build ; npm run docs:index -- --check
```

⚠ **沙箱**：本仓全部闸门工具走 `tsx`→`esbuild`，在 `workspace-write` 沙箱下会 `spawn EPERM`；
需 `danger-full-access`（2026-09-20 会话已放开）。

## 2. 架构一页纸（**先读这段，别改架构**）

船长 2026-09-19 追加令：「所有本地化文本采用 ID 引用，只需要做一份本地化表就能直接进行替换」。

- **唯一表**：`packages/data/src/l10n/table.ts` 的 `L10N`（由 `@whale/data` 导出）。
  id 规则 `<域>.<文件短名>.<三位序号>`，域：`ui./ship./mod./item./skill./ano./gal./belt./station./faction./travel./matter./bp./wreck./core.`。
- **三条读取路径，同一张表**：
  1. 渲染层组件：`useL10n().t(id, params)`（hook，随语言重渲染）；
  2. 渲染层模块级/工具函数：`tr(id, params)`（读模块级语言；切语言时引擎 `notify()` 会重渲染整棵树）；
  3. 内容数据：`localizeCtx(ctx, locale)` / `buildSimContext(locale)` 读同一表的 `ship.` `item.` 等段（`locale==='zh'` 原样返回）。
- **缺 id ⇒ 显示 id 本身**（不再回退中文）：这是"漏登记一眼可见"的设计，别改成回退。
- **源码里不留中文**：`table.ts` 是唯一真源；改文案＝改表；改 id 需同步改源码引用。
- **工具两件套**（都在 `tools/`，已登记 `tools/README.md`）：
  - `npm run l10n:wrap`：AST 批量接线器（造 id + 写表 + 改源码）；
  - `npm run l10n:check`：体检器（ID 不变量 + 未译读数），是**闸门**。

## 3. 剩余四件事（按优先级）

### ① core 引擎文案 ≈617 处（最大一块，**开工前需船长定口径**）

- 位置：`packages/core/src/*.ts` —— `addLog('中文…')` **316** 处 · 命令错误 `error: '中文…'` **301** 处。
- 建议口径（**待船长确认**）：**core 只产出「文案 id + 参数」**，渲染层按当前语言渲染
  ⇒ core 与语言解耦、老档日志仍保持中文（船长已定），新日志跟语言。
- 若改口径 ⇒ 属系统级改动，**走四步闸门**（集中提问 → 中文设计总结 → 等确认 → 再实现）。
- 备选（更省事但有代价）：只翻"命令错误串"（301 处，界面直接显示），日志文案留中文——需船长点头。

### ② 渲染层碎片 / 漏项（**2026-09-20 实测：251 条**，方法已跑通）

- 分布（前六）：`panels/Expedition.tsx` **54** · `pages/ShipPage.tsx` **26** · `panels/Industry.tsx` **24** ·
  `pages/FitPage.tsx` **17** · `pages/MarketPage.tsx` **16** · `panels/MapPage.tsx` **9**；
  其余散在 `WormholeScan` / `Glyphs` / `itemSubs` / `shipInfo` / `wreckFlavor` / `wormholeIntel` / `App` / `engine` 等。
- ⚠ **这类就是卡 §0.1-2 说的「JSX 文本断片」**：`npx tsx tools/l10n-wrap.ts` 只报 13 处可自动包，
  剩下 200+ 全要**手工整句替换**（断片并回整句再翻）。别再指望工具批处理。
- 已做完的样板：`panels/Wormhole.tsx`（51 → 0，提交 `0bd77d0e`）——照它的改法做下一批即可。
- 逐文件清单做法（探针不入仓，用完即删）：用 TS AST 列 `StringLiteral` + `JsxText` 里含中日韩的节点
  （判据与 `tools/l10n-check.ts` 同），或直接读 `l10n:check` 的 Top 10 表。
- ⚠ **手工插条目必做三条自检**：同 id 不重复（TS1117 会报）· 不撞号（先查该段最大号）·
  中英 `{占位符}` 集合一致（体检器会报）。

### ③ 主进程 / 预加载的文案 ≈10 处（**渲染层工具扫不到，别漏**）

- 扫描根：两个工具的 `ROOT` 都写死在 `apps/desktop/src/renderer/src` ⇒
  **`apps/desktop/src/main/index.ts` 与 `preload/` 从没被扫过**。
- 实测（2026-09-19）：`main/index.ts` 有 10 处玩家可见中文——窗口标题 `'大鲸鱼-深空放置'`（第 204 行）·
  导入/导出对话框的 `title`/`buttonLabel`/`filters[].name`（151~177 行）· 两条错误串（161/171 行）。
- 处理建议（二选一，**建议甲**）：
  甲：这 10 处也走唯一表（主进程启动时读语言偏好 + `L10N`，与语言切换解耦但即时性要求低）；
  乙：给它们打 `l10n-keep` 并在工具里把扫描根扩到 `apps/desktop/src`，明示"主进程只出中文"。
- ⚠ 无论选哪个，**工具扫描根要扩到 `apps/desktop/src`**（否则这块永远是盲区）。

### ④ P4 逐页溢出读数表（**船长明确要的交付物**）

- 目的：英文比中文长 30~60%，逐页给读数，船长据此定排版（一级页「不滚」红线是否维持由船长裁）。
- 做法：`npm run ui:geom` / `npm run ui:probe` 在 **en 语言**下逐页量（只算读数、不做观感结论——观感归船长）。
- 交付：一张表（页 / 中文块高 / 英文块高 / 溢出 px / 是否滚动）+ 建议。

### ⑤ 收尾核对

- 把「故意不译」两类登记进 `l10n-check` 白名单，让读数归零可核：
  ① `l10n-keep` 标记项（类型字面量联合 key、`game/autoPerf.ts` 的 `AUTOPERF_*` 开发协议串）；
  ② 逻辑比较用中文串（`=== '中文'` 一类，不进界面）；
- 4 条未接线条目（`ui.Industry.019/098`、`ui.ItemsPage.022/023`）：其中文在源码里仍大量出现，
  下次接线会**按 zh 自动复用**；若确认已废则删。

## 4. 每批工作的标准流程

1. `git merge main`（若落后）→ 解冲突（**保留 ID 制、采纳对方结构**，见 §5 坑 6）；
2. `npx tsx tools/l10n-wrap.ts --only=<文件>` 拿清单；
3. 写 EN 映射 JSON（`tools/_l10n-en-<批>.json`，`{ "中文": "English" }`）——**只放你要翻的串**，缺译的一律不包；
4. `npx tsx tools/l10n-wrap.ts --en=tools/_l10n-en-<批>.json --write`（可加 `--only=`）；
5. 跑闸门：`typecheck` + `l10n:check`（**必看尾部 ✅/❌**）+ `content:check` + `ui:rot-check` + `build`；
6. `git add -A && git commit`（中文说明：改了什么 · 数量 · 验证 · 已知取舍）；**不合并、不推送**；
7. 删临时探针与映射 JSON（`_` 前缀的用完即删；有复用价值的转正式工具并登记台账）。

## 5. 坑（都踩过，附症状 → 解法）

| # | 症状 | 解法 |
|---|---|---|
| 1 | id 撞号：typecheck 报 **TS1117**（对象字面量重名）或体检器报**死引用** | 造 id 前**先查该段最大号**；`ui.<段>.<最大+1>` |
| 2 | 源码被写成坏行（`})gine.034")}。` 之类），typecheck 报语法错 | **嵌套**（模板里套模板 / 模板里套三元中文串）：工具只包内层，**外层转人工按参数整句拼** |
| 3 | 英文界面仍显示中文 | 片段只往后接 `{tr(...)}` 没删中文 ⇒ **整段替换**，改完 grep 一遍那段的原文 |
| 4 | 多行 `title` 换行丢失 / 键对不上 | 值里写**真换行**：JSON 里 `\n`（不是 `\\n`）；工具报告里换行以 `\n` **转义显示**，别照抄 |
| 5 | 英文值被体检器判残留中日韩 | 只放行「语言自称」（`en === zh`，如「中文」）；中文引号 `「」` 要换成 `“”` |
| 6 | 解冲突时把对方的中文 key 写法带回来 | 对方若写 `t('中文')`（旧词典写法，词典已删）⇒ **转成 `tr('ui.…')` 并补表项**；解冲突后**必跑 typecheck**（漏 `*/` 会吞掉整段） |
| 7 | **批量替换把 id 写成了显示文本**（`onToast(r.error ?? 'ui.Exp.389', true)`）——`typecheck` 与 `l10n:check` **都查不出**，真机上把 id 原样显示给玩家 | ⚠ **替换串必须是 `tr('id')` 整体，不能只换引号里的内容**（2026-09-20 我栽了 38 处）。改完必跑自检：`git grep -n -E "\?\? *'ui\.[A-Za-z]+\.[0-9]{3}'" -- apps` 必须为空 |
| 8 | **加了表项却忘了改源码** ⇒ 表里躺着一批"未接线"条目、源码仍是中文 | 改完必跑**表 ↔ 源码引用对拍**（临时探针即可，不入仓）：未接线条目应只剩"故意不译/待处置"那几条；同中文串多条目应为 0 |
| 9 | `core` 的日志/错误串在**渲染层无 id 可查**（`text` 是中文正文） | 甲案改造中：`LogEntry.textId` + `CommandResult.error` 认 `{ id, params }`，过渡期两者并存；⚠ `packages/core/src/save.ts` 的注释 2026-09-20 前**与代码不符**（曾误写"载入后清空 logs"），已校正——**读注释前先看代码** |

## 6. 待船长裁决

1. **游戏英文名**：船长给出 `Great Whale: Deep Space Idle`；三号复核提了撞名证据——
   副标题已有[同名 H5 游戏](https://gamerankedreview.com/blog/h5-game/deep-space-idle) ·
   `Great Whale` 是[万智牌蓝卡名](https://gatherer.wizards.com/UZ/en-us/77/great-whale) ＋ Steam 有
   [The Great Whale Road](https://steamdb.info/app/464830/patchnotes/)；备选：`Great Whale Idle`（推荐）·
   `Whale Pact: Deep Space Idle` · `Great Whale: Void Idle`。**选定后改 4 处**：表项 `ui.App.056`
   （现为 `zh: "大鲸鱼-深空放置"` / `en: "Whale · Deep Space Idle"`）· Electron 窗口标题
   （`apps/desktop/src/main/index.ts:204` 的 `title: '大鲸鱼-深空放置'`）·
   `docs/glossary-en.md` 登记 · `package.json` 与商店稿英文名。
2. **`ui.ShipPage.106` 与手册页的「入门向」**（设计侧表述）：英文侧已按中性译法处理（`(rank 2)`），
   **中文未擅改**，等船长定是否清理中文。

### 6.1 已定的两项（2026-09-20 船长：甲案 + 先修复）
- **core 文案口径 = 甲案**（core 只产出「文案 id + 参数」，渲染层按语言渲染）。落地要点：
  `LogEntry` 加可选 `textId` / `textParams`（`text` 仍写中文，兼容与检索兜底）；
  `CommandResult.error` 放宽为 `string | { id, params? }`；新域 `core.<文件短名>.<三位序号>`；
  **按文件分批、每文件一提交、随时可停**（老档不迁移）。

#### 6.1.1 甲案实施手册（**照着做，别自己发明**）
**已落地**（提交 `2d2884eb` 地基 + `mining.ts` · `6a8ab3b1` `salvaging.ts`）：
| 环节 | 形状 |
|---|---|
| 日志 | `addLog(state, kind, 中文, 'core.<文件>.<号>', { p1, p2, … })` —— 后两个参数**可选**，不传就是老行为 |
| 指令错误 | `{ ok: false, error: 中文, errorId: 'core.<文件>.<号>', errorParams: {…} }` |
| ⚠ 选型教训 | **不要**把 `error` 改成 `string \| CmdText` 联合：会外溢到全部读取点与用例（实测砸 30+ 处）；**加法式可选字段**才零影响 |
| 渲染层取值 | `i18n/locale.tsx` 的 `logText(entry)` / `cmdText(r)`：有 id 按当前语言，没有显示中文 |
| 派生串（两步渲染） | 若某参数**本身是一句带 id 的话**：core 侧照传中文 + 另给 `<键>Id`（如 `p6Id`）；渲染层 `resolveParamIds()` 会先渲染它再喂进外层文案。样板见 `salvaging.ts` 的 `loopNote` |
| 共用句 | 同一句中文在多文件复用（如"长途运输…再开采/再打捞"）⇒ **拆成两条整句**（`core.state.001` / `.005`），**别用 `{verb}` 参数**（中英语序会错位） |
| 防呆 | `npm run l10n:check` 会扫 `packages/core/src` 里一切 `'core.*'` 字面量：必须在表内且形态合规 |
| 每批收尾 | 删掉中途多造的条目（未接线条目里出现 `core.*` 就是信号）；跑全套闸门 + core 用例 |

**进度（截至 2026-09-20）**：`mining.ts` ✅（36 条）· `salvaging.ts` ✅（27 条）· `shipyard.ts` ✅（40 条）
⇒ 表 **3079** 条（core 段 131；含共用条目命名空间 `core.state.*`：舰队无此船 / 不在已知航路 / 重复清剿已停止 等，
`ai.ts`、`expedition.ts`、`location.ts` 直接复用）。
**⚠ 第五批（`industry.ts`）只做到一半就收工（2026-09-20 · 上下文耗尽的诚实交代）**：
本轮已把该文件的**前置校验错误串**列全并完成一部分改造，但**未跑闸门、未提交** ⇒ 已 `git checkout` **整文件回退**，
表里多造的 `core.industry.*` 也已清理（不留半成品）。**下次开工直接从这里继续**：
1. 该文件的错误串有**两种引号形态**（`error: '…'` 与 `error: \`…\``），**必须两种都扫**
   （我第一次只扫了单引号，漏了 20+ 条 —— `git grep -n 'error: \`' -- packages/core/src/industry.ts`）；
2. 「需停靠空间站…」（精炼炉 / 货柜拆解 / 残骸回收炉 三条）已定为**共用条目**
   `core.state.010`，句式 `{p1}随协会基地网络运转：需停靠空间站（母港或已建成副站）才能启动（AI 核心驱动不受此限）。`，
   `{p1}` = `精炼炉` / `精炼炉的「货柜拆解」` / `残骸回收炉`；
3. 「采矿作业中：先停止开采。」这条已出现在 **3 个文件**（industry ×2 + 别处）⇒ 用 `core.state.013`（打捞/远征/巡逻/返航同理）；
4. **多段拼接**的日志（精炼炉/回收炉的"停炉"那三条 `543/617/642` 附近、AI 战报）**先别接**，
   等"多段文案"形状定了统一做（`ai.ts` 已有同样待办注释）。
**⚠ 2026-09-20 实测「剩余工作量表」（未改造文件；已改完的 `mining`/`salvaging`/`shipyard`/`ai` 不在此列）**：

| 文件 | 剩余 | 文件 | 剩余 | 文件 | 剩余 |
|---|---|---|---|---|---|
| `industry.ts` | **72** | `wormholeSalvage.ts` | **54** | `location.ts` | **50** |
| `expedition.ts` | **45** | `market.ts` | **40** | `equipment.ts` | 29 |
| `wormhole.ts` | 28 | `wormholeBattle.ts` | 27 | `manufacturing.ts` | 24 |
| `hauling.ts` | 21 | `sideTasks.ts` | 20 | `fitPresets.ts` | 17 |
| `engine.ts` | 15 | `wormholeHold.ts` | 13 | `station.ts` | 12 |
| `encounters.ts` | 11 | `wormholeScan.ts` | 9 | `explore.ts` | 8 |
| `matterTech.ts` | 6 | `state.ts` | 6 | `onboarding.ts` | 5 |
| `wormholeAuto.ts` | 4 | `comms.ts` | 3 | `simulation.ts` | 2 |
| `marks.ts` / `events.ts` / `firstRewards.ts` | 各 1 | | | | |

⚠ **节奏教训（2026-09-20）**：一轮**别挑 >40 的文件**——`industry.ts`（72）就是这么做到一半、上下文耗尽
被迫整文件回退（不留半成品）。建议：**一轮一个 20~40 的文件**，或一轮两三个 <15 的小文件。
（`combat.ts` 此前显示的 3 处是误计：它的日志/错误是派生串，见下条待办。）

**下一批建议顺序（按上表从小到大重排，先清小文件攒手感）**：
`marks.ts` → `events.ts` → `firstRewards.ts` → `simulation.ts` → `comms.ts` → `wormholeAuto.ts` →
`onboarding.ts` → `matterTech.ts` / `state.ts` → `explore.ts` → `wormholeScan.ts` → `encounters.ts` →
`station.ts` → `wormholeHold.ts` → `engine.ts` → `fitPresets.ts` → `sideTasks.ts` → `hauling.ts` →
`manufacturing.ts` → `wormholeBattle.ts` → `wormhole.ts` → `equipment.ts` → **`market.ts`** →
**`expedition.ts`** → **`location.ts`** → **`wormholeSalvage.ts`** → **`industry.ts`**（大件最后、单独一轮）。

- **日志口径实测与纠偏**（船长追问"老档哪来的历史日志"后查实）：日志**不落盘**（引擎 `persist()` /
  `currentSaveText()` 写盘前剥离）⇒ 真实档 `logs` 恒为空；**但**造档工具（`tools/make-test-save.ts` 等）
  直接用通用件序列化，故 `docs/test-saves/` 里 **1~300 条日志**；2026-09-08 之前的真实档也带
  （实测 `user-backup-20260907-234825.json` 300 条）。已修：注释校正 + **导入外部档不再透传旧日志**
  （提交 `be5a0967`）；"恢复备份"仍按 2026-09-08 口径接续显示。
  ⇒ 甲案**无需为历史日志做迁移**。

## 7. 文件清单

| 类别 | 文件 |
|---|---|
| 唯一表 | `packages/data/src/l10n/table.ts`（生成件，只许经工具/人工改这一处） |
| 工具 | `tools/l10n-wrap.ts`（接线器）· `tools/l10n-check.ts`（体检器）——都在 `tools/README.md` 台账 |
| 渲染层骨架 | `apps/desktop/src/renderer/src/i18n/locale.tsx`（`L10nProvider` / `t` / `tr` / `textOf`）· `i18n/fmt.ts`（数字与单位） |
| 内容覆盖层 | `packages/data/src/l10n.ts`（P2 的 `EN_*` 表 + `localizeCtx`）· `packages/data/src/context.ts`（`buildSimContext(locale)`） |
| 用例 | `packages/core/tests/l10n-overlay.test.ts`（23 例：覆盖完整性 / 深比 / 占位符 / 卡片嵌套） |
| 文档 | `docs/glossary-en.md`（术语与专名，权威）· `docs/design/l10n-en-20260919.md`（过程与分期）· 本卡 |
| 引擎接口 | `GameEngine.setLocale(locale)`（重建 ctx + 目录数组后 `notify()`）⇒ 切语言即时生效 |

## 8. git 状态与合并步骤

- 现状（**2026-09-20 已刷新**）：`verify40` 已并 main 至 `bad7601e`（52 条），合并提交 `90d2cf01`；
  此后本工作树领先 main（只有本地提交）。**main 若再前进 ⇒ 照下面再并一次**。
- 步骤（**合并进 verify40，不动 main**）：
  ```powershell
  git log main --oneline -5          # 先看对方改了什么
  git merge main --no-edit           # 解冲突：保留 ID 制、采纳对方结构
  npm run typecheck ; npm run l10n:check
  ```
  ⚠ **解冲突三条实战口径（2026-09-20 实测）**：
  ① 结构取对方、判据取我方——对方把某段重写了就整段取对方，再把其中的中文接成 `tr(id)`；
  ② **对方可能带回旧词典制残留**（`i18n/dict.en.ts` 一类）⇒ 一律按 ID 制处理，不留第二套机制；
  ③ 解完**必跑 typecheck**（漏一个 `*/`、少一个 import、变量改名没跟（本次 `openM`→`farM`）
     都会当场报；`git diff --diff-filter=U` 列表清空后再提交。
- 合并后**必跑**：typecheck · l10n:check · content:check · ui:rot-check · build · core 用例 · docs:index。

## 9. 船长验收建议（英文好不好、排版行不行，只有船长能判）

1. 本地跑起来 → 设置面板切 **English**（语言存 `localStorage`，不进存档）；
2. 逐页看一遍：**星图 / 舰船 / 装配 / 物品 / 市场 / 工业 / 技能 / 任务中心 / 通讯**，再进 **虫洞 / 远征 / 手册**（三份长文）；
3. 重点看悬浮信息层（舰船与装备卡片），那里是英文最长的地方（读数见 §3 ③ 的 P4 表）；
4. 反馈按「页 → 具体串」给，我按 id 改表即可（一处改、全语言一致）。
