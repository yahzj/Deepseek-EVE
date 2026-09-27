# 架构护栏首轮基线：存量重复实现与越层直读清单（2026-09-27 · 三号 verify）

> **状态：待船长裁决**（本批只登记、**不改代码**；船长点名后逐条收口）
> **护栏本体**：`npm run arch:guard`（`tools/arch-guard.ts`）· 规范见 `docs/development-conventions.md` §十五之二 ·
> 单点索引见 `docs/single-source.md`
> **本批读数**：渲染层 **100 文件 / 14 个页面与面板目录文件命中 helper 池**；`arch:guard` 四项检查 **F1 0 · F2 0 · F3 0 · F4 0**（存量已按"只登记不红"登记）。

---

## 一、已证实的重复实现（建议优收口，按证据强度排序）

### A1 · `stopLabel()` 在两份活动栏里**逐字同源** · ✅ **2026-09-27 已收口（船长「按你推荐来」）**

| 项 | 读数 |
|---|---|
| 位置（收口前） | `panels/ActivityBar.tsx:44` 与 `panels/ActivityBarClassic.tsx:51` |
| 证据 | 两处函数体的 `tr()` id 集合**完全相同**（12 个 id，顺序一致）：`ui.ActivityBar.007/005/008/031/009/004/010/011/012/013/032/014` |
| 影响（收口前） | 活动栏"停止（做某事）"的按钮文案要改就得改两处，漏一处两套界面就说法不一 |
| **收口做法** | 新建单点 `panels/activityStopLabel.ts`（`stopLabel()`）；两处改为 import，本地实现删除 |
| **逐字核对** | 单点里的 id 序列 = 原两份的序列（15 个 `tr()`，含 `stop-mining`/`stop-salvage` 共用 `ui.ActivityBar.005`、`stop-whauto`/`recall-expedition` 共用 `ui.ActivityBar.009`）；`default` 分支**保留原样返回空串**（原实现如此，未改行为） |
| **冻结件例外** | `ActivityBarClassic.tsx` 头注自称"冻结件"⇒ 在该文件 import 处**写明这是本批的唯一必要改动、文案一字未改、DOM 与行为零变化、要回退只需把 switch 复制回来**（已写进代码注释） |
| 风险 | 低（纯取词映射；两份活动栏的**其它部分**差异很大、**不动**） |
| 单点登记 | 已进 `tools/arch-guard.ts` 的 `SINGLE_SOURCE` ＋ `docs/single-source.md`（F3 会核对） |

### A2 · 「物品大类 / 槽类」取词在四处各有一套拼装 · ⏸ **评估后不收口（如实说明理由）**

| 位置 | 它自己做了什么 | 已有单点 | 收口判定 |
|---|---|---|---|
| `pages/MarketPage.tsx:86` `kindTextOf` | 残骸单列「残骸」· 装备按槽类 · 其余走 `kindTextOfItem` | `labelsText.ts` 的 `kindText`/`kindTextOfItem`（**已在用**） | **不是重复**：它做的是"市场行专用的分叉规则"，收掉要新增一个市场专属出口，**不减少任何重复** |
| `panels/Handbook.tsx:67~69` `kindName`/`slotName`/`roleName` | 三行本地包装 | 同上 | **零逻辑包装**（只是本地别名）；收口 = 纯改名扰动四处调用点，**功能收益为 0** ⇒ 不做 |
| `panels/Industry.tsx:545` `kindLabelText` | 又一个本地包装 | 同上 | 同上 |
| `pages/ShipPage.tsx:90` `rarityLabel` | 稀有度三档 → 文案 | 分档单点 = `itemRarityTierOf`（data）；**取词**目前全仓**仅此一处** | **只有一处实现，不构成重复**；等它出现第二份时再按"先登记再收"处理（本清单留档提示） |

**结论（照 §2「从数据出发」，不凭印象收口）**：A2 里**没有可证的重复**——要么是"不同用途的分叉规则"、要么是"零逻辑本地包装"、要么是"全仓唯一实现"。
⇒ 本批**只收口 A1**（唯一有逐字同源证据的一条），A2 保留为"下一批候选"，等船长另点名或等真出现第二份实现。

## 二、`arch:guard` F1 的存量直读（**已登记进白名单，不红**）

| 文件 | 直读的表 | 白名单理由 | 要不要收口 |
|---|---|---|---|
| `game/engine.ts` | 全部 data 表 | **它就是 ctx 的产地** | 不收（正常） |
| `i18n/locale.tsx` | `L10N` | 本地化单点自身 | 不收（正常） |
| `panels/Handbook.tsx` | `FACTION_CODEX` · `FOE_SHIPS` | 势力图鉴卡片构造单点要用原始表 | ⚠ **待核**：这两张是**原始中文表**，英文界面下势力档案/敌舰名是否漏中文，需一次真机复读（我本批未跑 UI 探针） |
| `panels/Wormhole.tsx` | `WORMHOLE_FAMILY_CARDS` | 只做「族 → 卡 id」反查，不显示文本 | 不收 |
| `ui/wreckFlavor.tsx` | `FRAGMENT_RECIPES` | 按 `tier` 取配方行喂读数，不显示文本 | 不收 |

## 三、机器查不出、需要人裁的"异名同义"嫌疑（27 处 helper 全表）

> 判据：**名字不同、语义疑似相同**——机器判不出来（实测同名命中 0），列出来供你点名。

