# 派系活跃掉落率读数：从"写死裸常量"收口到"随档位现算"（2026-09-24）

状态：**进行中** —— 改动**已落码**，七道闸门全绿，**待船长验收**；
归档按 AGENTS.md §8（船长验收 + 合入 main 后当批做：关键内容并入 roadmap / 词典 → 删本文件 → 重跑 `docs:index`）。

## 船长原话（照抄）

1. 报障：「**敌对派系活跃的卡牌上，铁人模式的残骸掉率加成似乎没应用到？**」
2. 选定方案：「**甲**」（＝ ① 工具读数参数化、打印普通/铁人/限时三档；② 卡面读数随状态现算）。

## 一、查证结论（先取证，不猜）

**机制层：一直是对的。** 「敌对派系活跃」的掷骰全仓只有一处（`expedition.ts` 的 `if (factionActive)` 分支），
且它**乘了**乘区：`FACTION_RARE_DROP_CHANCE × rareDropRateMulOf(state)`，其中
`rareDropRateMulOf = 限时倍率 rareWreckRate × 铁人 ×1.2`。

**真引擎实测**（临时探针 · 各 3000 趟 · 同一批档，只切铁人开关；用完已 `git checkout` 还原）：

| | 实测掉落率 | 解析式（保底 10 趟） |
| --- | --- | --- |
| 普通档 | **29.70%**（891/3000） | 30.87%/趟 |
| 铁人档 | **35.10%**（1053/3000） | 36.42%/趟 |
| 比值 | **×1.182** | **×1.180** |

⇒ 两个独立方法都给出 **×1.18**（自然 p 30% → 36%，被保底轻微稀释）——**加成确实生效**。

**病根 = 读数写死裸常量**（两处，都不吃乘区）：

| # | 位置 | 原样 |
| --- | --- | --- |
| ① | **卡面**（`Expedition.tsx` 置顶派系活跃卡的奖励行） | `Math.round(FACTION_RARE_DROP_CHANCE * 100)` ⇒ **恒印 30%** |
| ② | **`npm run faction:audit`** | `factionRareDropEffectiveRate()` 内部写死 `const p = FACTION_RARE_DROP_CHANCE` ⇒ **恒印 30.9%/趟** |

于是铁人档在**卡面上看上去"没加上"** —— 船长看到的现象是真的，只是病在读数不在机制。

## 二、落码（逐条）

1. **`core/lairs.ts`**：
   - `factionRareDropEffectiveRate(rate = FACTION_RARE_DROP_CHANCE)` —— **参数化**（原为无参、内部写死）；夹 0~1，
     `p=0 ⇒ 1/N`、`p=1 ⇒ 1` 边界都补了用例。
   - `factionRareDropChanceOf(state)` —— **当前档位的单趟自然概率**（含全部乘区），夹 0~1。
   - `factionRareDropRateOf(state)` —— **界面/工具读数**：自然概率再过保底折算。
   - 新增运行时 import `rareDropRateMulOf`（`lairs` → `tuning` → `ironman`，**无环**；且新函数都在**函数体内**调用，
     不存在顶层求值 ⇒ 不会重蹈 2026-09-24 那次 `combat ↔ wormholeFoes` 循环依赖的 CJS 转译 TDZ）。
2. **`core/expedition.ts`**：掷骰改调 `factionRareDropChanceOf(state)` —— **读数与结算同一函数**（本仓惯用的单点化），
   顺手删掉不再使用的 `rareDropRateMulOf` import。
3. **`core/index.ts`**：导出两个新函数。
4. **卡面**（`panels/Expedition.tsx`）：`Math.round(FACTION_RARE_DROP_CHANCE * 100)` ⇒
   `Math.round(factionRareDropChanceOf(state) * 100)`；删掉该文件对 `FACTION_RARE_DROP_CHANCE` 的 import
   （改完就没人用了）。**文案 id 一条没加**（`{pct}{ui.Expedition.406}{n}` 的结构照旧，只换数）。
5. **`tools/faction-audit.ts`**：改成**三档读数表**（普通 / 铁人 / 此刻限时倍率），各列自然概率、含保底实际率、
   4h 与 8h 期望件数；并注明"卡面显示的就是当前档那一行"。
6. **用例**（`tests/bounty-tasks.test.ts`）：新增一条钉住"读数随档位现算"——普通 = 裸常量、铁人 = ×1.2、
   两者差 > 4pp、参数化解析式的单调性与两个边界。

**没动的**：`FACTION_RARE_DROP_CHANCE`（30%）· `FACTION_RARE_DROP_PITY_ROLLS`（10）·
`FACTION_RARE_DROP_COUNT`（1）· 铁人 ×1.2 · 限时倍率表 —— 本次**零数值改动**，只改读数的算法与去处。

## 三、验证读数

- **七道闸门**：`typecheck` 四包 0 错 · core **201 文件 / 2273 用例全绿**（+1）· `content:check` ✅ ·
  `l10n:check` ✅ · `ui:rot-check` ✅ · `save:roundtrip-audit` ✅（丢键 0）· 桌面 `build` ✅。
- **`npm run faction:audit` 新输出**（实测）：

  ```
  档位                          自然概率   实际率（含保底）   4h 刷     8h 刷
  无加成（标称）                      30%      30.9%           ≈4.4 件    ≈8.7 件
  铁人（×1.2）                     36%      36.4%           ≈5.1 件    ≈10.3 件
  限时倍率（此刻 ×1.00）               30%      30.9%           ≈4.4 件    ≈8.7 件
  ```

- **不可见的边界**：本次只改**读数**；结算路径的随机数时序一字未动（掷骰仍恒消耗一次 `nextRandom`）⇒
  既有 300 趟/200 趟统计用例读数不变。

## 四、已知残余风险（如实记）

- **卡面那个数字没有静态护栏**：`Expedition.tsx` 已不再 import `FACTION_RARE_DROP_CHANCE`，
  但若日后有人再写死常量，没有体检会报红（该数字是 JSX 表达式，不在 `content:check` 的扫描面内）。
  真要守，得在 `content:check` 里加一条"渲染层不得直接消费掉率类常量"的规则——**待船长定**，本次未加。

## 五、待裁决点

- 要不要发公告？（本次是**读数修正**、零数值改动，按 §十二 判定大概率不构成"大更"——与同日另两件一并问过。）
