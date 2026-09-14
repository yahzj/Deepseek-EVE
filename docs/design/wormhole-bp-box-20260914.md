# 虫洞遗迹打捞新增「图纸货柜」（2026-09-14 · 二号 · d2）

> **状态：已确认**（船长 2026-09-14 逐轮裁定：五问 + 两问 + 最终八条冻结口径各一次点头）。
> 本稿是该系统的**权威件**；`docs/design/wormhole-exclusive-20260913.md` §6.1b 的「70:30」一行已由本稿作废。

## 一、船长原话（照抄）

> 「**给虫洞的遗迹打捞新增图纸货柜。占 2 格大小。内部是随机 T3T4T5 舰船的一次性图纸。
> 有较低概率出 T3 或 T4 的永久图纸。**」

## 二、裁定链（按序）

| # | 问题 | 船长裁定 |
|---|---|---|
| 1 | 要不要「记层」（决定浅/深层开出的档次） | **甲 · 记层**（复用现成的 `wormholeDilutionPoolOf(ctx, depth)`） |
| 2 | 从哪里掉（与既有安全货柜的关系） | **甲 · 与安全货柜并列**（连带把安全货柜的 30% 稀释池收回去） |
| 3 | 永久图纸概率 | **5%** |
| 4 | 开箱方式 | **甲 · 精炼炉拆解**（复用 `recipe: 'unbox'`） |
| 5 | T5 池很薄（一次性仅皇带鱼 1 张） | **本批不动，只报备** |
| 6 | 并列比例 | **50 : 50** |
| 7 | 三种货柜的中文名 | **浅层 / 中层 / 深层** |
| 8 | 最终八条冻结口径 | **确认** |

## 三、两条「实现上的必然」（已向船长说明并获批）

**① 必然是三种货柜，不是一种。** 拆解读的是精炼炉产线记录里的 `itemId`
（`industry.ts` 的 `wormholeUnboxRoll(state, ctx, r.itemId)`），而货柜撤离后进仓库只剩
「物品 id + 数量」⇒ **层信息只能写进物品 id**。好在稀释池的层门槛是 **2 / 3 / 5**，**三段精确等价**：

| 货柜 | 覆盖层 | 一次性池 | 永久池（5%） |
|---|---|---|---|
| 图纸货柜（浅层） | 层 2 | T3 ×10 | T3 永久 ×10 |
| 图纸货柜（中层） | 层 3~4 | T3×10 + T4×4 = 14 | T3×10 + T4×4 = 14 |
| 图纸货柜（深层） | 层 5+ | T3×10 + T4×4 + **T5×1** = 15 | T3×10 + T4×4 = 14（**不含 T5**） |

**② 安全货柜的 30% 稀释池要收回去。** 既然一次性图纸改由图纸货柜专出，安全货柜必须改
**100% 族专属池**，否则同一批图纸会有**两条渠道**。

## 四、最终口径（八条冻结）

| # | 项 | 定案 |
|---|---|---|
| ① | **新物品** | `box-bp-shallow` / `box-bp-mid` / `box-bp-deep` = **图纸货柜（浅层 / 中层 / 深层）** · **1000 m³**（= 500 m³/格 × 2 格）· **2 宽 × 1 高 = 2 格** · `kind: 'container'` · 施工期 `unreleased` · 各 1 条市场行（`basePrice: 1` / `demandMultiplier: 0`） |
| ② | **记层** | 浅层 = 层 2 · 中层 = 层 3~4 · 深层 = 层 5+（`wormholeBpBoxIdOf`） |
| ③ | **掉落** | 遗迹专属掉落判定（层 2 起 12%→50%）**命中后再掷一次**：安全货柜 **50** : 图纸货柜 **50**（`WORMHOLE_BPBOX_SHARE = 0.5`） |
| ④ | **一次性池** | `wormholeDilutionPoolOf(ctx, 层档)`（**原口径原样复用**：T3 层 2 / T4 层 3 / T5 层 5） |
| ⑤ | **永久池** | **5%**（`WORMHOLE_BPBOX_PERMANENT_CHANCE`）；`wormholePermanentPoolOf` = 前缀 `sbp-` **排除** `sbp-once-` 与 `sbp-wh-` → 非 `singleUse` → tier ∈ {3,4} 且 ≥ 门槛（T3 层 2 / T4 层 3） |
| ⑥ | **开箱** | 既有精炼炉 `recipe: 'unbox'`（90 秒/件 · 停靠空间站 · 1 枚 AI 核心或主控亲自） |
| ⑦ | **连带改动** | **安全货柜改 100% 族专属池**；`WORMHOLE_DILUTION_SHARE` / `wormholeLootShares()` **停用留档** |
| ⑧ | **表现与契约** | 新增 1 枚 SVG（`box-bp` · 扁长条箱体 + 卷轴筒）+ 4 个色调（`box-bp` 底 + 浅/中/深三档）· `content:check` 四处扩写 · 新增 `tests/wormhole-bp-box.test.ts`（9 例）· **存档零迁移** |

