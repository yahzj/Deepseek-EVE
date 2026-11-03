# 主树 Git 同步工作记录（2026-11-03）

> 状态：本地 merge 尚未提交；最新 `origin/main` 抓取失败，远端同步与推送均未完成。
> 工作区：`H:\大鲸鱼\Deepseek-EVE-verify`；分支：`verify`。最后可见 `origin/main` 为 `dc98d5ccbe58fc843d2bab48fdc12b14859eaf64`，不是本次成功 fetch 确认的最新远端状态。

## 用户授权摘要

- 船长要求「主树推送和GIT同步」。先在 verify 工作区整合远端 `main`，保留远端科幻 HUD/UI 更新和本地已确认的设置分类、右上角版本号、底栏许可入口及五类标签。
- 已授权同步本地化调用与待译登记、设置分类工作文档和冒烟断言，并用 `npm run docs:index` 更新生成索引；只调整 ID、文档及测试预期，不改变其他 UI、文字或功能。
- 本次收尾授权暂存四份文档 / 测试变更及刷新后的索引，不提交、不推送。主代理负责统一验证和后续远端推进处理。
- 后续需求：账号及云存档已要求接入设置，但新系统方案已提交船长确认、尚未获确认，本次 Git 同步不得提前接入；不读取或修改个人真档。
- 主代理 core 全量回归运行中报告 `l10n-deferred-20261009.test.ts` 的 `ui.App.132` 守恒断言失败；用户明确授权修改测试 helper 和必要专项测试，以固定精确期望放行有当前设计依据的批准文案，不回退文字、不改功能源码、不放宽全表守恒，并复跑失败测试。其他全量结果由主代理汇总。

## 当前合并与历史保留

- 沿用正在进行的 `git merge origin/main`，不改为 rebase、squash 或重置，保留双方提交历史；本地 merge 尚未提交。
- 当前合并的本地父提交为 `1a3196789710b1900a41e943a6e737880227bb33`，`MERGE_HEAD` 为 `8acaea9d01ca1700532b496ff5151e703d27d1ae`；尚未创建合并提交。
- 最新 `git fetch origin main` 失败；最后可见的本地远端跟踪引用为 `origin/main = dc98d5ccbe58fc843d2bab48fdc12b14859eaf64`。该提交可能落后于真实远端，不能宣称已追平。主代理负责网络恢复后重新抓取并处理 `origin/main` 超前于 `MERGE_HEAD` 的部分。
- 原始冲突范围为 `appSettings.tsx`、`appSettings.css`、`packages/data/src/l10n/table.ts` 和生成件 `docs/INDEX.md`。冲突标记及未合并条目已清除，其他合并结果保留。

## 冲突处理结果

- `apps/desktop/src/renderer/src/panels/appSettings.tsx`：保留五类子页面、键盘切换、开发者门禁、右上角版本号及复制、底栏许可入口；融合远端字体选择及 Oxanium 授权内容。
- `apps/desktop/src/renderer/src/panels/appSettings.css`：保留分类与版本栏排版，融合远端 Oxanium 和复古字体覆盖，不回退远端 HUD 样式。
- `packages/data/src/l10n/table.ts`：远端已发布的 `ui.App.192–195` 保持 Oxanium 标题、元信息、来源说明和“复古”的原义及原文、英文与延期状态；本地未推送的五类标签使用独立 `ui.settingsTab.001–005`，不再占用远端 ID。调用点同步，临时映射已移除。
- `docs/l10n-pending.md`、`docs/design/settings-subpages-20261103.md`：同步上述稳定 ID 归属和英文延期登记，不准备或覆盖英文。
- `tools/settings-subpages-smoke.cjs`：配色行仍存在，移除的是“亮白／跟随系统”选项，界面页保留 7 行预期；断言核对界面行标签、默认／复古字体、五个配色选项及 Oxanium 许可小节。字体和许可标题的精确预期分别使用 `ui.App.195` 和 `ui.App.192`，不改变测试操作流程。
- `packages/core/tests/helpers/approved-mk1-copy-delta.ts`：只为 `ui.App.132`、`ui.App.134`、`ui.App.136` 加入固定精确中英期望，对应 `docs/design/settings-fixes-20261102.md` §十一的船长原话与调整项；只为英文延期的 `ui.App.180` 加入固定精确期望，对应该设计稿 §九字体两档最终口径。其他 ID 仍走既有历史快照守恒，无运行时 `L10N` 反向期望或全表豁免。
- `docs/INDEX.md`：随文档更新由 `npm run docs:index` 重建，不手改生成内容。

## 验证状态

- 主代理报告以下检查均已通过：`npm run typecheck`、`npm run build`、`npm run l10n:check`、`npm run l10n:params`、`npm run ui:rot-check`、`npm run content:check`、`npm run docs:index -- --check`。
- 完整 `npm run test -w @whale/core` 全量通过：7105 passed、9 skipped、0 failed。此前两条 `ui.App.132` 固定快照失败已按现行设计证据更新 baseline helper 精确期望（`ui.App.132/134/136/180`），未回退文案、未改功能源码、未放宽其他 ID 的守恒；两条失败用例定向复跑通过。
- 设置 Electron smoke 未验证：依赖通过 `npm ci --ignore-scripts` 恢复，但 Electron binary 未安装 / 不可用，因此本次不能运行 `tools/settings-subpages-smoke.cjs`。`build` 通过不代表 Electron smoke 通过；合并产物上的中英、classic / modern、窄窗、字体及许可、版本栏、键盘与发布版开发者门禁仍待 Electron binary 可用后验证。旧 smoke 报告不代表当前产物。
- 上述通过状态不改变 Git 状态：本地 merge 仍未提交，最新 fetch 失败，远端推送未完成；后续由主代理重试抓取并处理更新后的 `origin/main`。观感验收由船长执行。
