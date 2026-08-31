/**
 * 全局错误边界：视图/组件渲染抛错时兜底展示，避免整窗白屏。
 * 粗粒度策略：出错即提示并可「回到技能库」；不尝试局部恢复（沉浸态复杂度高）。
 */
import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    // 调试留痕（不弹 toast——错误边界自身不应再依赖外部 UI）
    console.error("[AppErrorBoundary]", error);
  }

  private reset = () => {
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="grid min-h-dvh place-items-center bg-[var(--bg-0)] p-6">
        <div className="w-full max-w-md rounded-lg border border-border/60 bg-card p-6 text-center">
          <p className="text-2xl">⚠️</p>
          <h1 className="mt-2 text-base font-semibold text-text-primary">
            界面渲染出了点问题
          </h1>
          <p className="mt-1.5 break-all text-xs text-text-tertiary">
            {this.state.error.message || String(this.state.error)}
          </p>
          <p className="mt-2 text-xs text-text-tertiary">
            你的草稿与数据都保存在本机，不会因此丢失。可点击下方按钮回到技能库重新开始。
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <Button size="sm" onClick={this.reset}>
              重试
            </Button>
            <Button size="sm" variant="ghost" onClick={() => window.location.reload()}>
              刷新窗口
            </Button>
          </div>
        </div>
      </div>
    );
  }
}