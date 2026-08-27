import { SearchX } from "lucide-react";

interface EmptyStateProps {
  hasError?: boolean;
  errorMessage?: string;
}

export function EmptyState({ hasError, errorMessage }: EmptyStateProps) {
  if (hasError) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-6 py-16 text-center">
        <div className="rounded-full bg-destructive/10 p-3">
          <SearchX className="h-6 w-6 text-destructive" />
        </div>
        <h3 className="text-base font-semibold text-foreground">
          加载失败
        </h3>
        <p className="text-sm text-muted-foreground">
          技能数据加载失败：{errorMessage}
        </p>
        <p className="text-xs text-muted-foreground">
          请尝试重启应用，或在设置中检查扫描路径。
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-6 py-16 text-center">
      <div className="rounded-full bg-muted p-3">
        <SearchX className="h-6 w-6 text-muted-foreground" />
      </div>
      <h3 className="text-base font-semibold text-foreground">
        没有找到匹配的技能
      </h3>
      <p className="text-sm text-muted-foreground">
        试试调整搜索关键词或清除筛选条件
      </p>
    </div>
  );
}
