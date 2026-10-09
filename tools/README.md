# 工具区台账（tools/）

> 本文件是工具区的**索引 + 版本自检台账**。新增工具请两处登记：**本文件** + 工具自己的头注释
> （头注释写"用途 / 运行 / 口径 / 版本自检"四段，体例见 `pd-vs-foe-drone.ts`）。

## 一、版本自检（船长 2026-09-12 定）

> 「工具区需要进行一个备注，和之前的旧数据规则一样，**超过一个大版本的工具要检查是否和现在版本有较大偏差**。」

- **大版本判据 = 存档结构版本**：`packages/core/src/state.ts` 的 `CURRENT_STATE_VERSION`（现 **v24**）。
  它是"数据形状变了"的权威信号（字段增删/迁移），工具最容易被打穿的就是这条路。
- **每个工具的头注释写三条**：
  ```
  ⚠ 版本自检（口径同「旧数据不可靠」：超过一个大版本必须核对是否与现状偏差过大）
    - 游戏版本：v0.1.0（package.json）· 存档结构：v24（CURRENT_STATE_VERSION）
    - 本工具最后核对：YYYY-MM-DD（当日核对的内容）
    - 本工具最后跑过：YYYY-MM-DD
    - 判据：CURRENT_STATE_VERSION − v24 ≥ 2 ⇒ 必须重跑核对
  ```
- **体检入口**：`npm run tools:audit`（只读头注释，不执行工具）——输出「需重检 / 未登记 / 在版本内」三档。
  差 ≥2 个大版本 ⇒ **需重检**；差 1 或未登记 ⇒ **待确认**。
- ⚠ **不给老工具批量补登记**（船长 2026-09-12：「**调用时再检查，不用立刻更新**」）——
  口径 = **调用即核对**：谁在哪个会话里*用*某个工具，谁就当场核对它跟当前版本有没有大偏差，
  顺手把这三条补进那个工具的头注释（**用哪个补哪个**，不搞一次性大扫除）。
  在此之前 `tools:audit` 把老工具列为"待确认"就够用——它是台账，不是欠账单。

**为什么要这条**：本仓已有先例——`battle-calibrate` 曾在全表 27 张卡迁入舰级路径后**整表静默空转**
（提案字段对真卡无效、读数一格不变，极易被误读成"提案无效"＝假结论）。工具不会自己报错，
只会**安静地给你一个过时的数**。

## 二、台账（32 个工具）

