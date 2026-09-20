# 交接文档 · 大鲸鱼深空工业 · 2026-09-13（二号 → **新二号**）

> 你是**二号**：本仓「虫洞专属内容」这条线的经办人。本件 + `AGENTS.md` 读完即可开工；
> 交付物的**逐项读数与待办归属**在 `docs/design/archive/handoff-20260913-wormhole-content-d2.md`（别重复读会话）。

---

## 0. 一分钟开工

```bash
cd H:\大鲸鱼\Deepseek-EVE-d2          # ← 你的工作区（同仓 worktree，分支 d2/workspace）
git status --porcelain                 # 应干净；有东西先问船长
git rev-list --left-right --count main...d2/workspace   # 左=main 独有右=你独有；左>0 先 git merge main
npm run typecheck                      # 四连之一，确认基线可跑
```
然后按需读：`AGENTS.md`（必读）→ `docs/design/wormhole-exclusive-20260913.md`（设计+裁定链）→
`docs/design/archive/handoff-20260913-wormhole-content-d2.md`（本批交付与待办）→ `docs/glossary.md`（术语权威）。
**开工前先问船长"这一轮做什么"**——他的指令通常极短（例：「1，可以补到0.6。2.10架。3.先不动。4.跟着涨」），
需要你把它逐条落成"字段 + 数值 + 归属"再复述一遍确认。

## 1. 工作区、推送闸门与铁律（违一条就白干）

- **你的工作区**：`H:\大鲸鱼\Deepseek-EVE-d2`（分支 `d2/workspace`）。**主树 `H:\大鲸鱼\Deepseek-EVE`（`main`）归船长与一号**——
  **二号永不直接写主树文件**；三号在 `H:\大鲸鱼\Deepseek-EVE-verify`（分支 `verify`）。
- **完成即合入**：d2 自测四连全绿 → `git -C d2 merge main` 追平（有冲突在 d2 解）→ `git -C main merge --ff-only d2/workspace`
  → **在 main 重建产物** `npm run build`（`apps/desktop/out` 是船长的本地验收产物）→ 提醒船长**重启**本地那份。
  `--ff-only` 报 `Not possible to fast-forward` = **main 又前进了**（一号在推）⇒ 回 d2 再 `git merge main`。
- **推送闸门**：开发中**只做本地 commit，不推送 origin**；未完成的提交标「待验收/待发布」。
- **四步闸门**（数值/系统/取舍类改动）：集中提问 → 中文设计总结（列清增删）→ **等显式确认**（"没反对"≠确认）→ 才实现，并把裁定落进 `docs/design/`。
- **§5.2**：新提议与既有已确认规则/契约/测试冲突 ⇒ **先停下摆冲突请船长裁决**（原话+出处+后果+可选做法+推荐）。
- **§5.1 禁子代理**：一个都不许开，活自己干。
- **语言**：一律中文（沟通/注释/文案/日志）；commit 标识符不受限。
- **编码纪律**：禁 `Set-Content`/`Out-File` 裸写中文；用 .NET `WriteAllText` + `UTF8Encoding($false)`；
  **全仓 CRLF、无 BOM**；批量写文档/合并后**三条自检**（BOM 与行尾一致 · 往返解码乱码 0 · 与两侧父提交比"父提交有的行还在"）。
- **汇报格式**：改了哪些文件 + 行为变化 + 验证结果 + 已知取舍；证据标注只在「外壳/真档/性能/跨窗口几何」场合加。

## 2. 船长的工作方式（今天新增的经验，照做省两轮）

1. **他按族逐条审**（A→C→D→E→G），一次给几条裁定；要**按 id 锚定**改，别按长文案近似匹配。
2. **他要读数**：「有无测试过 X？」= 期望你**当场能跑出一个数**，不是要一篇说明。本批已备 4 件工具（见 §9）。
3. **他要量化口径**：「平均强度要高上 10%」这类要求 ⇒ 用工具出表核对平均值，**不许手算拍脑袋**。
4. **他会追问出处**：「低槽 4 必须 ≥ 高槽 4+1 是什么时候的规则？」⇒ 每条契约都要能追到**提交/文档/日期**；
   追不到就说明它是"某人提炼的精神"，要摆出来请他定（今天就删掉了这么一条）。
5. **他讨厌自相矛盾**：给"光环型"舰船配代价时别放在影响**编队机动**的项上（今天实测：单舰 −30% 速度会让全队接近速度 −13%，
   把"全舰 +15% 伤害"的光环吃掉一部分 ⇒ 该惩罚已移除）。
6. **他要"实测生效"**：新机制落码后要跑一次真实战斗/真实规格值验证，并把读数写进汇报与设计稿。

## 3. 系统地图（本批落点，按需查）

