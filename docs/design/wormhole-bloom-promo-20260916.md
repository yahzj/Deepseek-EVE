# 限时活动「虫洞大量生成」（扫描加速 ＋ 一次性送 5 处）· 2026-09-16

> **状态：进行中**（工作文档；船长验收 + 合入 main 后按 AGENTS.md §8 归档三步：关键内容并入 roadmap ＋ 词典登记 → 删本文件 → 重跑 `npm run docs:index`）

## 一、船长原话（照抄）

- 原始需求：「**将扫描虫洞所需时间\*0.25，持续到9月20号，并给予所有玩家5个虫洞（同样持续到20号为止，到20号之后提醒我清理这个过期的赠送）**」
- 四答（同日，逐条）：**① 每人只发一次 5 个** · **② 只给已解锁者** · **③ 到期只停止赠送**（不回收已发出的） ·
  **④ 提醒 = 挂账 ＋ 只读检查**；展示「**5和虫洞限时缩短写在一起，但是要润色成虫洞大量生成之类的**」；
  公告「**写好后给我看**」

## 二、机制（一条促销 = 三项同源）

`packages/core/src/tuning.ts` 新增 **`PROMOS`（促销表）**，与 `TUNING_RULES` **共用同一套日期判据**
（`dayWindowActiveAt` / `dayWindowEndMs`：本地时区 · `from` 含当日 00:00 · `until` 当天整天有效 · 次日 00:00 失效）。

| 项 | 现值 | 读取点 |
|---|---|---|
| `id` | `wh-bloom-20260916` | `state.promoClaimed` 的键（一次性领取凭据） |
| `label` / `detail` | 「虫洞大量生成」＋ 两句游戏内说明 | 活动栏徽标（`ActivityBar.tsx`） |
| `from` ~ `until` | `2026-09-16` ~ `2026-09-20` | 两张表共用判据（已加"同判"守卫用例） |
| `scanMul` | **0.25**（基准 12 小时 ⇒ 3 小时，再吃技能口径） | `wormholeScanWindowMs`（与 `TUNING_RULES` 的 `wormholeScanMs` **相乘**） |
| `giftWormholes` | **5**（一次性） | `reconcileWormholePromoGift`（逐 tick 幂等） |
| `claims` | `['wormholeScanMs']` | 活动栏：被认领的倍率键**不再单列**徽标（同一件事不显示两遍） |

**赠送口径**（`wormholeScan.ts` 的 `reconcileWormholePromoGift`，照 `reconcileWormholeScanWelcome` 范式）：
- **逐 tick 幂等 + 只发一次**：靠 `state.promoClaimed[promoId]`；老档缺席该字段 ⇒ 下一次心跳自动补发；
- **只给已解锁者**（协会声望 ≥ 40）：未达标不发、也**不记领取** ⇒ 达标后（仍在活动期内）下一拍自然领到；
- **允许暂时超过库存上限**（船长确认）：手里已有 3 处 ⇒ 送 5 处得 **8 处**（否则赠送会被上限"吃掉"）；
  ⚠ 放宽**只作用于赠送这一条路径**——扫描产出与"满则停机"仍严守上限（`wormholeStockPush` 未动语义，
  赠送走新拆出的 `stockPushUncapped`）；
- **到期只停止赠送**：已发出的虫洞**不回收**（不改任何已存状态 ⇒ 零迁移、零回收代码）。

**存档**：新增**可选**字段 `state.promoClaimed?: Record<string, true>`（`save.ts` 白名单读写，
非法值忽略；空表不落键 ⇒ 保持老档形状）。**不升版本、零迁移**。

## 三、改动清单（文件）

