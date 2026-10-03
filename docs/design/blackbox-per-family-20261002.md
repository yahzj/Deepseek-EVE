# 每族一件黑匣（R 族「光环旗舰黑匣」）

- **状态**：进行中（实现完成 · 本批闸门待跑/已跑见 §五；等船长验收）
- **船长令**：**甲**（在"R 族入侵该发自己的黑匣"的三案里选甲 = **按族各登记一件匣**）
- **船长原话（照抄 · 转述玩家报障）**：

  > 「**光环入侵结束给的黑匣还是墨潮的**」

- **本批落点（模块自报 §2.1）**：主域 = **物品与货仓**（黑匣这一档物品）；连带 **入侵与活动**
  （发放侧 / 结算快照 / 结算信）与 **舰船与装配**（12 张插件图纸的料单说明与等价组）。
  **参照的同类子模块**：既有 `blackbox-h`（墨潮旗舰黑匣）那一条完整链路（物品 → 市场行 → 稀有度 →
  入侵发放 → 结算快照/信件 → 装配顶料）—— 本批**照它的结构再加一件**，不新造第二套。
  **是否跨域**：**是**（物品与货仓 → 入侵与活动 → 舰船与装配），已在本批开工前报船长并获令「甲」。

## 一、真因（读数）

发放侧把黑匣物品 id **写死**成 H 族那一件：

| 入口 | 文件 | 改前 |
|---|---|---|
| 击沉旗舰那一拍 | `core/weekendBattle.ts` `weekendApplyBattleOutcome` | `weekendGrantRewards(..., { blackBox: true })` ⇒ 常量 `WEEKEND_BLACKBOX_ITEM_ID = 'blackbox-h'` |
| 结算迟到补发 | 同文件 `weekendSettleAndGrant` | 同上 |
| 对账补发（逐 tick） | `core/weekendComms.ts` `reconcileWeekendBlackBox` | `weekendGrantRewards(state, { blackBox: true })` |
| 结算清单/信件 | 同文件 `weekendRewardLinesOf` | `itemId: WEEKEND_BLACKBOX_ITEM_ID`（快照里没有"是哪一件"这一栏） |

而入侵有**两族**（`WEEKEND_BOSS_FAMILIES = ['H', 'R']`；R 族「光环科技 / Corona Systems」2026-10-01 建族，
本期（2026-10-02）正是 R 族）⇒ **R 族打完自家旗舰，进仓库的是「墨潮旗舰黑匣」**：名字、卖价、
料值、图鉴归类、结算信里的物品名全是 H 的。

## 二、修法（唯一取数口 · 按族取）

1. **`core/blackbox.ts`（取数口）**
   - `blackBoxItemIdOfFamily(family)` = 约定 **`blackbox-<族小写>`**（H ⇒ `blackbox-h` · R ⇒ `blackbox-r`）；
   - `blackBoxItemIdForFamily(family, hasItem?)`：发放侧手上有 `ctx.items` ⇒ 先探该族匣在不在内容表里，
     不在就**退回落款 `blackbox-h`**（宁可发一件同价同用途的族匣，也不让"已结清"永远置不上 ⇒ 一拍一拍重试）；
   - `BLACKBOX_ITEM_IDS` 由 1 件扩到 3 件（两件族匣 ＋ 声望换的通用匣）——`blackboxSeenOf` 的老档回填与
     `weekendComms.hasAnyBlackBox`（补发判据）跟着全看；
   - `isBlackboxItem` 判据本来就是 **id 前缀** ⇒ 加族零改动（入库即置位"见过黑匣"、即解锁插件门类）。
2. **三条发放入口**：都改读 `weekendBlackBoxItemIdOf(ev, ctx)`（`weekendBattle` 内的私有小口，
   族从 `state.weekendEvent.family` 取）；`weekendGrantRewards` 的 reward 参数新增可选 `blackBoxItemId`
   （**缺省仍是落款墨潮匣** ⇒ 老调用方逐字不变）。
3. **结算快照**：`WeekendResultSnapshot` 新增 `blackBoxItemId?: string`（缺省 = 本批之前结束的场次 ⇒
   面板/信件按落款墨潮匣显示，**与玩家当时真正到手的那一件一致，不回改历史读数**）；
   `save.ts` 的 `weekendLastResult` 清洗块按 `isBlackboxItem` 白名单收（手改档塞进来的字符串一律丢弃）。
4. **结算信/面板**：`weekendRewardLinesOf` 用 `snapshot.blackBoxItemId ?? 'blackbox-h'` ⇒ 光环期显示
   「光环旗舰黑匣 ×1」。
5. **内容侧**：`data/items.ts` 新增 `blackbox-r`「光环旗舰黑匣」（与 H 件同构：`kind: 'blackbox'` ·
   5 m³ · 8,000 万）＋ 市场行（奇货 · 只收不卖 · 80,000,000）＋ 稀有度 4 ＋ 英文覆盖
   （`Corona Flagship Black Box`）。
6. **装配侧**：`MATERIAL_GROUPS` = `['blackbox-universal','blackbox-h','blackbox-r']`（**三者互为替代**，
   12 张图纸的数据一字未改；组序仍是"通用最先" ⇒ 优先扣除序与报名字口径不变）。
7. **内容契约（`tools/content-check.ts`）**：新增「每族黑匣契约」——按 `WEEKEND_BOSS_FAMILIES` 逐个核对
   `blackBoxItemIdOfFamily(族)` 那件物品存在且 `kind === 'blackbox'`（缺了即报红）；物品总数 110 → 111。

