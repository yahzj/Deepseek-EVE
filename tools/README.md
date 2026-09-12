# 工具区台账（tools/）

> 本文件是工具区的**索引 + 版本自检台账**。新增工具请两处登记：**本文件** + 工具自己的头注释
> （头注释写"用途 / 运行 / 口径 / 版本自检"四段，体例见 `pd-vs-foe-drone.ts`）。

## 一、版本自检（船长 2026-09-12 定）

> 「工具区需要进行一个备注，和之前的旧数据规则一样，**超过一个大版本的工具要检查是否和现在版本有较大偏差**。」

- **大版本判据 = 存档结构版本**：`packages/core/src/state.ts` 的 `CURRENT_STATE_VERSION`（现 **v24**）。
  它是"数据形状变了"的权威信号（字段增删/迁移），工具最容易被打穿的就是这条路。
- **每个工具的头注释写三条**：
  ```
  ⚠ 版本自检（口径同「旧数据不可靠」：超过一个大版本必须核对是否与现状偏差过大）
    - 游戏版本：v0.1.0（package.json）· 存档结构：v24（CURRENT_STATE_VERSION）
    - 本工具最后核对：YYYY-MM-DD（当日核对的内容）
    - 本工具最后跑过：YYYY-MM-DD
    - 判据：CURRENT_STATE_VERSION − v24 ≥ 2 ⇒ 必须重跑核对
  ```
- **体检入口**：`npm run tools:audit`（只读头注释，不执行工具）——输出「需重检 / 未登记 / 在版本内」三档。
  差 ≥2 个大版本 ⇒ **需重检**；差 1 或未登记 ⇒ **待确认**。
- ⚠ **不给老工具批量补登记**（船长 2026-09-12：「**调用时再检查，不用立刻更新**」）——
  口径 = **调用即核对**：谁在哪个会话里*用*某个工具，谁就当场核对它跟当前版本有没有大偏差，
  顺手把这三条补进那个工具的头注释（**用哪个补哪个**，不搞一次性大扫除）。
  在此之前 `tools:audit` 把老工具列为"待确认"就够用——它是台账，不是欠账单。

**为什么要这条**：本仓已有先例——`battle-calibrate` 曾在全表 27 张卡迁入舰级路径后**整表静默空转**
（提案字段对真卡无效、读数一格不变，极易被误读成"提案无效"＝假结论）。工具不会自己报错，
只会**安静地给你一个过时的数**。

## 二、台账（29 个工具）

| 工具 | npm script | 挂牌状态 |
|---|---|---|
| `balance-check.ts` | `balance` | 未登记版本自检 |
| `battle-calibrate.ts` | `battle:calibrate` | 未登记版本自检 |
| `bounty-econ.ts` | `bounty:econ` | 未登记版本自检 |
| `content-check.ts` | `content:check` | 未登记版本自检（**体检契约总入口**） |
| `content-export.ts` / `content-import.ts` / `content-schema.ts` / `content-validate.ts` | `content:export` / `content:import` / — / — | 未登记版本自检 |
| `drone-vs-gun.ts` | `battle:drone-vs-gun` | 未登记版本自检 |
| `faction-audit.ts` | `faction:audit` | 未登记版本自检 |
| `firepower-curve.ts` / `foe-hp-table.ts` | — | 未登记版本自检 |
| `hit-profile.ts` | `battle:hit-profile` | 未登记版本自检 |
| `liquidity-audit.ts` | `liquidity:audit` | 未登记版本自检 |
| `loop-stop-check.ts` | — | 未登记版本自检 |
| `make-autoperf-save.ts` / `make-test-save.ts` | — | 未登记版本自检 |
| `manufacture-econ.ts` | `manufacture:econ` | 未登记版本自检 |
| `market-rarity-sim.ts` | — | 未登记版本自检 |
| `mixed-damage-review.ts` | `battle:mixed-review` | 未登记版本自检 |
| `pd-tune.ts` | `battle:pd-tune` | 未登记版本自检 |
| `pd-vs-foe-drone.ts` | `battle:pd-vs-drone` | 未登记版本自检 |
| `playthrough-sim.ts` | — | 未登记版本自检 |
| `price-audit.ts` | `price:audit` | 未登记版本自检 |
| `salvage-econ.ts` | `salvage:econ` | 未登记版本自检 |
| `travel-matrix.ts` | `travel:matrix` | 未登记版本自检 |
| **`ui-probe.ts`** | `ui:probe` | **已登记**（v24 · 核对 2026-09-12） |
| **`ui-geom.ts`** | `ui:geom` | **已登记**（v24 · 核对 2026-09-12） |
| **`tools-audit.ts`** | `tools:audit` | **已登记**（v24 · 本体检工具自身） |

> 26 个老工具的「未登记」不是缺陷、是**历史**：它们是逐批长出来的，当时没有版本自检这条规矩。
> 按上面的口径**不批量补**，改为**调用时再检查**（谁用谁补）。

## 三、工具产物的落点纪律

- 一次性探针一律 `_` 前缀、收尾二选一（转正 / 删除）；
- **可重建的产物**（截图 / 读数 JSON / 注入档）统一落 `tools/_ui-artifacts/`，**不入库**；
- 工具自己写产物目录时**先 `mkdirSync(recursive)`**，并在缺输入时给出"怎么造"的明确提示，
  不要留下"文件找不到"的谜题。
