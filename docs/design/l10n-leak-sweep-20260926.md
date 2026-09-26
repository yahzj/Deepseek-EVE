# 工作文档 · 本地化遗漏扫批（舰船类型 / 高中低槽位文本等）（2026-09-26 · 三号）

> **状态：进行中** —— 甲批已落码、闸门待跑；归档按 AGENTS.md §8（船长真机验收 + 合入 main 后当批做：
> 关键内容并入 `docs/roadmap.md` 一条 → 删本文件 → 重跑 `docs:index`）。
> **船长原话（照抄）**：「**发现部分遗漏未本地化的文本（舰船类型，高中低槽位数量的文本）**」

## 一、根因（一句话）

core/data 里有一族**纯中文名表/函数**（`RACK_LABELS` '高槽/中槽/低槽' · `SLOT_LABELS` ·
`shipCategoryLabelOf` · `shipSizeLabel` …），渲染层**直读**它们 ⇒ 英文界面下漏出中文。
渲染层本该走 `ui/labelsText.ts` 的本地化单点（`rackText` / `slotText` / `shipRoleText` / `shipTierText`）。
**部分页面走了、部分没走**——这就是"部分遗漏"的形态。

⚠ 特别值得记的一条：**槽类名有两份同名表**——
`ui/itemSubs.ts` 的 `RACK_LABELS`（**已本地化**，键→`ui.itemSubs.025/026/027`，市场/手册/仓库筛选读它）与
core 的 `RACK_LABELS`（**纯中文**）。`shipInfo.tsx` / `FitPage.tsx` 读的是 **core 那份** ⇒ 同一屏上
"市场筛选是英文、船卡槽位行是中文"。

## 二、本批（甲）改了什么 —— 全部走**现成**的本地化单点，零新英文文案

| # | 位置 | 原 | 现 |
| --- | --- | --- | --- |
| 1 | **船卡「槽位布局」行**（`ui/shipInfo.tsx` `slotListText`） | `RACK_LABELS.high/mid/low`（core） | `rackText('high'/'mid'/'low')` |
| 2 | **装备「槽位 / 类型」行**（`ui/shipInfo.tsx` `moduleInfoLines`） | `SLOT_LABELS[mod.slot]` | `slotText(mod.slot)` |
| 3 | 舰船信息兜底行（无 ship 时那支） | `MODULE_SLOTS.map(SLOT_LABELS)` | `MODULE_SLOTS.map(slotText)` |
| 4 | **装配页槽位组标题**（`pages/FitPage.tsx`） | `RACK_LABELS[rack]` | `rackText(rack)` |
| 5 | 装配预设详情 / 换装 toast / 装配搜索 | `RACK_LABELS[rack]` · `rackLabel(rack)` · `SLOT_LABELS[...]` | `rackText` / `slotText` |
| 6 | 物品仓库 / 货仓 的模块行与详情、搜索串 | `SLOT_LABELS[def.slot] ?? def.slot` | `slotText(def.slot)` |
| 7 | **舰船页/远征卡的类别 chip** | `shipCategoryLabelOf(ship)`（core） | `shipRoleText(shipCategoryKeyOf(ship))` |
| 8 | **船卡「定位 / 档次」行的舰级名** | `shipSizeLabel(tier) + ' T' + tier` | `shipTierText(tier)`（= `"T3 巡洋舰"` / `"T3 Cruiser"`） |
| 9 | **虫洞舰卡副标题的舰级名**（`panels/Wormhole.tsx`） | `shipSizeLabel(tier)` | `shipTierText(tier)` |
| 10 | **远征卡的角色名**（`panels/Expedition.tsx`，两处） | `shipRoleLabel(role)`（core） | `shipRoleText(role)` |
| 11 | **窝点档名**（外围/核心/深层，三处） | `LAIR_TIER_LABELS[tier]`（core） | `lairTierText(tier)`（新登记 `ui.labelsText.066~068`） |
| 12 | `ui/ShipSprite.tsx` 的 `roleLabel()` | 直读 core 角色表 | **删**（全仓无人引用，属死代码） |

**新登记的 id 共 4 条**（唯一新英文文案，其余全是复用既有 id）：

| id | zh | en | 用途 |
| --- | --- | --- | --- |
| `ui.labelsText.065` | 护盾力场 | Shield Field | 槽位名 `shield-field`（原先**没登记** ⇒ 英文界面下回落成键名 `shield-field` 本身） |
| `ui.labelsText.066` | 外围 | Periphery | 窝点档 1 |
| `ui.labelsText.067` | 核心 | Core | 窝点档 2 |
| `ui.labelsText.068` | 深层 | Deep | 窝点档 3 |

新增本地化单点：`ui/labelsText.ts` 的 **`rackText()`**（槽类名，建在已本地化的 `RACK_SUBS` 上，**不另存第二份文案**）
与 **`lairTierText()`**（窝点档名）。

## 三、防复发契约（本批最重要的一半）

`tools/ui-subs-check.ts` 从"只查选项表重复项"扩成**两条**（仍挂在 `ui:rot-check` 链上，`npm run ui:subs-check`）：

