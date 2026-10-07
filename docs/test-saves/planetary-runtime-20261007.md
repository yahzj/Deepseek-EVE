# 星球建设完整运行验收

状态：隐藏实验系统，普通玩家入口未开放，不推送或发布公告。

生成：`npx tsx tools/make-test-save.ts planetary-runtime`，输出`test-save-planetary-runtime-20261007.json`，只从全新合成状态生成，绝不读取个人档。

本机操作建议用独立预览档，不覆盖正在玩的个人档。网页存档管理先导出原档／备份，再加载本测试文件。运行本机开发或预览页面，在控制台设置：

```js
localStorage.setItem('whale-idle:debug', '1');
localStorage.setItem('whale-idle:planetary-test', '1');
location.reload();
```

重载后打开实验面板：

```js
window.dispatchEvent(new Event('whale-planetary-open'));
```

此标记要求本机调试允许，公网、桌面打包的file协议、普通debug标记均不会打开。测试后清除`whale-idle:planetary-test`，恢复原有备份；切勿覆盖没有备份的进度。

测试档含三颗已详探星球及真实施工完成的生存设施，本地建材／生活储备、两艘副船货舰与母港仓库补给。人口未预先发现和唤醒。

操作路径：人口与补给→在遗迹／穹顶候选地调查发现人类→选中型基地→选择副船→运送4组休眠人口→等到货→首次唤醒1组，再唤醒3组→地表扩建电力／分配工作岗位→改造工程按特性开工→完成家园目标。查看寻人／家园通讯与任务记录；工程可暂停、取消未用材料退款；缺电／补给不足走休眠或救援，不永久删除人口。

原生八组：先`npm run build`，再`node tools/planetary-native-check.cjs`。工具自行建立随机本机预览端口、隐藏Electron和临时用户目录，旧／新版、中／英文、桌面／390×640手机触摸仿真；实际发现、运输、唤醒、改造、家园与保存重载，输出几何读数及截图到忽略的工具产物目录。它不是观感验收，也不代表实体手机测试。

核心回归：`npm run test -w @whale/core -- planet`。常规v31档不带星球运行标记，不会自动创建基地、完成人类任务或产生资源。
