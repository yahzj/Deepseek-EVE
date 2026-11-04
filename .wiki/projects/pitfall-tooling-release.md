---
id: pitfall-tooling-release
title: 工具链与发布：踩坑与经验
category: projects
tags: [pitfall, workflow]
summary: 工具链与发布踩坑：桌面外壳、回归诊断、夹具替身、工具可信度、提交闸门、发布分发（docs 蒸馏，非现行规则）
tier: core
source: docs-distill:pitfall-tooling-release
confidence: extracted
created: 2026-11-04T10:45:43.209Z
updated: 2026-11-04T10:45:43.209Z
---

# 工具链与发布：踩坑与经验

> 本页是 docs 提炼的经验记录，非现行规则；与 AGENTS、docs 现行正文或代码冲突时，以它们为准。带「历史」标记的条目按当时口径理解，旧数值与旧流程不得当现行结论。

## 结论先行

- 「全绿」与失败数都必须带口径：497 文件 6205 项不等于 519 文件 7096 项的真整库，「广覆盖」与「完整回归」不能混称；22 条虫洞用例在开战之前就全红，被阻断的断言不能算通过。
- 失败条数不是缺陷条数：夹具缺合法前置会整批失败，不许靠下调生产门槛转绿。
- 夹具伪造真实条件会造出真结论：未经电子战的规格推射程差 15 米，`spread` 改对象会旁路固定编成判定，换个随机种子断言就翻面。
- 提交钩子四项技术检查全绿只证明技术契约没红，不证明内容正确；已批准内容落库后漏同步旧断言，仍会在推送前的真实整库里红掉。
- B 类审批是流程工具不是身份认证：它绑定暂存树、分支、基线；暂存区与工作文件不一致＝审批了另一份代码，`--no-verify` 不是选项。
- 生成件冲突不手拼：`docs/INDEX.md` 几乎每轮集成都冲突，一律 `npm run docs:index` 重建；手拼统计立刻和实际目录脱节。
- 发布与验收口径：「推送即部署」已改为唯一手动 `publish.yml`，但工作流合入默认分支之前远端旧 push 触发仍然有效，不能宣称自动部署已关；构建成功、自动测试通过都不等于玩家实机、观感或合规验收，每条结论要写明「在哪个目标上验的、用什么工具、没验什么」。

## 1. 桌面外壳与开发启动

### 坑：报「无法进入游戏」，其实是 Electron 本地运行时缺文件

- **现象**：二号执行 `electron-vite dev` 报 `Error: Electron uninstall`，船长报障原话是「无法进入游戏」，第一反应容易当成存档加载坏。
- **根因**：`electron` 包版本 31.7.7 在，但缺 `path.txt` 与 `dist/electron.exe`；`electron-vite` 在创建游戏进程之前就抛错。上一批原生压力工具默认借用主树 Electron，因此构建能跑却掩盖了本树开发启动依赖。
- **解法 / 规避**：核对主树同为 31.7.7 后复制其 `dist/` 与 `path.txt` 到本树依赖目录，执行文件 SHA256 一致（`1fa93c3471c1…da424c5`）；不把运行时二进制入库、不升级包版本、不改永久环境变量。
- **复发检查点**：`node tools/electron-dev-smoke.cjs`（本树 `electron-vite dev` + 真实主进程/预载 + 隐藏窗 + 独立临时 userData，报告写 `tools/_ui-artifacts/electron-dev-smoke/report.json`）；改任何依赖后先查 `node_modules/electron/path.txt` 与 `dist/electron.exe` 是否存在。
- **来源**：`docs/design/d2-electron-startup-20261031.md:9-13`

### 坑：诊断模式掩盖玩家路径——熄屏后计时停滞

