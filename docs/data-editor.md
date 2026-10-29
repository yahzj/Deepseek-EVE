# 大鲸鱼数据编辑器

> 编辑静态参数的开发工具，不修改玩家存档或已安装游戏。当前限制留在本页，搬表、合入和验收过程已封存。

## 启动与权限

- 源码与便携程序位于Git外的`H:\大鲸鱼\数据编辑器`；游戏命令`data:editor`、`data:editor-build`、`data:editor-pack`、`data:editor-test`转到该目录。
- 已登记便携路径为`release\大鲸鱼数据编辑器-0.1.2-x64.exe`。该版内置来源契约未覆盖后来新增的敌舰字段，会安全拒载新版项目；使用前需更新独立编辑器构建，不可忽略未知字段或放宽校验。
- 加载可信同仓附属工作树，核对目录、分支与可编辑状态；主树、main/master与游离HEAD只读。工具不运行未知项目脚本，不静默安装缺失依赖。

## 编辑、预览与保存

1. 按名称或ID选条目，修改数值草稿；按字段单位输入，缺省不当作0，公式和派生数只读。
2. 多选对比或批量设值、加减、乘倍率，先预览再应用；非法一项不会部分应用，撤销重做只改草稿。
3. 查看联动变更后保存。隔离候选运行四包类型、内容及完整core检查；失败保留草稿、不写JSON，不提供强制保存。
4. 成功后原文备份到所选工作区`tools/_data-editor/backups/<事务ID>/`。恢复先核对全部目标哈希，外部修改、基线变化或检查期间源码改变时停止。

可编辑舰船、装备、插件、物品/无人机、直接商品，以及已接入的敌舰、敌机、挂载、悬赏、入侵和信号空间源数字；数量按所选树现算。不新增、删除、重排条目或修改ID、文本、引用、结构、舰型与机制开关。

附属非主分支可用真实引擎预览草稿的入侵、信号空间及独立新规则编队。修改草稿后旧读数失效；备用机不计当前火力，触发效果、命中与抗性不伪算为持续输出。部分表缺失、来源不匹配或字段未知时拒绝，主树不运行候选预览。

共享字段契约参与来源指纹，不能串项目或以过期令牌保存；全部目标先预检再恢复。商品key与舰船ID不一定相同，关联按refId；价格联动列明，基准价不当作实时成交价。蓝图书价与配方规则仍由代码维护，工具不猜测修改。

## 数据来源

- `packages/data/src/static/{ships,modules,plugs,items,market}.json`：静态参数。名称、文案与派生公式留在TS，由`staticDataGroup`组装原目录接口。
- `packages/data/src/static/{foeShips,foeDrones,bounties,invasionFleets,wormholeFleets}.json`及`packages/core/src/static/foeMounts.json`：敌方源数字，公式、引用和顺序由原工厂维护。
- `staticFieldTypes.json`：可信字段形状契约，不是数值副本；新增字段按类型与校验流程维护。
- `data-static-migrate.ts`及`data-static-fields.ts`：仅显式搬表维护，不能日常重跑覆盖已迁移数据。

JSON不保存最终战斗快照，不引入SQL。原数值标定与守护用例继续有效，不能靠删测试或强制通过解除。独立编辑器开发源码仍依赖游戏来源树的共享工具，迁出Git不等于完全独立。

## 生效与检查

数据随构建发布；开发版重载，正式程序重新构建，不热换运行中战斗或订单。编辑器构建产物保留在`tools/_data-editor/builds/<ID>/`，不覆盖正在玩的游戏，不自动Git提交、合入或推送。

| 入口 | 用途 |
|---|---|
| `npm run data:editor-test` | 独立编辑器字段、草稿、事务、冲突与恢复专项 |
| `npm run data:migration-check` | 固定基线搬表等价验收；有意调参后不要求旧全值相等 |
| `node tools/data-editor-native-check.cjs --portable --no-screenshots` | 可信隔离副本中的便携程序真实输入、保存、拒绝和恢复 |
| `node tools/data-editor-visual-check.cjs` | 隐藏Electron窗口几何与非空像素取证，不替代船长观感验收 |

临时备份、候选、构建和`tools/_ui-artifacts/`报告不入库，恢复只处理工具自身事务。Excel/CSV仍可用，导出前先处理未导入编辑，见`docs/content-workbench.md`。
