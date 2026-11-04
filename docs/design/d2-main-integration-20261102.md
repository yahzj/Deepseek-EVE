# 二号与主树整合及上传核验

状态：本地整合与冲突处理完成，准备上传核验，尚未触发正式部署。二号，2026-11-02。

## 授权与保存边界

船长要求「先合入然后试着上传下，看下还会自动部署吗」，并在确认主树存在已收尾但未提交文件后回复「一起检查，还有git的拉取后检查冲突」。本批包含这些主树成果的检查、独立提交、二号整合、主树快进及代码上传；不手动触发部署、不动远程服务器或个人存档、不继续调游戏数值、不改写许可证条款。

- 二号功能收尾提交`a2461ab32`，整合同事更新`78dd364`，统一手动发布`2d75ad29`。
- 主树服务器按原交接要求单独提交为`abef585b`；版权构建工具单独提交为`f12668a7`，各自正常提交闸门通过。
- 两批分离时创建的自有版权stash快照`801cb0468b5dbb6c978360eb61ae4a5229552095`已恢复，成果均已提交，stash保留作为恢复点。归档文件只按精确清单保存，不读取归档正文。
- Git直连多次超时，命令级使用Windows原生TLS后端`git -c http.sslBackend=schannel -c http.version=HTTP/1.1 fetch origin`成功；不改持久Git配置。远端main为`69e3df74e`，只读GitHub API交叉核对相同，没有新增同事提交。

## 冲突及处理

在二号`git merge --no-commit main`出现两处内容冲突：

1. `web/vite.config.ts`：保留同事混淆插件、GitHub Pages基路径及原发布版权头，同时接入主树`releaseRightsPlugin`和独立Worker的`releaseRightsBannerPlugin`。网页及桌面构建成功，产物版权检查通过，未丢弃任一方构建能力。
2. `docs/INDEX.md`：现有生成器在读取前排除archive，使用`npm run docs:index`重新生成；不手拼统计。

README自动合并保留统一手动发布说明与两方版权内容。远端新增的`LICENSE`与主树`LICENSE.txt`并存且陈述不同，作者名及AGPL/商业使用口径也有差异，仍须权利人统一确认；本次不擅自改条款。远端网页守卫当前允许任意`*.github.io`而不只官方账号，IPv6本地回环和自定义域名被拦截，这些检查发现保留，不冒称已经修复。构建成功不等于许可证合规或访问策略验收。

## 验证

- 主树及整合后的服务器各跑83项测试通过；整合后服务器类型检查通过。版权插件3项专项通过。
- 整合后的网页生产构建和桌面生产构建成功；两端许可正文、第三方许可、入口链接、全部渲染JS/Worker版权头及无源码映射检查通过。保留既有Vite包体积与混合导入提示。
- 手动发布专项21项通过，确认工作流不含push发布入口、唯一workflow_dispatch、构建门槛及SHA/标签/产物校验；未运行真实GitHub Actions发布。
- 架构护栏通过；存档往返53份可读、76份旧版预期拒读、0份意外失败、0处变形。
- 广覆盖当前代码回归：497个文件，468个通过、29个失败；6205项中6143通过、61失败、1跳过。排除了22个含子进程/旧Git正文读取的测试文件，不能称完整核心回归。重复运行结构化结果相同，证据`tools/_ui-artifacts/integration-20261102/current-regression.json`。

### 待核查失败清单

本次不为消除失败擅自调参数、翻译或批量改断言；正式手动发布保留全量回归门槛，当前版本不视作发布验收全绿。

| 文件 | 失败数 | 首个现象 |
|---|---:|---|
| activity-display-20261004 | 2 | 活动栏测试夹具缺encounter |
| alien-command-20261006 | 2 | 扩编后的波次数量与旧断言不同 |
| battle-card-range-memory-20261021 | 2 | 射程读数与旧精确值不同 |
| bounty-tasks | 1 | 下一场开战时远征仍进行中 |
| cleanup-equivalence-20261027 | 1 | 活动栏测试夹具缺encounter |
| corona-devices-20261001 | 1 | 未观察到预期连续开火 |
| corona-mounts-20261002 | 1 | 伤害倍率精确断言不符 |
| data-editor-enemies-20261008 | 1 | 入侵覆写血量读数不符 |
| desire-invasion-20261002 | 1 | 开战拒绝 |
| desire-memory-20260928 | 2 | 默认距离读数不符 |
| first-task-tail-20261004 | 1 | 任务状态断言不符 |
| flagship-kill-record-20260927 | 3 | 旗舰未按预期击沉 |
| gravekeeper-art-20261016 | 1 | 美术来源断言不符 |
| invasion-loop-distance-20261009 | 1 | 量程上限断言不符 |
| l10n-overlay | 5 | 扩编数据及已登记英文延期与旧全英文假设不一致 |
| loop-range-confirm-minimize-20261026 | 1 | 提取组件的测试上下文缺state |
| market-domain-layout-20261030 | 1 | 新物品使数量变化 |
| market | 1 | NPC吸收量低于旧门槛 |
| mining-group-20260927 | 1 | 技能总数与旧119项假设不符 |
| popup-hint-copy-20261004 | 2 | 黑匣价格仍断言30而现值60 |
| retreat | 1 | 开战拒绝 |
| scan-stacking-richtext-20261018 | 2 | 提取组件上下文缺shipCommandCostOf |
| settle-stats | 1 | 新combat统计字段与旧Object.keys假设不一致 |
| skill-upgrades-20260927 | 1 | 技能总数与旧119项假设不符 |
| station-action-policy-20261013 | 1 | 自动探索主控交接拒因断言不符 |
| web-build-dependencies-20261009 | 1 | 配置测试未声明新增混淆插件依赖 |
| weekend-wiring-20260925 | 1 | 遭遇日志查找断言不符 |
| wormhole-expedition-journey-20261005 | 7 | 训练夹具未满足编队许可声望 |
| wormhole-expedition-special-20261006 | 15 | 同一训练夹具许可问题 |

上述为失败现象分类，不等于所有行为差异均无缺陷或都只是旧测试。本批上传仅验证代码同步与自动部署解耦，不替代修复这些问题、游戏验收、公告审核或正式部署授权。

## 上传核验待完成

合并提交后主树须干净再快进；只推送main，不创建/推送版本标签，不手动dispatch。上传后核对远端SHA和三个工作流触发器，并查询该SHA的Actions与近期部署。零运行是有时间窗口的观察结论，不能证明无限未来；不取消或删除无关任务。核验结果在最终汇报说明。