## 三、文案调整台账（whale-copy §2.7）

| 日期 | id / 位置 | 改动 | 依据（船长原话） |
|---|---|---|---|
| 2026-10-02 | `ui.IndustryPage.116` zh/en | 「取得第一个**墨潮旗舰**黑匣后解锁」→「取得第一个**黑匣**后解锁」 | 船长 2026-10-02 令「甲」 |
| 2026-10-02 | `ui.IndustryPage.142` zh/en | 「与**墨潮**旗舰黑匣互为替代」→「与**各族的**旗舰黑匣互为替代」 | 同上 |
| 2026-10-02 | 12 × `bp-plug-*` 说明（zh 在 `blueprints.ts` / en 在 `l10n.ts` 的 `BP_DESC_EN`） | 「须先取得墨潮旗舰黑匣」→「须先取得任意黑匣」／`requires any black box.` | 船长 2026-09-27「现有的舰船插件蓝图都只要使用任意类型黑匣就可以制作」＋ 2026-10-02 令「甲」 |
| 2026-10-02 | `core/blackbox.ts` `plugCraftLockReasonOf` | 拒因文案泛化，并修 **textId 指错**（`ui.IndustryPage.090` 是精炼炉「本炉料余」，改指 `ui.IndustryPage.116`） | 同上（顺手修的实现走偏，已在本批说明） |

- 未改：`core.weekend.003/016/039/040` 等**日志**里的「旗舰黑匣」是**族无关的统称**（不点名族），
  照旧；历史公告**不回改**（公告是当时的记录）。

## 四、不做 / 已记账的取舍

1. **老匣不追改**：R 族期已经拿到墨潮匣的玩家，手里的那件**不动**（同价 8,000 万、同样能下料、同样解锁插件，
   只差族名与外壳描述）。要做"换发/补发"是另一批（可另开工具批）——**等船长定**。
2. **推送前一次性补偿的固定墨潮匣**（`compensateMissingWeekendBlackBox`）**有意保留**：它只服务
   `WEEKEND_BOX_COMPENSATION_CUTOFF_WALL_MS` 之前的历史场次，那时**只有 H 一族**在跑 ⇒ 当时该拿到的就是墨潮匣。
3. **`reconcileWeekendBlackBox(state)` 签名不动**（不加 `ctx`）：`core/tests/weekend-blackbox-reconcile-20260928.test.ts`
   有一条**源码级契约**断言引擎里写的是 `reconcileWeekendBlackBox(state)` ⇒ 该入口不做存在性探测，
   族匣必存在由 §二.7 的内容契约保证；真破损时 `addWare` 拒收 ⇒ 不记账、下一拍再试（**不会发错族**）。
   该入口另加一道 `WEEKEND_BOSS_FAMILIES` 闸：**占位族那套老口径（A/C/G）没有自己的匣** ⇒ 按落款墨潮匣发
   （与本批改动之前逐字一致，不会退化成"永远补不出去"）。
4. **`core/shipWrecks.ts` 的 `WRECK_PLUG_BLACKBOX_ITEM_ID`（= `blackbox-h`）**：全仓**零引用**（死常量，
   当初为"回收插件 ⇒ 换回黑匣"那条未接线的路准备的）——本批**不动**，仅记账。

## 五、验证

- `npm run typecheck` 四包全绿 · `npm run build`（桌面外壳）✓ 2.89s；
- 新用例 `packages/core/tests/blackbox-per-family-20261002.test.ts`（**18 条**）：内容登记 · 取数口与回落 ·
  **两族端到端击杀**（R ⇒ `blackbox-r` 且 `blackbox-h` 为 0；H ⇒ 照旧 `blackbox-h`）· 幂等 ·
  结算补发与快照 · 结算信（含老快照回落）· 对账补发（含占位族回落）· 存档往返与手改档白名单 ·
  装配侧（顶料/真扣/解锁）· 文案（12 张图纸中英 ＋ 两条界面文案）；
- 既有用例同步（**改了断言的都列在这里**）：`blackbox-plug-category-20260926.test.ts`（blackbox 档 2 件 → 3 件）、
  `plug-universal-blackbox-20260927.test.ts`（等价组 2 件 → 3 件，＋1 条"光环匣顶料/报名字"断言）；
- 全量：`npm run test -w @whale/core` = **303 文件 / 3134 用例全绿**；
- `npm run content:check`（含新契约「每族一件（blackbox-h / blackbox-r）」· 物品总数 111）· `l10n:check` ·
  `l10n:params` · `ui:rot-check` · `ui:layout-css:check` · `arch:guard`（F1~F9 零处）全绿；
  `scope:check`（咨询级）读数 = **18 个文件 / 5 个域**（域划分见工具口径；本批跨域已按 §2.1 报船长并获令「甲」）；
- 端到端读数（用例内打印）：`[读数] R 族击杀：blackbox-r=1 · blackbox-h=0`。

## 六、待裁决点（等船长一句话）

1. R 族期已拿过墨潮匣的玩家要不要"换发一件光环匣"（工具批 or 不追）。
2. 匣名口径：本批按船长原话里的「**光环**」定名「**光环旗舰黑匣**」（英文 `Corona Flagship Black Box`，
   与族名 `Corona Systems` 同源）；若船长更想要「余晖中枢匣」一类专名，改名只动物品表与英文覆盖。
