# 二号Electron开发启动修复

> 状态：本树运行时已补齐，实际开发启动冒烟通过（二号 · d2/workspace · 2026-10-31）。
> 船长报障：「无法进入游戏」，启动`electron-vite dev`时报`Error: Electron uninstall`。
> 范围：二号本地依赖与开发启动取证，不改游戏规则、存档、主树或依赖版本，不推送。

## 定位与处理

- 二号`electron`包版本31.7.7，但缺少`path.txt`和`dist/electron.exe`；`electron-vite`解析不到运行文件，在创建游戏进程前抛错，不是游戏存档加载失败。
- 上批原生压力工具默认借用主树Electron，证明了二号构建可运行，却未覆盖二号本地开发启动依赖。改为默认读取本工作树`require('electron')`，只有显式环境变量才可覆盖。
- `npm rebuild electron`及官方`install.js`未补齐运行文件。随后核对主树同为31.7.7，将其完整`dist/`与`path.txt`复制到二号依赖目录，未修改主树。执行文件SHA256一致：`1fa93c3471c11dc8128998c662c705104e4528b98901b61c8a25216acda424c5`。
- 不把运行时二进制入库，不删除整个依赖目录，不升级包版本，不改变永久环境变量。
- 新增`node tools/electron-dev-smoke.cjs`，走当前树`electron-vite dev`和真实主进程/预载，隐藏窗口、独立临时userData，验证React根节点与真实IPC；报告到`tools/_ui-artifacts/electron-dev-smoke/report.json`，完成关闭自有PID并核对临时目录边界清理。

## 验证

- `node tools/electron-dev-smoke.cjs`最终返回0，使用二号本地`node_modules/electron/dist/electron.exe`，实际版本31.7.7；开发主进程和预载构建、Vite服务、Electron创建窗口、React根节点和真实读档IPC全部通过，渲染异常0。
- 最终自有开发工具PID38224、Electron PID39396已退出，临时目录按边界校验后清理；本次不保留开发服务，不操作个人档。运行时复制未改依赖清单或锁文件。
- 冒烟使用隐藏隔离窗口，不代表船长个人档的内容验收。新游戏启动后会自动保存初始状态，验证同时接受尚无存档或教程0、模式尚未选择的新档；不能把自动保存的新档误判为读到了个人档。
- 验证脚本开发期间修正了不支持的CLI端口参数、Electron子进程识别和新档可选字段断言，最终以成功报告为准，不把中间脚本失败当成生产游戏故障。
- 船长可在二号根目录重新运行`npm run dev`；无需设置借用主树运行时的环境变量，也无需改动存档。
