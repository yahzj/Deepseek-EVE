/**
 * **客户端版本行**（**2026-10-02 船长令**：「**建议在设置里给游戏添加版本号，否则无法判断玩家当前版本**」）。
 *
 * 三问裁定（船长）：① 值 = **版本号 · 构建 sha · 构建日期 · 运行形态**（只显示版本号分辨不出"网页版
 * 被浏览器缓存住旧产物"）；② 本批**只做显示**（"发现新版本 ⇒ 提示刷新"留下一批）；③ 命名用
 * 「**客户端版本**」（游戏内已有的「版本号」是**铁人档世代号**，别撞名）＋ **放设置页最上方**。
 *
 * 三个值由**构建时注入**（单点 = `tools/build-info.ts`；网页与桌面两套构建各一句 `define`）：
 * - `__APP_VERSION__` = `apps/desktop/package.json` 的 `version`（与发布 tag 同源）；
 * - `__BUILD_SHA__` = CI 的 `GITHUB_SHA` / 本地 `git rev-parse --short HEAD`；
 * - `__BUILD_TIME__` = 构建时刻（UTC+8）。
 *
 * ⚠ **三个都带兜底**：任何构建器没注入（例如直接在源码上跑用例/预览）时，这一行仍照常显示、不炸。
 */

/** 三件套（`typeof` 守卫：全局没定义时不抛 ReferenceError —— 这是 JS 里唯一能这么判的写法） */
export const BUILD = {
  version: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0',
  sha: typeof __BUILD_SHA__ === 'string' ? __BUILD_SHA__ : 'dev',
  time: typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : '—',
} as const

/**
 * **运行形态**：有 `window.whale`（Electron 预加载注入的安全桥，见 `env.d.ts`）= **桌面版**；
 * 没有 = **网页版**（`web/` 那条构建；它的存档走 localStorage / 本地存档文件）。
 */
export const BUILD_FORM: 'web' | 'desktop' =
  typeof window !== 'undefined' && (window as { whale?: unknown }).whale !== undefined ? 'desktop' : 'web'
