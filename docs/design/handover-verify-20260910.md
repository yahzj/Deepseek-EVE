# 三号工作区（verify） · 收尾归档与续接卡（2026-09-10）
> **2026-09-11 状态标注（一号补）**：§5 第 1 条（公告 11 张）与第 2 条（`FACTION_RARE_DROP_CHANCE`）**已结**；第 3 条「点防 PD 六参数」**已收口于 `docs/design/drone-losses-20260910.md` §6.1**；§0 基线（1dd743d）与未推送数已过期。


> 用途：本文件是**三号（`Deepseek-EVE-verify` 工作区）2026-09-10 会话的收尾归档**——接手人
> （一号/二号/新助手）读这一份即可知道"改了什么、验证到哪、还有什么没做、旋钮在哪"。
> 更细的口径一律看 `docs/design/` 对应设计稿、`docs/roadmap.md` 同日条目与 `docs/glossary.md`；
> 本文件不重复承载权威细则。
>
> **船长在收尾时明确：「机制保留」**——指组装机「循环制造」的卡片级机制与悬赏 `loot` 字段/结算链路
> **都保留**，只清数据与改界面，不删字段、不删分支（详见第 1 节相关两行）。
>
> **给继任三号的交接 brief = `docs/design/handover-d3-20260910.md`**（工位/铁律/接手事项/口径备忘/验证法/踩坑/检查单）；
> 项目级入口 = 一号的 `docs/design/handoff-20260910-session-turnover.md`。本文件是**逐批细节的归档**。

## 0. 状态一句话

**verify = main = `1dd743d`**；两个工作区（verify / d2）都无未提交改动
（main 树在归档写作时有一号的一次性测试档改动，属其批次，与本工作区无关）；
全部验证绿灯（typecheck ×4 / core **785** / content:check / desktop build）；
**本地未推送 123 个提交**（推送闸门：待船长验收 + 公告批准后，代码与公告一起推一次）；
仓库内**无 `_` 临时探针残留**（本会话所有探针用完即删，见第 7 节）。

## 1. 本会话在 verify 交付的批次（按时间）

| 批次 | commit | 一句话 |
|---|---|---|
| 我的舰队卡片左侧舰影列 | `045b3de` | 每艘船的舰影放卡片最左；`ResizeObserver` 量**列表实宽**，<702px 整列不渲染 |
| AI 指挥中心工作动画 | `5192f85` `017b79e` | 「执行中」每行按工作内容差分（6 类，56×36 SVG 槽位，`memo` 化；只动 transform/opacity） |
| 物品页/货仓行首图标 | `d281c43` | 列表模式名字前加图鉴同款行首图标；`RowGlyph` 上移为**共用唯一实现**（`ui/itemView.tsx`） |
| 手册改版与排版 | `6b3b4d0` `10938e2` `81dba16` | 顶部标签 → 侧边导航 + 图鉴分组与搜索；修分组压扁；玩法速览改每条一张卡 |
| 精炼炉/组装机卡图标 | `8803eb5` | 卡牌名字前同款小图标；补齐 5 个缺失图标键；`content:check` 新增**图标覆盖契约** |
| AI 核心调度学 LV6 排查 | `68a02f3` | 结论 = 引擎到不了 Lv6、是技能页按钮文案越限；修文案 + 两道纵深防御 + 契约测试 |
| 补 rank5 训练档底 | `17ac4da` | `RANK_BASE_MS[5]=742_000`（调度学满级 ≈89.7h）+ 「阶梯严格递增」契约测试 |
| 市场按槽位分档 | `3930bf6` | 移除「装备」类型 → 高/中/低槽装备三类型；蓝图子类按**产物槽类**；商品行改显示**自己的库存** |
| 界面宇宙背景 | `50bb453` `bb5ccbc` | 32 张无缝星图转 JPEG(q85)、启动随机抽一张平铺；设置里可「换一张」 |
| 背景可见性校准 | `703f492` `8afa5d3` | 面板 alpha 0.88 + 蒙层 0.55 + 顶栏同档（**排除战场**） |
| 机群战损表现层对接 | `665992f` | 二号设计稿 §九 派给三号的两项：击落原位小爆炸 + 战报「机群损失」行；连带修 `droneDown` 误画弹道 |
| 维修装置消耗高亮 | `d27d36e` | 模块详情「运转消耗」琥珀 chip + 装配页「维修组件（运转消耗）」行（含库存告警） |
| 驾驶状态窗采掘/打捞动画 | `065e8fe` `2f45dab` | 采掘激光打矿岩 / 打捞牵引光束 + 扫描弧；整窗统一到工作色；采集对象与舰体同周期浮动 |
| 活动窗 AI 徽标拆两枚 | `603e119` | 「副船 ×N」（粉）+「工业 ×N」（薄荷），各自跳转；数字取 core 单点 |
| 星图显示赏金任务 | `e9c0d84` | 已探索星系挂 `⚑N` + 行动窗任务行（节点倒计时后由一号收敛为仅弹窗） |
| 星图显示敌对派系活跃 | `588e0a5` | `✦` 徽标 + 行动窗说明行（后由一号改红 + 方框 + 全称） |
| 收尾与交接备注 | `588e0a5` `c13825e` | roadmap 收尾条目 + 公告待审稿 9 卡 |
| 组装机「循环制造」上移卡片级 | `b7676d8` | 开关/目标件数/本轮合计挂到**整张生产卡**（含主控线、新线自动继承）；老档逐线字段一次性归并 |
| 星图派系标记对齐 + 闪缩 + 烬火星区右移 | `11bf605` | ✦ 与全称标签**横向永远居中**、冲突改上抬；红方框/红圆点 1.6s 缩放脉动；`galaxy-cinder` x 560→600 |
| 蜃影星系下移 12 | `22d4c8d` | 让开「碎晶带→烬火星区」航线（圆心垂距 1.6 → 13.0） |
| 移除全部常驻悬赏附赠 | `5294839` | 26 张悬赏卡 `loot` 一律清空（20 张由非空清空）；**机制保留**，两处卡面文案改写 |
| 归档与续接 | 本条 | 本文件 + roadmap 收尾条目 |

