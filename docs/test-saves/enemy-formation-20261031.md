# 敌方编成调整验收

独立合成，不读取或覆盖个人档。先在游戏内备份当前进度，再导入测试档；结束后退出并恢复备份。

## 单舰20声望门槛

运行`node --import tsx tools/enemy-formation-journey.ts --save`，生成：

`tools/_ui-artifacts/enemy-formation-20261031/test-save-enemy-formation-standing20.json`

本档由灰鲭鲨单舰打到8声望，再换长尾鲨，以13场首胜到20。编队技能未训练，可检查解锁通讯和许可门槛，自行购买许可、训练并选择编队。技能通过正式前置/许可/训练路径；2000万初始资金、全图探索、目录价格供给是测试预置，不表示新号零资金养成已通过。

## 满技能编队

沿用`node --import tsx tools/make-command-fleet-all-ships-save.ts`重新生成满技能全船型档。默认12舰122/125成本；自行改为两巡洋、四巡洋、带后勤/电子舰的混编比较。此档检验玩法和布局，不代表60声望时已能拥有满技能舰队。

常驻可比较赤潮、回音、奥罗、虚海和巨构核心的舰数；入侵检查四族外围/主力/旗舰编成，信号检查第1/2/4/7/10层。旗舰共享池保持30万。普通残骸和原奖励不因护航数量增加。

## 自动复核

- `node --import tsx tools/enemy-formation-check.ts --seeds=3`：328组静态对照、5886场合成战斗，输出`report.json`。
- `node --import tsx tools/enemy-formation-journey.ts --save`：合法单舰进度、3卡各12种子正式返航循环，输出`journey.json`及门槛档。
- `npm run test -w @whale/core -- --run enemy-formation-20261031`：新旧规则、血/火力、残骸、能力额度、分支、谜质和存档回归。
- `node --import tsx tools/enemy-formation-sustain-check.ts`：五套成熟舰队、23张常驻、3种子、每线最多5轮的持续作战及完整返航账本，输出`sustain.json`与逐卡报告；不生成或修改个人档。
- `node --import tsx tools/enemy-formation-sustain-check.ts --focus`：六套成熟舰队、20种子、每线最多10轮复测穹顶守卫，包含辅助舰加防护配装，输出`sustain-focus.json`与重点报告。固定配装与预算不同，不代表正常养成或普遍最优编成。

旧档兼容由独立构造的缺版本战斗验证，勿为此改写个人档。存档仅新增战斗规则标记；旧战斗打完后下一场采用新编成。
