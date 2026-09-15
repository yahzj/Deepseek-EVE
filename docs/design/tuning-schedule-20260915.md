# 限时倍率表（tuning schedule）· 工作文档

**状态：进行中**（2026-09-15 一号 · 待船长验收 → 归档时并入 roadmap / 词典 / architecture，并删除本文档）

> **船长原话（照抄）**：「**添加一个新功能，允许我快速设置在指定的现实日期之前，给特定数值调整一个倍率
> （比如残骸量，虫洞扫描周期等）。**」
> 六问六答（2026-09-15）：**① 生效范围 = 写进正式数据（全员生效）** · ② 可调面 = **白名单注册表** ·
> ③ 清单 = 残骸密度 / 稀有残骸掉率 / 稀有残骸体积 / 虫洞扫描周期 / 采矿速度 / 悬赏任务奖励 / 技能训练 ·
> ④ 时间 = **支持区间（开始可省）＋截止日期** · ⑤ 叠加 = **相乘 ＋ 界面可见** ·
> ⑥ 入口 = **数据文件**（改完重载生效），并且「同时拥有限时加成时，还会在**活动无人机的右侧**
> （扫描进度条的右侧）显示当前加成项是什么和剩余时间」。

## 一、做了什么（落码清单）

| 层 | 落点 |
|---|---|
| 表与单点 | **`packages/core/src/tuning.ts`（新）**：`TUNABLE_KNOBS`（8 个开关的白名单：名称 / 乘在哪 / 方向）· `TUNING_RULES`（规则表，**当前为空**，头注给了写法示例）· `localDayStartMs` / `ruleActiveAt` / `tuningMulAt` / **`tuningMul(state,key)`** / `activeTunings(now)` |
| 墙钟 | `state.ts` 新增**可选**字段 `wallMs?`（不落盘、不参与迁移）· `engine.ts` 的 `advanceGame` **只在显式传 `nowWallMs` 时**写入 ⇒ **工具与用例不传 ⇒ 恒 1×**（标定读数不被日历污染） |
| 读取点（8 个） | ① `salvage.wreckDensityOf`（只乘读取值）② `expedition` 派系掉落掷点 ③ `wormholeSalvage` 墓场判定掷点 ＋ 遗迹/墓场每件单位数（3 处）④ `salvaging` 打捞彩头单位数 ⑤ `wormholeAuto` 自动探索发放单位数 ⑥ `wormholeScan.wormholeScanWindowMs` ⑦ `mining.getMiningParams`（`cycleMs` 与 `unitsPerCycle`）⑧ `expedition` 悬赏结算基底 ＋ `sideTasks` 三处奖励生成（资源/快递 · 窝点 · 派系）⑨ `engine` 训练时长（4 处同一表达式） |
| 界面 | `ActivityBar.tsx`：**扫描条右侧**新增「限时加成」徽标（多条横排 · 名称 ×倍率 · 剩余时间 · 悬停写明备注与截止日），`styles.css` 新增 `.app-activitybar-tuning*`（**照 `.app-activitybar-scan` 同族复刻**：同字号/内边距/圆角，定宽 190px + 两段省略号防头部跳动）；`index.ts` 导出表与三个函数 |
| 体检 | `content:check` 新增「**限时倍率表契约**」：① 未知开关 ② 倍率必须 > 0 且有限 ③ 日期合法且 `from ≤ until` ④ **每个白名单开关都必须有读取点**（`tuningMul(state, 'key')` 至少一处）——防"登记了没接线"的静默失效 |
| 用例 | `packages/core/tests/tuning.test.ts`（12 条）：表本身 5 条（未设墙钟 = 1× · 区间边界（起始当天 00:00 / 截止当天整天 / 次日 00:00 失效）· 相乘 · 非法输入不生效 · `activeTunings` 读数）＋ **八个开关逐个"乘在正确的地方"** 7 条 |

## 二、口径与边界（写给日后）

- **时间**：`YYYY-MM-DD` 按**本地时区**解析；`from`（可省）= 当地 00:00 起生效；`until` = **当天整天仍生效**，次日 00:00 失效。
- **叠加**：同一开关多条命中 ⇒ **相乘**；未命中 ⇒ 1。
- **不落存档生效状态**：命中现算 ⇒ 活动结束无需回收、无需迁移。
- **`wreckDensity` 只乘读取值**：不改已存 `state.galaxyWrecks[g].density` ⇒ 到期自动回落，不追溯、不吐货。
- **`rareWreckRate`**：乘在两个掷点概率上并夹在 `≤ 1`（窝点/派系掉落 · 洞内墓场每 3 堆普通判定一次）。
- **`rareWreckVolume`**：乘在**发放时的单位数**上（1 件 = `RARE_WRECK_VOLUME_M3` 单位）⇒ 回收炉开箱批数随之翻倍；⚠ 物品说明里的"单件 30 m³"是**基础值文案**（活动期间不随动）。
- **`skillTrainMs`**：技能系统**没有经验点**（按时长训练）⇒ 口径取训练时长倍数（×0.5 = 练得更快）。
- **工具/用例免疫**：不传 `nowWallMs` ⇒ `state.wallMs` 保持 undefined ⇒ 所有开关 1×（`battle:calibrate` / `wormhole:econ` / `balance` 等标定读数不受日历影响）。

## 三、验证

- typecheck 四包 0 错 · core 全量用例（含新增 12 条）· `content:check` ✅（含新契约）· `ui:rot-check` ✅ · 桌面＋网页 build ✅。
- 负向验证：**摘掉任一开关的读取点** ⇒ 体检「限时倍率表契约」点名该开关；**去掉区间上界判断** ⇒ 区间边界用例红。

## 四、怎么用（船长操作）

在 `packages/core/src/tuning.ts` 的 `TUNING_RULES` 里加一行，重载即生效：

```ts
export const TUNING_RULES: readonly TuningRule[] = [
  { key: 'wreckDensity', mul: 2, from: '2026-09-20', until: '2026-09-22', note: '周末双倍残骸' },
  { key: 'wormholeScanMs', mul: 0.5, until: '2026-09-30', note: '虫洞扫描加速' },
]
```

## 五、待裁决 / 未做

1. **公告**：本功能是"全员生效"的限时活动载体 ⇒ 要不要发一条「限时活动」公告（待审稿可随时补写）；已上线公告一字未动。
2. **未接入的候选**（第一版没做，等你点头再加）：精炼产出 · 市场价（有价格权威契约）· 战斗伤害/血量（会污染标定读数）· 虫洞威胁/回合。
3. **展示口径**：`rewardIsk` 目前**结算与任务生成**吃倍率；悬赏**卡面**的奖金显示仍读原始 `rewardIsk`（界面另有"限时加成"徽标解释差异）——若你要卡面也×倍率，我按同一单点接。
4. 表放 **core**（`packages/core/src/tuning.ts`）而非 data：读取点全在 core，而 core 不能反向 import data（`balance.ts` 是同款先例）。