| 层 | 落点 |
|---|---|
| 数据 | `packages/data/src/{modules,items,ships,shipBlueprints,blueprints,marketCatalog,wormholeFoes}.ts` |
| 引擎 | `packages/core/src/combat.ts`（克制表/规格构建/开火路径/预估器）· `wormhole{,Grid,Salvage,Battle,Hold}.ts` · `types.ts`（契约字段） |
| 界面 | `apps/desktop/src/renderer/src/{ui/shipInfo.tsx, pages/ShipPage.tsx, panels/Wormhole.tsx}` |
| 契约 | `tools/content-check.ts`（唯一门禁；产物说明/蓝图说明/槽位/闸门全在这） |
| 工具 | `tools/wh-*.ts`（本批 4 件，见 §9） |
| 文档 | `docs/design/wormhole-exclusive-20260913.md`（设计与裁定链）· `wormhole-family-review-20260913.md`（按族清单）· `wormhole-ships-review-20260913.md`（舰船审查表） |

## 4. 本批（今天）交付的批次

| 轮 | 内容 | 读数 |
|---|---|---|
| R1 | 按族审核轮：装备数值/文案逐条改；船体三机制落地 | 见设计稿 §3.5 |
| R2 | 舰船二轮：子分类 9 类 + 全部改名 + 进界面 + 契约删 1 条 | 15 艘平均强度 **1.149** |
| R3 | 官方三艘重装舰对齐同级 + 价格跟涨 | 陆龟 3/3/4·205·390·450k ｜ 玳瑁 4/4/5·330·910·1.1M |
| R4 | 三条待落机制全落 | 全体攻击 · 无人机结构 +80% · 鱿蜂改名（25 文件） |
| 归档 | 交接件 + 设计稿进度表收口 + roadmap 条目 | 本件与 `docs/design/archive/handoff-20260913-wormhole-content-d2.md` |

## 5. 你要做的第一件事

1. `git -C d2 merge main` 追平后**核验一号已完成的两项**（他 2026-09-13 提交 `4a82f78b`）：
   ① 族池已含「无人机」类（`wormholeSalvage.ts`：`WormholeFamilyPool.drones` + `drones: pick(ctx.items.keys(), 'drone')`）
   —— `content:check` 读数已变为「按族池（装备/装备图/舰船图**[+族专属无人机]**）… C 5/5/3**+机1** · E 5/5/3**+机1**」；
   ② `engine.wormholeDescend` 已传 `wormholeScanBonusOf(this.ctx, run.fleet)`（`engine.ts:1527`）⇒ 扫码加成在深层同样生效。
   他的「无人机归属/孤儿」契约与用例也已一并做完（测试基线升到 **1239 用例**）⇒ **不要再重复动他的文件**。
2. 因此**二号这条线当前没有未完成项**；剩下的是船长两条待裁（见 §6）与"按族继续审 / 上线"这类新指令。
## 6. 挂账（当前 **2 条**，均为船长待裁）

| # | 事项 | 归属 | 状态 |
|---|---|---|---|
| ~~1~~ | ~~族池加「无人机」类（C 巢卫攻坚 / E 构件哨戒，10 架/次）~~ | 一号 | ✅ **已完成**（提交 `4a82f78b`；契约读数 C/E 各 **+机1**） |
| ~~2~~ | ~~`engine.wormholeDescend` 传 `wormholeScanBonusOf(ctx, run.fleet)`~~ | 一号 | ✅ **已完成**（`engine.ts:1527`） |
| 3 | 已发布公告「鱿蜂无人机」改名（仅文案） | 船长 | 待点头 |
| 4 | 上线动作：删 `unreleased` + 虫洞公告待审稿 | 船长 | 「先不动」 |

## 7. 他人在途（合并前必看）

- **一号（main）**：常有多文件未提交（今天在途：`engine.ts` / `index.ts` / `wormholeBattle.ts` / `wormholeSalvage.ts` /
  `wormhole-*.test.ts` / `content-check.ts` / `wormhole-econ.ts`）。**他的文件不要动**；合并前先 `git -C main status --porcelain`，
  若你要合入的路径与他重叠 ⇒ 停下问船长。注意：你在 main 跑的 `npm run build` **会把他未提交的代码打进去**，汇报时说清。
- **三号（verify）**：核验与收尾线。

## 8. 验证闭环与常用命令

```bash
# 四连（改任何东西都跑；缺一不可）
npm run typecheck                 # core/data/ui/desktop 四包
npm run test -w @whale/core       # 今天基线：1232 用例
npm run content:check             # 内容门禁：交叉引用/契约/闸门/价格口径
npm run build                     # 桌面产物（本地验收那份）

# 本批 4 件工具（都可重跑；改了数值就重出文档）
npx tsx tools/wh-family-review.ts --write   # 按族总览（装备全字段 + 舰船特色与加成）
npx tsx tools/wh-ships-review.ts --write    # 舰船审查表（逐艘 + 同档对照 + 越界标注）
npx tsx tools/wh-weapon-dps.ts              # 武器输出对比（虫洞武器 vs 制式 MK3，引擎口径）
npx tsx tools/wh-ship-tune.ts               # ⚠ 只对未调基线运行（检测到 subClass 即拒绝，防二次叠加）

# 其它常用
npm run content:export            # 重出 Excel 审查工作簿（content-csv/content-workbench.xlsx）
npm run content:import <表> <xlsx># 把船长改过的表回写进代码（AST 改写，未知 id/缺行 ⇒ 整表拒绝）
npx tsx tools/make-test-save.ts   # 造可复现测试档（给船长实测）
npx tsx tools/battle:calibrate    # 战斗标定（改数值/舰船后抽查）
```