- **现象**：玩家报「电脑待机黑屏后游戏自动暂停，之前不会这样」；常规诊断工具跑不出这个问题。
- **根因**：主窗口 `backgroundThrottling: !process.env.WHALE_AUTOPERF` 只在诊断模式关节流，防后台定时器降频、遮挡后台化、渲染进程后台化的三个启动参数也只在诊断模式启用。游戏由渲染层定时器推进，战斗每心跳最多推进 100 毫秒，被严重降频后表现为近乎停滞；未发现熄屏主动暂停游戏的代码。
- **解法 / 规避**：普通主窗口也关闭后台节流，防降频参数在应用就绪前固定启用，保留既有 100/500 毫秒自适应心跳；补真实主进程入口的启动测试，先验证旧实现 3 项失败、修复后 4 项全通过。边界：真正系统睡眠会停止进程执行，不宣称睡眠恢复已修，未做物理熄屏、锁屏或系统睡眠复现。
- **复发检查点**：`node tools/desktop-background-pump-native-check.cjs`（隐藏窗、不设 `WHALE_AUTOPERF`、75,012 毫秒观察期内 100 毫秒定时器触发 750 次、最大间隔 113 毫秒）；`npm run test -w @whale/core -- --run desktop-background-pump-20261031.test.ts`。
- **来源**：`docs/design/desktop-background-pump-20261031.md:13-19、31-34、38-40`

### 坑：代码改了，玩家跑的还是旧产物

- **现象**：主进程策略修复后界面热更新看不出来，老桌面产物继续复现旧行为，验收时误以为没修好。
- **根因**：主进程策略不在热更新范围，必须完全退出并重启新产物才生效；`web` 构建会清空 `web/dist`，构建之后放的探针会被下一次构建抹掉。
- **解法 / 规避**：交付前核对产物新鲜度（记录 renderer/web 入口 hash），探针必须在构建之后放；改主进程后完全退出再启动。
- **复发检查点**：比对构建日志里的入口 hash（如 `index-CVl1PAya.js`、`index-DXxPfMQg.js`）与最新构建；`npm run build -w @whale/desktop` / `npm --prefix web run build` 之后才布置探针。
- **来源**：`docs/design/desktop-background-pump-20261031.md:36`；历史：`docs/design/archive/handoff-20260911-to-new-pilot1.md:212、222`；现行规则 `AGENTS.md` §1（旧产物会掩盖修改）

## 2. 回归诊断：别把「跑了测试」当「验过了」

### 坑：「完整回归」其实少跑了 22 个文件

- **现象**：报告写「广覆盖当前代码回归 497 文件 6205 项」，被当成完整核心回归向上汇报。
- **根因**：排除了 22 个含子进程/旧 Git 正文读取的测试文件；真整库是 519 文件 7096 项（7087 通过、0 失败、9 项既有迁移跳过）。
- **解法 / 规避**：口径必须写清文件数、用例数、失败数、跳过数、排除项；只能称「广覆盖」或「完整」二者之一，并给出对账依据。全量回归是集中验收动作，不是每轮动作——开发期跑受影响专项，船长明确开始集中验收才跑完整 `npm run test -w @whale/core`。
- **复发检查点**：拿测试输出末尾的 files/tests 计数与 `git ls-files packages/core/tests | wc -l` 对账；报告里出现「完整」两字就回查是否排除了文件。
- **来源**：`docs/design/d2-main-integration-20261102.md:29`；`docs/archive/integration-failure-diagnosis-20261102.md:8、15、17`（历史档案）；历史口径：`docs/design/archive/handover-verify-20260911.md:34`（文档-only 批次不跑测试）

### 坑：61 条失败不是 61 个缺陷——被阻断的断言不能算通过

- **现象**：29 个文件 61 条失败，看上去像 61 处生产缺陷。
- **根因**：共用夹具 `tools/wormhole-expedition-fixture.ts:40` 只设累计声望 20，却经真实购买入口去买 40/60 门槛的指挥训练许可，22 条虫洞用例失败在开战之前；另有隔离执行时假引擎缺 `engine.state.encounter/hauling`、抽取组件缺 state 等。
- **解法 / 规避**：补合法前置后 22 条真正跑完十层旅程、精英与事件断言；明确记录「被阻断 ≠ 通过」，不把被阻断的深层逻辑冒称已验；也不下调生产门槛迁就夹具（门槛是生产契约，不是测试参数）。
- **复发检查点**：看失败堆栈第一处断言是不是落在「进入战斗/进入流程」之前；单跑 `npm run test -w @whale/core -- --run <文件>` 确认失败点位置。
- **来源**：`docs/archive/integration-failure-diagnosis-20261102.md:25-31、17、73`（历史档案）

