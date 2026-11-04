---
id: pitfall-save-data
title: 存档与数据：踩坑与经验
category: projects
tags: [pitfall, data]
summary: 存档与数据踩坑：导入门禁、保存事务、读档白名单、离线结算、真档保护、云存档（docs 蒸馏，非现行规则）
tier: core
source: docs-distill:pitfall-save-data
confidence: extracted
created: 2026-11-04T10:44:45.300Z
updated: 2026-11-04T10:44:45.300Z
---

# 存档与数据：踩坑与经验

> 本页是 docs 提炼的经验记录，非现行规则；与 AGENTS、docs 现行正文或代码冲突时，以它们为准。

## 结论先行
- 导入存档"没反应"多数是可复现的竞态：取消判定一旦永久锁定，晚到的 `change` 就再也接不到文件。
- 铁人闸门只认"来档是否铁人 + 代次"，而代次等于存盘次数；换设备先选模式必然抬代次、把旧档关在门外。
- 保存不是"写临时文件再改名"就安全：要 FIFO 队列、入队固定快照、唯一临时文件、失败不毒化后续请求，回执还要等铁人账本。
- 备份/导出必须绑定"确切的已提交快照"，不能拿当前内存或盘上碰巧最新的文件冒充；`persist` 失败仍报成功是最贵的假绿。
- 新增随档字段必须"写入点 + `normalizeState` 白名单"两处落笔并跑往返；漏一处就是"保存成功、读档丢失"。
- 读写口径必须单点同源：离线结算上限、行情历史长度、数量单位、铁人代次，两处各算一遍就会给玩家互相矛盾的读数。
- 离线时间基准（`savedAtWallMs`）与补剂锚点错了会重复结算或少结算；整段与分片必须同结果，边界按事件切段。
- 真档只读：改档先关游戏、双备份、只替换字段块、三条自检、复读核对；测试一律合成档或副本，个人真档不是夹具。

## 1. 导入、搬档与版本门禁
### 坑：导入存档"没反应"是取消判定的竞态，不是浏览器玄学
- **现象**：Win10 + Edge 玩家选完存档点导入，界面既无成功也无报错，像没点。
- **根因**：`pickImportSave()` 靠 focus 兜底判取消——对话框关闭、焦点回来后硬等 300ms，`input.files` 仍空就判 canceled，而 `finish()` 一旦调用即 `done = true` 永久锁定。Win10/Edge 上 `change` 可能晚于 `focus` 几百毫秒（200~500KB 存档正落在杀软扫描窗口），真正的 `change` 到达时已被 `done` 挡掉。
- **解法 / 规避**：去掉一次性硬判，改轮询宽限（7×300ms≈2.1 秒；2026-09-30 起触屏放宽到 8 秒，并等页面可见后才计时），`change` 与轮询共用幂等 `finish`，`finish` 里统一清计时器与监听。2026-09-22 同批还剥了 UTF-8 BOM（记事本另存会加，`JSON.parse('\uFEFF{…}')` 直接抛错）；2026-09-30 手机报障「只能导出不能导入」又补了三处：input 必须挂进文档（安卓内核不认游离节点）、`accept` 末尾补通配（安卓按 MIME 过滤会把 `application/octet-stream` 存档灰掉）、取消宽限按环境分开。上限 10MB 不变。
- **复发检查点**：`rg -n "graceMs|done = false|\uFEFF|input.accept" apps/desktop/src/renderer/src/game/storage.ts`；手机端复测"从文件 App 翻目录超过 2 秒再选"。
- **来源**：`docs/design/import-save-edge-20260922.md:8-30`；现行代码注释 `apps/desktop/src/renderer/src/game/storage.ts:278-291`、`:347-354`。

