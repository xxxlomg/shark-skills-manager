# brand/ — 产品品牌素材位

产品名: **shark skills（技能鲨）**。
品牌（2026-08-11 定稿）: 黑鳍 + 橙浪 的鲨，瑞士国际主义风味。
配色: Paper `#FAF8F4` / Accent `#FF6A45` / Ink `#1A1714` / Line `#E7E1D8`。

## 文件

- `fin-light.png` — 透明底 · 黑鳍 + 橙浪（浅色主题 / 浅色任务栏）
- `fin-dark.png` — 透明底 · 白鳍 + 橙浪（深色主题 / 深色任务栏）
- `appicon-src.png` — 1024 · 暖纸圆角底 + 黑鳍橙浪（供 `npx tauri icon` 生成全套应用图标）

## 生成管线（品牌图形均由脚本产出，勿手改素材）

```bash
# 仓库根下:
python scripts/gen_brand_icons.py   # 重建 fin-light / fin-dark / appicon-src
python scripts/gen_favicon.py       # 由 fin-light 重建 public/favicon.svg
npx tauri icon <appicon-src.png>    # 重建 src-tauri/icons/** 全套
```

> 旧版 navy 实心鲨品牌素材（`shark-*.png`、`make_brand2.py`、`make_svg2.py`）已随品牌切换归档至仓库根 `.trash/brand-old/`，可恢复删除。

## 落地触点清单

| 触点           | 位置                                                                  |
| -------------- | --------------------------------------------------------------------- |
| 窗口 / 产品名  | `src-tauri/tauri.conf.json` → `productName`、`app.windows[0].title`   |
| 页面标题       | `index.html` → `<title>`、splash `.sp-title`                          |
| favicon        | `public/favicon.svg`（基于 fin-light 内嵌）                           |
| 顶栏 logo      | `src/components/layout/Topbar.tsx`（fin-light / fin-dark 深浅自适应） |
| 侧栏 logo      | `src/components/layout/Sidebar.tsx`（同上）                           |
| splash logo    | `frontend/index.html` → `.sp-logo-wrap img`（fin-light）              |
| 应用图标全尺寸 | `src-tauri/icons/**`（由 `appicon-src.png` 生成）                     |
| UI accent      | `src/index.css` 四色预设（设置页可换，与品牌解耦）                    |

**注意:数据目录与 identifier 解耦** —— `config.rs` 固定使用 `Roaming\shark\shark-skills-manager`（`PRODUCT_LINE_DIR` + `DATA_DIR_NAME`），不随 identifier 变化；identifier 为 `com.skills-shark.desktop`。