### 坑：沙箱里的「失败」有一半是环境

- **现象**：同一份代码，沙箱首轮 7053 通过/34 失败/9 跳过，沙箱外 7059 通过/28 失败/9 跳过，其中 6 条是环境阻断。
- **根因**：沙箱内 tsx 读取 Windows 用户信息、CLI 及仓库身份检查被阻断，与被测逻辑无关。
- **解法 / 规避**：不修改测试绕过环境；获准后在沙箱外原样复跑，把「环境阻断」与「真失败」分开报数，不给环境问题贴业务缺陷标签。
- **复发检查点**：同一命令沙箱内外各跑一次，比对失败集合差异；日志中检索 EPERM/权限类关键词。
- **来源**：`docs/archive/integration-failure-diagnosis-20261102.md:89、110`（历史档案）

## 3. 夹具与测试替身：假数据会造出真结论

### 坑：硬编码旧数值，一次数据变更引发回归雪崩

- **现象**：技能总数断言 119 实际 122、商品目录断言 570 实际 571、黑匣价格断言 30 现值 60、默认距离断言 2000 实际 1967、叠光 tag 断言 `w0-foe-4` 实际 `w0-foe-5`。
- **根因**：测试把当时的输出抄成常量；内容/数值/派生编成更新后断言不跟，失败点看上去五花八门，其实是同一类漂移。
- **解法 / 规避**：读当前单点派生值或共用常量；但「简单改成输出当前值」同样是错的——要按契约核（保留分组与成员覆盖、真实击杀门槛、钳制行为断言）。
- **复发检查点**：`rg -n "toBe\(1[0-9]{2}\)|toBe\(5[0-9]{2}\)" packages/core/tests` 抽查总数类魔法数；`rg -n "toHaveLength\(" packages/core/tests` 复核目录类断言。
- **来源**：`docs/archive/integration-failure-diagnosis-20261102.md:36、43-48`（历史档案）；同模式清单：`docs/design/d2-main-integration-20261102.md:43-66`

### 坑：夹具伪造真实规格，两套管线混成一个假结论

- **现象**：对照伤害 1044/336≈3.107，而舰级读数是 519/156；默认射程 4416 米而实战 4401 米。
- **根因**：用未受电子战压制的 `createPlayerSpec` 推射程，真实建场先应用电子战（压制系数约 0.004138）；用 `spread` 修改 ship 对象后 `hasFixedFoeFormation` 失效，回落到旧整卡多舰补偿与 DPS 折扣，等于把两条管线混在一条对照里。
- **解法 / 规避**：在同一管线做隔离对照，按真实战场规格核记录；不取消电子战、不改生产伤害，反向用例（未击杀不留档）也要补。
- **复发检查点**：确认夹具是否经过真实入场入口而非直接构造对象；对照两侧是否调用同一函数；射程/伤害类断言附「是否应用电子战」条件。
- **来源**：`docs/archive/integration-failure-diagnosis-20261102.md:34-35、41、87`（历史档案）

### 坑：随机序列耦合，换个种子结论就翻面

- **现象**：`market.test.ts` seed7 下挂价 29，收购价在 5 窗内降到 28/27，不再满足「挂价不高于收购线」的吸收条件，簿面只成交 2064。
- **根因**：测试依赖特定种子的价格路径，没有隔离报价条件；调参或随机流变化后同一条断言换种子就红。
- **解法 / 规避**：改成 3 种子同窗口独立白盒：高于买价无吸收、平价每窗 21600、随成交重报价后最终售罄；删除「反复挑有利种子」的失效注释。
- **复发检查点**：同一条断言换 2~3 个种子复跑；测试里出现按 seed 分支的特判即警报。
- **来源**：`docs/archive/integration-failure-diagnosis-20261102.md:52、86`（历史档案）

### 坑：VM 抽取式测试会静默脱钩真实依赖