### 坑：铁人档换设备导入被自家闸门拒——代次是存盘次数
- **现象**：手机换设备，玩家把旧档发来导入，界面提示无法导入（`ui.engine.051`）；原档 6079 代、新设备阈值 9000。
- **根因**：判据 `ironmanLoadVerdict` 的阈值 = max(当前档代次, 本机账本代次)，来档是铁人档且代次 < 阈值即拒，只有"来档 ≥ 48 小时"的救援豁免；代次 = 存盘次数（约每 15 秒一次 + 每个动作一次）。玩家在新设备"先进游戏、选了铁人"，代次一路 +1，很快超过旧档。
- **解法 / 规避**：把来档降回普通档（`on:true`→`false`，删 `sinceWallMs`，保留 `seq`），闸门整条不适用；保留 `seq` 让 `syncIronmanHead` 把本机账本顶到旧代次，反回滚纪律照旧。产品侧：在强制二选一的模式框上加「导入存档」入口，玩家先导入再选模式（否则"选铁人→抬代次→再导入"必然踩坑；导入后模式框按 `engine.modeChoiceNeeded()` 自动重判）。
- **复发检查点**：`rg -n "ironmanLoadVerdict|ironmanLoadCheck" packages/core/src/ironman.ts apps/desktop/src/renderer/src/game/engine.ts`；按"先在模式框导入、再选铁人"走一遍换设备场景。
- **来源**：`docs/design/ironman-mobile-import-20260928.md:10-16`、`:25-47`、`:49-63`（入口与文案 `ui.Ironman.044`）。

### 坑：过旧档不是"想办法迁"，而是明确拒读并保护原文件
- **现象**：启动提示档案制式过旧，游戏开新档；玩家以为旧进度被删。
- **根因**：每次结构变更都留迁移链会让代码与用例无限膨胀。船长 2026-09-19 裁掉过旧迁移、只留虫洞之后（当时下限 v24），2026-10-27 起读取下限提升到 v31、v24→v31 链退役。
- **解法 / 规避**：单一常量收口（`MIN_SUPPORTED_SAVE_VERSION`），低于下限抛 `SaveError('VERSION')`，`engine.start()` catch 后开新档，旧文件原样保留不覆盖；启动拒读会挂起写入，玩家明确放行后才可能用新档替换旧文件（要保进度就别放行覆盖）。保留一份"应被拒"的反证样本，迁移检查同时断言 v≥下限可读、v<下限被拒。
- **复发检查点**：`npm run save:migrate`（可读与预期拒读分开报，意外失败必须非零）；`npm run test -w @whale/core` 中 `packages/core/tests/legacy-save-load-guard-20261027.test.ts`（拒读后原文不变、放行前不保存）。
- **来源**：历史档案 `docs/archive/retired-docs-20261029/save-migration-floor-20260919.md:3`、`:16-20`、`:36-40`、`:45-48`；现行 `docs/architecture.md:49`、`:53`；`docs/test-saves/README.md:30`。

## 2. 保存事务、备份与重连
### 坑：写临时文件再改名≠保存有序，共用临时文件会让旧快照晚提交
- **现象**：界面操作成功，下次启动却回退到较旧进度；偶发 ENOENT 或文件占用。
- **根因**：桌面每次 `save:save` 都写同一个 `save.json.tmp` 再 rename，且不等铁人账本；渲染层大量 `void this.persist()` 无互斥，动作保存、定时保存、恢复、关页保存可重叠（历史定位 `apps/desktop/src/main/index.ts:90–99`）。原子替换只保证单次替换，不保证并发先后，旧请求可能晚提交。
- **解法 / 规避**：主进程统一保存/恢复/账本提交队列：入队时固定快照、唯一临时文件、成功后覆盖、失败不毒化后续请求；回执对应该快照提交完成，主档回执等铁人账本；关页只算尽力保存。错误修法：只把临时文件名随机化、把 ENOENT 当成功、只降低自动保存频率、只给一个按钮加防抖。
- **复发检查点**：`npm run save:guard-check`、`npm run save:reconnect-check`（需先起其依赖的浏览器调试服务，否则是 `fetch failed`）；保存队列/账本专项用例在 `npm run test -w @whale/core` 内。
- **来源**：历史档案 `docs/archive/retired-docs-20261029/guoqing-audit-20261002.md:292-347`；现行 `docs/architecture.md:55`；`docs/review/guoqing-audit-followup.md:9`。

