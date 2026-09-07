# 市场收购侧改版：档位 + 簿面件数 + 两侧抢单（已确认 2026-09-08）

> 状态：**已确认并落地**（船长 2026-09-08 拍板：①收购价档位按 rarity 全局制 ②簿面件数放大
> （common 单件 ×3、rare ×2）③两侧抢单实现（卖 30%·e^(−6r) / 买 20%·e^(−14s) 每 60s 窗）
> ④奇货 1.0L 全价回收、维持稀有节奏）。承接「站内让利吸收」（market-sell-absorb.md）后的
> 市场卖侧整体拼图；本档文档含 2026-09-08 起的完整收购侧规则。

## 一、收购价档位（`buyPrice`，市场页"收购"报价）

| 商品类 | 档位 | 说明 |
|---|---|---|
| 原料池（矿石/矿粉/气/冰） | **1.0L**（留空） | 挖矿主收入线不变 |
| 池耗材（弹药×3 / 修理组件×2 / 无人机×4） | **0.6L**（显式 demandMultiplier） | 防"造弹卖站"近无本回血；消耗品应以消耗为主 |
| common 单件（装备/蓝图/AI 核心/民用船） | **0.6L** | 二手/自制出货回血 ↑50%（原 0.4~0.5） |
| rare（装备 MK2/3、蓝图、舰船） | **0.65L** | 原 0.35 |
| exotic 奇货（异星原型/奇货船/巨灵鲸蓝图书等） | **1.0L** | 全价回收；稀缺件无复制途径，现货倒卖亏 5% 税 |

实现：`demandMultiplier` 语义 = 收购档位（数据值全部按 rarity 档批量更新；池商品留空 =
原料平价 1.0）；引擎单件缺省按 `BUY_TIER[rarity]`（common 0.6 / rare 0.65 / exotic 1.0）兜底，
导出 `acquisitionFactorOf(def)`（UI 默认卖价同源）。防套利不变式：收购 ≤ 1.0L < 供应（约
1.0~1.06L±jitter），倒买倒卖恒亏 ≥5% 税；簿面撞价交叉由 digest 队列兜底。

## 二、簿面件数放大（平价流通速度）

| 收购单 | 件数 | 平价长期流速 |
|---|---|---|
| common 单件（85%/窗） | ×1 → **×3/张** | ≈0.85 → ≈2.6 件/窗（仍低于让利折价上限 5/窗 → 让利提速仍有效） |
| rare（3%/窗） | ×1 → **×2/张** | 期望 0.075/窗；主体由让利吸收保底 F=0.3 兜底（平价 0.3/窗、折价至 1.5/窗） |
| 奇货（1%/窗） | ×1 不变 | 稀缺节奏不变；保底 0.1/窗 |
| 池商品三档阶梯 | 不变 | 只随单价档变化 |

开盘簿（seedCommonBook）与每窗刷新（refreshGoodOrders）同步。

## 三、两侧抢单（越线挂单小概率成交）

- **卖出侧**：挂价 p > 收购价线 b → 每 60s 窗掷一次：命中 = `snatchSellChance(0.3) × e^(−snatchSellDecay(6) × r)`，
  r = (p−b)/b。命中成交 1 件 @ p（税/escrow/池/日志同簿成交，日志标注"巡游采购"）。
  - +10% 溢价 ≈16.5%/窗（约 6 窗一单）、+50% ≈1.5%/窗（约 66 窗）、翻倍挂 ≈0.07%/窗（极慢）。
- **买入侧**：挂价 p < 供应价线 a → 每窗掷：`snatchBuyChance(0.2) × e^(−snatchBuyDecay(14) × s)`，
  s = (a−p)/a，命中成交 1 件 @ p（钱包不足当窗跳过；闸内商品不参与；日志"巡游供货"）。
  - 砍 5% ≈9.9%/窗、砍 20% ≈1.2%/窗。
- 三层通道互斥：平价/让利单 = 簿面 + 站内让利吸收；越线单 = 抢单（簿吃不掉、吸收不接）。
  窗口顺序：簿撮合 → 抢单掷骰 → 让利吸收。
- 参数入 `balance.market`（snatchSellChance / snatchSellDecay / snatchBuyChance / snatchBuyDecay）；
  纯 rng 掷骰、无状态字段、存档零迁移。

## 四、代码落点

- `packages/data/src/marketCatalog.ts`：全部单件 demandMultiplier → 档位值（127 行，脚本化迁移并
  核对 rarity→值）；弹药/修理组件/无人机 9 条池耗材显式 0.6；头注释更新。
- `packages/core/src/market.ts`：buyPrice 档位化（池 dm??1 / 单件 acquisitionFactorOf）；
  开盘簿与刷新件数 3/2；matchPlayerOrders 两侧抢单 + settleSnatchSell/SettleSnatchBuy；
  导出 BUY_TIER / acquisitionFactorOf；头注释。
- `packages/core/src/types.ts`：demandMultiplier 注释 = 收购档位；MarketBalance +4 抢单参数。
- `packages/core/src/balance.ts`：snatchSellChance 0.3 / decay 6；buy 0.2 / decay 14。
- `packages/core/src/index.ts`：导出 acquisitionFactorOf。
- 测试：helpers/events/v10 测试商品档位同步 common 0.6 / rare 0.65 / exotic 1.0；既有断言更新
  （蓝图回卖 600、卖船 72k、AI 核心簿 qty3、高挂改赌巡游）；新增档位真值表、簿件数 3 与 rare
  spawn qty2@650、卖侧抢单 200 窗统计（+10% 溢价期望 ≈33 件）、买侧抢单统计（−5% 期望 ≈20 件）。
- UI：MarketPage 买卖两侧单价提示四态（平价 / 让利吸收 ×E / 高挂赌巡游 / 低挂赌巡游），默认卖价
  兜底改 acquisitionFactorOf。

## 五、验证

core 482 绿（47 文件）+ typecheck ×4 绿 + content:check 绿 + desktop build 绿。

## 六、经济自稳与边界

- 大额平价抛售照旧计入 netVol → 冲击压价自稳；让利吸收上限 ×5 与簿面并存不叠加（簿厚吃簿、
  簿薄站补，总窗速 = max(簿, 配额) 语义见 market-sell-absorb.md §二）。
- 奇货 1.0L 全价回收的对象仅限抽取到货的稀缺件；异星原型无蓝图、奇货船需高声望，无复制途径。
- rare/exotic 目录需求侧仍受 3%/1% 低频簿约束，"平价现卖"以让利保底 F 为准（船长此前拍板口径）。

## 七、挂账

公告稿（收购价上调属玩家可见数值向更新；若随批发布，待船长验收后另出待审稿）。买侧"收购单
件数 3/稀有 2~3"的旧提案语义已由"簿面件数放大 ×3/×2"实现替代；「批量档」数量阶梯不作数。
