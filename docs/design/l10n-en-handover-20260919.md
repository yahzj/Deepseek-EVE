# 英语本地化 · 交接卡（2026-09-19 · 三号）

> 交接对象：接手继续做「《大鲸鱼-深空放置》英语本地化」的会话（一号/二号/新助手皆可）。
> 工作文档（过程记录与分期）：`docs/design/l10n-en-20260919.md` · 术语权威：`docs/glossary-en.md`。
> 本卡只讲**怎么接着干**：状态 · 流程 · 坑 · 剩余 · 验收。

## 0. 30 秒速览

| 项 | 值 |
|---|---|
| 分支 | `verify40`（三号工作树 `H:\大鲸鱼\Deepseek-EVE-verify`）；**落后 main 27 条**（见 §8 先并一次） |
| 纪律 | **船长令：翻译全部完成前不合入 main**（只本地提交）；main 侧由一号维护 |
| 唯一表 | `packages/data/src/l10n/table.ts` —— **2,816 条**（`id → { zh, en }`，383 KB） |
| 接线 | 渲染层 `t()` / `tr()` 调用点 **3,405 处**（63 个源文件）；表 ↔ 源码引用 **2,812 个 id**（4 条暂未接线） |
| 剩余读数 | 含 JSX 文本的未译 **308 条**；工具侧「需人工 58 + 缺译 51」 |
| 未做 | **core 引擎文案 ≈617 处**（`addLog(` 316 · `error: '中文'` 301）· **主进程文案 ≈10 处**（工具盲区）· **P4 逐页溢出读数表** |
| 已验证 | typecheck 四包 0 错 · core 173 文件 / **1,888 例** · `content:check` · `ui:rot-check` · 构建 · `docs:index` 全绿 |

## 1. 接手先跑这 6 条（确认现状，别凭记忆）

```powershell
cd H:\大鲸鱼\Deepseek-EVE-verify
git log --oneline -1                      # 应为三号的本地提交
npm run typecheck                         # 四包 0 错
npm run test -w @whale/core               # 173 文件 / 1888 例
npm run l10n:check                        # 表 2816 · 未译 308（报告口径不阻断）
npx tsx tools/l10n-wrap.ts                # 干跑：列「需人工 / 缺译」两份清单
npm run content:check ; npm run ui:rot-check ; npm run build ; npm run docs:index -- --check
```

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

### ② 渲染层碎片 / 漏项（≈109 条，方法已成熟）

- 「需人工 58 条」＝跨行 JSX 断片（`A{expr}B` 形态，工具故意不碰）；
- 「缺译 51 条」＝工具没覆盖的位置（少数模板/嵌套）；
- 做法：`npx tsx tools/l10n-wrap.ts --only=<file>` 列清单 → 读源码 → **整段替换**成
  `tr('ui.<段>.<号>', { 参数 })` → 补表项 → 跑 `l10n:check`。重灾区：`panels/Wormhole.tsx`(31) · `panels/Expedition.tsx`(17)。

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

- 现状：`verify40` 领先 main **51 个提交**；main 相对三号上次合并点（`56a91a58`）**又新增 27 条**
  （一号/二号：仓库筛选报障修复 · 资源任务均价 · 虫洞科技与取消固定种子等）⇒ **接手第一件事是再并一次**。
- 步骤（**合并进 verify40，不动 main**）：
  ```powershell
  git log main --oneline -5          # 先看对方改了什么
  git merge main --no-edit           # 解冲突：保留 ID 制、采纳对方结构
  npm run typecheck ; npm run l10n:check
  npx tsx tools/l10n-wrap.ts         # 对方新加的中文会出现在「缺译」里 → 照 §4 接线
  ```
- 合并后**必跑**：typecheck · l10n:check · content:check · ui:rot-check · build · core 用例 · docs:index。

## 9. 船长验收建议（英文好不好、排版行不行，只有船长能判）

1. 本地跑起来 → 设置面板切 **English**（语言存 `localStorage`，不进存档）；
2. 逐页看一遍：**星图 / 舰船 / 装配 / 物品 / 市场 / 工业 / 技能 / 任务中心 / 通讯**，再进 **虫洞 / 远征 / 手册**（三份长文）；
3. 重点看悬浮信息层（舰船与装备卡片），那里是英文最长的地方（读数见 §3 ③ 的 P4 表）；
4. 反馈按「页 → 具体串」给，我按 id 改表即可（一处改、全语言一致）。