### 坑：网页"重新连接文件"只恢复权限，旧内存覆盖较新的文件
- **现象**：浏览器重启后重连绑定文件，显示"连接成功"；下一次保存把另一设备写的更新进度盖掉。
- **根因**：权限未授予时读文件返回 null；启动只在 `storage.load()` 里比较文件与浏览器档的保存时刻；"重新连接"只申请权限、刷新状态、弹成功提示，随后保存直接把当前内存写进文件，没有重读或冲突判定（历史定位 `App.tsx:642–648`）。
- **解法 / 规避**：把重连当"装载来源重新出现"：先暂停写入并失效旧请求，等在途写完再严格读文件；进度不同就让玩家选择（载入文件／保留当前并覆盖／取消），取消保持暂停；部分介质成功要明确报告、不能回滚已成功介质；"连接成功"不得暗示"进度已载入"。只看 `savedAtWallMs` 不足以处理时钟回拨与跨设备，长期要档案身份与修订信息。
- **复发检查点**：`npm run save:reconnect-check`；同源多标签页走 Web Locks 单写者（第二页只读，失锁转保护性只读）。
- **来源**：历史档案 `docs/archive/retired-docs-20261029/guoqing-audit-20261002.md:351-391`；现行 `docs/architecture.md:57-59`。

### 坑：备份/导出绑错快照——拿"盘上碰巧最新的文件"冒充当前进度
- **现象**：备份提示成功，恢复后却是旧进度；刚导出的铁人档立刻导回被判"回滚"拒绝。
- **根因**：`backupNow()` `await persist()` 却不看布尔结果就备份磁盘主档——保存失败时复制的是上次成功的主档还报 ok。导出走 `currentSaveText()`（seq=N）后 `void persist()` 又抬到 N+1，同一文件马上导回 N<N+1 被闸门拒（合成复现：导出 seq7、当前/账本 8 → `rolled-back`）。
- **解法 / 规避**：手动备份绑定"本次已保存的快照"；最新提交失败就明确失败，或标注"上次成功主档＋其保存时刻"。导出与主档共用同一提交快照和同一文本，桥在用户手势内调用；失败保存不提高内存代次、并发快照独立分配。语义上要定清"代次"代表成功提交还是每次保存调用。
- **复发检查点**：`node tools/guoqing-save-native-check.cjs`（真实 IPC：导出与主档逐字相同，102 代导出→立即导入 103→恢复 105，旧 102 正常启动被拒且文件原文不变）。
- **来源**：历史档案 `docs/archive/retired-docs-20261029/guoqing-audit-20261002.md:610-634`、`:570-606`；修复跟进入口 `docs/review/guoqing-audit-followup.md:9`、`:14`；`docs/architecture.md:55`。

## 3. 读档归一与字段保真
### 坑：新增随档字段只改写入不改白名单——保存成功、读档丢失
- **现象**：新字段存盘后重启凭空消失；或读档后合法小数/长数值被"清洗"变形。
- **根因**：`normalizeState` 是手工维护的大型清洗白名单（`packages/core/src/save.ts:103` 起；历史审计时整个文件约 3,506 行）：写入端序列化全量，读档端只保留白名单字段，漏登记即丢；清洗数值过于通用又会把领域值改坏。
- **解法 / 规避**：每个随档字段两处落笔（写入点 + 白名单），跑 `save:roundtrip-audit` 与类型穷尽用例；数量/时长/百分比/序号分别定义归一政策；加默认值不一定升版本号，改变字段语义才需要迁移；归一与"内容 id 是否还有效"分开。老档单位变更要在载入时换算一次并写可选标记（如 `skills.progressVersion=1`），历史区间不可逆推就不追算，也不能用旧构建回写新构建存的档。
- **复发检查点**：`rg -n "normalizeState" packages/core/src/save.ts`；`npm run save:roundtrip-audit`；单点登记见 `docs/single-source.md:137`。
- **来源**：历史档案 `docs/archive/retired-docs-20261029/guoqing-audit-20261002.md:733-746`；`docs/development-conventions.md:24`；老档单位换算 `docs/design/synaptic-accelerant-audit-20261009.md:191-193`。

