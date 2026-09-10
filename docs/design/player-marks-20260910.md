# 玩家标记（收藏）· 默认排序置顶（状态：已确认，2026-09-10 船长拍板；一号实现）

> 2026-09-10 船长需求：允许玩家给这些打标记（收藏），被标记项在列表内置顶；
> 有排序键的列表只在**默认排序**下置顶。船长确认可标记范围：
> 市场商品行（「订单」）、精炼炉卡片与组装机卡片、舰船（舰队卡）。
> 纯偏好功能：不改数值、不改经济、不影响任何自动作业。

## 1. 可标记范围（四处）

| 界面 | 标记键（kind） | id 口径 |
| --- | --- | --- |
| 市场页商品行（常驻 / 稀有 / 搜索结果同一套行） | `goods` | 市场商品 key（`ctx.marketGoods` 键） |
| 精炼炉卡 + 残骸回收卡（工业页「精炼炉」标签） | `recipes` | 可精炼资源 / 可回收残骸的物品 id（`ctx.items` 键） |
| 组装机蓝图卡（含舰船蓝图） | `blueprints` | 蓝图 id（装备/弹药蓝图 + 舰船蓝图） |
| 舰队船卡（舰船页「我的舰队」） | `ships` | 船**实例** id（`state.fleet` 键；同型多艘各自独立） |

不在本次范围（船长未纳入；如需再加）：蓝图书架（书架上持有的蓝图书）、舰船页「空间站商店」在售舰船、
物品仓库 / 货仓、技能页、市场「我的挂单」。

## 2. 交互

- 星标按钮 `MarkStar`（`apps/desktop/src/renderer/src/ui/marks.tsx`）**常驻显示在同一位置**：
  未标记 = 暗色空心星，已标记 = 金色实心星（`ico-star` 线稿 + CSS 填色）；
- 位置：市场行 = 名称行行首（每行都有，故名称列对齐、无布局跳动）；精炼/回收卡与组装机卡 = 卡头右侧分组
  （`.app-belt-head-right`，与 `.app-ship-top-right` 同款）；舰队船卡 = `app-ship-top-right` 按钮组首位；
- 点击切换（`engine.toggleMarkAt`）；`stopPropagation` + `preventDefault` + `keydown` 拦截，
  不触发所在行/卡的既有行为（市场行选中、舰船卡按钮组、组装机卡按钮）；
- 悬停提示「标记（收藏）：默认排序下置顶 / 已标记：默认排序下置顶（点击取消）」；
- **不写游戏日志**（打标记是高频界面操作，写日志会刷屏；船长 2026-09-10 确认）。

## 3. 置顶口径

- 只在**默认排序**下置顶；组内保持原有相对顺序（前面插一段，其余项不重排）。
- 市场：常驻栏（有货冒泡上浮）、稀有订单栏（有货奇货优先）、搜索结果三处都是默认口径 → 都置顶。
- 组装机：类型标签是筛选而非排序键 → 各标签下都置顶；「全部」标签下已标记蓝图会排在
  「装备→舰船→弹药」类型分组之前（船长已知悉该口径）。
- 舰队：排序下拉选「默认排序」时置顶；选「按名称 / 耐久 / 舰族」时**不置顶**（严格按该键排序）。

## 4. 存档（零迁移，v24 不升版本号）

- `GameState.marks: MarksState` = `{ goods: string[]; recipes: string[]; blueprints: string[]; ships: string[] }`
  （声明在 `GameStateV16` 的兼容字段区，与 `shipLocks / shipReturns` 同族）；
- 老档缺字段 → 读入补四类空表（`normalizeState` 白名单重建，防 `slowDrawLastGameMs` 那类字段被丢）；
- 读档剪枝 `pruneMarks`：只收非空字符串、去重；**舰船标记只保留仍在舰队里的实例**
  （卖船 / 战损后自动失效）；商品/资源/蓝图的目录校验由界面与写入指令负责（遗留旧 id 无害）；
- 写入指令 `toggleMark` 校验目标可解析（`markTargetExists`），非法 id 拒绝并返回错误文案。

## 5. 涉及文件

- core 新增：`packages/core/src/marks.ts`（`MarkKind / markedIds / isMarked / markTargetExists /
  toggleMark / clearMarks / pruneMarks / MARK_KIND_TEXT`）、`packages/core/tests/marks.test.ts`（8 项）；
- core 改动：`state.ts`（`MarksState` + 字段 + 新档空表）、`save.ts`（白名单重建 + 末尾 `pruneMarks`）、
  `index.ts`（导出）；
- renderer 新增：`apps/desktop/src/renderer/src/ui/marks.tsx`（`MarkStar` + `pinMarked`，
  检索标签 `data-ui-group="mark-star"`）；
- renderer 改动：`ui/Glyphs.tsx`（`ico-star` 线稿 + 色调）、`game/engine.ts`（`toggleMarkAt`）、
  `pages/MarketPage.tsx`、`pages/IndustryPage.tsx`、`panels/Industry.tsx`、`pages/ShipPage.tsx`、
  `styles.css`（`.app-mark-btn` / `.app-belt-head-right`）。

## 6. 验证

- `npm run typecheck`（core/data/ui/desktop 全绿）；
- `npm run test -w @whale/core`：629 passed（新增标记测试：切换幂等 / 四类互不串类 / 非法 id 拒绝 /
  可标记目标判定 / 存档往返 / 老档空默认 / 剪枝 / 卖船失效）；
- 真实目录探针（临时 `_` 前缀脚本，已删）：真商品键 / 真精炼资源 / 真装备与舰船蓝图 / 真船实例
  全部可标记，假 id 全部拒绝，存档往返一致，老档补空表；
- `npm run content:check` 通过；`npm run build -w @whale/desktop` 绿；
- 推送闸门：只本地 commit，未推送 origin。

## 7. 待船长验收 / 可选后续

- 舰船页「空间站商店」在售舰船、蓝图书架、技能页是否也要标记（当前未纳入）；
- 是否需要「取消全部标记」入口（core 已备 `clearMarks` 指令面，UI 未接）；
- 是否要单发一条玩家公告（本功能属便利项，公告稿待船长定后再出）。
