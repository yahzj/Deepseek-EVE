# 内容工作台（CSV 双向编辑内容数据）

> 船长 2026-09-05 拍板方案①并确认设计总结。目的：把 `packages/data/src/` 的 TS 内容表
> 变成船长可以在 **Excel/WPS 里直接浏览、筛选、批量修改**的表格，再由工具安全写回源码。
>
> 工具按「工具纪律」（development-conventions.md 第十章）入库：`tools/content-export.ts`
> + `tools/content-import.ts`（Phase B），均挂 root npm script。
> 导出中间产物在 `content-csv/`（已 gitignore——源数据以 git 为准，CSV 只是工作台）。

## 一、流程总览

```
npm run content:export              # ① 导出 7 张 CSV 到 content-csv/
   ↓  Excel/WPS 打开编辑（筛选/排序/批量改数值与文案）
npm run content:import <表> <csv>   # ②（Phase B）安全回写源 TS + 自动校验 + diff 摘要
   ↓
content:check + typecheck 自动收尾 → git diff 过目 → 提交
```

新增/删除条目、改嵌套结构**不在 CSV 做**——给出 id + 草案交内容维护者代办（CSV 只改存量行）。

## 二、快速开始（导出）

```powershell
npm run content:export          # 默认输出 content-csv/
npm run content:export D:\my    # 也可输出到任意目录
```

| 文件 | 内容 | 行数(约) | 主要可改列 |
|---|---|---|---|
| skills.csv | 技能 | 62 | 名称/组/rank/描述（⟦⟧红线见下） |
| items.csv | 物品（矿/矿物/气/冰/弹药/无人机） | 29 | 体积/收购价/精炼配方/伤害基数/描述 |
| modules.csv | 装备 | 72 | 数值参数/CPU/抗性拆列/描述 |
| ships.csv | 舰船 | 19 | 血量/9 抗性列/槽位/CPU/速度/描述 |
| anomalies.csv | 敌人/悬赏 | 26 | 威胁/战术/血型/奖励/战利品/伤害权重 |
| belts.csv | 矿带 | 17 | 主产物/复合产出池/声望门槛 |
| market.csv | 市场商品 | 139 | 基准价/池参数/倍率/门槛 |

CSV 为 UTF-8 + BOM：Excel/WPS 双击即开，中文不乱码。**编辑后直接 Ctrl+S 保存即可**。

## 三、列约定（导出/导入两端一致）

- 第一列 = `id`（或 market 的 `key`）：**匹配键，只读**；改了 id = 拒绝导入；
- 数值列一律**引擎原值**：小数即小数（`0.2` = +20%，不是 20）、毫秒即毫秒、秒即秒——
  不要按"百分比习惯"填 20；表头里已注明单位与语义；
- 枚举列填**英文原值**：kind（ore/mineral/gas/ice/ammo/drone）、slot、rarity、tactic、
  defProfile、role、damageType（kinetic/explosive/plasma）等，表头括号内有中文对照；
- 嵌套结构 = 紧凑串、`|` 分隔：精炼配方 `min-tritanium×2|min-pyerite×0.6`、
  复合产出 `ore-veldspar×55|ore-scorched×30`、战利品同格式（`物品id×单位数`）；
- **空单元格 = 该字段未填**（引擎缺省生效）——不要把"0"和"空"混用，二者语义不同；
- 布尔列：是 / 否 / 空（空 = 未填 = 引擎默认，例如市场卡"可否卖出"空 = 默认可）。

## 四、编辑红线（导入时会拦，先知道少返工）

1. `id` / `key` 不可改、行不可整行删除（真删走代办）；
2. **技能描述里的 ⟦数值⟧ 必须与引擎接线乘区一致**——这是语义约束，机器拦不住：
   改动描述数值后要过"技能数值一致性"人工复核（找一号）；
3. **anomalies.csv 的威胁/伤害权重/奖励**属战斗平衡域（二号 C4 校准负责）：
   改完进 C4 复核清单，别当纯内容改；
4. 交叉引用 id（refine 的 mineralId、belt 的 oreId、loot 的 itemId…）必须指向现存条目
   ——导入器会校验引用存在性；
5. 数值范围导入器会拦（抗性 0~0.9、threat>0、CPU≥0 等），口径与 content-check 一致。

## 五、Phase B：content:import（回写，2026-09-05 已交付）

```powershell
npm run content:import <表名> <csv文件>        # 实写回源 TS
npm run content:import <表名> <csv文件> --dry-run   # 只预览计划，不写盘
```

四道护栏（任一不过 = 整体拒绝、零写入）：
1. **主键只读**：CSV 出现未知 id（新增条目）→ 拒绝；源表有而 CSV 缺失（多为"筛选视图保存"
   误删整行）→ 拒绝并列清单。新增/删除条目都走代办（给 id + 草案）；
2. **逐列校验**：数字可解析、枚举合法（表头括号内有对照）、数值范围（抗性 0~0.9、概率 0~1、
   威胁 ≥1、CPU ≥0…）、引用 id 存在（refine/产出/战利品/星系）——口径与 content-check 同源；
3. **空单元格 = 不改该字段**（只改你想改的列，其余原样）；可选字段填 **`-` = 删除该字段**；
4. **只写有差异的字段**：源里没变的格子不产生 diff（所以 Excel 保存不会"动全表"）。

回写实现 = TypeScript AST 区间级最小替换：源文件注释/分组/排版/下划线数字（12_000）都保留，
只替换你改过的那几个值；行内注释（如悬赏卡的平衡说明）原样保留。
收尾自动跑 `content:check` + core/data typecheck，打印 `git diff --stat` 摘要——检视无误再提交。

已验证场景（回归测试）：数值/字符串/枚举修改（单行最小 diff）、抗性等对象新增键与改键、
market 单行卡（数字/布尔/新增字段）、refine 多行列表修改（保多行风格）、空数组 → 填入战利品、
`-` 删除字段（整块干净移除）、坏枚举/负数/未知 id/误删行全部拦截、无差异空跑。
技能描述 ⟦数值⟧ 的改动需一号复核与引擎接线一致；anomalies 表数值改动进二号 C4 平衡复核清单。

## 六、七张表家族对照（浏览辅助）

- 装备家族 slot → 中文：miner 采矿器 / cargo 货舱扩张 / turret 动能炮台 / missile 导弹架 /
  laser 激光炮 / shield 护盾件 / armor 装甲件 / propulsion 矢量推进器 /
  drone-rack 甲板扩展 / drone-tac 战术导控 / support 支援件；
- 物理槽 rack：high 高槽 / mid 中槽 / low 低槽；
- 舰船 role：industrial 工业 / armed 武装 / armored 重装 / hauler 航运；
- 敌方 tactic：brawl 贴脸 / orbit 环绕 / kite 风筝；defProfile：shield 盾型 / armor 甲型 / balanced 均衡；
- 弹药/武器伤害系 damageType：kinetic 动能（破盾）/ explosive 高爆（拆甲）/ plasma 能量（全能）；
- 市场 rarity：common 常驻 / rare 稀有 / exotic 限定。