### 坑：逐轮取整把 0.9 变成 0——数量单位必须贯穿读写
- **现象**：合成复现 `addItem(state, wreckId, 0.3)` 返回 true 但货仓 +0；0.9 存盘再读变成 0。
- **根因**：残骸体积可以是小数，主控每次入库都 `Math.floor(units)`，副船直接累加小数；读档又对货仓/仓库逐值取整（历史定位 `core/inventory.ts:97–114`、`core/save.ts:501–503,601–603`）；作业统计按原始小数累加，与入库不一致。
- **解法 / 规避**：先定单位政策再改实现——要么允许有限精度小数并让出售/搬运/容量/回收/存档全部遵循，要么只存整数并在统一数量层维护随档余数；不能只是删掉几处 `Math.floor`。历史审计提过的小数方案后来被已确认的整数政策替代，以现行规则为准。
- **复发检查点**：十轮 0.3 应合计为 3、主控与副船同配置产出一致、合法数量往返不减少；`rg -n "Math.floor" packages/core/src/inventory.ts`。
- **来源**：历史档案 `docs/archive/retired-docs-20261029/guoqing-audit-20261002.md:492-532`；`docs/review/guoqing-audit-followup.md:12`。

### 坑：行情历史运行期 48 点、存档只留 24 点——同一窗口两个上限
- **现象**：每次重启丢掉一半价格窗口，图表行为与运行期说明不一致。
- **根因**：运行期历史上限 48，保存归一 `slice` 只留最后 24（历史定位 `core/save.ts:980`），两处各自定义上限。
- **解法 / 规避**：把上限抽成无副作用常量让两边共用——现行 `packages/core/src/market/constants.ts:50` 的 `PRICE_HISTORY_LIMIT = 48`，`save.ts:693` 用它裁尾；不要为了复用常量造 `save→market→state→save` 运行期环。回归覆盖 0/24/48/49 点、非法值过滤、旧档长度、满窗往返的值与顺序。
- **复发检查点**：`rg -n "PRICE_HISTORY_LIMIT" packages/core/src`；`npm run test -w @whale/core`。
- **来源**：历史档案 `docs/archive/retired-docs-20261029/guoqing-audit-20261002.md:638-652`；修复 `docs/review/guoqing-audit-followup.md:15`；现行代码 `packages/core/src/market/constants.ts:50`。

### 坑：往返审计"失败仍报通过"——最贵的假绿
- **现象**：91 份样本 1 份失败（v17 低于当时下限），工具末尾仍打印"存档往返体检通过"。
- **根因**：工具只比较第一次归一与第二次归一的键/类型，数组只看第 0 个元素，不比较数值与长度；有丢键只打印失败文案、不设非零退出码，最终"通过"分支只看 lost/typed（历史定位 `tools/save-roundtrip-audit.ts:27–38,49–77`）。
- **解法 / 规避**：拆成版本迁移、结构幂等、领域保真三种检查；预期拒读由 fixture 元信息声明并单列，意外失败必须非零退出；检查全部数组元素与值。注意"退出 0"只证明工具认为没问题，不证明值保真——同一份报告里"98 份中 97 份成功"也要按实情写。
- **复发检查点**：`npm run save:roundtrip-audit`；`npx tsx tools/guoqing-audit-recheck.ts`（含故意无效夹具应退出 1）。
- **来源**：历史档案 `docs/archive/retired-docs-20261029/guoqing-audit-20261002.md:656-682`；修复 `docs/review/guoqing-audit-followup.md:16`；按实情记录 `docs/design/synaptic-accelerant-audit-20261009.md:185`。

