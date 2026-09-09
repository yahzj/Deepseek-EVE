# 一号会话交接卡（2026-09-09 DSH 环境再次出问题；交给新继承人）

> 用途：DSH 环境仍不稳定（此前已重装过一次，见 docs/design/handoff-20260909-dsh-reinstall.md），
> 本卡固化"大鲸鱼一号"全部在途状态。新继承人开工：先读 AGENTS.md →
> docs/development-conventions.md → 本卡 → docs/roadmap.md 开放项 → 相关 design → 代码现状，再动代码。
> 本卡内容消化后删除（参照先例：内容迁 docs/roadmap.md 后删）。

> **⚠️ 状态更新（2026-09-09 16:50，本卡作者会话追加）：** ①「待拍板 #1 导入处置」已由
> 船长拍板"删除护栏，导入表格数据"并由并行一号实例执行 = 提交 19147ce（工作簿 items 导入
> 100 单位/批分级档回写 14 条、content-check 精炼净率护栏删除、文档同步，校验全绿）；
> ②O9 审核表 v1 已出 = docs/design/blueprint-buildtime-audit-20260909.md（提交 294f59a）；
> ③**O9 商讨收口（船长拍板）：修理组件两线/民用级装备档/弹药三线全部维持现状、零改动**，
> 审核表状态改"已商讨收口"，roadmap O9 已标 ✅——新继承人勿再推进 O9 数值；
> ④工作簿导入即终态，勿再执行任何 content:import items 回写（会与 HEAD 无差异或误覆盖）；
> ⑤余下开放项照本卡 §三 3/4/5 与 roadmap（O1–O4/O6、舰船 buildSeconds 另议未立项、延后备忘）。

## 一、仓库与基线事实（2026-09-09 16:26 核对）

- 主树 `H:\大鲸鱼\Deepseek-EVE`（分支 main，一号/船长独占）：HEAD = **15c03f6**；工作树**干净**。
- `origin/main` = dc2e08d；本地 main **领先 11 笔未推送**（36f5bd8..15c03f6，清单见下）；推送闸门 = 船长统一验收后与并行会话协调推送。
- 未推送清单（含并行会话笔，**勿代推**）：
  - 36f5bd8 Merge 'main' into d2/workspace（二号基线）
  - 670c026 巡洋价位定档 9/11/13/15M + 王鲭声望 6→10 + 鲸王补 11（二号；**6148f0d = 同批"重放"提交**——巡洋价格是否真拍板需船长确认）
  - ef9c895 三号：舰船战斗图形·敌族草稿 A~G 全主形（进行中）
  - 292c701 清理 tools/_reapply.cjs（并行遗留未确认草稿，不执行）
  - 0ff7dbc 收尾记录：roadmap 变更记录 + O8/O9 登记 + AI 扩容设计稿 §六
  - 738e1d9 **O8 精炼炉运转分档校准**（船长批准四档矿船桶；14 配方批量/周期：富凡/灼烧 20/24s；希莫/辉云/曦棱/氖云/蓝霜 18/11s；磷光/离子/极光/寒髓 34/10s；玄晶/星幽 58/8s；暗星冰 42/5.8s——58/8s 时净率 135.9% 超护栏故取 42/5.8s=132.7%）
  - 14991a8 工业页跳星图（炉/回收卡「去矿带/去打捞」按钮 + is-goto 高亮）
  - d1238db 组装机连续生产（线行「循环」开关 + 目标件数；autoRepeat/repeatGoal/produced 零迁移）
  - 2ef4de1 旧临时交接卡（残骸 Bug 挂起）——**已被 15c03f6 清理**
  - 15c03f6 清理：残骸跨星系 Bug 关闭 + 自查结论/延后议题迁 roadmap + 删除旧卡
- 验证基线（本会话实跑）：core 测试 **555/555 绿** + typecheck ×4 绿 + content:check 绿。
- 一号批次公告：船长已答**不需要**。

## 二、本会话（原一号继承人）已完成

1. **残骸跨星系 Bug = 关闭**：向船长要现场三要素后，船长答复"没事了，看错了"（误报），零代码改动。
   引擎自查结论与五项未排点（encounter hidden 路径/仓库旧残骸残留/敌群重名/残骸收购卡展示口径/anomalies 人读核对）
   已迁移 docs/roadmap.md 变更记录；临时卡 handoff-20260909-salvage-bug.md 已删（提交 15c03f6）。
2. 基线验证全绿（上节）。
3. 发现并还原了内容工作簿导入问题（见下 #1，工作树已还原零残留）。

## 三、未完成 / 待船长决策（按优先级）

