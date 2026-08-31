# shark skills · 技能鲨

> 本地 AI 技能（Agent Skills）管理、翻译与打包桌面工具——让中文用户**一眼看懂、一用就会**。

鲨 = 敏锐、精准、快。shark skills 把你散落在各个 AI 工具里的 skills 统一扫进来：
看懂它（流式翻译成中英对照）、管好它（分类 / 搜索 / 状态追踪）、分享它（打包成 `.skillpack` 在平台内流通）。

**正式版入口**：[gitee.com/xxxlomg/shark-skills-manager](https://gitee.com/xxxlomg/shark-skills-manager)
当前发布形态：**Windows x64 绿色解压版**（`shark-skills-manager.exe` 与 `skills/` 同级目录，免安装随取随用）

---

## ✨ 核心价值

| 模块 | 能力 |
| --- | --- |
| **多源扫描** | 配置多个 skills 目录（路径 / 标签 / 启用开关）统一扫描，按标签分组展示；源目录删除自动标记 |
| **流式翻译** | 调 LLM API 流式生成中英对照译文；大文件自动分块、哈希增量跳过未变化原文；自动派生中文标题 / 描述 |
| **浏览视图** | 首页分类 → 分类详情 → 详情抽屉三级导航；网格 / 列表双布局；合集嵌套折叠；`Ctrl+K` 全局搜索 |
| **引用台账（Hub）** | 技能与各 AI 工具之间的链接 / 副本统一管理；出处 → 落点可视化 + 健康状态；批量引入 / 取消引入 |
| **Skill Packs** | 勾选技能打包为 `.skillpack`；导入 / 导出 / 安装 / 改名；包内附 `pack.json` + `README.md` + 译文 sidecar |
| **导入管线** | 本地 zip / Git URL 两种来源；安全解压预览，提交时拍平嵌套、同名自动改名 |
| **创作工作台** | 全页沉浸式技能创作；七阶段流程导航（发现 → 范围 → 建模 → 设计 → 生成 → 评估 → 打包）；Markdown 编辑 / 分栏 / 预览；附带资源 IDE 式编辑器 + 模板库 + AI 帮写；初稿落地后按正文引用一键生成真实可用的 references/scripts 附件 |
| **AI 创作** | 模型直出 SKILL.md 原文流式生成，右侧预览实时滚动跟随，可「应用到正文」 |
| **统一 AI 层** | 翻译 / AI 创作 / 连接测试统一走设置页 LLM 配置；prompt 模板集中在 `src/lib/ai/prompts/` 一处管理 |
| **布局外观** | 顶栏 ↔ 侧栏模式切换；侧栏技能库目录树；暗 / 亮双主题 + 四色 accent 预设 |
| **数据外部化** | 配置 / 译文 / Packs / 导入库统一存放在系统数据目录，重装不丢，旧目录自动迁移 |

---

## 🚀 安装与运行

### 绿色解压版（推荐，当前发布形态）

1. 从[正式版入口](https://gitee.com/xxxlomg/shark-skills-manager)下载 `shark-skills-manager_<version>_win64.zip`；
2. 解压后进入 `shark-skills-manager/`，双击 `shark-skills-manager.exe`；
3. 若 Windows 提示「Windows protected your PC」：点「更多信息」→「仍要运行」（未签名绿色软件的正常提示）。

### 源码构建

环境要求：Node 18+、Rust stable（含 Tauri [平台前置依赖](https://v2.tauri.app/start/prerequisites/)）。

```bash
npm install
npm run tauri:dev      # 桌面应用开发模式（前端 HMR + Rust 热重载）
```

纯前端预览（无后端，假数据）：

```bash
npm run dev
# 浏览器访问 http://localhost:5173/?mock=1
```

生产打包：

```bash
npm run tauri:build    # Windows .exe / macOS .dmg / Linux .AppImage
scripts/build-portable.bat   # Windows 绿色便携包 → dist-portable/
scripts/build-portable.sh    # macOS / Linux 便携包
```

Rust 单元测试：

```bash
cd src-tauri
cargo test
```

---

## 📁 架构概览

### 技术栈

| 层 | 技术 |
| --- | --- |
| 桌面框架 | Tauri 2（Rust） |
| 前端 | React 19 + TypeScript |
| 构建 | Vite 8 |
| 样式 | Tailwind CSS v4 + shadcn/ui（Radix） |
| 图标 / 通知 | lucide-react / sonner |

### 目录结构

```
shark-skills-manager/
├── src/                  # React 前端
│   ├── components/       #   ui / layout / skill / settings / common
│   ├── hooks/            #   数据加载与状态
│   ├── lib/              #   api 封装 / 翻译 / AI 层 / markdown 等
│   ├── assets/brand/     #   品牌资产生成管线
│   ├── App.tsx           #   主应用与全局状态
│   └── index.css         #   主题变量 + accent 预设
├── src-tauri/            # Rust 后端（scanner / translations / pack / import / authoring，含单测）
├── public/               # 静态资源（favicon / 内置示例技能）
├── skills/               # 示例技能 + 内置资源（随包分发、扫描隐藏）
├── scripts/              # 便携包打包脚本 + merge 单测
└── docs/                 # 设计追踪文档（PLAN-*.md，不入库）
```

---

## ⚙️ 配置说明

所有配置均在应用内 **设置** 面板完成，持久化于系统数据目录（见下文），**API Key 仅存本地**。

| 配置项 | 说明 |
| --- | --- |
| **扫描路径** | 添加多个 AI 工具的 skills 目录，自定义显示标签与启用开关；自动检测常见默认路径 |
| **LLM 配置** | OpenAI 兼容接口：`api_key` / `base_url` / `model`；「测试连接」按钮即时验证 |
| **思考模式** | 开 / 关（默认关）；配合思考强度 low / high / max（默认 low）。仅对 DeepSeek 端点发送（其他端点自动忽略） |
| **外观** | 顶栏 / 侧栏布局切换；暗 / 亮主题与 accent 色即时切换并持久化 |
| **下载 / 导入目录** | 自定义 Pack 导出与技能导入的目标目录 |

---

## 🧰 Skillpack 安装与使用

**安装技能包**：Packs 页「导入 .skillpack」，或直接把 `.skillpack` / `.zip` 拖进应用窗口。导入自动执行三道闸：

- **版本闸** —— 包 `format_version` 高于当前应用版本时拒绝导入；
- **sha256 自验** —— 清单登记的每个文件逐一校验哈希，任一不符整包拒收；
- **不覆盖** —— 与已有包 id 冲突时自动改名，已有包不受影响。

导入后进入 Packs 库；点「安装」落地到技能库（`imported/<包名>/`，自动写入 `.import.json` 来源记录），即可浏览 / 翻译 / 引用到各 AI 工具。

**创建与导出**：Packs 页「新建 Pack」→ 从全部技能勾选（单次上限 40 个）→ 生成 `pack.json` 元数据与 `README.md` → 「导出」得到可分享的 `.skillpack` 文件。

**删除**：仅移除包本体，**不影响**已安装到技能库的副本与 Hub 现有引用。

---

## 💾 数据目录

运行时数据与代码分离，位于系统数据目录（Windows：`%AppData%\shark\shark-skills-manager`）：

```
shark-skills-manager/
├── config.json          # 扫描路径 / LLM 配置（仅存本地）
├── translations.json    # 译文索引
├── translations/        # 中英对照译文文件
├── packs/               # 已创建的 Skill Packs
└── imported/            # 由 zip / URL / Pack 安装进来的技能库
```

首次启动若发现旧版数据目录，自动迁移并自校验。

---

## ❓ 常见问题

**Q：翻译功能不可用 / 报"未配置 API Key"？**
A：需在 设置 → LLM 配置 中填写 OpenAI 兼容接口的 `api_key` / `base_url` / `model`，点「测试连接」验证通过后即可使用。

**Q：Windows 提示"Windows protected your PC"？**
A：绿色解压版未做代码签名，属正常提示。点「更多信息」→「仍要运行」即可。

**Q：技能从哪里来？**
A：三个来源：① 设置中配置的扫描路径（本地已有 skills 目录）；② 导入管线（zip / Git URL；Packs 页还可以导入 `.skillpack`）；③ 创作工作台自己创建。

**Q：删除技能会丢文件吗？**
A：不会。批量删除前自动完整备份到 `merge-backups` 再移入系统**回收站**（可恢复）；被 Hub 引用的技能转「解除引用」（二段式删除，绝不物理删除文件）。

**Q：配置和数据存在哪里？重装会丢吗？**
A：存在系统数据目录（Windows：`%AppData%\shark\shark-skills-manager`），与程序本体分离，重装或更换绿色包位置不丢数据。

**Q：技能如何给 Claude Code / Codex CLI 等工具用？**
A：详情抽屉「引用」按钮或 Hub 页「新建引用」——链接（junction，推荐）/ 复制 / 移动三选一，把技能放进已注册工具的 skills 目录；引用记录在 Hub 统一管理。

---

## 🤝 贡献

本项目由 xxxlomg 开发，仅供学习和个人使用。
问题与建议请到[正式版入口](https://gitee.com/xxxlomg/shark-skills-manager)提 Issue。