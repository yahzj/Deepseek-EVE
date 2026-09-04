# Generates placeholder app icons for the desktop build:
#   apps/desktop/build/icon.png  (512x512, for reference / other platforms)
#   apps/desktop/build/icon.ico  (16/24/32/48/64/128/256 PNG frames inside one ICO)
# Icon content: a small starlit "deep space" square with a simple industrial
# spaceship silhouette (cyan hull, orange engine flare) facing right.
#
# Usage: pwsh -File tools/make-icon.ps1
# Requires .NET System.Drawing (Windows only).

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

$outDir = Join-Path $PSScriptRoot '..\apps\desktop\build'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function New-ShipIcon([int]$S) {
  $bmp = New-Object System.Drawing.Bitmap($S, $S)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)

  $rect = New-Object System.Drawing.Rectangle(0, 0, $S, $S)

  # deep space gradient background
  $bgTop = [System.Drawing.Color]::FromArgb(255, 12, 26, 66)   # #0C1A42
  $bgBot = [System.Drawing.Color]::FromArgb(255, 3, 6, 14)     # #03060E
  $grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $bgTop, $bgBot, 45.0)
  $g.FillRectangle($grad, $rect)

  # stars (deterministic)
  $rnd = New-Object System.Random(7)
  for ($i = 0; $i -lt 90; $i++) {
    $x = $rnd.Next(0, $S)
    $y = $rnd.Next(0, $S)
    $r = 0.5 + $rnd.NextDouble() * 1.4
    $a = 70 + $rnd.Next(130)
    $col = [System.Drawing.Color]::FromArgb($a, 205, 226, 255)
    $sb = New-Object System.Drawing.SolidBrush($col)
    $g.FillEllipse($sb, [single]($x - $r), [single]($y - $r), [single]($r * 2), [single]($r * 2))
  }

  # helper: unit coords -> pixels
  $px = { param($ux, $uy) New-Object System.Drawing.PointF([single]($ux * $S), [single]($uy * $S)) }

  # engine flare (behind hull, left side)
  $flame = [System.Drawing.Color]::FromArgb(255, 255, 180, 94) # #FFB45E
  $pts = @(& $px 0.285 0.534; & $px 0.185 0.548; & $px 0.285 0.562)
  $g.FillPolygon((New-Object System.Drawing.SolidBrush($flame)), $pts)
  $core = [System.Drawing.Color]::FromArgb(255, 255, 236, 180)
  $pts = @(& $px 0.285 0.540; & $px 0.225 0.548; & $px 0.285 0.556)
  $g.FillPolygon((New-Object System.Drawing.SolidBrush($core)), $pts)

  # lower tail fin
  $fin = [System.Drawing.Color]::FromArgb(255, 96, 169, 220) # #60A9DC
  $pts = @(& $px 0.500 0.620; & $px 0.545 0.705; & $px 0.625 0.620)
  $g.FillPolygon((New-Object System.Drawing.SolidBrush($fin)), $pts)

  # small antenna fin on top
  $pts = @(& $px 0.430 0.480; & $px 0.470 0.425; & $px 0.530 0.480)
  $g.FillPolygon((New-Object System.Drawing.SolidBrush($fin)), $pts)

  # hull: diamond-shaped industrial ship, nose pointing right
  $hull = [System.Drawing.Color]::FromArgb(255, 160, 219, 255) # #A0DBFF
  $pts = @(
    (& $px 0.285 0.548)
    (& $px 0.530 0.470)
    (& $px 0.795 0.548)
    (& $px 0.530 0.626)
  )
  $g.FillPolygon((New-Object System.Drawing.SolidBrush($hull)), $pts)

  # hull outline (subtle dark rim)
  $edge = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 11, 42, 77), [single](0.006 * $S))
  $g.DrawPolygon($edge, $pts)

  # cockpit accent line near the nose
  $cw = 0.006 * $S
  if ($cw -lt 1) { $cw = 1 }
  $cock = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(200, 46, 109, 158), [single]$cw)
  $g.DrawLine($cock, [single](0.60 * $S), [single](0.548 * $S), [single](0.755 * $S), [single](0.548 * $S))

  $grad.Dispose()
  $g.Dispose()
  return $bmp
}

# 512px PNG reference
$big = New-ShipIcon 512
$big.Save((Join-Path $outDir 'icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$big.Dispose()

# multi-size ICO (PNG-compressed frames; supported by Windows Vista+)
$sizes = @(16, 24, 32, 48, 64, 128, 256)
$frames = @()
foreach ($sz in $sizes) {
  $bmp = New-ShipIcon $sz
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  $frames += , @($sz, $ms.ToArray())
  $ms.Dispose()
}

$ms = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($ms)
$bw.Write([uint16]0)            # reserved
$bw.Write([uint16]1)            # type: icon
$bw.Write([uint16]$frames.Count)
$offset = 6 + 16 * $frames.Count
foreach ($f in $frames) {
  $dim = if ($f[0] -ge 256) { 0 } else { $f[0] }
  $bw.Write([byte]$dim)
  $bw.Write([byte]$dim)
  $bw.Write([byte]0)            # palette
  $bw.Write([byte]0)            # reserved
  $bw.Write([uint16]1)          # planes
  $bw.Write([uint16]32)         # bpp
  $bw.Write([uint32]$f[1].Length)
  $bw.Write([uint32]$offset)
  $offset += $f[1].Length
}
foreach ($f in $frames) { $bw.Write($f[1]) }
$bw.Flush()
[System.IO.File]::WriteAllBytes((Join-Path $outDir 'icon.ico'), $ms.ToArray())
$bw.Dispose()
$ms.Dispose()

Write-Host "done: $outDir\icon.png , $outDir\icon.ico"
