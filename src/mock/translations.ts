/** mock 原文：覆盖标题/列表/代码块/链接/加粗，用于预览 MarkdownRenderer */
export const MOCK_RAW = `# browser-cdp

Connect to a running Chrome instance via the Chrome DevTools Protocol and
share its login state across tools.

## When to use

- The target site requires an **authenticated** session you already have open.
- You need to inspect network requests or cookies from a live tab.

## Quick start

\`\`\`bash
chrome --remote-debugging-port=9222
\`\`\`

Then point the agent at \`http://localhost:9222\`. See the
[CDP spec](https://chromedevtools.github.io/devtools-protocol/) for details.

> Note: only one client should drive a tab at a time.
`;

/** mock 译文（与原文段落对齐） */
export const MOCK_TRANS = `# 浏览器 CDP

通过 Chrome DevTools Protocol 连接一个正在运行的 Chrome 实例，
并在多个工具之间共享它的登录态。

## 何时使用

- 目标站点需要你已经打开的**已认证**会话。
- 你需要检查某个活跃标签页的网络请求或 Cookie。

## 快速开始

\`\`\`bash
chrome --remote-debugging-port=9222
\`\`\`

然后让 agent 指向 \`http://localhost:9222\`。详见
[CDP 规范](https://chromedevtools.github.io/devtools-protocol/)。

> 注意：同一时刻只应有一个客户端驱动某个标签页。
`;

/** anchor 格式双语文本，供 parseBilingual 解析 */
export const MOCK_BILINGUAL =
  `<!-- anchor:original -->\n${MOCK_RAW}\n<!-- anchor:translated -->\n${MOCK_TRANS}\n`;
