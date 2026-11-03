# 主树 Git 同步工作记录（2026-11-03）

> 状态：第一轮远端合并已提交；本地第二次 merge 待提交，尚未推送。
> 工作区：`H:\大鲸鱼\Deepseek-EVE-verify`；分支：`verify`。第二次合并目标为缓存 `origin/main = dc98d5ccbe58fc843d2bab48fdc12b14859eaf64`。

## 任务范围

- 船长要求「主树推送和GIT同步」。先在 verify 工作区整合远端 `main`，保留远端科幻 HUD/UI 更新和本地已确认的设置分类、右上角版本号、底栏许可入口及五类标签。
- 同步本地化调用、待译登记、设置分类文档及冒烟断言，保留现有 UI、文字和功能；生成索引用 `npm run docs:index` 更新。
- 当前收尾仅更新并暂存本记录、设置分类文档及生成索引，不提交、不推送。
- 后续需求：账号及云存档已要求接入设置，但新系统方案已提交船长确认、尚未获确认，本次 Git 同步不得提前接入；不读取或修改个人真档。

## 当前合并与历史保留

- 第一轮远端合并已提交为 `4e6389fe3a406381279f3ab3f3fe60c16de7b5de`，保留双方提交历史，未使用 rebase、squash 或重置。
- 当前执行 `git merge --no-commit origin/main`，合入缓存 `dc98d5ccbe58fc843d2bab48fdc12b14859eaf64`，仅追加 wiki / stock 设计文档；本地第二次 merge 尚未提交，尚未推送。
- 第一轮原始冲突为 `appSettings.tsx`、`appSettings.css`、`packages/data/src/l10n/table.ts` 和 `docs/INDEX.md`；第二轮唯一冲突为生成件 `docs/INDEX.md`，以 `npm run docs:index` 重建解决。
- 最新远端抓取失败，当前只确认缓存引用，不能据此宣称已追平真实远端或完成推送。

## 冲突处理结果

- `apps/desktop/src/renderer/src/panels/appSettings.tsx`：保留五类子页面、键盘切换、开发者门禁、右上角版本号及复制、底栏许可入口；融合远端字体选择及 Oxanium 授权内容。
- `apps/desktop/src/renderer/src/panels/appSettings.css`：保留分类与版本栏排版，融合远端 Oxanium 和复古字体覆盖，不回退远端 HUD 样式。
- `packages/data/src/l10n/table.ts`：远端已发布的 `ui.App.192–195` 保持 Oxanium 标题、元信息、来源说明和“复古”的原义及原文、英文与延期状态；本地未推送的五类标签使用独立 `ui.settingsTab.001–005`，不再占用远端 ID。调用点同步，临时映射已移除。
- `docs/l10n-pending.md`、`docs/design/settings-subpages-20261103.md`：同步上述稳定 ID 归属和英文延期登记，不准备或覆盖英文。
- `tools/settings-subpages-smoke.cjs`：配色行仍存在，移除的是“亮白／跟随系统”选项，界面页保留 7 行预期；断言核对界面行标签、默认／复古字体、五个配色选项及 Oxanium 许可小节。字体和许可标题的精确预期分别使用 `ui.App.195` 和 `ui.App.192`，不改变测试操作流程。
- `packages/core/tests/helpers/approved-mk1-copy-delta.ts`：只为 `ui.App.132`、`ui.App.134`、`ui.App.136` 加入固定精确中英期望，对应 `docs/design/settings-fixes-20261102.md` §十一的船长原话与调整项；只为英文延期的 `ui.App.180` 加入固定精确期望，对应该设计稿 §九字体两档最终口径。其他 ID 仍走既有历史快照守恒，无运行时 `L10N` 反向期望或全表豁免。
- `docs/INDEX.md`：随文档更新由 `npm run docs:index` 重建，不手改生成内容。

## 验证状态

- 已完成的合并代码验证：`npm run typecheck`、`npm run build`、`npm run l10n:check`、`npm run l10n:params`、`npm run ui:rot-check`、`npm run content:check`、文档索引检查均通过。
- 完整 `npm run test -w @whale/core`：521 个测试文件，7105 passed、9 skipped、0 failed。已批准配色与字体文案采用固定 baseline 精确期望，不回退玩家文本、不放宽其他 ID 的守恒。
- 当前三号构建的 `tools/settings-subpages-smoke.cjs` 已通过：复用主树 `H:\大鲸鱼\Deepseek-EVE` 的 Electron 31.7.7 运行时，使用隔离临时用户目录和合成档，不读取个人真档；classic / modern × zh / en 四组合全部通过，包括新字体及许可内容，runtime errors 为 0。
- 该冒烟针对三号构建，覆盖设置分类、版本栏、键盘、窄窗、偏好保持、许可及发布形态开发者门禁；结果属于功能与几何验证，不替代船长观感验收。
- 后续 wiki / stock 文档合并不改变已验证的功能代码；当前仍是本地第二次 merge 待提交、尚未推送，不把代码验证通过等同于远端同步完成。