| 工具 | npm script | 挂牌状态 |
|---|---|---|
| `battle-ammo-warning-desktop-check.cjs` | 构建后 `node tools/battle-ammo-warning-desktop-check.cjs` | 合成档/隔离userData/隐藏Electron，两布局与英文延期回退，技能连用与缺弹首击不写/二击开战；v31，2026-10-09，不作观感结论 |
| `synaptic-accelerant-check.ts` | 直接 `npx tsx tools/synaptic-accelerant-check.ts` | 合成状态检查手动续时、训练切换及离线8/32/64h；v31，核对/运行2026-10-09，诊断不符退出1，不读个人档 |
| `synaptic-accelerant-desktop-smoke.cjs` | 构建后 `node tools/synaptic-accelerant-desktop-smoke.cjs` | 隔离userData、隐藏Electron，合成旧档32h离线及IPC重载；v31，2026-10-09，不作观感结论 |
| `l10n-deferred-check.ts` | `l10n:check`内部调用 | v31；只核对英文延期标记/空值与待本地化文档成对，不生成英文、不放宽普通漏译/占位符护栏 |
| `startup-win-worker-check.cjs` | 双端构建后`node tools/startup-win-worker-check.cjs` | v31；隐藏隔离Electron加载桌面file/网页HTTP，合法合成16架机群、真实Worker每卡30局/单实例/输入延迟/长任务与停止清理；不读个人档，不冒称手机性能或观感 |
| `battle-step-preview.ts` / `battle-step-preview-worker.ts` | `npx tsx tools/battle-step-preview.ts`，worker仅由父工具打包 | v31；100/50/10ms步长及补算预算、装填/齐射/回充/机动与5场景多种子对照；内存注入，不改源码或个人档，前后校验哈希 |
| `data-editor-enemy-schema.ts` / `data-editor-enemy-preview.ts` | 编辑器服务调用，预览CLI由候选服务执行 | v31；六类敌人源数字字段、范围、来源和当前core派生预览；不复制战斗算法，不倒写派生值 |
| `data-enemy-migrate.ts` / `data-enemy-alien-migrate.ts` / `data-enemy-metadata.ts` | `npx tsx tools/data-enemy-migrate.ts --baseline`及显式迁移/来源登记 | v31；一次性AST源数字迁移，已迁移源码拒绝重写，六表权威数字与TS公式/引用分离；不得用于日常参数覆盖 |
| `data-editor-native-check.cjs` / `data-editor-visual-check.cjs` | `node tools/data-editor-native-check.cjs --portable`，可选蓝图/速度/六表专项 | v31；迁出目录0.1.2真实程序、同仓隔离保存/恢复与隐藏窗口，依赖必须来自已验证工作树；不读取个人档、不将几何当观感 |
| `wreck-loot-price-audit.ts` | `npx tsx tools/wreck-loot-price-audit.ts`，可调`--batches`/`--rare` | v31；全残骸普通/稀有/完好抽样、可重复装备买价、实际回收/挂售及托管补缺回归；只用合成档，不改正式值/个人档，强制完好命中不代表自然频率 |
| `alien-invasion-check.ts` / `alien-invasion-fixture.ts` | `npx tsx tools/alien-invasion-check.ts --seeds=8`，`--save`生成合成档，`--audit`导出逐舰输出 | v31；新波次/爆虫一次性动能/巢母无限补机与指挥校准，标准A0~A3及高阶合法配装、三族对照；审核分别列循环射击、爆发、护理与后备；无个人档，不改正式数值；审核模式不覆盖校准报告 |
| `alien-invasion-ui-check.cjs` | 构建后`node tools/alien-invasion-ui-check.cjs` | v31；自建隐藏Electron和隔离userData，合成末波检查两布局/两视口；不当观感验收，关闭自有PID |
| `guoqing-audit-recheck.ts` | 直接 `tsx tools/guoqing-audit-recheck.ts` | 国庆节审查 C01～C10 合成续接复核；v31，核对/运行 2026-10-03；诊断不是修复门禁，不读个人档 |
| `save-reconnect-browser-check.ts` | `npm run save:reconnect-check`（先构建 web） | C02 真实 Web Locks/OPFS/IndexedDB/UI 回归；自建服务与隔离 Edge，模拟权限/选择器，无个人档，端口占用则失败；v31，2026-10-04 |
| `mobile-page-audit.ts` | `npm run ui:mobile-pages`（先构建 web） | 合成解锁档，208 组手机页面/弹层几何＋8 组活动窗口回归，自建服务与隔离 Edge；输出诊断不冒称观感/全弹层验收；v31，2026-10-04 |
| `balance-check.ts` | `balance` | 未登记版本自检 |
| `battle-calibrate.ts` | `battle:calibrate` | 未登记版本自检 |
| `bounty-econ.ts` | `bounty:econ` | 未登记版本自检 |
| `content-check.ts` | `content:check` | 未登记版本自检（**体检契约总入口**） |
| `content-export.ts` / `content-import.ts` / `content-schema.ts` / `content-validate.ts` | `content:export` / `content:import` / — / — | 未登记版本自检 |
| `drone-vs-gun.ts` | `battle:drone-vs-gun` | 未登记版本自检 |
| `faction-audit.ts` | `faction:audit` | 未登记版本自检 |
| `firepower-curve.ts` / `foe-hp-table.ts` | — | 未登记版本自检 |
| **`foe-export.ts`** | `foe:export` | **已登记**（v25 · 核对 2026-09-17；敌人**敌舰明细**导出（xlsx 单 sheet ＋ 同列 CSV）：25 个舰级 × 56 列，含三层三系抗性/名义 DPS 分系/射程与期望交距/挂载件与机群） |
| `hit-profile.ts` | `battle:hit-profile` | 未登记版本自检 |
| `liquidity-audit.ts` | `liquidity:audit` | 未登记版本自检 |
| `loop-stop-check.ts` | — | 未登记版本自检 |
| `make-autoperf-save.ts` / `make-test-save.ts` | — | 未登记版本自检 |
| `manufacture-econ.ts` | `manufacture:econ` | 未登记版本自检 |
| `market-rarity-sim.ts` | — | 未登记版本自检 |
| `mixed-damage-review.ts` | `battle:mixed-review` | 未登记版本自检 |
| `pd-tune.ts` | `battle:pd-tune` | 未登记版本自检 |
| `pd-vs-foe-drone.ts` | `battle:pd-vs-drone` | 未登记版本自检 |
| `playthrough-sim.ts` | — | 未登记版本自检 |
| `price-audit.ts` | `price:audit` | 未登记版本自检 |
| `salvage-econ.ts` | `salvage:econ` | 未登记版本自检 |
| **`tip-audit.ts`** | `ui:tip-check` | **已登记**（v0.1.0 · 核对 2026-09-17；悬停提示**接线**体检：①同元素不许同时带 `title` 与富卡 `hoverTipProps` ②富卡元素祖先链上不许有原生 `title`（跨文件解析组件 DOM 根，只认小写宿主标签）；当日全仓 0 命中。**时机那一半**（进入后 500ms 才置空 vs 浏览器原生延迟同档的竞态）由 `ui/Tooltip.tsx`「指针一进就压」根治，静态查不出） |
| **`l10n-check.ts`** | `l10n:check` | **已登记**（v0.1.0 · 核对 2026-09-19；**唯一本地化表**（id → `{zh,en}`）体检：①id 形态 `<域>.<短名>.<三位序号>`②调用点不得再传中文源串（旧词典写法已废）③死引用（源码用了表里没有 ⇒ 界面会显示 id）④英文值禁残留中日韩字符 ⑤中英占位符 `{n}` 集合逐个相同 ⑥值非空/无首尾空白；另出「未接线条目 / 未译读数 / 同中文串多条目」报告，不阻断） |
| **`l10n-wrap.ts`** | `l10n:wrap` | **已登记**（v0.1.0 · 核对 2026-09-19；P3 界面批**批量接线器**：AST 找出四类安全位置（JSX 文本子节点 · 展示类属性字符串初值 · JSX 三元/逻辑分支 · 旧写法 `t('中文')` 的参数）换成 `tr('ui.<文件短名>.<序号>')`，并**把中英两列追加进唯一表**；英文由 `--en=<json>` 给（缺译一律不包，绝不产出 `en: ''`）；跨行/标点碎片不碰，列「需人工拆句」清单；同一中文串复用既有条目） |
| `travel-matrix.ts` | `travel:matrix` | 未登记版本自检 |
| **`wormhole-econ.ts`** | `wormhole:econ` | **已登记**（v25 · 核对 2026-09-13；虫洞层收益校准：逐层真实战斗 + 期望原矿收益） |
| **`ui-probe.ts`** | `ui:probe` | **已登记**（v24 · 核对 2026-09-12） |
| **`ui-geom.ts`** | `ui:geom` | **已登记**（v24 · 核对 2026-09-12） |
| **`tools-audit.ts`** | `tools:audit` | **已登记**（v24 · 本体检工具自身） |

> 26 个老工具的「未登记」不是缺陷、是**历史**：它们是逐批长出来的，当时没有版本自检这条规矩。
> 按上面的口径**不批量补**，改为**调用时再检查**（谁用谁补）。

## 三、工具产物的落点纪律

- 一次性探针一律 `_` 前缀、收尾二选一（转正 / 删除）；
- **可重建的产物**（截图 / 读数 JSON / 注入档）统一落 `tools/_ui-artifacts/`，**不入库**；
  ⚠ 本条只管**产物放哪**——**不强制产出**：改界面**不要求**必须交无头 Chrome/CDP 实测与截图
  （2026-09-13 船长裁定，见 `docs/development-conventions-changelog.md` 2026-09-11 条与 `AGENTS.md` §1 末条：
  验证标注只在容易被误读的场合才写；界面改动以"四连全绿"为准，按需取证）；
- 工具自己写产物目录时**先 `mkdirSync(recursive)`**，并在缺输入时给出"怎么造"的明确提示，
  不要留下"文件找不到"的谜题。
