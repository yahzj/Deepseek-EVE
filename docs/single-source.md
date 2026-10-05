# 单点索引（谁有权算、谁只能读）· 2026-09-27 建

> **这份是什么**：全仓「**这件事归谁管**」的索引。接活第一步查这里——同一个数字/同一句话，
> **只许一个地方算它**，页面/工具只许调用。
>
> **为什么要有它**：船长 2026-09-27 原话（照抄）：「**现在的开发流程挺混乱的，各种代码都是地方单独调用，
> 我们能否商量下，进行开发流程规范？**」——规矩写进了 `docs/development-conventions.md`「取数与派生纪律」，
> **本文件是那张规矩的落地索引**，护栏 = `npm run arch:guard`（`tools/arch-guard.ts`）。
>
> **怎么用**：
> 1. 要动某个数值/文案/派生显示 → **先在本表找它归谁**；找到就调用，找不到就**先在本表登记**再写码。
> 2. 新增单点 ⇒ 登记 `tools/arch-guard.ts` 的 `SINGLE_SOURCE`；本文件同步补一行供人查阅。
> 3. 改名/搬家 ⇒ 机器注册表和本文件一起改；F3 目前只检查机器注册表指向的源码文件与符号，**不核对两份登记表的文字一致性**。
>
> **不一致时以代码为准**，并**当场把本表改对**；本表随单点登记同步维护。

## 一、core 引擎层（`packages/core/src`）

