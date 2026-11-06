// electron.vite.config.ts
import react from "@vitejs/plugin-react";
import { resolve as resolve2 } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

// ../../tools/build-info.ts
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
var __electron_vite_injected_import_meta_url = "file:///D:/Documents/GitHub/Deepseek-EVE/tools/build-info.ts";
var ROOT = join(dirname(fileURLToPath(__electron_vite_injected_import_meta_url)), "..");
function appVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(ROOT, "apps", "desktop", "package.json"), "utf8"));
    return typeof pkg.version === "string" && pkg.version.length > 0 ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}
function shortSha() {
  const env = process.env.GITHUB_SHA;
  if (typeof env === "string" && env.length >= 7) return env.slice(0, 7);
  try {
    const out = execSync("git rev-parse --short HEAD", { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    return out.length > 0 ? out : "dev";
  } catch {
    return "dev";
  }
}
function buildTime() {
  const t = new Date(Date.now() + 8 * 36e5).toISOString();
  return `${t.slice(0, 10)} ${t.slice(11, 16)}`;
}
function buildInfoDefine() {
  return {
    __APP_VERSION__: JSON.stringify(appVersion()),
    __BUILD_SHA__: JSON.stringify(shortSha()),
    __BUILD_TIME__: JSON.stringify(buildTime())
  };
}

// ../../tools/release-rights/index.ts
import { readFileSync as readFileSync2 } from "node:fs";
import { createRequire } from "node:module";
import { dirname as dirname2, join as join2, resolve } from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";
var __electron_vite_injected_import_meta_url2 = "file:///D:/Documents/GitHub/Deepseek-EVE/tools/release-rights/index.ts";
var ROOT2 = resolve(dirname2(fileURLToPath2(__electron_vite_injected_import_meta_url2)), "../..");
var RIGHTS_BANNER = "/*! \u5927\u9CB8\u9C7C-\u6DF1\u7A7A\u653E\u7F6E | \u4F5C\u8005 ya (yahzj) | \u6388\u6743\u89C1 LICENSE.txt\uFF1B\u7B2C\u4E09\u65B9\u8BB8\u53EF\u89C1 THIRD-PARTY-NOTICES.txt\u3002 */";
var RUNTIME_PACKAGES = ["react", "react-dom", "scheduler", "lucide-react", "@carbon/icons-react"];
function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
function releaseRightsAssets(dependencyRoot) {
  const license = readFileSync2(join2(ROOT2, "LICENSE.txt"), "utf8");
  const require2 = createRequire(join2(resolve(dependencyRoot), "package.json"));
  const notices = RUNTIME_PACKAGES.map((name) => {
    const packageDir = dirname2(require2.resolve(`${name}/package.json`));
    const pkg = JSON.parse(readFileSync2(join2(packageDir, "package.json"), "utf8"));
    return `===== ${name} ${pkg.version} =====

${readFileSync2(join2(packageDir, "LICENSE"), "utf8")}`;
  });
  const pixelLicense = readFileSync2(join2(ROOT2, "apps/desktop/src/renderer/src/assets/stellar/LICENSE-PixelPlanets.txt"), "utf8");
  const unifontLicense = readFileSync2(
    join2(ROOT2, "apps/desktop/src/renderer/src/assets/licenses/unifont-18.0.01-LICENSE.txt"),
    "utf8"
  );
  const oxaniumLicense = readFileSync2(
    join2(ROOT2, "apps/desktop/src/renderer/src/assets/licenses/oxanium-LICENSE.txt"),
    "utf8"
  );
  const thirdParty = [
    "\u7B2C\u4E09\u65B9\u8BB8\u53EF\u58F0\u660E\n\n\u672C\u6587\u4EF6\u8986\u76D6\u5F53\u524D\u6E32\u67D3\u5305\u7684 React\u3001React DOM\u3001Scheduler\u3001Lucide\u3001Carbon \u56FE\u6807\u3001PixelPlanets \u7D20\u6750\u3001GNU Unifont \u5B57\u4F53\u4E0E Oxanium \u5B57\u4F53\u7684\u8BB8\u53EF\u3002\n\u684C\u9762\u8FD0\u884C\u65F6\u53E6\u5E26\u7684 Electron/Chromium \u8BB8\u53EF\u6587\u4EF6\u4ECD\u987B\u4FDD\u7559\uFF1B\u672C\u58F0\u660E\u4E0D\u66FF\u4EE3\u8FD9\u4E9B\u6587\u4EF6\u3002",
    ...notices,
    `===== PixelPlanets / Deep-Fold =====

${pixelLicense}`,
    `===== GNU Unifont 18.0.01 =====

Copyright \xA9 1998-2026 Roman Czyborra, Paul Hardy, Qianqian Fang, Andrew Miller, Johnnie Weaver, David Corbett, \xC6lla Chiana Moskopp, Rebecca Bettencourt, Ho-Seok Ee, et al.
\u5B57\u4F53\u653E\u5728 SIL Open Font License 1.1 \u4E0E GNU GPL v2 \u6216\u66F4\u9AD8\u7248\u672C\uFF08\u9644 GNU \u5B57\u4F53\u5D4C\u5165\u4F8B\u5916\uFF09\u53CC\u8BB8\u53EF\u4E0B\u5206\u53D1\u3002\u6388\u6743\u539F\u6587\u5982\u4E0B\uFF08\u53D6\u81EA https://unifoundry.com/LICENSE.txt\uFF09\uFF1A

${unifontLicense}`,
    `===== Oxanium / The Oxanium Project Authors =====

${oxaniumLicense}`
  ].join("\n\n") + "\n";
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'" />
  <title>\u7248\u6743\u4E0E\u6388\u6743 | \u5927\u9CB8\u9C7C-\u6DF1\u7A7A\u653E\u7F6E</title>
  <style>body{font-family:system-ui,sans-serif;line-height:1.7;margin:32px auto;padding:0 20px;max-width:72ch;color:#202124;background:#fff}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere}a{color:#075b9b}</style>
</head>
<body><main>
  <h1>\u7248\u6743\u4E0E\u6388\u6743</h1>
  <pre>${escapeHtml(license)}</pre>
  <p><a href="./LICENSE.txt">\u6388\u6743\u58F0\u660E\u539F\u6587</a> \xB7 <a href="./THIRD-PARTY-NOTICES.txt">\u7B2C\u4E09\u65B9\u8BB8\u53EF</a></p>
</main></body>
</html>
`;
  return { "LICENSE.txt": license, "THIRD-PARTY-NOTICES.txt": thirdParty, "copyright.html": html };
}
function releaseRightsBannerPlugin() {
  return {
    name: "whale-release-rights-banner",
    apply: "build",
    enforce: "post",
    renderChunk(code) {
      return { code: `${RIGHTS_BANNER}
${code}`, map: null };
    }
  };
}
function releaseRightsPlugin(dependencyRoot) {
  return {
    ...releaseRightsBannerPlugin(),
    name: "whale-release-rights",
    config() {
      return { build: { sourcemap: false }, esbuild: { legalComments: "inline" } };
    },
    transformIndexHtml() {
      return [
        { tag: "meta", attrs: { name: "copyright", content: "\u5927\u9CB8\u9C7C-\u6DF1\u7A7A\u653E\u7F6E \xB7 \u4F5C\u8005 ya\uFF08yahzj\uFF09\uFF1B\u6388\u6743\u89C1 LICENSE.txt" }, injectTo: "head" },
        { tag: "link", attrs: { rel: "license", href: "./copyright.html" }, injectTo: "head" }
      ];
    },
    generateBundle() {
      for (const [fileName, source] of Object.entries(releaseRightsAssets(dependencyRoot))) {
        this.emitFile({ type: "asset", fileName, source });
      }
    }
  };
}

// electron.vite.config.ts
var alias = {
  "@whale/core": resolve2("../../packages/core/src/index.ts"),
  "@whale/data": resolve2("../../packages/data/src/index.ts"),
  "@whale/ui": resolve2("../../packages/ui/src/index.tsx")
};
var electron_vite_config_default = defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { sourcemap: false }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { sourcemap: false }
  },
  renderer: {
    resolve: { alias },
    plugins: [react(), releaseRightsPlugin(resolve2("."))],
    worker: { plugins: () => [releaseRightsBannerPlugin()] },
    /** **2026-10-02 船长令**（「否则无法判断玩家当前版本」）：构建时把版本注入界面（设置页最上方那一行） */
    define: buildInfoDefine()
  }
});
export {
  electron_vite_config_default as default
};
