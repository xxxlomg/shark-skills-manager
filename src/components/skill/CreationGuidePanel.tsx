import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface CreationGuidePanelProps {
  /** 「我的描述」单一输入（PLAN-11 阶段 0：description 即 purpose，无「何时用」）。 */
  description: string;
  bodyEmpty: boolean;
  busy: boolean;
  onDescriptionChange: (value: string) => void;
  onGenerateBody: () => void;
}

/**
 * 极简创建入口（PLAN-17）：只保留基础元数据——描述输入 + AI 生成正文。
 * 内部规范（shark-skill-creator）对用户隐藏：由后端 API 隐式将规范转化为
 * prompt 指令注入 AI 生成链路，用户只看到输入框与生成按钮。
 */
export function CreationGuidePanel({
  description,
  bodyEmpty,
  busy,
  onDescriptionChange,
  onGenerateBody,
}: CreationGuidePanelProps) {
  const canGenerate = description.trim().length > 0 && !busy;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-4">
      <label
        htmlFor="creation-description"
        className="text-[12px] font-medium text-text-primary"
      >
        描述
      </label>
      <textarea
        id="creation-description"
        value={description}
        onChange={(event) => onDescriptionChange(event.target.value)}
        rows={5}
        placeholder="输入想法"
        className={cn(
          "mt-1.5 w-full resize-none rounded-md border border-input bg-transparent px-3 py-2.5 text-sm leading-relaxed outline-none transition-colors placeholder:text-text-tertiary/70 focus:border-primary focus:ring-2 focus:ring-primary/15",
        )}
      />

      <Button
        type="button"
        size="lg"
        className="mt-3 w-full justify-center gap-2 rounded-md"
        disabled={!canGenerate}
        onClick={onGenerateBody}
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Sparkles className="h-4 w-4" />
        )}
        {bodyEmpty ? "生成正文" : "补充正文"}
      </Button>
    </div>
  );
}