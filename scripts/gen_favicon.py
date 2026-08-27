"""用新鳍+浪图形（fin-light.png）重生成 public/favicon.svg（base64 内嵌）。"""
import base64
from pathlib import Path

here = Path(__file__).resolve().parent.parent / "frontend"
png = (here / "src/assets/brand/fin-light.png").read_bytes()
b64 = base64.b64encode(png).decode()

# fin-light 为 574x469
svg = (
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
    'viewBox="0 0 574 469" width="64" height="52">'
    f'<image xlink:href="data:image/png;base64,{b64}" x="0" y="0" width="574" height="469"/>'
    '</svg>'
)
out = here / "public/favicon.svg"
out.write_text(svg, encoding="utf-8")
print("wrote", out, len(svg), "bytes")
