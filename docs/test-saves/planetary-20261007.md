# 星球第一批规则原型验收

状态：核心规则原型，玩家入口未开放，没有星球可操作界面。

生成命令：`npx tsx tools/make-test-save.ts planetary`，固定输出`test-save-planetary-20261007.json`。该用途只从新建合成状态生成，不读取或覆盖个人档。

核验命令：`npx tsx tools/planetary-prototype-check.ts --file docs/test-saves/test-save-planetary-20261007.json`，只读指定测试档，输出勘探可见信息、环境参数、建设校验与相邻读数，并检查存档往返不变。省略`--file`则在内存构造同类夹具，不写盘。

三颗星球依次为16格轨道初探、25格地表详探、36格专项调查。大型星球注入正常基地、断电水站和无人农业，仅为测试设施状态，没有施工、扣料、产出或人口唤醒。

不需要导入游戏或替换个人存档。游戏里导入此档也不会显示星球入口；第二批生存和第三批隐藏操作页确认后另配实际操作流程。

专项回归：`npm run test -w @whale/core -- planetary-prototype-20261007`；主方案：`docs/design/planetary-habitation-20261007.md`。

桌面保存链：先`npm run build`，再`node tools/planetary-desktop-smoke.cjs`。工具创建并最终清理带固定前缀的临时用户目录，隐藏Electron窗口，验证渲染启动、实际保存、重载及星球字段保留；不读取个人档，不是界面观感验收。