| 关注点 | 唯一实现 | 护栏 |
|---|---|---|
| 武器组炮数与逐炮守恒分摊 | `volleyGunCountOf()` / `volleyDamageShareOf()` · `combatVolley.ts` | 逐炮齐射专项；`arch:guard` F2/F3 |
| 黑市入口、候选资格、本地日界与下次刷新 | `blackMarketUnlocked()` / `blackMarketCandidateGoods()` / `blackMarketDayStart()` / `blackMarketNextRefresh()` · `blackMarket.ts` | `black-market-page-20261004.test.ts` · `arch:guard` F2/F3 |
| 纯货舰模块能力兼容（安装/换装/候选/建档/修复同源） | `moduleAllowedOnShip()` · `shipFitting.ts` | `hauler-balance-20261004.test.ts`；`arch:guard` F2/F3 |
| 入侵残骸每族余额/箱子读数与旧账迁移 | `weekendWreckPoolsOf()` · `salvage.ts`；`normalizeWeekendWreckRecord()` · `weekendWreckLedger.ts` | `invasion-ledger-20261003.test.ts`：多族守恒、迁移、独立衰减与满舱不丢货 |
| 聚焦阵列波内射程/防空加算修正率 | `coronaFocusBonusOf()` · `coronaFocus.ts` | `corona-balance-20261003.test.ts`：时点/换波/加算抵消/真实近防入口 |
| 技能取消的"连带失效"基线（只报/只删因本次取消才失效的项） | `preexistingUnmet()` · `skillQueue.ts` | core 用例 `skill-cancel-baseline-20260926.test.ts` |
| 存档清洗白名单（新增随档字段必须"写入点 ＋ 白名单"两处落笔） | `normalizeState()` · `save.ts` | `packages/core/tests/save.test.ts` 类型穷尽 ＋ `save:roundtrip-audit` |
| 伤害类型配色（动能/爆破/能量 同族同色） | 伤害配色契约（token 单点） | `npm run ui:theme-check` 的 `dmg-color-check` |
| 装备归属档（高/中/低/**舰船插件**四档） | `rackDimKeyOf()`（渲染层）＋ core `rackOf` | `content:check` 归属档契约 |
| 回收/打捞产出与价值读数 | core `industry.ts` / `salvaging.ts` 的产出单点 | `npm run salvage:econ` · `recycle:compare` |
| 矿带每小时产出与**行情产值**（排序档「行情产值最高」与矿带卡面共用） | `beltYieldRows()` / `beltValuePerHour()` · `mining.ts`（**2026-09-30 建**：原先渲染层写了两份，排序那份还停在基准价口径 ⇒ 船长报障「原矿价值最高的排序已经落后」） | core 用例 `belt-sort-value-20260930.test.ts` · `arch:guard` F2/F3 |
| 手动工作位被谁占着（精炼炉/回收炉/拆解台/制造线/实验室共用的那一个名额；AI 核心驱动不算） | `manualSlotOf()` · `activityGate.ts`（**2026-10-01 建**：船长令「新的工业 UI 要改成和旧的工业一样，主控正在活动时禁止按钮」⇒ 界面得先问出"被谁占着"；原先这条判据在 `lab.ts`/`industry.ts`/`manufacturing.ts` 各写一份） | core 用例 `activity-lab-20261001.test.ts` 的「手动工作位判定」组 · `arch:guard` F2/F3 |

## 二、data 表面（`packages/data/src`）

| 关注点 | 唯一实现 | 护栏 |
|---|---|---|
| 仿真上下文（页面取数的唯一入口） | `buildSimContext()` · `context.ts` | `arch:guard` F1/F4 |
| 玩家可见文案唯一表（`id → { zh, en }`） | `L10N` · `l10n/table.ts` | `npm run l10n:check` ＋ `l10n:list` |
| 内容名/说明的英文覆盖层 | `packages/data/src/l10n.ts`（`EN_*` ＋ `overlay*`） | `l10n:check` ＋ core `l10n-overlay.test.ts` |
| 势力族色 | `FOE_ACCENT` · `ui/tones.ts` | 与星图族标签/战场敌舰/图鉴族徽同源（人工核） |
| 物品稀有度分档 | `itemRarityTierOf()` · `rarityTier.ts` | `content:check` 稀有度契约 |
| 公告数据（**仅经船长批准后写入**） | `announcements.ts` | 约定 §十二（发布审核） |

## 三、渲染表现层（`apps/desktop/src/renderer/src`）

| 关注点 | 唯一实现 | 护栏 |
|---|---|---|
| 两个市场入口的商品名称与蓝图产物/材料悬停 | `marketGoodDisplayName()` / `blueprintHoverLines()` / `MarketGoodHover` · `ui/marketGoodHover.tsx` | `arch:guard` F2/F3；黑市浏览器专项 |
| 网页重连存档摘要与有效状态内容比较 | `reconnectProgress()` / `sameReconnectProgress()` · `game/saveReconnect.ts` | `save-reconnect-engine-20261004.test.ts` · `arch:guard` F2/F3 |
| 物品领域分类与未知条目兜底 | `itemCategoryOf()` · `ui/itemSubs.ts` | 筛选专项测试 · `arch:guard` F2/F3 |
| 市场领域与细分判定 | `marketDomainPasses()` · `ui/itemSubs.ts` | 筛选专项测试 · `arch:guard` F2/F3 |
| 引擎与 `ctx` 的产地（页面取数都从它来） | `GameEngine` · `game/engine.ts` | `arch:guard` F1/F4 |
| 标签取词（槽类/槽位/舰级/地点/机型/物品大类…） | `labelsText.ts`（`kindText` 一族） | `ui:subs-check` 的「本地化直读契约」 |
| 族徽判据收窄（判"有没有族"只走它）＋ 族徽可读名（`aria-label` 取势力全称） | `crestFamOf()` / `crestLabelOf()` · `ui/labelsText.ts`（**2026-09-27 从 `panels/Handbook.tsx` 迁出**：图鉴 `IconGrid` 与物品页仓库/货仓的 `ItemGlyphGrid` 共用一份） | `ui:attr-check` 的「族徽判据契约」（改查单点文件 ＋ 两处网格的 `!= null` 兜底） |
| 图鉴卡片构造（装备/舰船/物品/蓝图/势力同源） | `itemCellOf()` 等共用 builder · `panels/handbookDetail.tsx`（**2026-10-02 从 `panels/Handbook.tsx` 拆出**） | `ui:attr-check` ＋ `arch:guard` F2 |
| 取色跨表兜底 | `toneOfAny()` · `ui/tones.ts` | 人工核（约定 §九） |
| 悬停提示接管层（全站唯一延迟 500ms 与"内层优先"） | `ui/Tooltip.tsx`（`TIP_DELAY_MS`） | `ui:tip-check` ＋ `ui:rot-check` |
| 悬停富卡皮肤（模块/物品/舰船参数表） | `ui/shipInfo.tsx`（`infoCardContent` 一族） | 约定 §九之七（人工核） |
| 视口懒挂载（大列表流式加载） | `ui/LazyMount.tsx` | `industry:lag` 读数 ＋ 人工核 |
| 活动栏「停止/取消」按钮文案（新版与旧版两套外壳共用） | `panels/activityStopLabel.ts` 的 `stopLabel()` | `arch:guard` F2（2026-09-27 收口 A1：原先两份逐字相同） |
| 活动栏行「点击去哪」的跳转表（两套外壳共用） | `ui/activityGo.ts` 的 `goFor()` | `arch:guard` **F5 跳转目标契约**（2026-09-27 建：原先两份重复，快递那档跳到已删除的星图页签 ⇒ **空白页**） |
| 属性表拼装（装配页/图鉴/蓝图产物/舰队悬停四处） | `ui/shipInfo.tsx` 的行工厂 | `ui:attr-check` 的「同名两行」体检 |

## 四、工具与文档层（`tools/` · `docs/`）

| 关注点 | 唯一实现 | 护栏 |
|---|---|---|
| 正式工具与临时探针的区分与收尾 | 约定 §十（`tools/xxx.ts` vs `tools/_*.ts`） | `npm run tools:audit` |
| 提交钩子B类审批范围与暂存内容绑定 | `tools/git-gate-approval.cjs`；本工作树Git目录审批记录，`.githooks/pre-commit` / `post-commit`调用 | `git-gate-approval-20261004.test.ts`：精确批准、变更失效、技术失败拒绝与成功消费 |
| 文档索引（全仓清册） | `docs/INDEX.md`（仅由 `npm run docs:index` 生成） | `docs:index --check` |
| roadmap 滚动窗口与封存卷 | `npm run docs:seal` | 工具自带守恒校验 |
| 工作文档 → 归档三步 | 约定 §十五 | 人工核（本批列出） |
| 本索引自身与护栏注册表的同步关系 | 本文件（人读索引）＋ `tools/arch-guard.ts` 的 `SINGLE_SOURCE`（机器执行源） | `arch:guard` F3 只核对机器执行源的源码落点；两份文字表同步由人工维护 |

## 五、维护纪律（三条）

1. **新派生值先登记再写码**：先在 `tools/arch-guard.ts` 的 `SINGLE_SOURCE` 加一项，再在本表补一行 ⇒ 再去写实现；`arch:guard` F2 会对"已登记单点被别处再写一份"报红。
2. **护栏栏写不出东西的条目** ⇒ 标 🟡「待补护栏」，不许假装已经上锁（人工核也是护栏，但要写明"人工核"）。
3. **本表与代码不一致时以代码为准**，当场改本表；改完跑 `npm run arch:guard` 复核（F3 会挡住悬空条目）。

---

_建表：2026-09-27（三号 · verify）· 首批条目取自 2026-09-24~27 各批归档结论与本次全仓取证；_
_条目增删随代码走；规则变更仍按开发约定的工作文档与归档流程处理。_
