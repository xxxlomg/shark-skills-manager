/**
 * 设置 → 技能仓库分区（模块 A 发布侧，从 SettingsDialog 拆出）。
 * 本地仓库路径 + 远端 URL + 初始化/校验/清除 + 仓库状态摘要。
 * 凭据完全走用户自己的 git 配置，App 不碰任何凭据。
 */
import { AlertTriangle, FolderOpen, GitBranch, Store } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/common/Tip";
import type { GitStatusInfo } from "@/lib/api";

interface RepoSectionProps {
  loaded: boolean;
  repoLocalPath: string;
  onRepoLocalPathChange: (value: string) => void;
  repoRemoteUrl: string;
  onRepoRemoteUrlChange: (value: string) => void;
  repoBusy: boolean;
  repoStatus: GitStatusInfo | null;
  onPick: () => void;
  onSetup: (initIfMissing: boolean) => void;
  onClear: () => void;
}

export function RepoSection({
  loaded,
  repoLocalPath,
  onRepoLocalPathChange,
  repoRemoteUrl,
  onRepoRemoteUrlChange,
  repoBusy,
  repoStatus,
  onPick,
  onSetup,
  onClear,
}: RepoSectionProps) {
  return (
    <>
      <p className="text-xs text-muted-foreground">
        发布 Pack 到你的「技能货架」仓库。凭据完全走你自己的 git
        配置（SSH / credential manager），App 不碰任何凭据。
      </p>

      <div className="space-y-1.5">
        <label className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          <FolderOpen className="h-3.5 w-3.5" />
          本地仓库路径
        </label>
        <div className="flex gap-2">
          <Input
            type="text"
            placeholder="D:\my-skill-repo"
            value={repoLocalPath}
            onChange={(e) => onRepoLocalPathChange(e.target.value)}
          />
          <Tip label="选择文件夹">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onPick}
              className="shrink-0 px-2.5"
              aria-label="选择文件夹"
            >
              <FolderOpen className="h-4 w-4" />
            </Button>
          </Tip>
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          <GitBranch className="h-3.5 w-3.5" />
          远端 URL
        </label>
        <Input
          type="text"
          placeholder="https://github.com/you/my-skill-repo.git（仓库须已存在）"
          value={repoRemoteUrl}
          onChange={(e) => onRepoRemoteUrlChange(e.target.value)}
        />
        <p className="text-[11px] text-text-tertiary">
          App 不代建远程仓库：先去 GitHub/Gitee 建一个空仓库，把 URL 贴进来。
        </p>
      </div>

      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          onClick={() => onSetup(true)}
          disabled={repoBusy || !loaded}
        >
          {repoBusy ? "处理中…" : "初始化新仓库"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onSetup(false)}
          disabled={repoBusy || !loaded}
        >
          校验已有仓库
        </Button>
        {repoStatus?.repo_configured && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClear}
            disabled={repoBusy}
            className="ml-auto text-text-tertiary"
          >
            清除配置
          </Button>
        )}
      </div>

      {repoStatus?.repo_configured && (
        <div className="space-y-1 rounded-lg border border-stroke bg-glass-1 p-3 text-xs text-text-secondary">
          <p className="flex items-center gap-1.5 font-medium text-foreground">
            <Store className="h-3.5 w-3.5 text-brand" />
            当前仓库状态
          </p>
          {repoStatus.repo_exists ? (
            <>
              <p>
                分支 <span className="font-mono">{repoStatus.branch}</span>
                {" · "}
                <span className="font-mono">
                  {repoStatus.clean ? "工作区干净" : "有未提交改动"}
                </span>
                {repoStatus.ahead > 0 && ` · 领先远端 ${repoStatus.ahead} 个提交`}
                {repoStatus.behind > 0 && ` · 落后远端 ${repoStatus.behind} 个提交`}
              </p>
              <p className="break-all font-mono text-text-tertiary">
                {repoStatus.repo_path}
              </p>
            </>
          ) : (
            <p className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5" />
              配置的路径不存在或不是 git 仓库——点「初始化新仓库」修复
            </p>
          )}
        </div>
      )}
    </>
  );
}