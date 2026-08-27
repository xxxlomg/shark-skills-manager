import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // Tauri 开发模式由 tauri.conf.json 的 devUrl 指定
  clearScreen: false,
  css: {
    // 显式提供 postcss 配置（空对象），让 vite 跳过 postcss-load-config 的
    // 目录搜索。在 Windows + Defender 环境下该搜索首次要 15 秒（每次启动
    // 都触发），导致首个 CSS 请求（index.css）卡 14s+，并阻塞事件循环连坐
    // 其他静态资源（env.mjs 11s）。
    postcss: {},
  },
  server: {
    host: "127.0.0.1", // 显式绑定 IPv4，避免 localhost 的 IPv6/IPv4 二义性
    port: 5173,
    strictPort: true,
    // 启动即预热关键模块：把 Tailwind 首次编译 + vite 首请求固定开销
    // 移到 vite 启动阶段（与 tauri cargo 编译重叠），WebView 加载时已热。
    warmup: {
      clientFiles: ["./src/main.tsx", "./src/index.css", "./src/App.tsx"],
    },
    // 强制 HMR 走 127.0.0.1：避免系统代理/防火墙劫持 localhost 的 ws 升级导致挂起
    hmr: {
      host: "127.0.0.1",
      protocol: "ws",
    },
  },
});