- **现象**：抽取 App 回调/组件源码在虚拟机里执行，真实代码新增 `state`、`shipCommandCostOf`、`SmoothFill`、`engine.state.encounter` 之后直接抛错；`web-build-dependencies` 的假 require 白名单漏了新增 `vite-plugin-javascript-obfuscator`，报的像是构建缺包，其实是配置测试没声明。
- **根因**：测试用「抽取源码 + 假上下文」模拟运行时；真实代码新增依赖时假上下文不会自动更新，报错点常不在真正的契约上，容易误判成生产故障。
- **解法 / 规避**：抽取真实依赖、补首帧 Hooks 桩并执行组件；白名单同步新增插件；只改测试隔离，不动功能组件。
- **复发检查点**：新增随档字段/组件/Hook/构建插件后，跑全部 vm 抽取类专项；`rg -n "new Function|vm\.|runInNewContext" packages/core/tests` 抽查命中。
- **来源**：`docs/archive/integration-failure-diagnosis-20261102.md:27-31`（历史档案）；`docs/design/main-git-sync-20261103.md:22-23`

## 4. 工具自身的可信度

### 坑：tsx 解析到的是构建产物，读数据会滞后一步

- **现象**：用工具判「当前数据状态」时结果与源码不符，据此误判过一次架构护栏。
- **根因**：`@whale/data` 经 tsx 解析到的是构建产物，可能滞后一步。
- **解法 / 规避**：判当前数据状态读源文件文本，不用包解析结果；工具结论要注明读的是源文件还是构建产物。
- **复发检查点**：`rg` 直接搜 `packages/data/src/static/*.json` 源文件；跑护栏前先确认构建产物时间戳。
- **来源**：历史：`docs/design/archive/handoff-20260913-to-new-pilot2.md:122`

### 坑：arch:guard 全绿不代表没有重复实现

- **现象**：`arch:guard` 四项检查 F1~F4 全 0，但渲染层 100 个文件里仍有 27 处本地 helper、14 个页面/面板文件命中 helper 池。
- **根因**：F2 只查「同名重复」，本仓实测同名命中 0；异名同义必须人裁。另一个例子：`goFor` 返回类型写成 `mapTab?: string`，把已删除的 `'task'` 页签塞进 string 也 typecheck 不红，活动栏点「快递」跳空白页没人拦——这才补了 F5 跳转目标契约（页签必须在 `MAP_TABS` 里真实存在、目的地名 id 必须在 l10n 唯一表里）。
- **解法 / 规避**：机器查机器能查的（同名重复、符号落点、ctx 取数、跳转目标、导入环），其余列清单交人裁；存量直读进白名单必须写理由；字符串型页签/路由参数优先收紧成联合类型。
- **复发检查点**：`npm run arch:guard` 之后再跑 `rg -n "function (xxxLabel|xxxText|kindTextOf)" apps/desktop/src/renderer/src` 找异名同义；新增页签/跳转档位时先看 `MAP_TABS` 与 l10n 唯一表。
- **来源**：`docs/review/arch-guard-baseline-20260927.md:6、43-45、60-67、69-92`

### 坑：扫描工具自己会点错页，新旧读数不能直接相减

- **现象**：英文界面残留中文先报 474 处，修工具后报 433 处；两者不能相减。
- **根因**：工具有一串 DOM/生命周期假设错误：不设 `layout` 就回落 classic（侧栏只有 8 项，点到第 6~10 页实际点错页）；`addScriptToEvaluateOnNewDocument` 注入累积，把后来者设的语言/存档顶掉；应用在 bundle 里读档，先导航再写 localStorage 对首文档无效；按下标点导航与 `NAV_ITEMS` 顺序不同；`textContent` 为空的图标页签被整排跳过。
- **解法 / 规避**：注入 `layout=modern`、收尾 `removeScriptToEvaluateOnNewDocument` 收回、改「页面脚本之前注入」、按导航文案点并去徽标数字、页签限定当前页容器、给 `.app-page-content` 挂 `data-page`。
- **复发检查点**：任何扫描先跑「已知档」自检（可达页数、页签数、每页含中日韩节点数）；读数附口径说明；新旧读数不一致先怀疑工具再怀疑产品。
- **来源**：`docs/review/arch-guard-baseline-20260927.md:98、105-108、111-128`

## 5. 提交闸门与多工作树合入

### 坑：B 类审批落不到钩子——审批了另一份代码