## 9. 已知坑与教训（今天全部真实踩过，逐条带证据）

1. **PowerShell `.Replace()` 是全局的** ⇒ 今天两次误伤：改 `reloadCutPct: 0.18` 顺带改了 D 族速装填机；
   改 `hitBonusPct: 0.24` 顺带改了 A 族扫描阵。**定式：按 id 锚定整条/整块 + 替换前先校验命中次数（必须 = 1）**。
2. **PS 命令里字符串内层别再套双引号**（今天 3 次解析失败）⇒ 内层一律用「」。
3. **here-string 终止符必须行首**（早前事故：脚本正文被写进 `combat.ts`）⇒ 已改走 .NET 字符串替换。
4. **`WriteAllText(path, null, enc)` 会写出 0 字节**（早前事故）⇒ 写完必查行数。
5. **`@whale/data` 经 tsx 解析到的是构建产物**（可能滞后一步）⇒ 判"当前数据状态"要**读源文件文本**（我今天因此误判过一次护栏）。
6. **工具不可重复运行**：`wh-ship-tune.ts` 按"现值 × 摆动"重算，二次运行会叠加（−30% 变 −51%、槽位再加一格）
   ⇒ 已有护栏；**正确姿势：`git checkout <父提交> -- <文件>` 取干净基线再跑**。
7. **战斗探针三个坑**：① 不给 `desireM` ⇒ 全程接近、不开火；② **编队接近速度 = 全队存活舰 `combatSpeed` 的平均**（慢船拖全队）；
   ③ `stats.meDmg` 是**实收扣血**（打死时恒等于总血，不能当输出指标）——比输出要用**规格值**（`createPlayerSpec`）。
8. **夹具颗粒度**：层位倍率一改，`target-lock` / `b1` 这类"一炮≈一层血"的夹具会被翻盘（我方 0 次开火即沉）
   ⇒ 夹具只动测试不动内容（船长裁定「最小调整夹具」）。
9. **契约会抓文案**：`产品说明契约` / `蓝图说明契约` 会核对文案里的**名字与数字**是否与产物一致
   ⇒ 改数值/改名必须同步：模块说明、图纸名、图纸说明（今天因改名漏了图纸说明，被 `content:check` 抓出 1 处）。
10. **契约要溯源再谈**：`content:check` 里有些断言是"草案精神的弱断言"（如今天删掉的"装甲舰低槽多"）
    ⇒ 先 `git log -S "<断言文本>" -- tools/content-check.ts` 找提交与依据，再决定"遵守/请船长改判"。
11. **别动存档结构**：`state` 加字段要同时看 `save.ts` 的 `clean*` 白名单与版本迁移。
    今天要传"扫码加成"时选择了**给函数加可选参数（默认 0）**而不是往 state 里塞字段——零迁移、零风险。
12. **主树常脏**：FF 失败 = main 前进；合完记得在 main 重建产物并让船长重启。
13. **一号顺手修过「货柜撤离静默消失」真 BUG**（详见 `docs/design/wormhole-extraction-endgame-20260912.md` §13.4）——接手时若在撤离/货柜路径上看到异常，先查那条记录，别重开调查。
14. **"强增"前先确认字段有消费点**：`lockRangeM`（锁定范围）与 `signatureM`（信号半径）**全引擎零消费**（纯展示），
    `scanResMm` 只进悬赏冷却（经济向）。今天因此返工过一版舰船加成。

## 10. 接手检查单（逐项打勾）

- [ ] `AGENTS.md` 已读；§2 四步闸门 / §5.1 禁子代理 / §5.2 冲突先提醒 / §3 四连 / §4 合入与编码纪律 已记牢
- [ ] 工作区 = `Deepseek-EVE-d2`（分支 `d2/workspace`）；**没有**写主树文件
- [ ] `git status` 干净、已 `merge main` 追平、四连全绿（**1239 用例**基线：一号补齐族池/扫码后升）
- [ ] 已读 `docs/design/archive/handoff-20260913-wormhole-content-d2.md`（本批交付/读数/待办）与设计稿 §0 裁定链
- [ ] 已向船长确认本轮任务与口径（含"要不要按族继续审"）
- [ ] 明白挂账只剩船长 2 条（公告改名 / 上线动作）与"一号在途文件不要动"
- [ ] 改完任何数值/文案：跑了四连、重出了相关文档、汇报里写了"改了哪些文件 + 行为变化 + 验证结果 + 已知取舍"，并提醒船长**重启本地产物**

---

_维护：二号 2026-09-13 写；下次交接（换新二号/压缩续接）时更新本件，并把旧的移入 `docs/design/archive/`。_