| # | 文件 | 改动 |
|---|---|---|
| 1 | `packages/core/src/tuning.ts` | `PromoRule` / `PROMOS` / `activePromos` / `promoActiveAt` / `promoScanMul` / `activePromoGifts` / `dayWindowEndMs`；`ruleActiveAt` 与 `activeTunings` 改用共用日期判据（**行为不变**，仅去重） |
| 2 | `packages/core/src/wormholeScan.ts` | 扫描窗口乘 `promoScanMul`；拆出 `stockPushUncapped`；新增 `reconcileWormholePromoGift` |
| 3 | `packages/core/src/state.ts` | 可选字段 `promoClaimed` |
| 4 | `packages/core/src/save.ts` | 白名单读 + 落盘（空表不落键） |
| 5 | `packages/core/src/engine.ts` | `advanceGame` 逐 tick 调 `reconcileWormholePromoGift` |
| 6 | `packages/core/src/index.ts` | 导出促销表与四个函数、两个类型 |
| 7 | `apps/desktop/.../ActivityBar.tsx` | 促销徽标（复用 `.app-activitybar-tuning*` 同族样式）＋ 隐藏被认领的倍率键 |
| 8 | `tools/tuning-expired.ts`（新）＋ `package.json` | `npm run tuning:expired`：列出生效期已过 / 未开始的限时条目（**不进 `content:check`**，体检与标定读数不吃日历） |
| 9 | `tools/content-check.ts` | 新增「限时促销契约」七条（id 唯一 · 文案非空 · 日期合法 · scanMul>0 · giftWormholes 正整数 · 至少一项效果 · claims 合法且认领 scan 必须写 scanMul） |
| 10 | 用例 | `tests/tuning.test.ts` ＋5 条促销用例（窗口边界 / 读数 / 回落 / 引擎读取点 / 两表同判）· `tests/wormhole-promo-gift.test.ts` 新增 8 条（含存档往返） |

## 四、在办中发现的一处**日历重叠**（已修）

既有用例 `tuning.test.ts` 的开关④把"现在"取成 **2026-09-20 12:00**，而本促销窗口正是 9/16~9/20
⇒ 两把乘子叠在一起（`×0.5` 被算成 `×0.25`）。**修法**：该用例把墙钟挪到窗口外的 9/25，
并**把"该时刻无任何促销"写成断言**（日后新促销再盖住它会立刻红）。
⚠ 教训：促销是**全时段的**环境乘子 —— 任何"给扫描窗口定读数"的用例都必须避开活动窗口。

## 四之二、船长验收后的两条 UI 修正（2026-09-16 当天追加）

船长原话（照抄）：「**虫洞大量生成6个字显示不完全。建议宽度要保证标题文字都能显示。**」＋
「**并且点击后，不会跳转扫描虫洞界面**」。

**① 宽度（徽标不再截字）**：根因有两条 —— a) 剩余时间当时用**全量** `formatDurationMs`
（4 天档 = `4天21小时5分3秒` 10 个汉字 ≈ 105px），b) 徽标是"定宽 190px ＋ 允许被压缩
（`flex-shrink: 1`）＋ 名称省略号"。**修法**：
- 新增紧凑时长 **`formatDurationShort`**（只保留两级最大单位：`4天21小时`）→ 徽标时间列用它，
  悬停 tip 仍用全量格式；时间列另给 `min-width: 7em ＋ 右对齐` ⇒ 剩余时间变化不再推挤标题；
- 徽标改为**按内容定宽**（`width: max-content`，`min-width` 保留原 190px 观感）＋
  **不允许被压缩**（`flex-shrink: 0`）＋ 名称**去掉省略号**（`flex: 0 0 auto`，不再 `overflow: hidden`）；
- 活动窗头部允许**换行**（`.app-activitybar-hd` 加 `flex-wrap: wrap ＋ row-gap`）⇒ 窄窗拥挤时
  整枚徽标换行，而不是把标题裁掉（这就是"宽度要保证标题文字都能显示"的落地口径）。

**② 点击去向（跳扫描虫洞界面）**：`PromoRule` 新增可选字段 **`open`**（去向单点、数据驱动）——
`'wormhole-scan'` ⇒ 星图页的「扫描虫洞」选项卡（`WormholeScanTab`：进度条与库存列表那一页，
即船长说的"扫描虫洞界面"）；不写 ⇒ 与限时加成徽标同款走「星图」。
本促销写 `open: 'wormhole-scan'`；`content:check` 的促销契约新增第 ⑧ 条拦"未知去向"，
用例里也钉了一条守卫（删掉 `open` 即红）。tip 里同步补一句「点击前往「扫描虫洞」页」。

## 五、验证（2026-09-16 实测填写）

