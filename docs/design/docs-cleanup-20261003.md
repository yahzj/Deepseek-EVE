# 文档整理第一批

> **状态：进行中**（零号 · dsh/c01-save-transaction · 2026-10-03）
> 船长原话：「规则已经整理好了，接下来对文档进行整理」

## 范围与判据

- 本批只整理文档目录，不改游戏代码、数据、测试、提交钩子或规则正文。
- 归档判据沿用 `docs/design/archive/README.md`：被后续交接件替代、且不再承担当前接手入口的旧交接卡移入归档区。
- 公告待审稿、存在待裁决点的设计稿、仍被当前工作引用的文档保留在 `docs/design/` 一线目录。
- 归档只移动文件并修正必要的路径引用，不改归档件正文结论。

## 本批归档候选

- `handoff-20260914-to-new-pilot1.md`：已被后续一号交接件替代。
- `handoff-20260920-to-new-pilot1.md`：已被 2026-10-02 一号收尾交接件替代。
- `handoff-20260926-to-pilot2.md`：已被后续二号交接件替代。
- `handoff-20260927-main.md`：已被后续一号收尾交接件替代。
- `handoff-20260927-verify.md`：已被后续三号交接件替代。
- `handoff-20260930-d2.md`：已被后续二号交接件替代。
- `handoff-20260930-verify.md`：已被后续三号交接件替代。
- `handover-20261001.md`：已被 2026-10-02 一号收尾交接件替代。

## 明确保留

- `handoff-foe-mounts-l10n-20260924.md`：专门的本地化交接件，未从当前材料确认已完成，不移动。
- `handover-20261002.md`、`handover-erhao-20261002.md`、`handover-yihao-20261002.md`：当前最新交接入口，保留。
- `announcement-draft-20260926-battleships.md`、`announcement-draft-20260929.md`、`announcement-draft-20260930.md`、`announcement-draft-20261002-corona.md`：仍有待审、待裁决或发布前置，不移动。

## 整理动作

- 已执行：移动 8 份旧交接卡到 `docs/design/archive/`。
- 已执行：更新归档区清单和移动产生的活跃文档引用；归档件正文只做必要的路径维护。
- 已执行：`npm run docs:index`，生成 436 份文档、841 行索引；`docs:index --check` 通过。

## 验证与收尾

- 已通过：`git diff --check`、文档索引校验、归档路径存在性检查、旧路径检索、编码/行尾检查（无 BOM、CRLF、无 LF-only）。
- 本批属于文档归档，不运行全量业务测试；不得借归档动作删除未结案内容。
- 船长验收并合入 main 后，按第十五章删除本工作文档；关键归档结论已写入归档区 README。