## 4. 离线结算与时间基准
### 坑：离线结算上限"技能不生效"——结算与溢出读数两处各算
- **现象**：玩家（船长）报「技能的离线时间上限不生效」：结算其实按 16~32 小时走了，简报却按 8 小时报"超出上限未结算"。
- **根因**：加成只在 `simulateOffline` 内部算（当时口径 `capEff = 8h × (1 + 0.2×离线作业管理学 + 0.4×无人值守调度学)`），而引擎四处——启动离线结算、读档、导入档、调试快进——各自用 `offlineSplit(…, 默认 8 小时)` 算溢出读数。
- **解法 / 规避**：单点 `offlineCapMsOf(state, baseMs?)` 收口加成，`simulateOffline` 与引擎四处都读它；当时不改数值（8h 基础、+20%/级、+40%/级、加算）。现行上限以 `simulation.ts` 与技能表为准，不引用旧里程碑的固定读数。
- **复发检查点**：`rg -n "offlineCapMsOf" packages/core/src apps/desktop/src/renderer/src/game/engine.ts`（应只有一处实现、调用点全读它）；`packages/core/tests/offline-cap.test.ts`（含"溢出读数与结算同源"用例）。
- **来源**：`docs/design/offline-cap-skill-20260922.md:8-23`；现行 `packages/core/src/simulation.ts:67`、`:94-95`；`docs/architecture.md:70`。

### 坑：离线整段与 30 秒分片算出不同结果——补剂锚在"离线末刻"
- **现象**：同一初始状态 8 小时离线：整段结算扣 1 枚、剩 24h；30 秒分片扣 1 枚、剩 16h5m。32 小时：整段 1 枚/24h，分片 2 枚/16h5m；铁人 + 只剩 1 枚时，整段已到 Lv5，分片仍 Lv4（等级不同）。
- **根因**：整段先推进到结束时刻再补用，`max(gameMs, until) + 24h` 锚在离线末日而非真实应补用时刻；技能队列又拿这一药效状态推进整段。分片路径每次都在真实时刻补，两边读数自然不一致。
- **解法 / 规避**：把续用放回技能自身时间轴（按续用/到期/升级事件分段），只让药效覆盖真正有效的时段；不要为了修它把整个离线系统改成每秒一拍（会把市场与随机事件一起改）。另注意静默记账要 `finally` 收尾，否则"零额度早退"会让之后在线补用没有逐枚日志。
- **复发检查点**：`npx tsx tools/synaptic-accelerant-check.ts`（8/32/64 小时整段与分片一致、库存一枚不足整段时不误升 Lv5）；`packages/core/tests/skill-boost-timeline-20261009.test.ts`。
- **来源**：`docs/design/synaptic-accelerant-audit-20261009.md:106`、`:118-132`、`:136-138`、`:143`、`:181`。

### 坑：调试快进不同步 `savedAtWallMs`——下次真实离线重复结算
- **现象**：用调试面板快进几小时后退出再进，离线结算又补了一次时间。
- **根因**：快进推进的是游戏模拟墙钟，而离线结算用 `state.savedAtWallMs` 判断真实离开时长；快进后不回写它，下次启动就会把同一段时长再结算一次。
- **解法 / 规避**：`debugFastForward(ms)` 快进后同步前移 `savedAtWallMs`；`debugQuick` 随档保存（当时引入于结构 v15，现行结构版本以 `state.ts` 的 `CURRENT_STATE_VERSION` 为准）以便离线回放一致；调试模式不压缩战斗与击杀演出，市场节奏也不缩短。
- **复发检查点**：`rg -n "debugFastForward|savedAtWallMs" apps/desktop/src/renderer/src/game/engine.ts`；手动"快进→退出→再进"核对离线简报时长。
- **来源**：`docs/design/v15-debug.md:30-38`；现行代码 `apps/desktop/src/renderer/src/game/engine.ts:3908-3917`。

