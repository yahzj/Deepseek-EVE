# 交接卡：残骸打捞跨星系 Bug 排查（2026-09-09，船长挂起；一次性文档，继承人读取后删除）

> 背景：船长反馈严重问题「残骸打捞能打捞出非当前星系的残骸」，随后指示**挂起排查、固化本地交接**
> （DSH 环境再次出问题，可能重装换会话）。本文是唯一续接入口，读取后请按底部「恢复步骤」行动，
> 确认内容已消化后删除本文件（参照 docs/design/handoff-2026-09-08-current.md 先例：迁移开放项入
> docs/roadmap.md 后删除）。
> 主树 H:\大鲸鱼\Deepseek-EVE（main；一号会话），并行会话：二号（d2 worktree）、三号（美术草稿）。

---

## 一、当前挂起任务：残骸打捞跨星系残骸 Bug（未定位根因，未修复）

### 船长原话
「发现残骸打捞有严重问题，能够打捞出非当前星系的残骸」

### 已完成的排查（勿重复劳动）
1. **引擎抽取路径自查**（packages/core/src/）：
   - 主控：`salvaging.ts → advanceSalvageOp → pullOneWreck(state, ctx, galaxyId, cycleMs)`；
     目标星系 = `state.salvaging.galaxyId`（第 214/280 行）——按星系过滤无误；
   - AI 副船：`ai.ts → advanceAiSalvage → pullOneWreck(state, ctx, task.galaxyId, real)`（第 814 行）——无误；
   - `pullOneWreck` 内敌群池 = `ctx.anomalies` 中 `a.galaxyId === galaxyId`（威胁加权），无跨星系；
   - 残骸型号 1:1 绑定敌群：`wreckItemIdOf = 'wreck-' + anomalyId`、`anomalyIdOfWreck` 反解唯一
     （salvage.ts 第 58~65 行）；回收画像 `recycleProfileOf` 按残骸 id → 敌群 → 星系。
   - 结论：**打捞抽取本身没有发现跨星系路径**——疑点应落在「表现层/数据层」而非抽取层。
2. **数据抽查**：anomalies.ts 逐条 id/name/galaxyId 正则列表已打印过，未发现 galaxyId 空洞错标
   （注意：PowerShell 中文显示乱码是控制台解码问题，文件本身 UTF-8 正常）。
3. **尚未排查**：① 低安遭遇（encounter hidden 模板）与打捞互动的任何残骸路径；② 物品仓库旧残骸
   残留造成误判；③ 敌群重名（不同星系同名残骸显示混淆）；④ 残骸收购卡 22 张（按敌群注册）吸收簿
   在站内的展示星系口径；⑤ 完整 anomalies 表人读核对（终端列表有乱码与贪婪匹配噪音，需要 read 工具
   或脚本干净输出）；⑥ rollIntactHullLoot「完好舰体」彩头（疑似不涉残骸，可快速复核）。

### 恢复后第一步
向船长要**现场三要素**（一次问完，勿边做边问）：
1. 在哪座空间站/哪个星系发起打捞（母港/副站？主控还是 AI 副船？）；
2. 捞到的残骸叫什么（回收卡名/物品名，例如「XX残骸」），它属于哪个敌群；
3. 在哪一步看到星系不对（卸货日志 / 回收卡来源 / 回收拆解保底物 / 完好舰体彩头 / AI 指派执行日志）。

拿到样本后：从仓库物品 id（`wreck-ano-*`）反查 `ctx.anomalies` 该敌群 galaxyId，与打捞源星系对表，
一次定位是数据错标还是逻辑泄漏。若船长给了存档路径，可只读分析（先备份、绝不覆写）。

---

## 二、本会话已完成并提交（均【待验收/待发布】，本地 main，未推送）

