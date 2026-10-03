# 调试模式允许载入铁人存档

- **状态**：进行中（实现完成 · 本批闸门见 §四；等船长验收）
- **船长令**：**「新增，调试模式允许载入铁人存档」**
- **三问裁定（船长）**：① **备份恢复 ＋ 导入 两条路都放行**；② 判据**只用本机调试门禁** `debugEnabled()`；
  ③ **不记救援**；另批"给造档工具加一个开关"⇒ 加 `--keep-ironman`。
- **本批落点（模块自报 §2.1）**：**存档与元系统**（铁人装载闸门这一条链：core 判据 ＋ 渲染层取数口 ＋
  造档工具）。**参照的同类子模块**：闸门本身的既有结构（判据收口在 core 纯函数 `ironmanLoadVerdict`，
  渲染层只负责"取三个数"）——本批照它的形状**只加一格入参**，不在渲染层另写判据。**是否跨域**：**否**
  （工具 `make-test-save.ts` 是同一条链的造档端，属工程侧）。

## 一、现状（改前，事实与行号）

- **判据本体** = `packages/core/src/ironman.ts` 的 `ironmanLoadVerdict`（唯一实现）；
- **取数口** = `apps/desktop/.../game/engine.ts` 的 `ironmanLoadCheck`，被**两处**调用：
  - `restoreBackup`（engine.ts:1723）—— **读取备份**；
  - `importSaveFromFile`（engine.ts:1820）—— **导入外部档**。
  ⇒ 一处改动覆盖两条路。
- **现行规则**（船长 2026-09-23/24）：只看"来档是不是铁人档"——是铁人档且代次 < `max(当前档代次, 账本最高代次)`
  ⇒ 拒绝；**唯一例外** = 来档年龄 ≥48h ⇒ 按「救援」放行并记一笔；普通档一律放行。
- **主进程没有闸门逻辑**（只有账本读写，`apps/desktop/src/main/index.ts`）⇒ 本批不动主进程。

## 二、改法（逐条）

1. **core**：`ironmanLoadVerdict` 的入参加一格 **可选** `bypass?: boolean` —— `true` ⇒ **一律放行**且
   `rescue: false`（船长三答之③"不记救援"）。**默认行为逐字不变**（不传 = 老的判定）。
2. **渲染层**：`ironmanLoadCheck` 开头加一句 —— 本机调试门禁开着 ⇒ 直接放行并 `console.warn` 一条
   （开发侧可见；发布版不可达），避免多读一次账本 IPC；判据本体仍是 core（传 `bypass: debugEnabled()`）。
3. **造档工具**：`tools/make-test-save.ts` 加 `--keep-ironman`（保留铁人标记）＋ 把两处"剥标记"收成
   一个单点 `handleIronmanForTestSave`；用法行同步；功能名解析改为"第一个不以 `--` 开头的参数"
   （这样开关放前面也行）。**默认行为逐字不变**（不加开关照样剥）。

## 三、安全根据与取舍（如实记账）

- **为什么这条口子安全**：`debugEnabled()` = **本机门禁**（协议 http(s) 且宿主是本机/内网）
  ∧ 本机 `localStorage['whale-idle:debug']` ⇒ **发布版恒 false**（公网域名 / 桌面打包版 `file:` 都进不来）
  ⇒ 玩家侧**不可达**，等于一个只在开发机上生效的开关。
- **取舍**：旁路开着时，「**关掉铁人 ⇒ 把关闭前的旧铁人档导回来**」也会放行 —— 那本是闸门要挡的一条。
  这是"允许载入铁人存档"的必然含义；船长已知情并选「甲」（若要留痕，可改成按"救援"记一笔 —— 见船长
  三答之③的备选「丙」）。
- 不动：48h 救援规则 · `syncIronmanHead`（载入档代次照旧顶到账本高度）· 铁人福利乘区 · 主进程 ·
  任何玩家可见文案（只 `console.warn`）。

## 四、涉及文件与验证

- **新增**：`packages/core/tests/ironman-gate-bypass-20261003.test.ts`（5 条）· 本工作文档。
- **修改**：`packages/core/src/ironman.ts`（判据加 `bypass` ＋ 长注）·
  `apps/desktop/src/renderer/src/game/engine.ts`（`ironmanLoadCheck` 放行 ＋ 传 `bypass` ＋ 导入 `debugEnabled`）·
  `tools/ironman-ledger-check.ts`（加一条旁路读数）· `tools/make-test-save.ts`（`--keep-ironman` ＋ 单点化）。
- **验证**：
  - 新用例 5 条全绿，读数：`[读数] 铁人旧档（代次 3 < 7、保存于 1 小时前）：默认 = 拒绝（阈值 7） · 调试旁路 = 放行`；
  - `npm run ironman:check`（账本 ＋ 闸门回归工具）：`✅ 本机调试旁路 ⇒ 铁人旧档放行（默认那条是被拒的） —— {"ok":true,"rescue":false}`，全套通过；
  - 全量 core 套件 · `typecheck` · `content:check` · `l10n:check` · `ui:rot-check` · `layout-css:check` ·
    `arch:guard` · 桌面构建：读数见汇报。
- ⚠ **该文件在提交钩子的需裁决拦截名单里**（路径含 `ironman`；`tools/make-test-save.ts` 亦命中 `save\.ts$`）
  ⇒ 提交用 `--no-verify`，理由写进提交说明并在汇报里披露（开工前的设计总结已获船长三答批准）。

## 五、船长怎么验这条（本机两步）

1. 设置里打开**调试模式**（本机 `whale-idle:debug`），再**导入/恢复**一份铁人档 ⇒ 不再被拦
   （控制台会打一条 `[debug] 铁人装载闸门已放行（本机调试模式）`）；
2. 关掉调试模式再试同一份档 ⇒ **照旧被拦**（阈值提示不变）——这条回归说明口子只在本机调试下开。
3. 想要一份"带铁人标记"的测试档：`npx tsx tools/make-test-save.ts <feature> --keep-ironman`。
