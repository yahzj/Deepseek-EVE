# T9 副空间站 + 通讯对话系统（状态：已确认）

> 来源：船长测试反馈单 T9（roadmap 置顶，批次 B·大系统；原列于 T10 前，船长调整为 T10 之后实施）。
> 2026-09-04 问答确认（Q1甲/Q2甲+乙/Q3甲/Q4甲/D1甲/D2 通讯器样式/D3甲）。
> 关联：docs/design/t8-galaxy-stay.md（station seam）、t10-task-center.md（建站族承接）。

## 确认口径
- Q1甲 建成后副站能力 = 卸货入仓库 / 维修 / 补给（弹药、修理组件）/ 换驾驶；星图迷雾视角与
  "返航空间站"覆盖副站；采矿返航目标 = 离矿带最近空间站（母港 ⊕ 已建成副站）。
- Q2甲+乙：任务中心「建站族」任务卡（状态/档位进度/提交/通讯重看）+ **首次抵达星系自动弹出建站提示**。
- Q3甲 三档分批、边交边生效（奠基=停靠卸货 → 完善=维修补给 → 建成=换驾驶+并入空间站清单）。
- Q4甲 缴交主体 = 该星系常见产出（红环=希莫非特/灼烧岩；烬火=蓝霜冰），总量按"正常采集 2~4 小时"基调
  （草案：红环 2000/4000/2000；烬火 2500/5000/2500 单位）。
- 对话系统（D1甲 通用剧本框架 / D2 通讯器样式：一次性全文呈现 + 逐句镜像右侧事件日志 / D3甲 已读不重播、
  任务卡可重看）。建成瞬间自动播放庆贺剧本。

## 实现
- data：`stations.ts`（2 站点 + 分档 + acceptItemIds + 剧本引用）、`dialogues.ts`（4 段剧本）；
  core：`types.ts`（StationSiteDef/StationTierDef/DialogueScriptDef 等 + SimContext.stations）、
  `state.ts/save.ts`（v16.1 兼容：stationSites/dockedSite/dialogueSeen/pendingDialogue）、
  `station.ts`（交付扣减（仓库+货仓）、档位推进、抵达挂点：stage≥1 停靠副站否则野外工地、
  通讯挂起）、`location.ts`（stationGalaxyIds=母港⊕建成站、nearestStationGalaxyId、
  dockedSite 停靠模型、transit 到站按目标设停靠）、`mining.ts`+`ai.ts`（自动循环往返目标=最近站）、
  `explore.ts/expedition.ts`（完成停留→onArriveAtGalaxy 挂点）；
- renderer：任务中心建站族卡（提交面板：选料/数量/可用量；停靠判定）、通讯器浮层（App 待播自动弹出 +
  卡内重看）、活动栏停靠文案、CargoPage（出售仅母港、卸货任意站）、styles。
- 测试：`t9.test.ts` 7 组（交付/档位/建成并入与最近站解析/抵达挂点两态/通讯镜像与已读/存档容错）。
- 换驾驶在任何空间站可用（舰队=随行船队模型，船长确认 ②）；母港独有：市场/制造台。

## 数值校准说明
- 档位数值 = 12s/轮 × 10 单位 × ~75% 有效率折算草案（船长确认基调）；三策略 balance 仿真不含副站
  采集段，交付报告以本口径 + 需要时可一次性脚本复核该星系采矿节奏微调终值（不影响已确认基调）。

## 验证
- core 244/244 绿；typecheck 全绿；build 通过；
- Electron CDP：任务中心出现建站族 + 2 张站点卡、通讯记录可打开/关闭通讯器（0 异常）。
