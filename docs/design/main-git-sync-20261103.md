# 主树 Git 同步工作记录（2026-11-03）

> 状态：本地第三次 merge 待完成、待验证，尚未推送。
> 工作区：`H:\大鲸鱼\Deepseek-EVE-verify`；分支：`verify`。

## 同步状态

- 前两次合并已提交为 `4e6389fe3`、`5e7e0deb1`，保留双方历史；本地 `main` 已在 `5e7e0deb1`。
- 当前第三次 `merge origin/main` 目标为 `4f40589e0c91b192441642fc0e4bcc2861a96348`，尚未提交，尚未推送。
- 本次处理 `apps/server/README.md` 的 modify/delete 冲突、生成索引及测试隔离适配，不修改功能代码。

## 冲突处理

- `apps/server/README.md` 保留远端新增的迁出提醒，改为简短指路：后端独立位于 `H:\大鲸鱼\deepseek-EVE-Background`，不属于本仓库的 npm workspace；不恢复旧部署或旧账号说明。
- `docs/INDEX.md` 用 `npm run docs:index` 重建解决，不手改索引内容。
- 既有设置整合保留远端科幻 HUD、字体和许可内容，以及本地五类标签、右上角版本号和底栏许可入口；已发布 `ui.App.192–195` 原义不变，分类使用 `ui.settingsTab.001–005`。

## 验证边界

- 第三次合并前的类型、构建、内容、本地化、参数、UI 及索引检查已通过；core 全量为 521 个测试文件，7105 passed、9 skipped、0 failed。
- 第三次合并前的三号构建设置冒烟已通过：复用主树 Electron 31.7.7，使用隔离用户目录及合成档，classic / modern × zh / en 四组合通过，包含新字体许可，runtime errors 为 0；不读取个人真档，不替代观感验收。
- 第三次合并后的统一 core 回归为 520 个文件通过、1 个文件失败，7101 passed、9 skipped、4 failed；唯一失败文件为 `invasion-autoloop-ui-20261008.test.ts`，原因是 VM 提取活动行时缺少新增本地组件 `SmoothFill`。
- 仅修测试隔离：同时提取真实 `SmoothFill`，提供首帧 Hooks 桩并执行组件，保留百分比、秒数、停止命令、跳转及入侵标签原断言。专项复跑 8/8 通过，不验证动画时序，不修改功能组件。
- 修复后尚未重跑完整 core 回归，不能据专项结果宣称第三次合并全量已通过；第三次 merge 仍待提交，未推送。
- 后续账号 / 云存档接入设置的需求待范围确认，本轮不实现。