- **现象**：聊天里船长批准了，`git commit` 仍被拦；或审批过了但检查读到的不是要提交的那版代码。
- **根因**：批准结果只在聊天与人的记忆里，钩子不知道；暂存区与已跟踪工作文件不一致时，检查读到另一版。
- **解法 / 规避**：`npm run commit:approval -- status` 看裁定范围 → `node tools/git-gate-approval.cjs approve --reason "单行中文依据" -- <逐个精确路径>` → 正常 `git commit`（或 `npm run commit:msg`）；不用 `--no-verify`，路径禁通配符。PowerShell 传 `--` 时直接调 `node`，别把含引号的多行批准文本拼进原生命令参数。边界：审批绑定工作树、分支、HEAD、合并父提交、完整暂存树与精确路径，暂存内容/分支/基线/工作树一变即失效，重新登记前须重新核对人的授权；它是流程检查不是身份认证。
- **复发检查点**：`npm run test -w @whale/core -- git-gate-approval-20261004.test.ts`（独立临时 Git 仓库覆盖内容变更失效、跨工作树拒绝、范围不完整、合并豁免、技术失败阻断与成功消费）。
- **来源**：`docs/git-gate-approval.md:7-25`

### 坑：钩子四项全绿 ≠ 内容正确

- **现象**：本地提交钩子全绿，推送前真实整库却红了 3 条。
- **根因**：两项来自「已批准说明落库后漏同步旧测试」，另一项是旧窝点威胁硬上限被新授权取代；钩子只跑类型/内容/本地化/UI 四项技术检查，不跑整库回归。
- **解法 / 规避**：批次内先专项、再集中整库、最后才推送；新说明落库时同步旧断言；不把「引擎无关」当免死金牌，也不为转绿把数字降回旧政策。
- **复发检查点**：提交前跑 `npm run typecheck`、`npm run content:check`、`npm run l10n:check`、`npm run ui:rot-check`；推送前集中验收再跑完整 `npm run test -w @whale/core`。
- **来源**：`docs/design/push-regression-contract-20261009.md:10、17`；现行口径：`docs/development-conventions.md:18-20`

### 坑：生成件冲突手拼＝两套口径

- **现象**：每轮集成都撞 `docs/INDEX.md`（有时还有 `docs/roadmap.md`），手动二选一后索引与实际目录不符。
- **根因**：索引是 `npm run docs:index` 生成的，冲突来自两侧新增与生成器的叠加，手拼统计一遍就漂。
- **解法 / 规避**：生成件冲突一律重新生成，不手拼统计；`docs/roadmap.md` 这类人写文档则双方新增记录逐行保留。
- **复发检查点**：`npm run docs:index` 后 `git diff --stat docs/INDEX.md` 应只有生成行；索引里出现手写条目即回查。
- **来源**：`docs/design/d2-main-integration-20261102.md:19`；`docs/archive/remote-audio-integration-20261102.md:11`（历史档案）；`docs/design/main-git-sync-20261103.md:15`；`docs/design/workspace-release-20261011.md:17`

### 坑：旧工作树的「未合入」差异可能早已在 main 里

- **现象**：旧工作树显示大量未合入内容，差点整树搬回主树，把 main 的新实现覆盖回旧版。
- **根因**：旧树基线早于 main 后续实现；另有一批内容存在旧「暂停/不合入」依据，而 main 已用归档新参数替代。旧树 diff 不代表待合入新版代码。
- **解法 / 规避**：先建独立 Git 工作树只移植本会话差异；合入前核对目标是否已被 main 实现（蓝图跳市场、速度显示、转管炮/波次等已在 main，不重复移植）；快进前做基线保护，main 变了就中止（第一次快进被基线保护中止、主树未被改动）；必要时 `git merge --abort` 回到干净工作树，不带半成品往下走。
- **复发检查点**：`git log --oneline origin/main..HEAD` 看真实未推送集合；合入前 `git status` 干净、基线未变、未跟踪文件逐个 SHA256 前后一致（七份未跟踪文件逐件未变）。
- **来源**：`docs/design/zero-integration-20261009.md:14-16、30、35、38`；历史：`docs/design/archive/handover-verify-20260911.md:121`

## 6. 发布与分发

### 坑：从「推送即部署」切到手动发布，中间有个窗口