> 会话更早的批次见 `docs/roadmap.md` 同日条目（各有设计稿）；一号/二号的批次见
> `docs/design/handover-d2-20260910.md` 与各自 commit。

## 2. 验证快照（最后一次全跑，2026-09-10 深夜，合并一号+二号新提交后）

| 命令 | 结果 |
|---|---|
| `npm run typecheck` | 4 个 workspace 全绿 |
| `npm run test -w @whale/core` | **785 通过 / 0 失败**（81 个测试文件） |
| `npm run content:check` | 通过（含图标覆盖契约、敌方混伤契约等新增护栏行） |
| `npm run build -w @whale/desktop` | 成功（产物核对：悬赏 `loot: []` ×26、非空 0、旧文案 0 处） |

本会话新增/改写的回归：`manufacturing.test.ts`（旧 5 项逐线用例改写为 5 项卡片级）、
`save.test.ts`（+2 老档归并）、`skill-level-cap.test.ts`（4）、`training.test.ts`（阶梯契约）、
`drone-anim.test.ts`（+1 droneDown 契约）；**负向验证**两处：去掉循环制造成本守卫 →
5 项/4 项如实失败。

## 3. 本会话引入的能力与契约（接手人先看这一节）

**state / core 新字段**
- `state.manufacturingLoops[blueprintId] = { on, goal?, produced?, stopWhy? }`（`ManufacturingLoopState`）：
  组装机**卡片级**循环制造配置——`GameStateV24` 追加、**无版本号变化**；老档逐线
  `autoRepeat/repeatGoal/produced` 读档时一次性归并（`on` = 任一为真、`produced` = 各线之和、
  只要有任一条线「无目标」→ 卡片也无目标），归并后逐线字段不再写回。逐线三位现为**兼容只读**。
- `ManufacturingView`：`autoRepeat/repeatGoal/produced` → **`loopOn/loopGoal/loopProduced`**（语义 = 该卡）。
- `manufacturingLoopOf(state, blueprintId)`：卡片循环配置的只读视图（界面统一入口）。
- `setManufacturingLoop(state, blueprintId, on, goal)`：**签名由线号改为蓝图 id**（桌面引擎
  `setManufacturingLoopAt(blueprintId, on, goal)`）；「关→开」= 新一批（`produced`/`stopWhy` 清零）。

