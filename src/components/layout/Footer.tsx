import { GitBranch, GitFork } from "lucide-react";
import { LINKS } from "@/lib/links";

/** 页脚（PLAN-09 P6）：产品名 + 双仓库链接 + 作者署名
 *
 * 两种形态：
 *  - 默认（顶栏模式）：页面底部横排
 *  - compact（侧栏模式，PLAN-10）：紧凑纵向，垫在侧栏最底部
 */
function FooterLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 transition-colors hover:text-primary"
    >
      {children}
    </a>
  );
}

export function Footer({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <footer className="px-1 pt-2 text-center">
        <p className="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 text-[10.5px] text-text-tertiary">
          <span className="font-medium text-text-secondary">shark skills</span>
          <FooterLink href={LINKS.githubRepo}>
            <GitBranch className="h-3 w-3" />
            GitHub
          </FooterLink>
          <FooterLink href={LINKS.giteeRepo}>
            <GitFork className="h-3 w-3" />
            Gitee
          </FooterLink>
          <span>© 2026 xxxlomg</span>
        </p>
      </footer>
    );
  }

  return (
    <footer className="mt-auto border-t border-border bg-background">
      <div className="mx-auto max-w-6xl px-6 py-4">
        <div className="flex flex-col items-center gap-1.5 text-center">
          <p className="flex flex-wrap items-center justify-center gap-4 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">shark skills</span>
            <FooterLink href={LINKS.githubRepo}>
              <GitBranch className="h-3.5 w-3.5" />
              GitHub
            </FooterLink>
            <FooterLink href={LINKS.giteeRepo}>
              <GitFork className="h-3.5 w-3.5" />
              Gitee
            </FooterLink>
            <span className="text-text-tertiary">© 2026 xxxlomg</span>
          </p>
        </div>
      </div>
    </footer>
  );
}