- **Check 1 · 选项表重复项**（2026-09-26 上半场加）：同表内 `key` / `label` / `id` 不得重复
  （船长报障「蓝图图鉴的筛选不消失」= 这条抓的那类）；
- **Check 2 · 本地化「直读」契约**（本批加）：渲染层**不得直读** 15 个受管的 core/data 纯中文标签符号
  （`RACK_LABELS` · `SLOT_LABELS` · `shipSizeLabel` · `shipRoleLabel` · `shipCategoryLabelOf` ·
  `LAIR_TIER_LABELS` · `WORMHOLE_PLACE_TEXT` …）。注释里的提及不算；豁免逐条写理由
  （`ui/labelsText.ts` = 本地化单点本身 · `App.tsx` 的 `KIND_LABEL` = 本文件自定义表 ·
  `ui/itemSubs.ts` = 自定义的已本地化 `RACK_LABELS` 与中文兜底 `label`）。

## 四、⛔ 乙批未做（**需要登记新英文文案，等你点头**）

契约现在会**如实报红**的就是乙批——都是"core 有纯中文表、渲染层尚无本地化版"：

| 表（core） | 内容 | 漏在哪 | 估量 |
| --- | --- | --- | --- |
| `WORMHOLE_PLACE_TEXT` | 空信息地点 / 舰船墓场 / 遗迹 / 舰船信号 / 矿脉 / 虫洞谜质（7 项） | 虫洞页当前格与图例（2 处渲染） | 7 条 |
| `WORMHOLE_ARCHETYPE_LABELS` | 均衡深区 / 残骸富集 / 遗迹密集 / 母矿脉 / 交火密集（5 项） | 虫洞扫描页（3 处渲染） | 5 条 |
| `KIND_LABEL` | 活动名（开采/打捞/长途运输/扫描虫洞/掩护巡逻/亲自开炉…，10 项） | **`App.tsx` 的日志分类行**（`{KIND_LABEL[kind]}`，但那是本文件**自定义**的同名表、不是 core 那张）⇒ 待核：core 的 `KIND_LABEL` 是否另有落点 | 待核 |

⇒ **乙批要新登记 12 条中英文案**（纯地点名/原型名，无口径问题）；`KIND_LABEL` 那 10 条**待核**
（渲染层那张是自定义表，core 那张可能只喂 core 自己的日志——先查清再决定要不要登记）。
要我就做，说一声"继续本地化"即可；在此之前契约对这两处**按"待登记"记账放行**（豁免逐条写了 `⛔` 与文档指向），
**其余位置一律不许直读**（负向验证：删掉豁免 ⇒ 立刻报 5 处、exit 1）。

## 五、验证（实测读数）

| 闸门 | 读数 |
| --- | --- |
| `npm run typecheck` | 四包 **0 错** |
| `npm run test`（core） | **227 文件 / 2492 用例全绿** |
| `npm run content:check` | ✅ 通过 |
| `npm run l10n:check` | ✅ 通过（无死引用 · 无中文源串 · 占位符对齐 · 无残留中日韩字符 · **4 条新 id 形态合规**） |
| `npm run ui:rot-check` | ✅ 通过（含扩写后的 `ui:subs-check` 两条契约） |
| `npm run ui:theme-check` | ✅ 通过 |
| 桌面 build / 网页 build | ✅ / ✅ |

**新契约的正向与负向**：

- 正向：`扫描 26 张带 key 的表 ⇒ 无重复项` ＋ `直读体检 ⇒ 渲染层无直读（豁免 5 条逐条有理由）`（exit 0）；
- **负向①**（临时去掉 `panels/Wormhole*.tsx` 两条豁免）：立刻报 **5 处**直读、**exit 1**
  （`Wormhole.tsx:37/1078/2717` · `WormholeScan.tsx:26/59/254`）；恢复豁免后逐字回绿；
- **负向②**（早先版本，按符号名裸扫）：把 `shipInfo` 的一处 `rackText('high')` 改回 `RACK_LABELS.high` ⇒
  报红、exit 1 —— 这条同时暴露了**误报**（市场页的 `RACK_LABELS` 来自**已本地化**的 `itemSubs`），
  故判据收紧为「**只认从 `@whale/core`/`@whale/data` 具名导入的符号**」——收紧后该误报消失、真直读照样抓住。

**观感**：中文界面下显示**逐字未变**（`rackText`/`slotText`/`lairTierText` 在中文下取的就是原来那几个词，
`shipTierText` 只是把 `"巡洋舰 T3"` 序改成 `"T3 巡洋舰"`、与手册/仓库既有写法一致）⇒
漏中文只在英文界面可见，请船长**切英文界面**看一遍：船卡「槽位布局」行 · 装备「槽位 / 类型」行 ·
装配台槽位组标题 · 舰船页/远征卡角色 chip · 虫洞舰卡舰级名 · 窝点档名。


_维护：本件按 §8 归档；关键内容并入 `docs/roadmap.md` 一条精简条目后删除本文件。_
