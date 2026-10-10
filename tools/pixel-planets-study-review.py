"""PixelPlanets尺寸/分层/复现检查及对照板，不读取个人档。
用法：python tools/pixel-planets-study-review.py <输出目录> [独立复现目录]。
仅使用已有Pillow；Godot3.5/游戏v0.1.0/档v31，2026-10-10核对。
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUTPUT = Path(sys.argv[1]).resolve()
FIRST = Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else None
artifacts = Path(__file__).resolve().parents[1] / "tools/_ui-artifacts"
assert OUTPUT.is_relative_to(artifacts), "输出仅限本树忽略目录"
assert FIRST is None or FIRST.is_relative_to(artifacts), "复现输入仅限本树忽略目录"
rows = json.loads((OUTPUT / "parameters.json").read_text(encoding="utf8"))
font_path = "C:/Windows/Fonts/msyh.ttc"
font = ImageFont.truetype(font_path, 20)
small = ImageFont.truetype(font_path, 16)
heading = ImageFont.truetype(font_path, 28)
background = (9, 15, 23)
readings = []
images = {}
for row in rows:
    image = Image.open(OUTPUT / (row["name"] + ".png")).convert("RGBA")
    alpha = image.getchannel("A")
    box = alpha.getbbox()
    assert image.size == (row["width"], row["height"])
    assert box and alpha.getextrema() == (0, 255), row["name"]
    if FIRST:
        repeated = Image.open(FIRST / (row["name"] + ".png")).convert("RGBA")
        assert repeated.size == image.size and repeated.tobytes() == image.tobytes(), row["name"]
    for layer in row["layers"]:
        assert layer["pixels"] == layer["width"] == layer["height"], layer
        assert layer["pixels"] >= row["pixels"]
    images[row["name"]] = image
    readings.append({"name": row["name"], "size": list(image.size), "bounds": list(box),
                     "layers": row["layers"], "repeatPixelsEqual": bool(FIRST),
                     "edgeMargin": min(box[0], box[1], image.width - box[2], image.height - box[3])})

titles = {
    "rocky": "岩质 / Ground + Craters",
    "ocean": "海洋 / Water + Land + Cloud",
    "gas": "气态带环 / GasLayers + Ring",
    "desert": "干旱 / DryTerran",
    "ice": "冰 / Land + Lakes + Clouds",
    "lava": "熔岩 / Land + Craters + Lava",
    "temperate": "湿润 / Land + Cloud",
    "star-yellow": "恒星 / Blobs + Star + Flares",
    "black-hole": "黑洞 / Core + Disk",
    "gas-clouds": "气态云层 / 双层GasPlanet",
    "asteroid": "小行星 / Asteroid",
    "galaxy": "星系外形 / Galaxy",
}
board = Image.new("RGB", (1800, 1040), background)
draw = ImageDraw.Draw(board)
draw.text((24, 12), "PixelPlanets 原材质对照：128 / 1024（固定种子、光向、相位；保留原色阶）", font=heading, fill=(226, 234, 242))
draw.text((24, 52), "独立原生导出，不是游戏截图。每对本体显示比例相同；仅画布和采样密度变化。", font=small, fill=(149, 170, 185))
for index, (identifier, title) in enumerate(titles.items()):
    x, y = (index % 4) * 450, 90 + (index // 4) * 310
    draw.line((x + 12, y + 3, x + 438, y + 3), fill=(46, 59, 71))
    draw.text((x + 16, y + 12), title, font=small, fill=(224, 232, 238))
    for offset, pixels in [(0, 128), (220, 1024)]:
        image = images[f"{identifier}-{pixels}-dither"]
        factor = 180 / (image.width - 32)
        size = (round(image.width * factor), round(image.height * factor))
        preview = image.resize(size, Image.Resampling.LANCZOS)
        board.paste(preview, (x + offset + (220 - size[0]) // 2, y + 48 + (210 - size[1]) // 2), preview)
        draw.text((x + offset + 82, y + 264), str(pixels), font=font, fill=(157, 213, 221))
board.save(OUTPUT / "overview.png")

detail = Image.new("RGB", (1600, 980), background)
draw = ImageDraw.Draw(detail)
draw.text((24, 12), "PixelPlanets 原恒星与海洋：分辨率与抖动对照（保留完整原材质层）", font=heading, fill=(226, 234, 242))
for r, identifier in enumerate(["star-yellow", "ocean"]):
    y = 65 + r * 445
    draw.text((20, y), titles[identifier], font=font, fill=(224, 232, 238))
    variants = [("128-dither", "128 / 原抖动"), ("1024-dither", "1024 / 原抖动"), ("1024-plain", "1024 / 关闭抖动")]
    for c, (variant, label) in enumerate(variants):
        x = c * 530
        image = images[f"{identifier}-{variant}"]
        box = image.getchannel("A").getbbox()
        content = image.crop(box)
        scale = min(350 / content.width, 350 / content.height)
        large = content.resize((round(content.width * scale), round(content.height * scale)), Image.Resampling.LANCZOS)
        detail.paste(large, (x + (520 - large.width) // 2, y + 45), large)
        draw.text((x + 135, y + 402), label, font=font, fill=(157, 213, 221))
detail.save(OUTPUT / "detail.png")
(OUTPUT / "readings.json").write_text(json.dumps(readings, ensure_ascii=False, indent=2), encoding="utf8")
print(json.dumps({"ok": True, "samples": len(rows), "repeatedEqual": len(rows) if FIRST else 0,
                  "overview": str(OUTPUT / "overview.png"), "detail": str(OUTPUT / "detail.png"),
                  "edgeTouching": [r["name"] for r in readings if r["edgeMargin"] == 0]}, ensure_ascii=False))
