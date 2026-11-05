# 待验收项批量验收台账 · 2026-11-05

> 状态：已生效（2026-11-05 船长指示执行）· 本页为验收台账，非待办文档
> 经办：主代理；范围：现行 docs/ 下状态行原文为「待验收」的文档；本批不推送。

## 一、判定口径

不采用 `docs/INDEX.md` 的归一状态列。生成器 `statusOf()` 只取状态行第一个分句，会把「已实现、专项自测通过，待船长验收」截成「已确认/已实现」，也会把「待船长验收」误归成「待裁定」。本批一律按**完整状态行原文**分类：

| 组别 | 份数 | 本批动作 |
| --- | --- | --- |
| 纯待验收 | 71 | **已验收**：状态行后追加验收结论，原状态行保留 |
| 带裁决 | 34 | 一字不动，逐份详细列在 `归档区/pending-decisions-20261105.html` |
| 进行中＋待验收（边界） | 16 | 一字不动，状态行仍标「进行中」，见 `归档区/boundary-20261105.csv` |
| 纯进行中 | 28 | 一字不动 |

## 二、验收边界（重要）

- **只收口文档验收状态**：每份在状态行后追加一行「验收结论：已验收（2026-11-05…）」，并按该文档状态行原有格式（引用块 `> `／列表 `- `／纯文本）书写，**原状态行原样保留**。
- **不篡改历史事实**：状态行里的「未提交／未合入／未推送」「待集中验收」等记录不删不改。本次验收**不代表**代码已合入 main、已推送或已部署。
- **不迁移**：本批不移动任何文档，`docs/INDEX.md` 的收录范围不变；上一轮 A/B/C 迁移议题仍搁置。
- **不改规则**：`AGENTS.md`、开发约定、公告闸门 §7 一字未动；含「公告审核／审字」的文档仍列入带裁决清单，不因本次验收视为公告获批。
- **可逆**：71 份原文备份在 `_docs-backup-20261105/acceptance-20261105/`，逐份前后 SHA256 在 `归档区/acceptance-20261105.csv`；删掉追加的那一行即完全还原。

## 三、已验收 71 份（按月 2026-09 17 / 2026-10 34 / 2026-11 19 / 无日期 1）