1. **【待拍板 #1：content-csv 工作簿导入处置】（重要——上一会话在此被打断，未获答复，勿假设结论）**
   - 船长指示（上一会话原话）："我已经审核完毕 content-csv 内的表格，导入后开始进 O9，并商讨"。
   - 但核对发现：`content-csv/content-workbench.xlsx`（items sheet，mtime **2026-09-09 15:03:44**）**早于 O8 提交 738e1d9**，
     内容 = O8 校准**前**的旧批量/周期表（14 行全部 refineBatchUnits=100 + refineCycleMs 10_000~60_000），
     并非曾以为的"已含 O8 新参数"（导出后未重导；文件 15:03 后无保存痕迹，船长若在 Excel 改过会更新 mtime）。
   - 试导入后果（**已 git checkout 还原**，勿重复）：14 行全被改回旧表 = 整体回退船长已批准的 O8 四档桶；
     content:check **3 行超护栏**：ore-nebulite 136.5% / gas-aurora 136.2% / ice-darkstar 137.4%（护栏 ≤135%，目标 ≈+20%）。
   - 待船长三选一拍板：
     - a.（推荐）先 `npm run content:export items content-csv/content-workbench.xlsx` 重导当前 O8 定稿表入工作簿 →
       再导入（结果与代码零差异）+ content:check/core/typecheck 绿 → 进 O9；
     - b. 船长确要工作簿旧表（100 单位/批）→ 需另拍板 3 行超护栏处置（放宽护栏 or 部分保留 O8 数值）；
     - c. 船长先自行打开工作簿确认真实内容再定。
   - 附：O8 四档桶本身 = 船长 2026-09-09 已批准并提交（738e1d9，校验全绿），HEAD 现状即 O8。
   - ⚠️ 工具实测提醒：`npm run content:import items <file> --dry-run` 的 `--dry-run` **不会传给工具**（npm 吞掉 `-` 开头参数，命令回显无该参数即会真实回写）；
     要传标志须用 `npm run content:import -- items <file> --dry-run`；跑导入前确保工作树干净便于还原。
2. **O9 蓝图非舰船耗时单独审核**（roadmap 已登记，方向已确认；船长原话"导入后开始进 O9，并商讨"）：
   交付物 = 组装机/装备/模块等蓝图 buildSeconds 审核表 + 校准建议，**出表给船长商讨**；舰船 buildSeconds 不在内（另议）。
3. O1 组装机卡「手动 vs AI」两档净/h（现单一手动口径，待船长拍板）；O2 奇货卖出侧溢价巡游（卖出侧未随 20L 收口，先问口径）；
   O3 balance-check 24h 策略复跑（工业扩容后未复跑，范围先问船长）；O4 顶部 AI 徽标计数与「执行中 N」偏差（早期反馈，根因未实证）。
4. **O6 二号船分级批次验收（已在 main，涉二号分工，一号只读）**：公告待审稿 6b79a61（id 2026-09-09-ship-size-tier）
   未经船长批准不得写入 announcements.ts；巡洋 T3 数值/渠道声望待船长终审（只读 docs/design/ship-size-tier-rework.md）。
5. 备忘：**精炼净收益差异问题 = 船长延后**（已迁 roadmap；差异 = 吞吐桶 ×8.7 × 矿价 ×37.7 ≈ 卖原矿差 328×，
   精炼净再 ×净率差；重开先回看 docs/design/refine-cycles.md 头注与 content-csv items sheet）。
6. 推送闸门：本地 main 领先 origin 11 笔未推送；等船长统一验收后与二号/三号并行会话协调推送一次。

## 四、验证命令速查

- `npm run test -w @whale/core`（现 555 绿）；`npm run typecheck`（core/data/ui/desktop ×4 绿）；`npm run content:check`（绿；含精炼护栏 ≤135%）。
- `npm run content:export items content-csv/content-workbench.xlsx`（导出工作簿）；导入见三.1 ⚠️ 提醒。
- 数值类工具：`npm run balance` / `npm run manufacture:econ` / `npm run salvage:econ` / `npm run bounty:econ`。
- 门槛档：`npx tsx tools/make-test-save.ts <case>`（清单在脚本头注释；存档落 docs/test-saves/，命名 `test-save-<feature>-<stamp>.json`）。

## 五、恢复步骤（新会话/新继承人）

1. 读 AGENTS.md + development-conventions.md + 本卡 + roadmap.md（开放项段"待办照旧先读本段"）→ 相关 design → 代码现状；
2. `git status` 核对干净；`git log origin/main..HEAD --oneline` 认领本地未推送清单（11 笔，勿代推）；
3. 先请船长拍板「三.1 导入处置」→ 按拍板执行（推荐 a：重导 → 导回 → 校验绿）→ 再开始 O9；
4. O9 出审核表给船长（方向已确认可直接做表；数值决策等船长，不擅自改数值）；
5. 其余按 roadmap 开放项（O1–O4/O6）与船长新指令推进；所有决策走四步闸门（提问 → 总结 → 明确确认 → 实现落 docs/design）；
6. 本卡消化后删除，内容要点（若有仍开放项）迁 docs/roadmap.md。

## 六、术语提醒（快速对照，权威 = docs/glossary.md）

- 精炼术语：**产出倍率**（非"收率"）；content-check 护栏 = 120% 倍率下每批净率 115%~135%（目标 ≈+20%）。
- 行程/战斗：**重复清剿**（旧称"连续出击/巡回讨伐"作废）；任务完成即返航（2×单程不可召回）；自动返航落点 = 最近已建成站。
- 残骸：回收卡名 = 「{敌群名}残骸」；计数 = m³；星图打捞卡按星系聚合、工业页回收卡按敌群注册。
- 玩家可见文案禁用开发话语（版本/日期/口径/校验等）；仓库文件一律 UTF-8、编辑工具写入，禁止终端 Add-Content 追加中文。