- [x] `npm run typecheck` 四包 **0 错**
- [x] `npm run test -w @whale/core` **151 文件 / 1614 用例全绿**（含本批新增：促销 5 ＋ 赠送 8 ＋ 紧凑时长 1）
- [x] `npm run content:check` **✅**（新契约：`1 条促销` 逐项通过，含点击去向校验）
- [x] `npm run ui:rot-check`（本批动 UI，必跑）**✅**
- [x] `npm run tuning:expired` 读数：**活动期内 = 无需清理**；模拟 9/21 之后 ⇒ 如实列出待清理 1 条
- [x] 桌面 `npm run build` ✅ · 网页 `npm run build --prefix web` ✅
- [x] 负向验证：① `giftWormholes` 改 0 ⇒ 赠送用例 8 条如实红 ＋ 契约点名；② `until` 挪到过去 ⇒
      11 条如实红 ＋ 提醒工具如实列出；③ 摘掉 `open` ⇒ 去向守卫如实红
- [x] 编码三查：全 CRLF · 无 BOM · 往返解码乱码 0
- [x] 公告已按船长"可以直接推送，包括公告"写入 `announcements.ts` 最上方

## 六、到期清理（**9/21 之后**）

1. 跑 `npm run tuning:expired` ⇒ 会列出 `PROMOS · wh-bloom-20260916`（生效 9/16~9/20）。
2. 从 `packages/core/src/tuning.ts` 的 `PROMOS` 里**删掉那一行**（`TUNING_RULES` 本批为空，无需动）。
3. 重跑 `npm run content:check`（促销契约条目数回到 0）+ `npm run docs:index`（若同时归档本文件）。
4. ⚠ **不需要**任何回收动作：`state.promoClaimed` 留着无害（键用不上），已发出的虫洞玩家照常探索。

> 本条的**提醒**已落在两处：本工作文档（§六）＋ 只读工具 `npm run tuning:expired`（跑一次就看得见）。

## 七、公告

**已批准并入库**（2026-09-16 船长：「进行合并和检查，然后可以直接推送，包括公告」）：
`announcements.ts` 最上方新增 `ann-wormhole-bloom-20260916`「虫洞大量生成」（tag 活动 · 3 条要点），
与同批代码一起推送上线。待审稿留档：`docs/design/announcement-draft-20260916-wormhole-bloom.md`。

## 八、推送与线上核验（2026-09-16 08:07）

- **推送**：`git push origin main` ⇒ `73ca8efb..482d0301`；本地 HEAD = 远端 = **`482d0301`**，待推送 **0**。
  （同批上线的还有三号在我编辑期间合入的 5 条：`fd91b12d` / `73ca8efb` / `e4b789d3` / `d5241f40` /
  `537cfce7`——含「首艘自造船」通讯与交接卡，属他人批次。）
- **闸门（在推送的那个提交上复跑）**：typecheck 四包 0 错 · core **150 文件 / 1615 用例全绿** ·
  `content:check` ✅ · `ui:rot-check` ✅ · 桌面与网页 build ✅。
- **Pages 核验**：线上 `https://yahzj.github.io/Deepseek-EVE/` 已切到本次产物
  `assets/index-rkKiY5U0.js`；与本地 `web/dist/assets/index-rkKiY5U0.js`
  **SHA256 逐字节一致**（`8B0B66CB…D540710F` · 1,600,814 字节）· 产物内含公告文案「虫洞大量生成」✅。
- **公告已上线**：`announcements.ts` 的 `ann-wormhole-bloom-20260916` 随本次推送与玩家见面。

## 九、后续

1. **验收**：徽标观感（宽度不再截字 · 点击进「扫描虫洞」页）请船长在**线上或本地**复核；
   若仍有不合意处，改 CSS/去向即可（本批所有口径都在 `PROMOS` 一行 + 两条 CSS 规则里）。
2. **9/21 之后清理**（见 §六）：`npm run tuning:expired` ⇒ 删 `PROMOS` 那一行 ⇒ 重跑 `content:check`。
3. **归档**（船长验收后）：把关键内容并入 roadmap 一条 ＋ 词典登记，删本工作文档，重跑 `docs:index`。
