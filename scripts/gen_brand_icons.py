"""从新 logo 提取纯图形（鳍+浪），生成深浅两色透明 PNG + App 图标源图。

产物（frontend/src/assets/brand/）：
  fin-light.png   透明底 · 黑鳍 + 橙浪（浅色主题/浅色任务栏）
  fin-dark.png    透明底 · 白鳍 + 橙浪（深色主题/深色任务栏）
  appicon-src.png 1024 · 暖纸圆角底 + 黑鳍橙浪（供 npx tauri icon 生成全套）
"""
from PIL import Image, ImageDraw

SRC = r"website/assets/ChatGPT Image 2026年8月11日 10_29_32.png"
OUT = r"frontend/src/assets/brand"

im = Image.open(SRC).convert("RGB")
w, h = im.size
px = im.load()

def is_bg(c): return c[0] > 235 and c[1] > 235 and c[2] > 235
def is_orange(c): return c[0] > 180 and c[1] < 140 and c[2] < 100

# 1) 在鳍+浪区域（排除文字）找 tight bbox
y0, y1 = 270, 770
minx, miny, maxx, maxy = w, h, 0, 0
for y in range(y0, y1):
    for x in range(w):
        if not is_bg(px[x, y]):
            minx = min(minx, x); maxx = max(maxx, x)
            miny = min(miny, y); maxy = max(maxy, y)
print("graphic bbox:", minx, miny, maxx, maxy)

gw, gh = maxx - minx + 1, maxy - miny + 1

def build(fg_white):
    """fg_white=False -> 黑鳍；True -> 白鳍。橙浪不变。背景透明。"""
    out = Image.new("RGBA", (gw, gh), (0, 0, 0, 0))
    op = out.load()
    for y in range(gh):
        for x in range(gw):
            c = px[minx + x, miny + y]
            if is_bg(c):
                op[x, y] = (0, 0, 0, 0)
            elif is_orange(c):
                op[x, y] = (c[0], c[1], c[2], 255)
            else:
                # 鳍（黑）或其抗边；深色版翻成白
                if fg_white:
                    op[x, y] = (255, 255, 255, 255)
                else:
                    op[x, y] = (c[0], c[1], c[2], 255)
    return out

light = build(False)
dark = build(True)
light.save(f"{OUT}/fin-light.png")
dark.save(f"{OUT}/fin-dark.png")
print("saved fin-light/fin-dark", gw, "x", gh)

# 2) App 图标源图：1024 暖纸圆角底 + 黑鳍橙浪居中
S = 1024
canvas = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(canvas)
d.rounded_rectangle([0, 0, S - 1, S - 1], radius=200, fill=(250, 248, 244, 255))
# 图形缩放到 ~72% 居中
scale = int(S * 0.72)
ratio = scale / max(gw, gh)
nw, nh = int(gw * ratio), int(gh * ratio)
g = light.resize((nw, nh), Image.LANCZOS)
ox, oy = (S - nw) // 2, (S - nh) // 2
canvas.alpha_composite(g, (ox, oy))
canvas.save(f"{OUT}/appicon-src.png")
print("saved appicon-src.png", S)