## 5. 铁人与真档保护
### 坑：重置铁人记录和保留徽章用同一个判据，不能兼得
- **现象**：为让玩家重新选模式而清空 `sinceWallMs` 后，隐藏徽章「铁人」的历史记录一起没了。
- **根因**：`ironmanModeChosen` = 曾开过铁人（`on` 或 `sinceWallMs`）**或**已选过普通；`ironmanEver`（徽章判据）= `on || sinceWallMs`。两个语义共用一个字段，清掉"已选过"就必须清掉"历史上开过"。
- **解法 / 规避**：先和船长定取舍再动档——要"重新选择"就接受徽章从重新选那一刻算；要保徽章就得改判据（加独立字段），不能既清又留。清 `sinceWallMs` 时必须保留 `seq`，否则丢掉代次痕迹。
- **复发检查点**：`rg -n "ironmanEver|ironmanModeChosen" packages/core/src/ironman.ts`；任何"重置模式选择"的脚本必须同时列出徽章后果。
- **来源**：`docs/design/ironman-mobile-import-20260928.md:36-47`；现行代码 `packages/core/src/ironman.ts:79`、`:96`。

### 坑：闸门只在导入/恢复生效、正常启动不设防——装载入口不一致
- **现象**：把旧主档替换进盘里直接启动，铁人反回滚没拦住；同一份旧档走导入却被拒。
- **根因**：`start()` 读档归一后直接采用状态，没有调用 `ironmanLoadCheck`；闸门只挂在导入/恢复路径（历史定位 `game/engine.ts:1049–1065`、`:1517–1564`）。
- **解法 / 规避**：统一装载流水线（待装载快照→校验→铁人判定→归一修复→离线结算→提交→发布状态），启动/导入/恢复共用；修复方向是让启动恢复也走现有判据，不是只补一个入口。注意这不是强反作弊承诺：单机档与账本都在玩家手里。
- **复发检查点**：`rg -n "ironmanLoadCheck" apps/desktop/src/renderer/src/game/engine.ts`（启动/导入/恢复/重连都应出现）；`npm run ironman:check`。
- **来源**：历史档案 `docs/archive/retired-docs-20261029/guoqing-audit-20261002.md:590-606`；修复 `docs/review/guoqing-audit-followup.md:14`；现行代码 `apps/desktop/src/renderer/src/game/engine.ts:1144`、`:1723`、`:1942`、`:2013`、`:2145`。

### 坑：改玩家真档的手术纪律——先关游戏、只换字段块、复读不采信工具自报
- **现象**：历史一次 GM 补偿（给误关铁人的玩家重新开启）若整档 `JSON.parse→重写`，键序、未登记字段、字节都可能变；游戏还开着则下一次自动保存直接盖掉改写。
- **根因**：存档是玩家唯一进度，任何"读进来改完写回"都可能引入额外差异；游戏在跑时有自己的保存循环，工具的自检报告也可能只看自己写的部分。
- **解法 / 规避**：①先关游戏（确认存档若干秒未变、无游戏进程）；②双备份（`%APPDATA%` + `%TEMP%`）；③外科式改写：只替换 `"ironman":{…}` 这段文本，其余字节原样透传；④三条自检：仍可解析、语义只差该块（键序无关深比较）、除该块外逐字符相同，不过即中止；⑤先在副本上试跑；⑥改写后复读核对（不采信工具自我报告），并核对字节差是否符合预期（当时 −30 字节）。
- **复发检查点**：改真档脚本必须只读挂载、不挂默认 npm script、先 dry-run；`rg -n "save-enable-ironman|save-grant-ships" tools/`（专用工具已随 2026-10-27 退役删除，恢复需船长明令）。
- **来源**：历史档案 `docs/archive/retired-docs-20261029/ironman-compensation-20260924.md:3`、`:8-16`、`:18-30`、`:33-50`。