**界面/表现层共用件（复用处）**
- `ui/itemView.tsx`：`RowGlyph` / `ItemViewBar` / `ItemGlyphGrid` / `kindExtraNote` / `useItemView`
  （图鉴、仓库、货仓、精炼炉卡、组装机卡同一实现；键口径 = 物品 `kind` / 装备 `slot` / 舰船族 / 蓝图）。
- `ui/itemSubs.ts`：`MODULE_SUBS`（9 组功能子类）/ `MODULE_SUB_SLOTS` / `BLUEPRINT_SUBS`（高·中·低槽装备蓝图 + 舰船 + 补给）/
  `RACK_KIND_KEYS = ['module-high','module-mid','module-low']` / `moduleSubKeyOf` / `subPasses`。
- `ui/spaceBg.ts`：`applySpaceBg` / `rerollSpaceBg` / `currentSpaceBg`（32 张 `assets/space/*.jpg`，`import.meta.glob`）。
- `ui/aiWorkFx.tsx`：`AiWorkKind` = mining/salvage/standby/refine/reclaim/craft，`AiWorkFx` 组件（56×36）。
- `ui/shipMounts.ts`：`mountsOf(shipId, foeKey)` 引擎喷口/炮口锚点（战场与状态窗共用）。
- 星图：`bandClear`（包围带公共判定）+ `stackDx`（徽标横向避让，⚑ 任务徽标用）+
  `factionDy` / `FACTION_HALF_W` / `FACTION_MARK_TOP` / `FACTION_DY_TRIES`（派系标记**居中 + 上抬**避让）。

**content:check 新增护栏**
- **图标覆盖契约**：物品 9 类 + 槽位 14 个 + 船族 4 个 + 蓝图，缺图形或缺色调即失败。

**样式契约（约定第十四章）**
- 新动画只动 `transform` / `opacity`；SVG 元素缩放必须显式
  `transform-box: fill-box; transform-origin: center`（否则绕用户坐标原点飞出去）。

## 4. 可调旋钮（值都写在代码注释里，改一处即生效）

| 想调什么 | 改哪里 |
|---|---|
| 底图蒙层浓度 / 面板与顶栏透明档 | `styles.css` `.app-root` 蒙层 0.55；`packages/ui/src/index.css` `.wui-panel` 0.88；`.app-header` 0.88 |
| 底图张数与换图行为 | `ui/spaceBg.ts`（`rerollSpaceBg` 排除当前下标）；图源 `docs/Small 512x512/`、包内 `assets/space/*.jpg` |
| AI 工作动画（6 类） | `ui/aiWorkFx.tsx`；槽位尺寸/配色 `.app-inv-fx` / `.app-aifx-*` |
| 状态窗工作色与浮动 | `ShipStatusWin.tsx` `WORK_ACCENT`（采掘 `#b5e35f` / 打捞 `#6fe3f0`）；`.app-swin-float` 周期 2.4s·−2.5px |
| 舰队卡舰影列 | `ShipPage.tsx` `FLEET_ART_W=132 / FLEET_ART_GAP=10 / FLEET_MAIN_MIN=560`（实宽 <702px 隐藏） |
| 星图徽标配色与避让 | `styles.css` `.app-map-bounty`（⚔ 金）/`.is-task`（`#8fa9d8`）/`.is-faction`（`#ff6a5e`）；`Expedition.tsx` `STACK_DX_TRIES` 与 `FACTION_DY_TRIES` |
| 派系标记闪缩节奏 | `styles.css` `@keyframes app-map-faction-pulse`（1.6s、scale 0.85、亮度 0.55） |
| 星图坐标 | `packages/data/src/universe.ts`（烬火星区 x=600、蜃影星系 y=127，均就地注明原因） |
| 循环制造（卡片级） | `manufacturing.ts`（停线口径/结账逻辑）；控制条样式 `.app-belt-loop`（`min-height: 24px`） |
| 悬赏附赠（当前全空） | `packages/data/src/anomalies.ts` 每卡 `loot`；结算链路 `expedition.ts` / `ai.ts` / 卡面 `Expedition.tsx` 未动 |
| 击落演出残留时长 | `battleViewCore.tsx` `DRONE_DOWN_LIFE=760` |
| 训练档阶梯 | `training.ts` `RANK_BASE_MS`（rank5 = 742_000 秒/级档底） |

## 5. 待船长决策（卡在这里，不决策就不动）

