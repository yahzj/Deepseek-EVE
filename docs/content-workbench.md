# 内容工作台

> 在Excel/WPS编辑存量内容，再由工具按主键写回权威源。工作簿与CSV不是第二份数据源；旧表数、行数与交付过程已封存。

## 导出与导入

```powershell
npm run content:export
npm run content:export D:\my
npm run content:import items content-csv/content-workbench.xlsx --dry-run
npm run content:import items content-csv/content-workbench.xlsx
```

默认输出`content-csv/content-workbench.xlsx`及兼容CSV，产物不入库。工作簿包含skills、items、modules、ships、anomalies、belts、market七张表，数量由当前目录现算；指定表名时自动读取对应sheet。

**重导前先核对未导入编辑**，先导入、另存或写新目录，不能用源重导覆盖草稿。XLSX为日常主格式，CSV选择UTF8；导入端支持的旧表头由`content-schema.ts`统一归一，不手改匹配键。

## 列与边界

- 首列id或市场key只读，未知、新增或缺失条目拒绝导入；新增、删除及结构改动走正常内容维护流程。原因：表格编辑不能隐式改变目录结构。
- 数值使用引擎原单位，表头标单位；倍率小数不按整数百分数填写，枚举沿用合法代码值。原因：显示习惯不能替代字段语义。
- 精炼、复合产出和战利品等紧凑引用按表头格式填写，引用必须存在。原因：错误ID会断开生产或掉落链。
- 导出空格表示未设置，导入空格表示保留原值，可选字段填`-`才删除，`0`是显式数值。原因：缺省、删除与零值不能混同。
- 技能说明与引擎效果需人工复核；敌方威胁、伤害、奖励属于战斗平衡改动，依现行确认和专项校准流程。原因：类型合法不等于语义或平衡正确。

## 写回与检查

已迁移字段写静态JSON，未迁移字段写原TS；按主键和字段作最小差异，保留无关注释与布局。静态源和编辑器限制见`docs/data-editor.md`。

导入先检查主键、枚举、范围、引用和删除语义，再执行变更，收尾跑`content:check`与core/data类型并打印差异摘要。检查失败先核对实际文件和工具备份，不以失败退出码推断所有写入一定回滚；提交前人工检查`git diff`，按开发约定补本域专项。

## 分类用语

中文类别取现有标签单点，伤害采用动能、爆破、能量，金额单位信用点；槽位、武器类型、物品自身稀有度和交易渠道分别取对应字段，不在工作簿说明中拼第二套映射。原因：类别和数值应随代码的权威定义一致变化。
