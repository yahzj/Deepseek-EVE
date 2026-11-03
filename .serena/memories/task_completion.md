# Task Completion & Verification Checklist

在完成任务并向船长汇报前，主代理必须统一执行以下闭环校验：

1. **类型检查**:
   ```bash
   rtk npm run typecheck
   ```
   必须确保 4 个 workspace 均 0 错误（tsc --noEmit）。

2. **内容与游戏数据契约**:
   ```bash
   rtk npm run content:check
   ```
   验证装备、商品、技能、蓝图、通讯等交叉引用与数据模型合法性。

3. **UI / CSS 契约 (若修改了前端界面或样式)**:
   ```bash
   rtk npm run ui:rot-check
   rtk npm run ui:layout-css
   rtk npm run ui:layout-css -- --check
   ```
   确保 modern 与 classic 双份样式同步无漂移，旋转与层级契约完备。

4. **文档与规则同步 (若涉及文档变动)**:
   ```bash
   rtk npm run docs:index
   ```
   重新生成 `docs/INDEX.md`。若修改规则，必须检查 `docs/development-conventions-changelog.md` 已记录。

5. **逻辑与专项测试 (若修改了 core 逻辑)**:
   ```bash
   rtk npx vitest run packages/core/test/<受影响的专项>.test.ts
   ```
   全量验收时执行 `rtk npm run test -w @whale/core`。

6. **临时文件清理**:
   核对并清理一次性探针、调试脚本（以 `_` 开头的临时文件）。确保 `rtk git status` 只包含任务预期范围内的修改。
