# 敌人明细导出（Excel）：敌舰明细（2026-09-17）

**状态：已完成（一号 · main）** · 工作文档（归档后删除，结论并入 roadmap 与 `tools/README.md`）

## 一、船长原话（照抄）

1. 「**能否将所有敌人的详细数据单独输出一个excel表格（之前的工具输出都太过粗糙，数据不详细）**」
2. 追问后收窄：「**只需要敌舰明细。**」

## 二、动手前查到的现状

- **现成先例与依赖**：`tools/content-export.ts` 早就用 `exceljs`（devDependency 已装）导出多 sheet 的 `content-workbench.xlsx`，并有 `content-import.ts` 回写 ⇒ **不需新装依赖**。
- **现有敌人工具确实粗**：`bounty-stats.ts` 只给每卡逐波求和的整卡总血/总DPS；`foe-hp-table.ts` 是按威胁档的参考表；`counter-audit`/`faction-audit`/`foe-dps-overcap`/`pd-vs-foe-drone` 各切一面。**逐舰级的三层三系抗性、射程带/期望交距/衰减/近盲、闪避与实速、挂载件与冲锋/捕获网、后勤修理、机群**没有任何一处汇总。
- **口径来源齐备**：`data/foe-ships.ts`（`FOE_SHIPS`，**25 条就是全部敌舰级**——已核"单独导出的 25 个 `FoeShipDef` 全部在数组里，无遗漏"）· `core/foeMounts.resolveFoeMounts` · `combat` 的战术期望距离式 · `balance.battle.hullClassBaseSpeedMps`（速度基准唯一出处）。

## 三、产出（`npm run foe:export`）

- `foe-csv/enemy-ships.xlsx` —— **一张「敌舰明细」sheet**：**25 行 × 56 列**，冻结前两列＋表头、开自动筛选；表头带**单元格批注**逐列写口径；数字格式按列给（血量千分位、占比/抗性百分比、倍率三位小数）。
- `foe-csv/enemy-ships.csv` —— **同列同序**的纯文本版（**试算列在 CSV 里由本工具按引擎口径算成数值**，保证 csv 自洽）；UTF-8 **带 BOM**（Excel 直接双击不乱码）。
- 落点纪律：`foe-csv/` 已入 `.gitignore`（与 `content-csv/` 同款，源数据以 git 为准、产物随时重建）。

**列分组**：① 标识（id/名称/族/舰种档与名/精锐/战术）② 血量（总血 ＋ 结构/装甲/护盾 值与占比）③ **三层×三系抗性 9 列** ④ 火力（单发/装填 ms 与秒/命中率/**命中模型（能量光束必中 or 掷命中+距离衰减）**/伤害构成/名义 DPS 合计与分系/射程带/期望交距与来源/远端衰减/近盲倍率/闪避/实速与倍率）⑤ 特性（挂载件/冲锋与倍率与冷却/捕获网/挨打后机群与炮台射程倍率/后勤修理/机群明细与机群名义 DPS）⑥ **试算列 4 列（Excel 公式：DPS、三层血）**。

**口径（写进了工具头注释与列批注）**：全部是**舰级裸值** —— 登记原值取 data 表，派生列走引擎同一把尺（三层血 = 总血×占比；名义 DPS = 单发×1000÷装填，**不含命中率与距离衰减**；实速 = 舰种基准×`speedRatio` 取整；期望交距 = `desireRangeM` ?? 下限+战术系数×带宽，夹 `minDistanceM`）。**刻意不含卡级覆写**（条目级 `hpMul`/`dmgMul`/`rangeMul`/`split`/`tactic`/`mounts`/`droneFireShare`、多舰补偿、越线折扣）——要看卡级实算值走 `npm run bounty:stats`，免得两套口径混在一张表里。

## 四、交叉核对（表里的数是不是引擎的数）

| 抽查 | 本表 | 独立来源 |
| --- | --- | --- |
| 劫掠电子舰 `foe-pirate-raider` | 总血 **182** · 闪避 **0.30** · 实速 **374** | 另一批的提交记录原文「A 族 T1 电子舰（**血 182 / 闪避 0.30 / 速 374**）」 |
| 劫掠护卫舰 `foe-pirate-corvette` | 实速 **374** | 同批「A 族海盗护卫舰不再低于本档基准（**337 → 374**）」 |
| 海盗头目舰 `foe-pirate-warlord` | 总血 **900** · 单发 **135** | `foe-ships.ts` 登记注与设计表「**900 / 135**」 |

## 五、闸门

`npm run foe:export` 跑通（自检读数：按族 A5/B2/C5/D4/E4/G5 · 最高总血 核心舱段 3,920 · 最高名义 DPS 核心舱段 136.5 · 带机群 6 条 · 带挂载件 10 条）·
`npm run tools:audit` 把新工具登记为 **v25 · 核对 2026-09-17** · `npm run typecheck` 四包 0 错 · `npm run content:check` ✅。
`tools/README.md` 台账 29 → **30**（新增 `foe-export.ts` 一行）；npm script `foe:export` 入库。
