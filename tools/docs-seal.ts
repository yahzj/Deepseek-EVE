/**
 * 已退役的roadmap滚动封存命令。保留失败出口，避免旧调用重新写回历史格式。
 * 用法：npm run docs:seal（退出1，不读取文档、不修改文件）。
 * 归档遵循开发约定§十五，由明确范围的原文搬迁与字节校验完成。
 */
console.error('docs:seal已退役：roadmap只保留当前待办。请按开发约定§十五归档本批过程，再运行npm run docs:index；旧记录无船长查阅要求禁止读取。')
process.exitCode = 1