- **现象**：以为改了工作流就关掉了自动部署。
- **根因**：工作流合入并推到默认分支之前，远端旧 push 触发仍然有效；已排队的旧任务也不受本地改动影响。
- **解法 / 规避**：`publish.yml` 作为唯一 `workflow_dispatch` 入口，`pages.yml`/`release.yml` 只保留 `workflow_call`；切换后确认远端工作流定义与是否有旧排队任务，不冒称「已关闭自动部署」。
- **复发检查点**：看三个工作流的触发器（应只有 1 个 `workflow_dispatch`）；推送后查该 SHA 的 Actions 与近期部署。零运行只是时间窗口的观察结论，不能证明无限未来。
- **来源**：`docs/design/manual-publish-20261102.md:9、24`；`docs/archive/integration-failure-diagnosis-20261102.md:66`（历史档案）；历史对照：`docs/design/archive/handoff-20260911-to-new-pilot1.md:233`

### 坑：手动发布的门槛在 SHA、标签和部分失败上

- **现象**：从分支名或手输版本发布，发出去的不是验过的提交；或标签已移动、包版本与标签不一致。
- **根因**：入口从默认分支执行，输入必须解析成完整 SHA 且已合入默认分支；Windows 只接受预先推送、与桌面包 `version` 精确一致、发布前未移动的 v 版本标签；两端上线不具备跨平台事务。
- **解法 / 规避**：网页与 Windows 都检出同一 SHA；文件下载后按清单核 SHA 与校验和；草稿上传完整才转正式 Release，不覆盖或自动删除已有 Release；结果摘要必须显示部分失败。并发不是严格 FIFO——较新触发可替换早期 pending，发布者应等当前任务结束后再触发。
- **复发检查点**：`npm run test -w @whale/core -- manual-publish-20261102.test.ts`（21 项：引用消歧、固定 SHA、默认分支祖先限制、轻量/附注标签、包版本一致、非法输入、清单/篡改/路径逃逸/额外文件、三平台选择与失败取消跳过、唯一手动入口）；`actionlint` 检查三个工作流。
- **来源**：`docs/design/manual-publish-20261102.md:11-23`

### 坑：构建通过被当成验收（或合规）

- **现象**：报告写「构建成功」，就被理解成可以交付或上线。
- **根因**：构建只证明产物能生成；观感、真机、许可、访问策略、部署结果都不在同一张证明里（例如远端网页守卫允许任意 `*.github.io`、构建成功也不等于许可证合规）。
- **解法 / 规避**：结论写清验证目标与工具，并列出未验证边界；未跑真实 GitHub Actions、未部署、未做实体机复现就明说，不拿构建或静态测试替代验收。
- **复发检查点**：每条交付结论问三句——在哪个目标上验的？用什么工具？没验什么？（例：隐藏窗冒烟 ≠ 物理熄屏复现；模拟手机 ≠ 实体手机；本地构建成功 ≠ 线上部署成功）
- **来源**：`docs/design/d2-main-integration-20261102.md:21`；`docs/design/desktop-background-pump-20261031.md:34、38-40`；`docs/design/manual-publish-20261102.md:22、24`；`docs/archive/remote-audio-integration-20261102.md:28、40`（历史档案）

### 坑：Steam 只吃未打包目录，上传只能走 steamcmd

- **现象**：想用 NSIS/zip 安装包上传；或以为 Steamworks 网页能直接传 build；或上传后以为会自动切分支。
- **根因**：Steam 端要 `win-unpacked/` 目录，不吃安装包；Steam build 只能 `steamcmd` 上传（Steamworks 网页没有上传入口）；`app_build` 的 `setlive` 默认留空 ⇒ 上传后不会自动切换分支。
- **解法 / 规避**：Steam 专用配置只出未打包目录（其余继承 `electron-builder.yml`）；`npm run steam:pack` 构建 → `electron-builder --dir --win` → 生成 `steam/app_build_<AppID>.vdf` 与 `steam/depot_build_<DepotID>.vdf` → `npm run steam:upload -- --user <账号> --run`；上传后在 Steamworks Builds 页手动「Set Build Live」。易漏：AppID 是 `5260760`；depotId 要先在 Steamworks 建 Depot 再填（未填时工具按预期停下给指引，别硬编占位符上传）；`productName`「大鲸鱼-深空放置」与 Steamworks 显示名「大鲸鱼-深空工业」不一致，改 exe 名要同步启动选项；exe 未签名（站外双击有 SmartScreen 提示）；只 Windows x64。
- **复发检查点**：`npm run steam:pack` 后核 `apps/desktop/release/steam/win-unpacked` 文件数（当时 72 文件 / 322.4 MB）与 `Get-AuthenticodeSignature`；`npm run steam:upload` 先不加 `--run` 只做前置检查。
- **来源**：`docs/design/steam-packaging-20260927.md:9-24、26-27、55-56、64-69、77-79`