| 提交 | 内容 | 验证 |
|---|---|---|
| dc2e08d | AI 核心启用判定修复（工业占用先抵扩容、超出才挤占共用上限；拆分计数 aiCoreShipUsed/IndustryUsed；玩家反馈"工业核心全开无法副船活动"）| core 550 + typecheck ×4 + build 绿；**已在 origin/main** |
| 0ff7dbc | 收尾记录：roadmap 变更记录 + O8/O9 开放项登记；industry-ai-slot-expansion.md §六占用次序澄清 | — |
| 738e1d9 | 精炼炉运转分档校准 O8：14 条配方批量/周期按四档矿船桶对齐（富凡/灼烧 20/24s；希莫/辉云/曦棱/氖云/蓝霜 18/11s；磷光/离子/极光/寒髓 34/10s；玄晶/星幽 58/8s；**暗星冰 42/5.8s**——58/8s 会致净率 135.9% 超护栏）；perOre 未动 | content:check + core 550 + typecheck ×4 + build 绿；审核表已导出 content-csv/（items sheet） |
| 14991a8 | 工业页跳星图（船长定）：炉卡/回收卡头部「去矿带/去打捞」按钮 → 星图矿带/残骸打捞 tab 卡高亮 3.5s（多主带全亮；is-goto 同款；App seq 机制） | typecheck ×4 + build 绿 |
| d1238db | 组装机连续生产（船长定）：线行滑动开关「循环」+ 目标件数（留空 = 料尽自停）；autoRepeat/repeatGoal/produced 零迁移；引擎相位推进跨离线连续结算；AI 核心循环保持占用、停线归还；停线汇总日志；glossary 登记「连续生产」 | core **555/555**（+5 测试）+ typecheck ×4 + build 绿 |

**并行会话本地提交（勿代推，需船长协调）**：36f5bd8(merge)、ef9c895（三号敌族草稿 A~G 全主形【进行中】）、
292c701（清 tools/_reapply.cjs 一次性脚本）、6148f0d + 670c026（巡洋价位定档 9/11/13/15M + 王鲭/鲸王声望，
标注"重放；此前被并行提交交叉吞失"——**巡洋价格是否真拍板需船长确认**）。

## 三、其它未完成 / 挂起事项

- **O9 蓝图非舰船耗时单独审核**（roadmap 已登记；"舰船类耗时单独审核"对应项，未动）；
- **精炼净收益差异问题**：船长先延后（原话"先延后"，随后转做跳转功能）。背景数字已核算存档于对话，
  要点 = 差异来自 吞吐桶 ×8.7 × 矿价 ×37.7 ≈ 卖原矿差 328×，精炼净再 ×净率差；若重开此议题先回看
  `docs/design/refine-cycles.md` 头注与 content-csv 工作簿 items sheet；
- **content-csv/content-workbench.xlsx**：已含 O8 新参数，船长在 Excel 审核中（改后可
  `npm run content:import items content-csv/content-workbench.xlsx` 回写，或直接文字指示调整）；
- 推送闸门：**未推送**（origin/main = dc2e08d；本地 main 领先 8 个提交：36f5bd8..d1238db）。验收通过后
  与并行会话一起协调推送；本批公告：船长已答**不需要**。

## 四、恢复步骤（新会话/新助手）

1. `git status` 核对工作树干净；`git log origin/main..HEAD --oneline` 认领本地未推送提交清单；
2. 读本卡 → 按「恢复后第一步」向船长要残骸样本 → 定位修复（预计改 salvage.ts/anomalies 数据或 UI 展示层其一，修复后 core 测试 + typecheck + build 全绿再本地提交【待验收/待发布】）；
3. 其余船长指令恢复后按 roadmap.md 开放项（O1–O4/O6/O9）与变更记录推进；
4. 确认本卡内容全部消化后删除本文件。

## 五、术语提醒

- 残骸 = 打捞回收原料（计数 = m³，unitM3 = 1）；回收卡名 = 「{敌群名}残骸」；
- 打捞星系卡（星图·残骸打捞）按星系聚合展示；工业页回收卡按敌群注册，来源星系 = recycleProfileOf.galaxyId；
- 术语权威 docs/glossary.md；玩家可见文案禁用开发话语（版本/日期/口径/校验等）。