| 文档 | 日期 | 原状态行（保留） |
| --- | --- | --- |
| `docs/design/acid-burster-charge-20261009.md` | 2026-10-09 | 已实现，自测完成，待船长验收/发布，一号main，2026-10-09。 |
| `docs/design/audio-ingest-20261104.md` | 2026-11-04 | 已实现、专项自测通过，待船长验收（2026-11-04） |
| `docs/design/battle-card-range-memory-20261021.md` | 2026-10-21 | 已实现，自测通过，待船长验收（二号 · d2/workspace · 2026-10-21） |
| `docs/design/battle-range-confirm-clarity-20261023.md` | 2026-10-23 | 已确认，已实现，待船长验收（二号 · d2/workspace · 2026-10-23） |
| `docs/design/black-market-bulk-resource-fix-20261013.md` | 2026-10-13 | 已实现，自测通过；待验收及发布（二号 · d2/workspace · 2026-10-13） |
| `docs/design/boost-copy-ammo-warning-20261009.md` | 2026-10-09 | 已合入主树，主树专项/构建/八组外壳通过，待集中验收；未推送（零号 · dsh/zero-integration-20261009 · 2026-10-09） |
| `docs/design/bounty-ambush-20260928.md` | 2026-09-28 | 已实现（自测全绿，待船长验收） |
| `docs/design/bounty-standing-20261030.md` | 2026-10-30 | 已实现，60门槛专项通过，待船长验收（二号 · d2/workspace · 2026-10-30） |
| `docs/design/code-review-20261002.md` | 2026-10-02 | 已交付报告（待船长验收与排期） |
| `docs/design/combat-command-implementation-20261030.md` | 2026-10-30 | 实现与本地专项验证完成，待船长验收；未合入主树、未推送（二号 · d2/workspace · 2026-10-31）。功能范围与下表必要大文件定向拆分已获船长「确定」批准。 |
| `docs/design/command-fleet-all-ships-save-20261031.md` | 2026-10-31 | 已生成并通过自动核验，待船长实机验收。二号，d2/workspace，2026-10-31。 |
| `docs/design/datadog-dashboard-ui-20261102.md` | 2026-11-02 | 待验收（2026-11-02 施工完成，待船长集中验收） |
| `docs/design/debug-invasion-autostart-pause-20261018.md` | 2026-10-18 | 已实现并自检，待验收（三号 · verify · 2026-10-18） |
| `docs/design/drone-hull-start-fix-20261009.md` | 2026-10-09 | 按船长设定修正完成，待验收/发布，一号main，2026-10-09。 |
| `docs/design/drone-rack-low-20260927.md` | 2026-09-27 | 已实现待船长验收 |
| `docs/design/drone-range-20260927.md` | 2026-09-27 | 已实现待船长验收 |
| `docs/design/drone-range-20260928.md` | 2026-09-28 | 数值已改（自测全绿，待船长验收）· Excel 已重导（但见 §四的缺口） |
| `docs/design/drone-shield-projector-20260927.md` | 2026-09-27 | 已实现待船长验收 |
| `docs/design/ecm-fleet-decay-20260929.md` | 2026-09-29 | 已实现待验收（落码＋闸门全绿；两条待船长点名见 §六） |
| `docs/design/ecm-stacking-copy-20260926.md` | 2026-09-26 | 已实现 · 待船长验收（本地产物已重建，需重启游戏）。归档按 AGENTS.md §8。 |
| `docs/design/encounter-sunk-ship-20260928.md` | 2026-09-28 | 已修复（自测全绿，待船长验收） |
| `docs/design/enemy-fleet-rebalance-20261031.md` | 2026-10-31 | 船长已批准，已实施并通过受影响专项自测；待船长验收，未合入、未发布。 |
| `docs/design/enemy-fleet-sustain-20261031.md` | 2026-10-31 | 合成实战读数，待船长实机验收；二号工作区，2026-10-31。 |
| `docs/design/enemy-fleet-vault-focus-20261031.md` | 2026-10-31 | 合成实战读数，待船长实机验收；二号工作区，2026-10-31。 |
| `docs/design/faction-plug-tuning-20261102.md` | 2026-11-02 | 船长授权“由你决定，包括前面的调整一起执行”，已实现并完成专项验证，待实机验收；未提交、合入或推送。 |
| `docs/design/faction-plugin-expansion-20261104.md` | 2026-11-04 | 危机超载速度惩罚追加已落地，主代理追加验证完成：5 个相关专项文件共 81 项全部通过，最新四包 typecheck、content:check、build 及指定 5 文件 git diff --check 全部通过， |
| `docs/design/fleet-command-license-standing-20261031.md` | 2026-10-31 | 实现、专项回归和隔离桌面验证完成，待船长验收。二号，d2/workspace，2026-10-31。 |
| `docs/design/fleet-command-standing-unlock-20261031.md` | 2026-10-31 | 实现、专项回归与隔离桌面冒烟完成，待船长验收。二号，d2/workspace，2026-10-31。 |
| `docs/design/fleet-support-final-20261101.md` | 2026-11-01 | 二号实现与专项自测完成，待船长验收；分支d2/workspace，未提交、未合入、未推送。 |
| `docs/design/foe-unit-naming-20260909.md` | 2026-09-09 | 已确认·已实现（待合入验收）。 |
| `docs/design/gravekeeper-flagship-finish-20261018.md` | 2026-10-18 | 已复现并修复，专项自测完成，待验收（三号 · verify · 2026-10-18） |
| `docs/design/guoqing-audit-closeout-20261029.md` | 2026-10-29 | 已实现，自测通过，待船长验收（二号 · d2/workspace · 2026-10-29开工，10-30收口，初始基线32951a897，已同步主树e1a0919a） |
| `docs/design/hauling-load-dialog-20261101.md` | 2026-11-01 | 船长2026-11-01确认，二号已实现并专项验证，待船长实机验收；未合入或推送。 |
| `docs/design/history-doc-cleanup-20261029.md` | 2026-10-29 | 清理与专项检查完成，待船长审阅（一号 · main · 2026-10-29启动，2026-10-30收尾） |
| `docs/design/hold-ux-20260922.md` | 2026-09-22 | 四条已全部落码，待船长验收（2026-09-23 补齐 ①残骸分色 / ④清单类型分隔线；②格区独立滚动 / ③Ctrl+点击 已合入） |
| `docs/design/industry-domain-folders-20261030.md` | 2026-10-30 | 实施与专项完成，待船长验收；本地提交，不推送（一号 · main · 2026-10-30） |
| `docs/design/industry-line-parity-20261001.md` | 2026-10-01 | 已落地（甲案 ＋ 修组装机循环 BUG ＋ 炉子补 1 秒化 ＋ 口径入册；等船长验收） |
| `docs/design/ironman-mobile-import-20260928.md` | 2026-09-28 | 已办（待船长验收） |
| `docs/design/loop-range-confirm-minimize-20261026.md` | 2026-10-26 | 已确认，已实现，自测通过，待船长验收（二号 · d2/workspace · 2026-10-26） |
| `docs/design/market-domain-folders-20261030.md` | 2026-10-30 | 实施与专项完成，待船长验收；本地提交，不推送（一号 · main · 2026-10-30） |
| `docs/design/oarfish-escort-readings-20261101.md` | 2026-11-01 | 多波增幅实现及独立合成实测完成，待船长验收；不代表长期可持续净收益或总体胜率。 |
| `docs/design/oarfish-support-calibration-20261101.md` | 2026-11-01 | 二号完成本轮取数，待船长审阅；船长同意继续新版实战重测。仅独立合成取数，不调整生产参数，不读个人档，不提交合入推送。 |
| `docs/design/online-chat-20261103.md` | 2026-11-03 | 2026-11-04 已在本地将 f0a43c0ba 快进合入主树 main。同步后本地专项检查与桌面冒烟已通过，待船长测试验收；后端未部署、未公网联调，主树未推送，尚未发布。 |
| `docs/design/planetary-surface-ui-20261010.md` | 2026-10-10 | 已实现并自检，待船长观感验收（一号 · main · 2026-10-10） |
| `docs/design/planetary-wheel-traits-20261011.md` | 2026-10-11 | 已实现并自检，待船长观感验收（一号 · main · 2026-10-11） |
| `docs/design/plug-cargo-and-fit-slot-20260926.md` | 2026-09-26 | 已实现 · 待船长验收（本地产物已重建，需重启游戏）。归档按 AGENTS.md §8。 |
| `docs/design/plug-slot-persist-20260928.md` | 2026-09-28 | 已修复（自测全绿，待船长验收） |
| `docs/design/range-ew-strength-proposal-20261031.md` | 2026-10-31 | 船长回复「确定」，整套方案获批；实现与专项验证已完成，待船长玩法/观感验收及集中整库回归，未提交、未合入、未推送。 |
| `docs/design/refining-yield-params-20261031.md` | 2026-10-31 | 已修复并完成本地验证，待船长验收（二号 · d2/workspace · 2026-10-31）；未合入主树、未推送。 |
| `docs/design/repair-drone-logistics-20261101.md` | 2026-11-01 | 船长已确认，二号已实现并完成专项验证，待实机验收；未提交、合入或推送，未读取个人档。 |
| `docs/design/repair-drone-market-20261102.md` | 2026-11-02 | 船长授权由二号决定参数并一起执行，成品与两种图纸已落地并完成专项自测，待实机验收；未提交合入推送，不读取个人档。 |
| `docs/design/return-log-copy-20261002.md` | 2026-10-02 | 已落码 · 待船长验收（文案调整经船长 2026-10-02「允许你对文案进行调整」授权； |
| `docs/design/scan-stacking-richtext-20261018.md` | 2026-10-18 | 修复完成，待验收（三号 · verify · 2026-10-18） |
| `docs/design/settings-subpages-20261103.md` | 2026-11-03 | 设置分类及第一轮远端同步已包含在本地合并提交 4e6389fe3；第二次文档 merge 待提交，尚未推送。当前构建检查与设置冒烟通过，观感待船长验收。经办：三号（verify）。 |
| `docs/design/settlement-contract-desire-drone-20260928.md` | 2026-09-28 | 前两件已办（自测全绿，待船长验收）· 第三件只出读数（见 §三） |
| `docs/design/sfx-console-20261104.md` | 2026-11-04 | 已实现自测，待船长验收（2026-11-04）。经办：零号（AI）· 分支：main · 日期：2026-11-04。 |
| `docs/design/signal-auto-estimate-20261102.md` | 2026-11-02 | 船长2026-11-02回复「按你推荐来」，二号实现与专项自测完成，待实机验收；分支d2/workspace，未提交、未合入、未推送。船长原话：「关于信号空间的自动探索，能否出一个简化算法，不用实际模拟进行，而是根据玩家 |
| `docs/design/signal-auto-weight-20261011.md` | 2026-10-11 | 已实现，自测中，待验收（二号 · d2/workspace · 2026-10-11） |
| `docs/design/signal-beacon-siege-torpedo-20261019.md` | 2026-10-19 | 实现完成，待专项验收（三号 · verify · 2026-10-19） |
| `docs/design/skills-domain-folders-20261030.md` | 2026-10-30 | 实施与专项验证完成，待船长验收；本地提交，不推送（一号 · main · 2026-10-30） |
| `docs/design/skills-merge-20260923.md` | 2026-09-23 | 已落码，待船长验收（core 前置按等级 / 一键补齐 / 取消级联 + 技能页图标·列表切换与确认条） |
| `docs/design/sortie-departure-20261102.md` | 2026-11-02 | 船长已明确“确认”完整实施方案，二号实现与专项自测完成，待船长验收；未提交、未合入、未推送，不改个人真档。 |
| `docs/design/sound-layers-20261102.md` | 2026-11-02 | 实施中（待船长验收）。经办：零号（AI）· 分支：main · 日期：2026-11-02。 |
| `docs/design/sound-system-20261102.md` | 2026-11-02 | 已实现 + 独立审查修复完毕，待船长验收（2026-11-02）。经办：零号（AI）· 分支：main · 日期：2026-11-02。 |
| `docs/design/stellar-readability-20261011.md` | 2026-10-11 | 已实现并自检，待船长观感验收（一号 · main · 2026-10-11） |
| `docs/design/stock-exchange-backend-b0-20261103.md` | 2026-11-03 | B0-1 已实现，待船长验收（2026-11-03 交付；本地提交 c1c4cd7，未推送） |
| `docs/design/ui-scifi-hud-refinement-20261103.md` | 2026-11-03 | 已完成 · 待船长验收 |
| `docs/design/unbox-result-ledger-20261013.md` | 2026-10-13 | 已实现，自测通过；待船长观感验收及发布（二号 · d2/workspace · 2026-10-13） |
| `docs/design/whale-king-price-20260929.md` | 2026-09-29 | 已实现待验收（落码＋闸门全绿；两条待船长点名的边界见 §五） |
| `docs/design/wreck-log-20260927.md` | 2026-09-27 | 已实现待船长验收 |
| `docs/review/guoqing-audit-followup.md` | — | 已复核修复，待船长验收；下表仅代表列出的逻辑问题，不代表原报告所有建议均完成。 |

## 四、未纳入、待船长处理

- **带裁决 34 份**：`归档区/pending-decisions-20261105.html`（可按裁决点类型、日期、被引数筛选）与同名 CSV。含公告闸门、方案/数值裁定、方向确认、挂起待启、设计审查等类型，逐份给出完整状态行、正文未决点摘录与建议下一步（归纳，不代裁决）。
- **进行中＋待验收 16 份**：状态行开头仍写「进行中」，尾部写「待船长验收」，本批按「仅待验收」口径未动；船长一句话即可按同样方式验收。
- **纯进行中 28 份**：在途工作，不在本批范围。

## 五、留痕

逐份清单与 SHA256：`归档区/acceptance-20261105.csv`、`归档区/boundary-20261105.csv`、`归档区/pending-decisions-20261105.csv`；生成脚本 `_docs-backup-20261105/accept-20261105.cjs`。
