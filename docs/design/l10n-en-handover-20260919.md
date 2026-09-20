# 英语本地化 · 交接卡（2026-09-19 · 三号）

> 交接对象：接手继续做「《大鲸鱼-深空放置》英语本地化」的会话（一号/二号/新助手皆可）。
> 工作文档（过程记录与分期）：`docs/design/l10n-en-20260919.md` · 术语权威：`docs/glossary-en.md`。
> 本卡只讲**怎么接着干**：状态 · 流程 · 坑 · 剩余 · 验收。

## 0. 30 秒速览（**2026-09-20 三号收尾后刷新——§1/§3 旧读数已作废**）

| 项 | 值 |
|---|---|
| 分支 | `verify40`（三号工作树 `H:\大鲸鱼\Deepseek-EVE-verify`）；**已并 main 至 `bad7601e`**（2026-09-20 并，52 条） |
| 纪律 | **船长令：全完成后不合入 main、不推送**（只本地提交）；main 侧由一号维护 |
| 唯一表 | `packages/data/src/l10n/table.ts` —— **3,773 条**（core 734 · ui 3,039） |
| 接线 | 渲染层 `t()`/`tr()` 调用点 **≈3,747 处** |
| **core 甲案** | **已完成** —— `textId`/`errorId` 引用 **803 处**，全部在表内、形态合规（无遗漏调用点） |
| 剩余读数 | **未译 0 条**（2026-09-20 裁决一「乙案」：65 条"中文当键"已由 `l10n-keep` 显式声明为**不译**、逐条点名可核）· 表 **3760** 条 = 源码引用 **3760** 个 id（1:1 对齐，零孤儿） |
| 未做 | —— **全部完成**（core 甲案 · 界面批 · 主进程 · P4 读数表 · 读数归零）。后续可选：67 条键类改 id 的重构、手机横屏溢出是否处理（见 §3④） |
| 已验证 | typecheck 四包 0 错 · core **1907** 用例全绿 · `l10n:check` · `content:check` · `ui:rot-check` · `build` · `docs:index --check` 全绿 |

## 0.1 2026-09-20 三号收尾轮做了什么（下次接手先看这段）

1. **core 引擎文案甲案全部落地**（本卡 §3① 那块 = 原 ≈617 处）：市场/长途运输/扫描/炉子停机/
   训练队列/虫洞战报/事件表 82 条正文 …… 逐文件迁移，`textId`/`errorId` 到 **803 处引用**。
2. **新增三条甲案机制**（都写进代码注释）：
   - `composeLog(lead, segs, firstSegNo)`（`packages/core/src/logParts.ts`）：多段可空尾巴拼装 +
     段内递归子段（`p{n}` → `p{n}p{k}` → …），与渲染层 `composeParts` 命名空间逐层对齐；
     `firstSegNo` 解决"基础模板已占 `p1…pN` 时段链抢槽"。
   - **多段链不能有空段**（空 id 会把后面整段丢掉）⇒ 空态另立基础模板，或让上一段留 `{pN}` 槽。
   - **两步渲染**（`pNId`）：段的内容本身要翻译时，先译好再当参数喂进外层。
3. **渲染层总开关**（关键发现）：core 侧 id 早已落位，但**渲染层 130 余处 toast 仍直接读 `r.error`**
   ⇒ 甲案在界面上等于没生效。已统一改 `cmdText(r) || tr('ui.…')`（**105 处 + 手工 2 处**）。
   **新调用点一律这么写，禁直接读 `r.error`。**
4. **界面批**：未译 323 → 251 → **67**（本轮从 204 起，逐页消化了 ShipPage / Industry / FitPage /
   MarketPage / WormholeScan / Wormhole / MapPage / ItemsPage / SaveManager / Expedition / shipInfo /
   Hauling / wreckFlavor / CargoPage / engine / BattleScreen / App + 九个小文件）。
5. **新增正式工具 `tools/l10n-list.ts`（`npm run l10n:list -- <文件…>`）**：与 `l10n:check` 同一条 AST
   判据，**逐条列出**未译的行号与文本（check 只打 Top 10 汇总）。界面批逐页消化靠它。
