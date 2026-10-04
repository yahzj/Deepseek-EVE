# Git提交审批放行

> 船长2026-10-04明确批准。本机制只解决B类审批结果落不到钩子的问题，技术检查不跳过。

## 使用顺序

1. 先在聊天中获得明确批准，记录本批用途、精确文件范围、风险和批准原话。
2. 整理暂存区；已跟踪工作文件必须与暂存内容一致，避免检查读到另一版代码。
3. 查看需裁定范围：`npm run commit:approval -- status`。
4. 登记已批准路径：`node tools/git-gate-approval.cjs approve --reason "船长明确批准依据" -- packages/core/src/save.ts docs/test-saves/example.json`。路径必须逐个列出，禁止通配符或无关路径。
5. 正常运行`git commit`或`npm run commit:msg`；不用`--no-verify`。

PowerShell传递`--`时可直接调用`node`，不要将含引号的多行批准文本拼进原生命令参数。批准依据用单行中文并避免半角双引号。

## 约束

- 审批文件位于当前工作树Git目录的`whale-gate-approval.json`，不入库、不写个人存档；绑定工作树、分支、HEAD、合并父提交、完整暂存树和精确批准路径。
- `save.ts`、测试档、铁人相关路径以及标定表/封存工具仍受审批约束；原合并继承豁免保留。
- 暂存内容、分支、基线或工作树变化即失效；重新登记前经办人须重新核对人的授权，不得自动扩大批准范围。
- `typecheck`、`content:check`、`l10n:check`、`ui:rot-check`照常全部执行；任意失败拒绝提交，批准不能压过技术错误。
- 技术检查成功后记录待提交回执，`post-commit`核对实际提交树与父提交再消费批准；失败可按原批准重试，不会提前消费。
- 撤销本工作树批准：`npm run commit:approval -- revoke`。
- 这是流程检查，不是身份认证或防代理伪造的安全边界。经办人始终需要真实的人类批准。

## 回归

`npm run test -w @whale/core -- git-gate-approval-20261004.test.ts`在独立临时Git仓库测试内容变更失效、跨工作树拒绝、范围不完整、合并豁免、真实技术失败阻断与成功消费，不读取个人档。