## 五、落点（改了哪些文件）

| 层 | 文件 | 改动 |
|---|---|---|
| 数据 | `packages/data/src/items.ts` | 新增 `BLUEPRINT_CONTAINERS`（3 件）+ 并进 `ITEMS` |
| 数据 | `packages/data/src/marketCatalog.ts` | 3 条市场行（`unreleased` · 上线动作 = 删字段） |
| 数据 | `packages/data/src/rarityTier.ts` | 3 个稀有度档位（`1`，与安全货柜同档） |
| 引擎 | `packages/core/src/wormholeHold.ts` | `WORMHOLE_SHAPE_BPBOX = { w: 2, h: 1 }` + 形状表登记 3 个 id |
| 引擎 | `packages/core/src/wormholeSalvage.ts` | 图纸货柜常量/池函数（`WORMHOLE_BP_BOX_*` · `wormholeBpBoxIdOf` · `wormholeBpBoxDepthOf` · `wormholePermanentPoolOf` · `WORMHOLE_BPBOX_SHARE` · `WORMHOLE_BPBOX_PERMANENT_CHANCE`）· `wormholeRollRelicBox` 加并列掷骰 · `wormholeUnboxRoll` 两台分岔（返回类型改 `WormholeUnboxDraw`）· 三处「2×2」硬编码文案改为**按形状现算** |
| 引擎 | `packages/core/src/industry.ts` | 拆解日志按 `source` 加后缀（族专属 / 一次性图纸 / 永久图纸）· `startUnboxRun` 的拒绝文案泛化为"货柜" |
| 引擎 | `packages/core/src/index.ts` | 导出新增常量与函数 |
| 界面 | `apps/desktop/src/renderer/src/ui/Glyphs.tsx` | `box-bp` 线稿 + `box-bp`/`-shallow`/`-mid`/`-deep` 色调 + `itemIconOf` 前缀分支 |
| 界面 | `apps/desktop/src/renderer/src/panels/Wormhole.tsx` | 7 处「遗迹安全货柜」硬编码泛化为「货柜」（含撤离结算行 `label`）· 货仓格短标签：图纸货柜显示「图纸」 |
| 契约 | `tools/content-check.ts` | 新增「图纸货柜契约」· 「图标契约」补 `box-bp` 与三档色调 · 「拆解链路契约」改为两台分岔（并打印并列比例与永久概率）· 「稀释池契约」的 70:30 断言改为**停用留档** · 物品总数 67→**70** |
| 用例 | `packages/core/tests/wormhole-bp-box.test.ts` | **新增 9 例** |
| 用例 | `packages/core/tests/wormhole-unbox.test.ts` | 口径改写：安全货柜 = 100% 族池（原 70:30 断言删除） |
| 用例 | `packages/core/tests/once-ship-blueprints.test.ts` | 第 ④ 条的 70:30 断言标注为**停用留档** |

## 六、验证

- **四连全绿**：typecheck ×4 0 错 · core **130 文件 / 1374 用例** · `content:check` ✅ · 桌面 build ✅
- **负向验证两条真红**（还原后全绿）：
  ① 把 `WORMHOLE_SHAPE_BPBOX` 从 `{2,1}` 改成 `{2,2}` ⇒ 「占货仓 2×1 = 2 格」断言立刻红；
  ② 把 `WORMHOLE_BPBOX_SHARE` 从 `0.5` 改成 `0.1` ⇒ 真引擎实测占比 10.8%（92/848）⇒ 比例断言红。
- `content:check` 新增读数行：`最低档一次性池 10 张 · 浅层永久池 10 张 · 图纸货柜并列比例 0.5 · 永久概率 0.05`

## 七、边界与不动项

- **T5 一次性图纸池只有 1 张**（`sbp-once-colossal` 皇带鱼；邓氏鱼连永久图纸都没有）——船长裁定
  **本批不动、只报备**。深层抽到 T5 就是那一张。
- **层 1 恒不出货柜**（`wormholeRelicChanceOf` 的入口闸未变，有用例钉住）。
- **存档零迁移**：只新增物品 id，不动任何既有字段；`wormholeRollRelicBox` 多抽的那一个随机数走
  **每格独立流**（种子含 `q/r`），不影响别的格子"出不出货"。
- 经济 / 航行 / 其它奖池 / 层数上限一律未动。
- 全批 `unreleased` ⇒ 玩家暂不可见（与虫洞同批上线；上线动作 = 删市场行的 `unreleased` 字段）。
