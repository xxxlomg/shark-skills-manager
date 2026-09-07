/**
 * 创作对话意图解析。
 *
 * 路由顺序是：明确资源路径 → 唯一已知文件名 → 资源关键词 → 明确正文操作 → 普通聊天。
 * 普通聊天不能因为“不是附件”就误进入正文生成流程。
 */

const RESOURCE_ROOTS = ["assets", "references", "scripts", "templates", "examples"] as const;

const RESOURCE_KEYWORDS =
  /附带资源|附件|资源文件|模板文件|模板|脚本文件|参考文件|参考资料|assets?\b|references?\b|scripts?\b|templates?\b|resources?\b|attachments?\b/i;

const RESOURCE_PATH_RE =
  /(?:^|[^A-Za-z0-9._-])((?:assets|references|scripts|templates|examples)(?:[\\/][A-Za-z0-9._-]*)+)/gi;

const BODY_TARGET_RE = "(?:正文|技能正文|技能文档|SKILL\\s*\\.?\\s*MD|body)";
const BODY_OPERATION_RE =
  new RegExp(
    `(?:生成|创建|新增|补充|追加|续写|完善|修改|更新|重写|简化|优化|调整|替换|覆盖|写入|修复|扩展|润色|整理|generate|create|add|append|continue|complete|update|rewrite|simplify|improve|edit|replace|write)\\s*.{0,18}${BODY_TARGET_RE}|${BODY_TARGET_RE}\\s*.{0,18}(?:增加|补充|追加|续写|完善|修改|更新|重写|简化|优化|调整|替换|覆盖|写入|修复|扩展|润色|整理|生成|create|add|append|continue|complete|update|rewrite|simplify|improve|edit|replace|write)`,
    "i",
  );

function isResourceRoot(value: string): boolean {
  return (RESOURCE_ROOTS as readonly string[]).includes(value.toLowerCase());
}

/** Return a safe, normalized resource-relative path, or null for non-resource text. */
export function normalizeResourcePath(value: string): string | null {
  const raw = value.trim();
  if (!raw || /^[\\/]/.test(raw) || /^[A-Za-z]:[\\/]/.test(raw)) return null;

  const normalized = raw.replace(/\\/g, "/");
  const parts = normalized.split("/");
  if (parts.length < 2 || !isResourceRoot(parts[0])) return null;
  if (parts.some((part) => !part || part === "." || part === "..")) return null;
  if (parts.some((part) => !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part))) return null;
  return parts.join("/");
}

interface ExplicitPathScan {
  found: boolean;
  invalid: boolean;
  paths: string[];
}

function scanExplicitResourcePaths(text: string): ExplicitPathScan {
  const paths = new Set<string>();
  let found = false;
  let invalid = false;

  for (const match of text.matchAll(RESOURCE_PATH_RE)) {
    found = true;
    const candidate = match[1] ?? "";
    const normalized = normalizeResourcePath(candidate);
    if (!normalized) {
      invalid = true;
      continue;
    }
    paths.add(normalized);
  }

  return { found, invalid, paths: [...paths] };
}

/** Extract one unambiguous explicit resource path. Multiple or invalid paths return null. */
export function extractResourcePath(text: string): string | null {
  const scan = scanExplicitResourcePaths(text);
  return !scan.invalid && scan.paths.length === 1 ? scan.paths[0] : null;
}

interface KnownPathMatches {
  ambiguous: boolean;
  paths: string[];
}

/** Match bare file names against known resource paths only when every match is unique. */
function findKnownResourcePaths(text: string, knownFiles: readonly string[]): KnownPathMatches {
  const knownPaths = [
    ...new Set(knownFiles.map(normalizeResourcePath).filter((path): path is string => !!path)),
  ];
  const fileNames = text.match(/[A-Za-z0-9][A-Za-z0-9._-]*\.[A-Za-z0-9]{1,12}/g) ?? [];
  const paths = new Set<string>();
  let ambiguous = false;

  for (const fileName of new Set(fileNames.map((name) => name.toLowerCase()))) {
    const matches = knownPaths.filter(
      (file) => file.split("/").pop()?.toLowerCase() === fileName,
    );
    if (matches.length > 1) ambiguous = true;
    if (matches.length === 1) paths.add(matches[0]);
  }

  return { ambiguous, paths: [...paths] };
}

export type AuthoringIntent =
  | { kind: "chat" }
  | { kind: "body" }
  | { kind: "attachment"; fileRel: string }
  | { kind: "attachment_needs_target" };

export function detectAuthoringIntent(
  text: string,
  knownFiles: readonly string[] = [],
): AuthoringIntent {
  const explicit = scanExplicitResourcePaths(text);
  if (explicit.found) {
    if (explicit.invalid || explicit.paths.length !== 1) return { kind: "attachment_needs_target" };
    return { kind: "attachment", fileRel: explicit.paths[0] };
  }

  const known = findKnownResourcePaths(text, knownFiles);
  if (known.ambiguous || known.paths.length > 1) return { kind: "attachment_needs_target" };
  if (known.paths.length === 1) return { kind: "attachment", fileRel: known.paths[0] };
  if (RESOURCE_KEYWORDS.test(text)) return { kind: "attachment_needs_target" };
  if (BODY_OPERATION_RE.test(text)) return { kind: "body" };
  return { kind: "chat" };
}
