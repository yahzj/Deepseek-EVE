# 深空星系与并列战损验收

> 状态：已确认方案的本机测试说明，普通玩家入口未开放。
> 适用游戏v0.1.0、存档v31；合成档，不读取个人档。

## 生成与隔离

`npx tsx tools/make-test-save.ts stellar-search`

产物为`docs/test-saves/test-save-stellar-search-20261007.json`。档内仅提供3架制造材料、测试舰船与沉船记录，不代做制造、搜索、勘探或建设。主控有3件普通插件和3项战损，沉船记录有2项战损。

优先使用全新浏览器配置或工具自建Electron目录。手动导入前在存档管理备份当前进度，测完恢复；不要覆盖没有备份的个人进度。自动脚本不读取个人userData。

## 隐藏入口

打开本机预览，启用调试。在开发者控制台执行以下命令，再刷新：

```js
localStorage.setItem('whale-idle:debug', '1')
localStorage.setItem('whale-idle:planetary-test', '1')
location.reload()
```

导入合成档后，打开星图：

```js
window.dispatchEvent(new Event('whale-planetary-open'))
```

仅本机允许的调试来源有效，公网和普通打包入口仍关闭。不需要替换桌面个人`save.json`。

## 操作路径

1. 舰船、装配、通讯沉船记录：确认普通插件与战损卡并列，点击战损查看富详情；普通槽位计数不包含战损。
2. 星系星图：点击制造深空探测机。基础工期1小时，R4，单架配方基础价值100万信用点；无制造技能的测试档以该值开工。
3. 选择指定坐标，输入`7`，派出1架。基础搜索6小时；暂停、刷新、继续不再次扣机。
4. 收到星系后，点击星球进行详探；固态星球可打开地表，气态星球不能建设。
5. 滚轮或按钮缩放、鼠标拖动；手机单指拖图、双指捏合。用适应全图和定位恢复视口；切换星系分别保留视口与选中项。
6. 另造一架并尝试随机搜索、连续搜索。满候选或缺探测机会停机；已有坐标输入免费定位，不重新生成世界。
7. 星系详情内可返回旧候选建设面板。原有世界和基地未改写。

手动缩短等待可用本机测试API，每次最多推进8小时。它执行真实游戏引擎，不直接注入产物或坐标：

```js
window.__whalePlanetaryTest.step(3600000)
```

四项专属技能只在实验世界解锁。两项探测技能满级把周期降至3小时；档案学把候选容量5提升到15；专属与通用材料技能满级的配方基础价值为71万。

## 自动核验

- 核心：`npm run test -w @whale/core -- stellar-search-20261007 stellar-save-20261007 stellar-map-geometry-20261007 probe-manufacturing-20261007 ship-damage-inline-20261007`
- 构建后原生：`node tools/stellar-native-check.cjs`，旧/新界面、中文/英文、桌面/手机仿真8组，真实点击、制造、搜索、暂停、拖动、缩放、地表与重载。
- 旧建设回归：`node tools/planetary-native-check.cjs`。
- 截图与读数落`tools/_ui-artifacts/stellar/`，不入库。脚本使用随机端口、隐藏窗口和临时userData，结束后关闭自建进程。

自动测试确认操作及几何读数，不代替船长的观感验收或实体手机验证。
