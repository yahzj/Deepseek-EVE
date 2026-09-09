# 市场数字稀有度（隐藏档 · 稀有订单分层）设计稿

> 状态：**已确认**（船长 2026-09-09 多轮拍板）。经办：二号。
> 触发：船长观察「稀有订单过多、各种东西混杂」；要求卖单/买单刷新几率与权重受稀有度影响。

## 一、决策链（船长逐轮拍板）

1. 稀有度**入物品本体**（数据层独立表），市场只调用；不是市场卡私有字段。
2. 用**数字**表达档位（不用名词，避免与供给档名混淆、便于未来扩展更高稀有度）。
3. 渠道与数字**分离**：市场卡 common/rare/exotic 字符串保留管「渠道层与订单寿命」；
   数字只驱动**稀有订单（rare）渠道**内的刷新权重——**奇货渠道出率与数字不挂钩**（船长定）。
4. 未来加更高档（如 5）：把奇货层中低稀有度行下滑到 3，稀有订单层自动承接。
5. MK2 弹药图纸（新出商品）豁免入奇货层（数字 4），不走价格带推导。
6. 初值迁移 v1：渠道 common→1；rare 且价 ≤50 万→2、>50 万→3；exotic→4（低值奇货可手动改 3）。
7. 系数与总量：tier3 权重 **0.25**、稀有卖单总量**不收敛**（模拟数据审定后船长拍板维持现状张数公式）。

## 二、数据与机制

- `packages/data/src/rarityTier.ts`：`RARITY_TIER: Record<refId, number>`（275 项 = 市场卡全集，
  含 22 张残骸只收卡）；查询 `rarityTierOf(refId)`。`MarketGoodDef.rarityTier` 由
  buildMarketGoodsCatalog 构建 SimContext 时填充（市场调用）。
- 消费点（仅 rare 渠道，同权重表）：
  - 卖单：slowSupplyDraw rare 加权抽取，行权重 × `rareTierWeight(def, ctx)`
    （tier3 → `balance.market.rareTier3Weight`（默认 0.25），其余 → 1）；
  - 买单：refreshGoodOrders rare 分支收购概率（每 60s 窗 3% × 建站扩容）同乘该权重。
- 蓝图 ×0.5、暗市闸 ×0.04 等既有权重规则不变；奇货（exotic）掷骰路径未动。

## 三、模拟（tools/market-rarity-sim.ts，正式入库）

口径：rare 渠道卖单，只调 slowSupplyDraw（每窗先清过期），5 种子 ×1440 窗（10 天），声望 24：

| tier3 权重 | 每窗总张数 | tier2（66 行） | tier3（56 行） | tier3 单行间隔 |
|---|---|---|---|---|
| 1.0（旧均权） | 14.1 | 8.4（59%） | 5.7（41%） | ≈1.7h |
| **0.25（定稿）** | 14.1 | 12.0（85%） | 2.1（15%） | ≈4.4h（中位 17 窗） |
| 0.1 | 14.1 | 13.2（94%） | 0.9（6%） | ≈8.5h |

- 结论：分层把高阶件从「1.7h 一张」拉到「4.4h 一张」、占比 41%→15%——「混杂」治理达标；
  总量由张数公式（8~15% × 目录件数）决定，船长定稿**不收敛**（分层已够）。
- 买单侧同表：tier2 ≈ 55 分钟一见、tier3 ≈ 3.7h 一见（60s 窗 3%×0.25，无扩容）。
- 运行：`npx tsx tools/market-rarity-sim.ts [--windows N] [--seeds a,b] [--standing N] [--tier3-weight X]`。

## 四、改动面与验证

- data：`rarityTier.ts` 新表、marketCatalog 构建填充、index 导出；core：types 字段 +
  MarketBalance.rareTier3Weight + balance 默认、market.ts 两消费点；content-check 护栏
  （键集 = 市场卡全集、值 1~4、渠道一致 common→1 / rare→2/3 / exotic→3/4）；
  回归 market.test +1（权重 0 永不命中 / 0.25 显著低于 / 均权对半）；core 615/615 +
  typecheck ×4 + content:check 绿。数字不进 UI（隐藏）；玩家可见文案零变化。

## 五、后续可用性

- 价格整批调整、图鉴/掉落分级、栏位重组：都引用同一 `rarityTierOf`（物品唯一珍稀度来源）。
- 新市场卡必须同步表（护栏强制）。