### 坑：测试档不是"随便存一份"——命名、注册、真档注入都有反噬
- **现象**：以真档为底注入的测试档，启动时底档那 12 艘老舰队自动归位（低槽作业装备改回高槽、腾出的动能炮 MK2 退回装备库）；或测试档命名/用途对不上，验收时拿错档。
- **根因**：`tools/make-test-save.ts` 的设计就是"基于船长当前真档注入门槛"，所以底档旧口径资产会走载入修复链；命名规则又要求文件名 `<feature>` 段等于注册 case，避免一档多用。
- **解法 / 规避**：命名固定 `test-save-<feature>-<stamp>.json`；新增用途先注册脚本头注释 + `INJECTORS`，再补档案清单文档，最后才生成。加载固定四步：游戏内「存档管理→备份」→退出→复制替换 `%APPDATA%\whale-idle\save.json`→测完恢复备份；每档旁留 `user-backup-<stamp>.json`。优先全新合成档；确需真档底注入要在文档里写清"哪些老资产会被归位"。
- **复发检查点**：`npx tsx tools/make-test-save.ts <case>`；`rg -n "test-save-|INJECTORS" docs/test-saves/README.md tools/make-test-save.ts`；导入后先看日志有无自动归位记录。
- **来源**：`docs/test-saves/README.md:88`、`:90-95`、`:97-106`、`:345-347`；`docs/development-conventions.md:59`、`:61`。

## 6. 云存档与跨端口径
### 坑：云存档上传必须先落本地、必带预览版本号
- **现象**：上传成功但本地进度没保存（或反过来）；两端同时改同一云档时互相覆盖。
- **根因**：上传若先 PUT 再本地落盘，本地失败就出现"云上有、本地没有"；不带预览 `baseVersion` 的 PUT 无法发现期间已被改过。
- **解法 / 规避**：`exportCloudSave` 先把确切当前快照经本地保存桥写成功，才返回同一 text 上传。上传先 GET latest 预览（目标账号 + `baseVersion`），明确确认后才 PUT 且必带该 `baseVersion`（包括 0）；已有云档需确认替换；409 作废确认、只刷新元信息、不覆盖、不自动重试写；超时/断网只报"结果不明"并要求刷新状态。
- **复发检查点**：`npm run test -w @whale/core` 中 `cloud-engine-20261103.test.ts`；`npx tsx tools/cloud-settings-fixture.ts`；手工演练断网与 409。
- **来源**：`docs/design/cloud-settings-20261103.md:25-27`。

### 坑：云档下载要"两次核验"，写状态变了就不能载入
- **现象**：载入锁释放后设置面板残留 paused；或下载途中账号/服务已切换，仍把旧候选载进游戏。
- **根因**：下载是异步长流程：预览显示候选版本后，玩家确认期间 token、账号、请求代次、写状态都可能变化；只在开始核验一次就会把过期候选写进内存。
- **解法 / 规避**：下载 latest/历史先查 10MB 限制并用 `loadSaveFile` 严格预检格式/版本，显示候选版本、飞行员、保存时间与铁人标记；确认后再次核验 token、账号、请求代次与写状态才进引擎，不自动上传；`confirmDownload` 的 finally 重读 `saveWriteState`，避免 UI 残留 paused；写入非 ok 时禁上传和载入，但保留云元信息读取；服务切换、失效 token、卸载都使请求与旧候选失效。
- **复发检查点**：`rg -n "saveWriteState|confirmDownload|baseVersion" apps/desktop/src/renderer/src/features/cloud`；手工演练"下载确认前切账号/切服务"。
- **来源**：`docs/design/cloud-settings-20261103.md:28-30`；导入链共用说明 `:26`。

### 坑：对外口径不能超过已验证事实——域名 SNI 事故与"撤销"措辞
- **现象**：旧域名 `https://shit.fuckrapper.online` 因域名含敏感词触发运营商 SNI 过滤，国内直连 TLS 握手被重置，桌面登录报 `net_error -101`；另一头，客户端很容易把"退出登录"写成"已退出全部会话"。
- **根因**：域名、证书与运营商会话都不是本地能演算的；服务端首次注册 token 在 logout 后仍返回 200（`backendInitialSessionRevocation=false`），不在本批修复范围。
- **解法 / 规避**：换正式域名（`https://game.bajibaji.party`，Let's Encrypt、nginx 直连，不经 Cloudflare），保留单次网络层回退 IP；域名强制 HTTPS，明文只留给回退 IP 与回环；退出登录用同一 token 再核验 profile：401 才显示已撤销，200 就如实显示"已退出本机，服务端会话仍有效"，核验网络失败只声明未确认。公网 endpoint 未验、隔离桌面 smoke 在最早的 wait-idle 就因 CDP TypeError 中断（截图正常渲染也只是页面读数），这些都不能写成"已验证/全绿"。
- **复发检查点**：`npm run test -w @whale/core` 中 `cloud-settings-ui-20261103.test.ts`、`cloud-api-20261103.test.ts`；`node tools/cloud-settings-smoke.cjs`（隔离桌面，失败按失败记录）。
- **来源**：`docs/design/cloud-settings-20261103.md:16-19`、`:32-36`、`:55-61`。

