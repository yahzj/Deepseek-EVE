/**
 * **空 PostCSS 配置**（2026-10-02 加 · 环境兜底，不是功能）。
 *
 * 起因：`postcss-load-config`（vite 内置）会从各项目的 root 一路**向上**找配置，
 * 一直找到 `H:\大鲸鱼\package.json` —— 那份文件是**外部进程留下的 0 字节空文件**，
 * `JSON.parse('')` 抛 "Unexpected end of JSON input" ⇒ vitest / electron-vite 全部起不来。
 * 仓库自身从未用 PostCSS 插件；在本仓根放一份**空配置**，让查找器命中最近的一份、
 * 不再走到那份坏文件（空配置 = 零插件 = 与"没有配置"逐字等价，不影响任何构建产物）。
 *
 * ⚠ 若哪天台面上那份空 package.json 被清理，本文件可留可删（留着无害）。
 */
module.exports = {}
