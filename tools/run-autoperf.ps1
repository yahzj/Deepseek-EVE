# 大鲸鱼·性能自动采集（2026-09-08 诊断工具）
# 用法：powershell -File tools/run-autoperf.ps1  [-Spec '<场景JSON>']
# 默认场景：地图挂机 60s → 工业页 60s → 市场页 60s → 战斗 ≈90s
# 产物：out/autoperf-<时间戳>/run.log（含 AUTOPERF_REPORT_BEGIN/END 的完整 JSON 报告）
param(
  [string]$Spec = '{"scenes":[{"name":"map-idle","seconds":60},{"name":"industry","page":"工业","seconds":60},{"name":"market","page":"市场","seconds":60},{"name":"battle","battle":true,"seconds":90}]}'
)
$ErrorActionPreference = 'Continue' # Electron 的 stderr 噪音（NativeCommandError）不能当致命错误
$root = Split-Path -Parent $PSScriptRoot
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$dir = Join-Path $root "out/autoperf-$stamp"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$save = Join-Path $dir 'save.json'
$log = Join-Path $dir 'run.log'

Push-Location (Join-Path $root 'apps/desktop')
try {
  Write-Output '==> 构建桌面端（生产渲染，避免 dev 开销污染数据）'
  npm run build 2>&1 | Out-Null
  Write-Output '==> 生成隔离初始存档'
  npx tsx (Join-Path $root 'tools/make-autoperf-save.ts') $save
  Write-Output '==> 启动自动采集（窗口自动关闭即结束）'
  $env:ELECTRON_ENABLE_LOGGING = '1'
  $env:WHALE_AUTOPERF = $Spec
  $env:WHALE_PERF_USERDATA = $dir
  npx electron . 2>&1 | Tee-Object -FilePath $log
} finally {
  Pop-Location
}
Write-Output ''
Write-Output "完成：日志 -> $log"
