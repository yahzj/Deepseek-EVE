/**
 * **客户端版本行的构建时注入**（**2026-10-02 船长令**：「**建议在设置里给游戏添加版本号，否则无法判断
 * 玩家当前版本**」⇒ 三问裁定：值 = 版本号 · 构建 sha · 构建日期 · 运行形态；只做显示；放设置页最上方）。
 *
 * **两套构建共用这一份**（`web/vite.config.ts` 与 `apps/desktop/electron.vite.config.ts` 各写一句
 * `define: buildInfoDefine()`）—— 单点，免得两处各算一遍、算出两个不同的戳：
 * - **版本号** = `apps/desktop/package.json` 的 `version`（`release.yml` 头注本来就要求它与发布 tag
 *   一致 ⇒ 唯一权威现成，不另立版本文件）；
 * - **sha** = CI 的 `GITHUB_SHA`（GitHub Actions 默认注入，**不用改工作流**），本地构建回落
 *   `git rev-parse --short HEAD`（7 位）；两样都拿不到 ⇒ `dev`；
 * - **时间** = 构建时刻，**统一按 UTC+8 记**（本地构建是本地时区、CI 是 UTC —— 不钉死时区就会为同一次
 *   构建写出两个不同的戳）。
 *
 * 产物形如：`define: { __APP_VERSION__: '"0.1.0"', __BUILD_SHA__: '"a1b2c3d"', __BUILD_TIME__: '"2026-10-03 08:20"' }`
 * —— 渲染层读法见 `apps/desktop/src/renderer/src/game/buildInfo.ts`（带缺省兜底）。
 */
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 仓根（本文件在 `tools/` 下 ⇒ 上一层） */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 版本号：`apps/desktop/package.json` 的 `version`（读不到 ⇒ `0.0.0`） */
function appVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'apps', 'desktop', 'package.json'), 'utf8')) as { version?: unknown }
    return typeof pkg.version === 'string' && pkg.version.length > 0 ? pkg.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

/** 短 sha：先看 CI 的 `GITHUB_SHA`，否则问本地 git（取不到 ⇒ `dev`） */
function shortSha(): string {
  const env = process.env.GITHUB_SHA
  if (typeof env === 'string' && env.length >= 7) return env.slice(0, 7)
  try {
    const out = execSync('git rev-parse --short HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
    return out.length > 0 ? out : 'dev'
  } catch {
    return 'dev'
  }
}

/** 构建时刻（`YYYY-MM-DD HH:mm`，**固定 UTC+8**） */
function buildTime(): string {
  const t = new Date(Date.now() + 8 * 3_600_000).toISOString()
  return `${t.slice(0, 10)} ${t.slice(11, 16)}`
}

/** 给 vite `define` 用的三件套（值已是 JSON 字面量形式） */
export function buildInfoDefine(): Record<string, string> {
  return {
    __APP_VERSION__: JSON.stringify(appVersion()),
    __BUILD_SHA__: JSON.stringify(shortSha()),
    __BUILD_TIME__: JSON.stringify(buildTime()),
  }
}