## 校验回归清单
- [ ] 导入路径：`rg -n "graceMs|done = false|\uFEFF" apps/desktop/src/renderer/src/game/storage.ts`，并在 Edge/Win10 与触屏各复测一次"选档后无反应"。
- [ ] 版本门禁：`npm run save:migrate` 全样本符合预期（可读/预期拒读分开报，意外失败非零）。
- [ ] 往返保真：`npm run save:roundtrip-audit`，丢键 0、类型变化 0；注意退出 0 不等于全部样本成功。
- [ ] 新增随档字段：写入点 + `normalizeState` 白名单两处落笔，跑类型穷尽用例与往返。
- [ ] 真档纪律：任何改档先备份、先关游戏、先 dry-run；`git status` 确认没有 `docs/test-saves/save-*.json` 被跟踪。
- [ ] 离线/时间：`packages/core/tests/offline-cap.test.ts` 与 `npx tsx tools/synaptic-accelerant-check.ts` 通过；快进后 `savedAtWallMs` 已前移。
- [ ] 铁人：`npm run ironman:check`；换设备按"先导入、再选模式"走通；启动/导入/恢复都过闸门。
- [ ] 云端：`cloud-*-20261103.test.ts` + `node tools/cloud-settings-smoke.cjs`；失败按失败记录，不写"smoke 通过"。

## 相关页
- [[save-architecture]]：存档结构、读写顺序、FIFO 事务与真档保护边界的现行摘要。
- [[data-content-editing]]：静态内容与字段契约的编辑、导出流程（随档字段与静态数据的分界）。
- [[verification-and-commit]]：检查门槛与提交纪律（`save:*` / `ironman:check` 的落点）。
- [[pitfall-tooling-release]]：工具假绿、探针误读与"退出 0 不等于通过"的同源教训。
- [[pitfall-industry-economy]]：数量单位、行情历史与产量守恒的玩法侧视角。
- [[pitfall-ui-ux-perf]]：导入无反馈、设置遮罩与写状态提示的界面侧视角。
- [[pitfall-collab-docs]]：真档只读、归档授权与"历史结论不得当现行"的协作纪律。

## Sources
- 存档结构/保存/迁移现行正文：`docs/architecture.md:47-61`、`:70`；`docs/development-conventions.md:24`、`:59`、`:61`；`docs/single-source.md:137`。
- 存档测试档纪律：`docs/test-saves/README.md:30`、`:88`、`:90-95`、`:97-106`、`:345-347`。
- 导入与换设备：`docs/design/import-save-edge-20260922.md`；`docs/design/ironman-mobile-import-20260928.md`。
- 离线结算与时间基准：`docs/design/offline-cap-skill-20260922.md`；`docs/design/synaptic-accelerant-audit-20261009.md`；`docs/design/v15-debug.md`。
- 云存档与跨端：`docs/design/cloud-settings-20261103.md`。
- 历史档案（只作经验记录，旧数值/旧规则不作现行依据）：`docs/archive/retired-docs-20261029/guoqing-audit-20261002.md`（C01/C02/C05/C07/C08/C09/C10/H03）、`docs/archive/retired-docs-20261029/save-migration-floor-20260919.md`、`docs/archive/retired-docs-20261029/ironman-compensation-20260924.md`；其现行处理状态见 `docs/review/guoqing-audit-followup.md` 与 `docs/design/guoqing-audit-closeout-20261029.md`。
- 既有知识页：`.wiki/concepts/save-architecture.md`（confidence: extracted）。
