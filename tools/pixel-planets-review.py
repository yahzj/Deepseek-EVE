"""PixelPlanets透明度/边界/小尺寸审查板，依赖现有Pillow，不安装包。
用法：python tools/pixel-planets-review.py <样片目录> [复现目录]
输入仅合成PNG和manifest；输出同目录review.png/readings.json。
游戏v0.1.0/档v31/Godot3.5，2026-10-09核对；不读取玩家档。
"""
import json
import hashlib
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps

directory = Path(sys.argv[1]).resolve()
repeat = Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else None
manifest = json.loads((directory / "manifest.json").read_text(encoding="utf8"))
readings = []
images = []
for sample in manifest["samples"]:
    file = directory / (sample["id"] + ".png")
    assert hashlib.sha256(file.read_bytes()).hexdigest() == sample["sha256"]
    image = Image.open(file).convert("RGBA")
    assert image.size == (sample["width"], sample["height"])
    alpha = image.getchannel("A")
    box = alpha.getbbox()
    assert box and alpha.getextrema() == (0, 255), sample["id"]
    assert box[0] > 0 and box[1] > 0 and box[2] < image.width and box[3] < image.height, (sample["id"], box)
    assert len(image.getcolors(image.width * image.height)) >= 4, "PNG缺少可辨纹理"
    if repeat:
        repeated = Image.open(repeat / file.name).convert("RGBA")
        assert repeated.size == image.size and repeated.tobytes() == image.tobytes(), sample["id"] + "复现像素不一致"
    images.append(image)
    readings.append({"id": sample["id"], "size": list(image.size), "visibleBounds": list(box), "bytes": file.stat().st_size,
                     "transparentPixels": sum(count for count, value in alpha.getcolors(image.width * image.height) if value == 0),
                     "repeatPixelsEqual": bool(repeat)})

board = Image.new("RGB", (1500, 880), (12, 18, 27))
draw = ImageDraw.Draw(board)
font_path = Path("C:/Windows/Fonts/msyh.ttc")
assert font_path.exists(), "审查板需要本机微软雅黑字体"
font = ImageFont.truetype(str(font_path), 20)
heading = ImageFont.truetype(str(font_path), 26)
draw.text((28, 18), "PixelPlanets 天体样片 / 深浅背景与缩小预览", font=heading, fill=(238, 242, 246))
titles = ["岩质 · 无大气", "海洋 · 岛屿与云层", "气态 · 带环"]
draw.rectangle((0, 655, 1499, 879), fill=(227, 231, 236))
for index, (image, title) in enumerate(zip(images, titles)):
    x = index * 500
    draw.text((x + 28, 70), title, font=heading, fill=(224, 231, 239))
    large = ImageOps.contain(image, (370, 370), Image.Resampling.NEAREST)
    board.paste(large, (x + (500 - large.width) // 2, 130 + (370 - large.height) // 2), large)
    for size, offset in [(116, 90), (48, 320)]:
        small = ImageOps.contain(image, (size, size), Image.Resampling.NEAREST)
        board.paste(small, (x + offset, 515 + (116 - small.height) // 2), small)
        draw.text((x + offset, 627), str(size) + "px", font=font, fill=(163, 180, 197))
    light = ImageOps.contain(image, (150, 150), Image.Resampling.NEAREST)
    board.paste(light, (x + 170, 695), light)
board.save(directory / "review.png")
(directory / "readings.json").write_text(json.dumps(readings, ensure_ascii=False, indent=2), encoding="utf8")
print(json.dumps({"ok": True, "samples": len(images), "repeat": bool(repeat), "review": str(directory / "review.png")}, ensure_ascii=False))
