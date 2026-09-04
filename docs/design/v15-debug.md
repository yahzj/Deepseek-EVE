# V15 设计：调试模式（开发工具 · 1 秒化 + 离线快进）

> 状态：**已确认**（用户 2026-09-04 确认：任何操作无需等待完成时间（按 1 秒），
> 可直接输入离线时长快进；开发工具，不影响正常玩法数值）。
> 影响包：core（时长点统一特判、战斗即时判定、存档 v15）、desktop（顶栏 ⚡ 调试面板）。

## 一、进入方式（对玩家隐藏）

- DevTools 执行 `localStorage.setItem('whale-idle:debug','1')` 后刷新 → 顶栏出现 **⚡ 调试**；
- 面板两项：**「1 秒化」开关**（即时生效，随存档 `debugQuick` 记录，离线回放一致）；
  **离线快进**（输入 分钟/小时 → 复用离线结算管线，上限 8 小时，弹离线简报）。

## 二、"1 秒化"覆盖（每处读 state.debugQuick，普通模式恒 false 零影响）

| 系统 | 处理 |
|---|---|
| 技能训练 | 队列每级固定 1 秒（engine.ts advanceSkillQueue） |
| 采矿 | 循环 1 秒（getMiningParams）、周转腿 1 秒（oneLegMs）；产量/满舱逻辑照常 |
| 制造 | 批次 1 秒（calcBuildDurationMs） |
| 星系际航行 | 单程 1 秒（travelLegMs）；展示 1 分钟（travelMinutesEff） |
| 扫描探索 | 作业固定 1 秒完成点亮（startScan） |
| 交火 | **保留实时战斗**（T11：调试器不跳过战斗——战斗需要真实验证）；去程 1 秒进战后按实时引擎推进，其余与正常一致 |
| 市场 | 刷单/价格节奏不缩短（经济时钟；用离线快进观察长线） |

## 三、实现要点

- 存档：`debugQuick: boolean`（默认 false）→ 结构版本 **v15**（MIGRATIONS[14] 补默认 + normalize 布尔化）；
- T11（2026-09-04）：取消"调试即时判定战斗"——debugQuick 下战斗仍走实时引擎（便于战斗验证）；
- desktop engine：`setDebugQuick(on)`、`debugFastForward(ms)`（快进后同步前移 savedAtWallMs，避免下次真实离线重复结算）；
- 面板在顶栏 header-right，样式独立（金色警示风格，与正式 UI 区分）。

## 四、验证

- 新增 `tests/debugQuick.test.ts`（8 例）：训练/采矿/制造/远征（航行 1s + 即时战斗 + 战报结算）/
  扫描 1 秒点亮；debugQuick=false 抽样回归；开关往返保存；v14→v15 迁移；
- 全套 18 文件 190 测试绿；typecheck ×4 绿；build 通过；隔离冒烟：克隆档迁移 v15、
  星图页零控制台错误、真实存档零接触；
- 普通模式（debugQuick=false）下所有路径与 V14 一致（时长/战斗/平衡不受影响）。