| 文件 | 本地 helper（行号） | 是否疑似与单点重合 |
|---|---|---|
| `pages/MarketPage.tsx` | `kindTextOf`(86) · `goodTipText`(145) · `blueprintHoverLines`(166) · `taxTipText`(442) · `sampleAgoLabel`(529) | `kindTextOf` ✅ 疑似（见 A2）；其余为**页面专属悬停/读数**，暂判不重合 |
| `panels/Expedition.tsx` | `FoeBriefTip`(179，组件) · `readLabelMode`(701) · `NodeLabel`(735，组件) · `secText`(785) | 组件不算单点竞争；`secText` 疑似时间格式化（与 `formatDurationMs` 同域） |
| `panels/Handbook.tsx` | `kindName`(67) · `slotName`(68) · `roleName`(69) · `crestLabelOf`(1121) | 前三条 ✅ 疑似（A2）；`crestLabelOf` 疑与势力名取词同源 |
| `pages/FitPage.tsx` | `hitDetailText`(166) · `mulText`(298) | 页面专属读数文案，暂判不重合 |
| `panels/Industry.tsx` | `kindLabelText`(545) · `ownedWhereText`(556) | `kindLabelText` ✅ 疑似（A2） |
| `panels/WormholeScan.tsx` | `foundDateLabel`(49) · `stockLineOf`(55) | 页面专属 |
| `pages/ShipPage.tsx` | `rarityLabel`(90) | ✅ 疑似（A2） |
| `pages/skillShared.tsx` | `SkillDescText`(15，组件) | 组件 |
| `panels/Achievements.tsx` | `badgeTimeLine`(74) | 页面专属 |
| `panels/ActivityBar.tsx` · `ActivityBarClassic.tsx` | `stopLabel`(44 / 51) | ✅ **已证实重复**（A1） |
| `panels/BattleScreen.tsx` | `foeMountsTipOf`(68) | 疑与 `ui/foeBrief.ts` 同源（敌舰挂载件文案） |
| `panels/CommsReader.tsx` | `idAsName`(26) | 通讯专用兜底 |
| `panels/bountySort.ts` | `byNameOf`(36) | 排序辅助 |

## 四、本清单的方法与边界（照 §2「从数据出发」）

1. **数据来源**：`git grep` 全仓扫描 ＋ 逐处读函数体比 `tr()` id 集合；**没有**凭印象点名。
2. **机器能做的与不能做的**：F2 只能查"**同名**重复"（本仓实测 0 命中）；**异名同义**由人裁——本清单第三节就是交人的那部分。
3. **本批未跑 UI 观感探针**（观感归船长）；但**跑了中英双语真机复读**（读数见第五节）。
4. **收口纪律（若你点名收）**：一次只收一条 → 同一处**中英对照前后读数** → 涉数值加用例 → 跑全六道闸门 → 单点索引同步登记。

## 五、随批做的「中英双语全量测试」读数 ＋ 查出的三个工具缺陷（2026-09-27）

**① 英文界面残留中文**（正式工具 `npm run l10n:scan`）：10 页可达，**合计 474 处**（上一版基准＝旧档 8 页 202 处；本次换用「已解锁市场/工业」的验收档 `test-save-plug-20260926.json`）。
按类名聚合（top）：`app-comms-subject` 62 · `app-dim` 48 · `app-role-chip`（武装 46 ＋ 装甲 24）· `app-ach-name` 40 · `app-ship-hover` 26 · `app-belt-ore` 23 · `app-station-name` 18 · `app-ano-name/desc` 各 15 · `app-ship-name` 14 · `app-hand-cell-name` 12。
其中**至少两类不是缺陷**：`app-ship-name`（船名/玩家自定义名）· `app-hand-cell-name` 那 6 条「××蓝图碎片」（＝ roadmap 已登记的"数据侧命名未做"）。
其余（通讯主题 · 成就名 · 角色 chip · 空间站名 · 异常名与说明）**是新发现的可译缺口**，建议单独立批。

**② 中文界面英文残留**：新档口径下 10 页逐页逐页签 **0 处**；仅 2 处技能说明里的档位词 `rank`（`rank2` / `rank 1 → 5`）——口径词，**不算漏译**。

**③ 本批查出的三个工具/环境缺陷（本批未改，建议单独立项）**：
- **`l10n-en-scan` 不设 `layout`**：应用回默认「旧版(classic)」，而 classic 侧栏只有 8 项（缺市场/工业）⇒ 工具点到第 6~10 页时**实际点的是错页**（读数里出现过"第 6 页（industry）"落在任务中心）。**修法**：注入时补 `whale-idle:layout`，或把导航定位改成按稳定属性（非下标）。
- **`l10n-en-scan` 不清理注入脚本**：`Page.addScriptToEvaluateOnNewDocument` 会累积 ⇒ 再跑任何扫描时，上一轮的 `localStorage.clear()+locale` 会在新文档里再执行一遍，**把后来者设的语言/存档覆盖掉**（实测：中文扫被上一轮英文注入顶回 `en`）。**修法**：跑完用 `Page.removeScriptToEvaluateOnNewDocument` 收回，或每轮用新 target。
- **存档注入在"全新浏览器 profile 的首个文档"上不生效**：同一写入方式（实测 `whale:idle:save` 已写入 **118,935 字节**）在首个文档表现为**钱包 0 · 导航 8 项**（＝新档），第二次导航后才生效。**这是读数型事实、不是观感结论**；影响的是"网页版基准档能否稳定复现"，建议单查 web 端首次载入的读档时序。

---

_建表：2026-09-27（三号 · verify）· 条目随收口进度更新；收完一条把该条标 ✅ 并注明提交号。_