6. **虫洞敌情做透（唯一动 core 的界面项）**：族称/三档名/伤害名/主系一句话原本是 core 拼的中文 ⇒
   core 出 `WORMHOLE_FAMILY_ETHNIC_IDS`/`DAMAGE_TYPE_LABEL_IDS` + 结构化 `primaryKind/primaryTypeA/B`，
   渲染层组句；探针实测英文整句零残留。

## 1. 接手先跑这 6 条（确认现状，别凭记忆）

```powershell
cd H:\大鲸鱼\Deepseek-EVE-verify
git log --oneline -3                      # 应为三号 2026-09-20 的本地提交
npm run typecheck                         # 四包 0 错
npm run test -w @whale/core               # 1907 用例全绿
npm run l10n:check                        # 表 3773（core 734 · ui 3039）· core 引用 803 · 未译 67（报告口径不阻断）
npm run l10n:list -- <某文件>              # 逐条列未译（界面批逐页消化用这个）
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

## 3. 剩余事项（按优先级）

### ① core 引擎文案 —— ✅ **已完成**（2026-09-20 三号收尾）

- 口径（船长已定**甲案**）：**core 只产出「文案 id + 参数」**，渲染层按当前语言渲染 ⇒ core 与语言解耦。
- 现状：`textId` / `errorId` 引用 **803 处**，`l10n:check` 核过**全部在表内、形态合规**；
  `packages/core/src` 里已无"只走中文"的玩家可见日志/错误串。
- 落地的三条机制与两条硬规矩见 §0.1-2；新写 core 日志**照抄同文件邻居的写法**即可。
- ⚠ 老档日志仍保持中文（船长已定）——`normalizeState` 容忍缺 `textId`，渲染层回退中文原串，别改成回退 id。

### ② 渲染层碎片 / 漏项 —— **67 条，且全部不是漏译**（2026-09-20 收尾实测）

> 这批**不建议再翻**：它们是"中文当键"的数据，翻成英文反而会让键与内容层对不上。
> 逐条已加 `l10n-keep` 或口径注释。要清零得**改数据结构**（属重构，需船长点头）。

| 文件 | 条 | 是什么 |
|---|---|---|
| `ui/Glyphs.tsx` | 10 | 技能组**形状槽键/色表键**（`group-舰船` …）：后缀必须对齐内容层技能组名才查得到图 |
| `ui/itemSubs.ts` | 10 | 筛选**键表 `label`**：渲染处走 `tr(id)`，`label` 是键不是文案 |
| `pages/ShipPage.tsx` | 9 | `CraftOption.group` **联合类型 key**（装备/舰船/消耗品蓝图） |
| `panels/Industry.tsx` | 7 | `kindLabel`（`'舰船'/'装备'/'消耗品'`）**比较用键** |
| `pages/MarketPage.tsx` | 7 | `placeOrderToast` 的 `'买' | '卖'` key + `unit='件'` 默认值 |
| `pages/FitPage.tsx` | 5 | `'基础舰炮'` 武器形态 key + core `shipInfoLines` 的中文标签 key |
| `game/autoPerf.ts` · `game/perf.ts` | 7 | 性能探针的 console 段名/日志（**不进玩家界面**） |
| `i18n/fmt.ts` | 1 | `creditUnit()` 按语言自取的中文分支（本身就是本地化实现） |
| 其余（各 1~2） | 11 | 同类键 / 形状槽 |

- 工具：`npm run l10n:list -- <文件…>`（逐条列行号+文本）· `npm run l10n:check`（汇总读数）。
- ⚠ 若将来真要清零：**在 `l10n-check` 里加 `l10n-keep` 白名单**（见 §3⑤），别去翻这些键。

### ③ 主进程 / 预加载的文案 —— ✅ **已完成**（2026-09-20 三号收尾）

- 原盲区成因：两个工具的 `ROOT` 都写死在 `apps/desktop/src/renderer/src` ⇒ `main/`、`preload/` 从没被扫过。
  **现已把扫描根扩到 `apps/desktop/src`**（`tools/l10n-check.ts`），`l10n:check` 现扫 65 个源文件。
- 处理（走**甲案**，主进程也读唯一表）：
  - `main/index.ts` 新增主进程侧 `t(id, params)` + `mainLocale`（缺 id ⇒ 返回 id 本身，与渲染层同口径）；
  - 14 处文案接 id：窗口标题（复用 `ui.App.056`）· 导入/导出对话框 title/buttonLabel/filters.name ·
    非法备份名 ×3 · 文件过大 / 读取失败 / 写入失败 / 非法文本；
  - **语言由渲染层推**：偏好存在渲染进程 `localStorage`（主进程读不到）⇒ 新增
    `l10n:set-locale`（main IPC）+ `window.whale.setLocale`（preload），
    由 `i18n/locale.tsx` 的 `L10nProvider` 在挂载与切语言时推一次。
    窗口标题与系统对话框都是**运行期才建**的 ⇒ 推送晚到无影响（启动瞬间默认中文）。
- 核验：构建产物 `out/main/index.js` 里已带 `l10n:set-locale` 与译文。

### ④ P4 逐页溢出读数表 —— ✅ **已完成**（2026-09-20 · 工具 `tools/ui-overflow.ts` / `npm run ui:overflow`）

**测法**：9 个一级页 × 2 语言 × 5 档窗口 × 3 份中后期真档 = **270 组**；
按 `App.tsx` 的 `PAGE_NO_SCROLL` 判据量 `documentElement` 是否出滚动条，并单量真正的一级页滚动容器
`.app-page-content`。产物：`tools/_ui-artifacts/shots/overflow.json`（可重建、不入库）。

**结论（读数，非观感）**

1. **"一级页不滚"红线：270/270 组全部成立**（0 组出现页面滚动条），**英文下也成立**。
2. **桌面三档（1600×1000 / 1366×768 / 1024×768）与手机竖屏（390×844，自动旋转成 1200 虚拟横屏）：
   内容区溢出全部 0px** —— 中英皆然。
3. ⚠ **唯一有溢出的是手机横屏（844×390）**：内容区出现滚动（`scrollHeight > clientHeight`），
   逐页均值如下（3 档存档平均；含 zh 基线值 ⇒ **不是英文引入的**）：

   | 页 | zh 均值 | en 均值 | en−zh | 说明 |
   |---|---|---|---|---|
   | skills | 269px | **342px** | +73px | 最紧；en 最大 415px |
   | industry | 187px | 210px | +23px | zh 侧已 175~212px |
   | map | 61px | 208px | +147px | **英文放大最明显**（+2.4 倍） |
   | ship | 71px | 126px | +55px | en 最大 155px |
   | fit | 2px | 32px | +30px | |
   | task | 0px | 10px | +10px | en 才出现（个别档 31px） |
   | comms | 0px | 6px | +6px | en 才出现（个别档 19px） |
   | items / market | 0px | 0px | 0 | 完整装下 |

**给船长的判断材料**：手机横屏这一档**中文侧本来就滚**（skills/industry/map/ship 都是几十一百多 px），
英文只是把它放大（最狠 map +147px、skills 到 415px）。所以这不是"英文破了红线"，
而是**该档窗口高度（390px）本来就装不下这些页**。

**✅ 船长 2026-09-20 裁定：「手机允许出现滚动条」** ⇒
- **手机档（390×844 / 844×390）的溢出不算破红线**；本工具判据已按此实现——`vp.mobile` 为真时不计破红线，
  但仍照实打印，并在汇总里单列「手机档出现滚动（船长已允许）」计数；
- **桌面三档（1600×1000 / 1366×768 / 1024×768）仍是红线**。注意按 `mobile` 判、**不按宽度判**：
  正文 1024 窄窗（桌面口径）与手机横屏 844 是两回事；
- 结论收敛为：**红线 270/270 成立**（桌面/窄窗 0 组滚动；手机档有滚动但已获准）。

**怎么复跑**：起静态服务托管 `apps/desktop/out/renderer`（4173）+ 无头 Chrome 带 `--remote-debugging-port=9222`，
然后 `npm run ui:overflow`。⚠ 手机档必须连 **UA/触摸**一起模拟（只改视口不会触发自动旋转，会量到假读数）。
⚠ 浏览器切语言在网页版靠渲染层暴露的 `window.__setLocale`（桌面端是主进程桥 `window.whale`）。

### ⑤ 收尾核对 —— ✅ **已做完**（2026-09-20 三号收尾，船长裁「一=乙 · 二=甲 · 三=先确认」）

- **`l10n-keep` 白名单已落地**（§3② 的"归零可核"）：`l10n-check` 认识 ① 同行/前 6 行的就近标记、
  ② `l10n-keep-start` … `l10n-keep-end` **区间**；另加"纯标点/空白不算文案"规则与
  **`--list-untranslated`** 开关（逐条列未声明项）。⇒ **未译读数 65 → 0**（54 条已声明不译、逐条点名）。
- **孤儿/陈条已清 25 条**（逐条核过"源码真不引用"再删）：原 18 条 core/ui 孤儿 + 裁决三的 4 条
  + 3 条被替代的陈条。⇒ **表 3760 条 = 源码引用 3760 个 id（1:1 对齐，零孤儿）**。
- **顺手修掉一个真 bug**：`Industry.tsx` 的 `tr('ui.Industry.137')` 漏传参数（界面会显示字面 `{p1}`）。
- **P4 读数表已交付**（§3④）· **手机档允许滚动**的裁定已写进工具判据。

> 遗留的"可选项"（都不是缺陷，需船长点头才动）：
> 1. 54 条"中文当键"的**改 id 重构**（属重构非翻译）；
> 2. 手机横屏那 7 页已有滚动条（船长已允许，无需处理）。

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

1. **游戏英文名**（⚠ **仍需船长定**）：船长给出 `Great Whale: Deep Space Idle`；三号复核提了撞名证据——
   副标题已有[同名 H5 游戏](https://gamerankedreview.com/blog/h5-game/deep-space-idle) ·
   `Great Whale` 是[万智牌蓝卡名](https://gatherer.wizards.com/UZ/en-us/77/great-whale) ＋ Steam 有
   [The Great Whale Road](https://steamdb.info/app/464830/patchnotes/)；备选：`Great Whale Idle`（推荐）·
   `Whale Pact: Deep Space Idle` · `Great Whale: Void Idle`。
   **现在只需改 1 处文本**：表项 `ui.App.056` 的 `en`（现为 `Whale · Deep Space Idle`）——
   窗口标题与产品名都已走这一条（见下），改完中英两侧一起变。
   （登记处另有：`docs/glossary-en.md` · `package.json` 与商店稿英文名。）
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
4. **多段拼接**的日志（精炼炉/回收炉的"停炉"那三条 `543/617/642` 附近、AI 战报）—— ✅ **已按 §0.1-2 的机制做完**（composeLog + 空段禁令 + 两步渲染）。
**✅ 本节余下内容（第五批半途记录 + 剩余工作量表 + 节奏教训）已全部解决**：
下面那张"剩余工作量表"里的**每一个文件都已改造完毕**，多段拼接那三条也按 §0.1-2 的机制做透了
（`composeLog` + 空段禁令 + 两步渲染）；`core.state.010` 那三条最终**没走共用条目**——
因为中英语序不同（`{p1}` 前置在英文里读不通），改为各文件独立条目（见 §5 坑位记录）。
以下**保留为历史记录**（说明当时是怎么判断与踩坑的），**不要照着它开工**：


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
（`combat.ts` 此前显示的 3 处是误计：它的日志/错误是派生串——这条**已在收尾时逐条核过**，无真漏译。）

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

- 现状（**2026-09-20 三号收尾后**）：`verify40` 已并 main 至 `bad7601e`（52 条），合并提交 `90d2cf01`；
  此后本工作树累计 **122 个本地提交**（core 甲案 + 界面批 + 工具）。
- **船长令：全完成后不合入 main、不推送**（本轮收尾时仍未并）。**main 若前进 ⇒ 照下面再并一次**。
- ⚠ 并之前先跑一遍 §1 那 6 条闸门（工作树必须干净，`git stash` 不算干净）：
  ```powershell
  git status --porcelain             # 必须空
  npm run typecheck ; npm run test -w @whale/core ; npm run l10n:check
  npm run content:check ; npm run ui:rot-check ; npm run build ; npm run docs:index -- --check
  ```
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
