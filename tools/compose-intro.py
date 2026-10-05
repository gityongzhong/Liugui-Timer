# -*- coding: utf-8 -*-
# 合成 GitHub README 介绍图：深色横幅，真实截图 + 投影 + 功能标签
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os

ROOT = r"C:\Users\Administrator\WorkBuddy\2026-09-30-23-40-39"
SHOTS = os.path.join(ROOT, "countdown-electron", "shots")
ICON = os.path.join(ROOT, "countdown-electron", "build", "icon-256.png")
OUT = os.path.join(ROOT, "发布", "github-repo", "intro.png")
PREVIEW = os.path.join(SHOTS, "介绍图-合成.png")

W, H = 1600, 980
BG = (19, 19, 21)          # #131315
TXT = (242, 242, 244)
SUB = (154, 154, 162)
LINE = (38, 38, 42)
PILL_BG = (29, 29, 33)
PILL_TX = (200, 200, 205)

F_BOLD = r"C:\Windows\Fonts\msyhbd.ttc"
F_REG = r"C:\Windows\Fonts\msyh.ttc"

canvas = Image.new("RGBA", (W, H), BG + (255,))


def font(path, size):
    return ImageFont.truetype(path, size)


def load_shot(name, target_w):
    img = Image.open(os.path.join(SHOTS, name)).convert("RGBA")
    r = target_w / img.width
    return img.resize((target_w, int(img.height * r)), Image.LANCZOS)


def paste_with_shadow(base, img, x, y, radius=28, alpha=110):
    """在 (x,y) 处贴截图，先画一个模糊圆角黑影托底"""
    w, h = img.size
    shadow = Image.new("RGBA", (w + 80, h + 80), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.rounded_rectangle([40 + 4, 40 + 12, 40 + w - 4, 40 + h + 12],
                         radius=radius, fill=(0, 0, 0, alpha))
    shadow = shadow.filter(ImageFilter.GaussianBlur(18))
    base.alpha_composite(shadow, (x - 40, y - 40))
    base.alpha_composite(img, (x, y))


draw = ImageDraw.Draw(canvas)

# ---- 头部：图标 + 名称 + 版本 ----
icon = Image.open(ICON).convert("RGBA").resize((84, 84), Image.LANCZOS)
canvas.alpha_composite(icon, (80, 52))
draw.text((188, 58), "流晷计时器", font=font(F_BOLD, 56), fill=TXT)

vt = "v0.7.3"
vf = font(F_REG, 22)
vb = draw.textbbox((0, 0), vt, font=vf)
vw = vb[2] - vb[0] + 28
vx = 188 + draw.textbbox((0, 0), "流晷计时器", font=font(F_BOLD, 56))[2] + 22
draw.rounded_rectangle([vx, 74, vx + vw, 114], radius=20, fill=PILL_BG, outline=(70, 70, 78), width=1)
draw.text((vx + 14, 78), vt, font=vf, fill=PILL_TX)

draw.text((190, 140), "会议控时 · 一眼可读 · PPT 放映自动计时 · 完全免费",
          font=font(F_REG, 22), fill=SUB)
draw.line([80, 192, 1520, 192], fill=LINE, width=1)

# ---- 截图区 ----
hero = load_shot("介绍图-主界面.png", 880)          # 880×592
fs = load_shot("介绍图-全屏投屏.png", 540)           # 540×321
run = load_shot("介绍图-计时中.png", 470)            # 470×316

paste_with_shadow(canvas, hero, 90, 228)
paste_with_shadow(canvas, fs, 1000, 228)
paste_with_shadow(canvas, run, 1035, 586)

# ---- 功能标签（贴在 hero 下方）----
chips = ["全屏投屏计时", "桌面悬浮窗", "PPT 放映自动计时", "多计时器 · 分类管理", "免安装 · 不联网"]
cf = font(F_REG, 18)
pad, gap = 24, 14
widths = []
for c in chips:
    b = draw.textbbox((0, 0), c, font=cf)
    widths.append(b[2] - b[0] + pad * 2)
total = sum(widths) + gap * (len(chips) - 1)
cx = 90
cy, ch = 862, 46
for c, cw in zip(chips, widths):
    draw.rounded_rectangle([cx, cy, cx + cw, cy + ch], radius=23,
                           fill=PILL_BG, outline=(58, 58, 64), width=1)
    b = draw.textbbox((0, 0), c, font=cf)
    draw.text((cx + (cw - (b[2] - b[0])) // 2 - b[0], cy + (ch - (b[3] - b[1])) // 2 - b[1]),
              c, font=cf, fill=PILL_TX)
    cx += cw + gap

# ---- 页脚 ----
draw.text((90, 938), "Windows 10 / 11 · 64 位 · 双击即用 · 数据仅存本机",
          font=font(F_REG, 17), fill=(119, 119, 125))

canvas.convert("RGB").save(OUT, "PNG", optimize=True)
canvas.convert("RGB").save(PREVIEW, "PNG", optimize=True)
print("已输出:", OUT, os.path.getsize(OUT) // 1024, "KB")
print("预览:", PREVIEW)
