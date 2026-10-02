# 舰船域拒因结构化 · 本地化批①（工作文档 · 2026-10-02）

**状态：进行中 · 已落码待验收**（船长 2026-10-02 令「**按你推荐来**」＝ 采纳三号「先做批①舰船域（10 条）」＋「探针转正」两条建议）

**经办**：三号（`H:\大鲸鱼\Deepseek-EVE-verify`，分支 `verify`）

## 1. 船长原话（照抄）

> 「**按你推荐来**」

（回的是三号的两问：「**先做哪批？**我建议 **批①舰船（10 条）**——同一族拒因、最规整、且是玩家最常撞到的路径（换船/维修/入仓）」＋「**探针要不要转正？**」）

## 2. 范围 / 不做

**做**：`packages/core/src/shipyard.ts` 里**换船 / 维修 / 入仓**三族拒因，按甲案补 `errorId`/`reasonId`（＋参数），中文原串**一字不改**照写；渲染点改走 `cmdText(...)`；唯一表补 zh + en。

**不做（如实登记，都是**跨模块**的，要另立批）**：

| 项 | 为什么不做 |
|---|---|
| `state.shipLockedReason`（2 条中文：在虫洞 / 自动探索中） | 它是**共享拒因**：`equipment` · `fitPresets` · `industry` · `inventory` · `market` · `scrap` · `shipyard` **8 个文件 15 处**都在调它——改返回类型要动 6 个域，按 §十八 属跨模块，得单独申请 |
| `activityGate.cannotInterruptReason`（3 条） | 换船那条已经用「中文嗅探 → 映到 `core.activityGate.004/005/006`」的老办法兜住；彻底改它与上一条同批做更省 |
| 日志行（`addLog` 缺 `textId`） | 属盘点稿里的**批⑨**（全仓 97 处），单独立项 |

⚠ 因此本批**不等于**"舰船域英文界面全清"：玩家在**船被锁定**时（在洞里/自动探索中）点换船、维修、入仓，仍是中文——那一层等跨模块批。

## 3. 读数（改前 → 改后 · 工具：`npm run l10n:core-zh -- shipyard`）

| 项 | 改前 | 改后 |
|---|---|---|
| `shipyard.ts` 裸中文上屏 | **19 处**（return 型） | **0 处** |
| 其中把中文当**参数**夹进句子的 | 1 条（`驾驶船${where}——…`，`where` 是中文短语） | 0 条（拆成 3 条模板） |

> ⚠ **比盘点稿多 9 条**：那份稿子的探针只认**行首** `return`，漏了 `if (…) return …` 行内形态（本批补扫后 `shipyard.ts` 从 10 条变 19 条）。转正的工具已经修掉这个漏判。

## 4. 改动台账

| # | 文件 | 改动 |
|---|---|---|
| 1 | `packages/core/src/shipyard.ts` | 21 处拒因补 `errorId`/`reasonId`（＋ `errorParams`）；`驾驶船${where}` 那条拆成 3 条模板（037 交付途中 / 038 返航途中 / 039 野外停留，「在哪」不再当中文参数）；带 `⟪文案调整 2026-10-02⟫` 记账注释 |
| 2 | `packages/data/src/l10n/table.ts` | 新增 **21 条** `core.shipyard.034~054`（zh 照抄原串 ＋ en 按 `docs/glossary-en.md` 口径出稿） |
| 3 | `apps/desktop/src/renderer/src/pages/ShipPage.tsx` | 入仓按钮的 `title` 从 `storable.reason` 改走 `cmdText({ error, errorId, errorParams })`（有 id 按语言渲染） |
| 4 | `tools/l10n-core-zh-audit.ts`（新）＋ `package.json` | 取证探针**转正**为 `npm run l10n:core-zh`（覆盖三类漏口：return 型含行内 / `addLog` 缺 id / `state` 赋值） |
| 5 | `docs/design/core-zh-leak-audit-20261002.md` | 盘点稿按期更正读数（含行内形态后全仓 271 处）＋ 标注本批已清 `shipyard.ts` |

**id 台账（举 4 例，全 21 条见 `table.ts`）**：

| id | zh（照抄原串） | en |
|---|---|---|
| `core.shipyard.034` | `正在驾驶的就是 {p1}。` | `You are already flying {p1}.` |
| `core.shipyard.039` | `驾驶船停留在「{p1}」星系（野外）——请先「返航空间站」再换船。` | `The ship you are flying is staying in the {p1} system, out in the field — return to station before switching.` |
| `core.shipyard.052` | `只有满耐久（结构与装甲都完好）的船才能入仓：先维修。` | `Only a ship at full durability, with structure and armor intact, can go into storage — repair it first.` |
| `core.shipyard.054` | `这艘船不能入仓。` | `That ship cannot be moved into storage.` |

**已知边界（如实登记）**：`{p1}` 里的**舰名/星系名**取自 core 的 `ctx`（中文名）⇒ 英文界面下这三个参数仍是中文名。
这属"**数据名当参数**"那类（与 2026-09-30 扫到的 144 处船名残留同源），机制上要靠"参数带数据 id"解决，**不在本批**。

## 5. 验证

- `npm run l10n:core-zh -- shipyard` ⇒ **0 处**（改前 19）
- `typecheck` 四包 ✅ · core **286 文件 / 3008 用例全绿** ✅
- `content:check` ✅ · `l10n:check` ✅ · `l10n:params`（**0 处漏喂**）✅ · `ui:rot-check` ✅
- **中文输出逐字未变**：`git diff` 逐行核 —— 每条被改行的中文原串都在新行里**原样重现**（唯一"改写"的 037/038/039 是**同一句**拆成三条模板，渲染结果与原先 `${where}` 拼接完全一致）
- **无副作用**：`error`/`reason` 字段照写（工具与老路径零影响）；判空写法（`if (!r.ok)`）不变

## 6. 边界

- 零数值 / 零存档 / 零机制改动；只动"拒因带不带 id"这一层。
- **模块自报（§十八）**：本批落在**舰船**域（`shipyard.ts` ＋ `ShipPage.tsx`）；`table.ts` 与 `tools/` 属共享底层。**无跨模块**。
- 临时脚本 `_land-ship-i18n.mjs` 与两个校验探针用完即删。

## 7. 下一步（按盘点稿的分批）

批② AI 副船（11 条）· 批③ 远征/自动循环（9 条）· 批④ 市场（2 条）· 批⑤ 工业（3 条）· 批⑥ 装配（1 条）· 批⑦ 虫洞＋战斗读数（2 条）· 批⑧ B 类待核（9 条）· 批⑨ 日志行（97 处，建议单独立项）· **新增批⑪：`shipLockedReason` ＋ `cannotInterruptReason` 两条共享拒因（跨 6 域，需先申请）**。