## 校验回归清单

- [ ] 完整回归报口径（文件数/用例数/失败/跳过/排除项齐全，与 `git ls-files packages/core/tests` 计数对账），失败逐条归类（环境阻断 / 夹具前置 / 旧断言 / 真缺陷，四类分开报）。
- [ ] 夹具走真实入口：不直接构造规格对象；射程/伤害类断言标注是否应用电子战；随机相关断言换 2~3 个种子复跑；行为改动先红后绿（故意改坏 → 测试必须失败 → 还原，保留证据）。
- [ ] 提交前后：提交前跑 `npm run typecheck`、`content:check`、`l10n:check`、`ui:rot-check`、`arch:guard`、`scope:check`，B 类路径逐条 `commit:approval` 登记且暂存区与工作文件一致；提交后 `npm run docs:index` 重生成索引、`git diff --check` 通过。
- [ ] 合并前：`git status` 干净、基线未变、未跟踪文件 SHA256 前后一致；生成件冲突一律重建。
- [ ] 推送与发布：推送前集中整库回归通过，推送后 `ls-remote`/远端刷新核对 HEAD，不以「命令已启动」当完成；发布前复核三个工作流触发器（唯一 `workflow_dispatch`）、手动发布专项 21 项，未真实触发就写「未运行真实 Actions / 未部署」。
- [ ] 桌面与 Steam：`node tools/electron-dev-smoke.cjs`、`node tools/desktop-background-pump-native-check.cjs`，改主进程后完全退出重启并核对产物 hash；`npm run steam:pack` + 不加 `--run` 的前置检查，AppID / depotId / productName / exe 名四处一致。
- [ ] 交付结论三问：验证目标？工具？未验证边界？

## 相关页

- 既有页：[[verification-and-commit]]（验证与提交纪律）、[[collab-gates]]（确认闸门与多工作树合入）、[[docs-system]]（文档体系与索引生成）
- [[pitfall-collab-docs]] — 协作与文档踩坑（编码、留痕、交接卡）
- [[pitfall-save-data]] — 存档夹具与真档保护
- [[pitfall-ui-ux-perf]] — UI 改动、观感验收与静态检查
- [[pitfall-l10n-copy]]、[[pitfall-index]] — 本地化扫描工具 / 本批踩坑页索引

## Sources

- 桌面与构建：`docs/design/d2-electron-startup-20261031.md`、`docs/design/desktop-background-pump-20261031.md`、`docs/architecture.md`
- 回归与诊断：`docs/archive/integration-failure-diagnosis-20261102.md`（历史档案）、`docs/design/d2-main-integration-20261102.md`、`docs/design/main-git-sync-20261103.md`、`docs/design/push-regression-contract-20261009.md`
- 工具与合入：`docs/review/arch-guard-baseline-20260927.md`、`docs/git-gate-approval.md`、`docs/development-conventions.md`、`docs/design/zero-integration-20261009.md`、`docs/design/workspace-release-20261011.md`、`docs/design/d2-integration-20261030.md`、`docs/archive/remote-audio-integration-20261102.md`（历史档案）；历史：`docs/design/archive/handoff-20260913-to-new-pilot2.md`、`docs/design/archive/handover-verify-20260911.md`、`docs/design/archive/handoff-20260911-to-new-pilot1.md`
- 发布与分发：`docs/design/manual-publish-20261102.md`、`docs/design/steam-packaging-20260927.md`
- 规则入口：`AGENTS.md`、`docs/development-conventions.md`