1. **公告**：`docs/design/announcement-draft-20260910-pending.md` 现有 **11 张卡**待批
   （我拟的 9 张 + 一号补的 2 张）。其中第 8 卡「驾驶状态窗的采掘与打捞」与已发布的
   `2026-09-10-ship-visuals`（「驾驶舰船有了状态窗…」）**主题相邻**，发布前建议合并或改写口径。
   本会话最新的三批（循环制造上卡片级 / 星图派系标记对齐与闪缩 / 移除常驻悬赏附赠）
   **尚未起草公告**——按约定开发/机制调整类可不发，**需要发我就补卡**。
2. **`FACTION_RARE_DROP_CHANCE`**：一号已改为 10% ×1 件，`content:check` 仍打印"待船长核定"。
3. **点防 PD 六参数**：**已收口于 `docs/design/drone-losses-20260910.md` §6.1**（原写"二号设计稿 §八"是失效引用），待船长一句"维持现值 / 改数"。
4. **星图两处残留贴线**（既有情况，非本次引入）：烬火星区→红环航道 距暗星坟场 11.5、
   柯尔边境→星髓迷宫 距灯塔长廊 3.1（<14 = 视觉上贴得很近）；要收拾的话我再动坐标。

## 6. 未完成 / 移交事项

- **星图布局本地覆盖**：`posOf` 会优先读 localStorage `whale-idle:starmap-layout-v2`——
  若你本机存过布局覆盖且含本次改动的星系，**内置坐标改了也看不出变化**（需清覆盖或拖一下）。
- **循环制造的旧档**：老档归并只在**读档时**发生一次；若你手上还有带逐线循环的档，读入后
  卡片上会显示合并后的开关与合计（不是 bug）。
- **`loot` 机制虽保留但现在无卡使用**：`重复清剿` 的「货仓放不下缴获」判定因此**永远不会触发**
  （其余停机条件不变）；手册那句按船长指示**保留原文**。
- **main 树**：归档写作时有一号的一次性测试档改动（`docs/test-saves/*`、`tools/make-test-save.ts`），
  属其批次，与本工作区无关；我方 verify 与 d2 树干净。
- **未推送**：本地领先 origin **123 个提交**（闸门：验收 + 公告批准后一起推）。

## 7. 风险与注意事项（踩过的坑，都是本会话真实踩到的）

- **绝不用 PowerShell 改仓库文本**：本会话两次被 `Set-Content`/`-replace` 把中文注释写成乱码
  （一次在 `ActivityBar.tsx`、一次在临时探针里）。仓库内文本一律走编辑工具；一次性批处理
  脚本用 Node（`fs.readFileSync/writeFileSync` + `utf8`）写到 `%TEMP%` 再跑，跑完删。
- **PS 5.1 的 `Select-String` 中文检索会假阴性**：查中文一律用仓库 grep 工具或 `read`；
  控制台里看到中文乱码通常只是渲染问题，用 `read` 复核文件内容为准。
- **`docs/roadmap.md` 是最高频冲突点**：三位 agent 都往顶部插条目。解冲突口径 = **两条并存**
  （我的条目 + 对方条目都留），解完必须 `git add` 后再 `commit`（否则合并提交漏内容）。
- **合并前先看对方树脏不脏**：git 会拒绝覆写对方未提交的文件 → **停手报告，绝不 force**；
  本会话三次合入都是等对方提交后再 ff。
- **"宽窄"要与实际布局量对齐，不要按窗口宽猜**：舰队舰影列与组装机行宽都因网格
  （`minmax(240px, 1fr)`）而与窗口宽**不严格相关**——这就是"屏幕过窄时隐藏进度条"方案被否的原因；
  结论：**量实宽**（`clientWidth` + `ResizeObserver`）或**用容器/坐标几何判定**。
- **改坐标要连带动线**：星图移动星系后要复算"航线是否穿过别的星点"与"徽标带是否撞邻居"
  （本会话的探针就是干这个的；移动前后逐条对比，别只看目标那一条）。
- **`_` 探针的处置**：本会话用过的探针（`_probe-mapfaction.ts` / `_probe-mirage2.ts` /
  `_probe-loot.ts`）全部**用完即删**；几何结论已写进 roadmap 条目与数据注释，不必留脚本。
