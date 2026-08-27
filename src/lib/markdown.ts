/**
 * 轻量 Markdown 渲染（纯前端，无第三方依赖）
 * 从原 app.js 迁移，保留所有功能
 */

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** 行内 Markdown（image / code / bold / link） */
export function inlineMd(text: string): string {
  return escapeHtml(text)
    // 图片先于链接处理，避免 ![alt](url) 被链接规则截半
    .replace(
      /!\[([^\]]*)\]\(([^)\s]+)\)/g,
      '<img src="$2" alt="$1" loading="lazy" />',
    )
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(
      /\[([^\]]+)\]\((https?:[^)\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener">$1</a>',
    );
}

/** 表格渲染：支持标准 GFM 表格（含/不含首尾竖线）、对齐标记、响应式包裹 */
function renderTable(rows: string[]): string {
  const cells = (r: string) =>
    r
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());

  // 判断是否为分隔行（|---|---|、|:---|:---:|---:| 等）
  const isSeparator = (r: string) => {
    const trimmed = r.trim();
    if (!trimmed.includes("-")) return false;
    // 去掉首尾竖线后，每段只含 -、:、空格
    const inner = trimmed.replace(/^\|/, "").replace(/\|$/, "");
    return inner.split("|").every((seg) => /^[\s:-]+$/.test(seg) && seg.includes("-"));
  };

  // 解析对齐标记
  const parseAlignments = (sepRow: string): string[] => {
    return cells(sepRow).map((seg) => {
      const s = seg.trim();
      if (s.startsWith(":") && s.endsWith(":")) return "center";
      if (s.endsWith(":")) return "right";
      return "left";
    });
  };

  // 找到分隔行索引
  const sepIdx = rows.findIndex(isSeparator);
  const alignments = sepIdx >= 0 ? parseAlignments(rows[sepIdx]) : [];

  let out = '<div class="table-wrap"><table>';

  // 表头（分隔行之前的行）
  const headerRows = sepIdx >= 0 ? rows.slice(0, sepIdx) : [rows[0]];
  const bodyRows = sepIdx >= 0 ? rows.slice(sepIdx + 1) : rows.slice(1);

  if (headerRows.length > 0) {
    out += "<thead>";
    for (const r of headerRows) {
      out +=
        "<tr>" +
        cells(r)
          .map((c, ci) => {
            const align = alignments[ci] ? ` style="text-align:${alignments[ci]}"` : "";
            return `<th${align}>${inlineMd(c)}</th>`;
          })
          .join("") +
        "</tr>";
    }
    out += "</thead>";
  }

  if (bodyRows.length > 0) {
    out += "<tbody>";
    for (const r of bodyRows) {
      if (isSeparator(r)) continue; // 跳过多余分隔行
      out +=
        "<tr>" +
        cells(r)
          .map((c, ci) => {
            const align = alignments[ci] ? ` style="text-align:${alignments[ci]}"` : "";
            return `<td${align}>${inlineMd(c)}</td>`;
          })
          .join("") +
        "</tr>";
    }
    out += "</tbody>";
  }

  return out + "</table></div>";
}

/** 完整 Markdown → HTML */
export function renderMd(mdText: string): string {
  // 归一化行尾：CRLF/CR → LF。否则 split("\n") 后每行行尾残留 \r，
  // 使依赖 $ 锚定的标题/列表/表格/引用正则全部失效（手册 .md 为 CRLF 时整篇退化成纯段落）。
  const lines = String(mdText || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n");
  const html: string[] = [];
  let i = 0;
  let listType: "ul" | "ol" | null = null;

  const closeList = () => {
    if (listType) {
      html.push(listType === "ul" ? "</ul>" : "</ol>");
      listType = null;
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    // 代码块
    if (/^\s*```/.test(line)) {
      closeList();
      const lang = line.trim().slice(3).trim();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++; // 跳过闭合围栏
      html.push(
        `<pre><code${lang ? ` class="lang-${escapeHtml(lang)}"` : ""}>${escapeHtml(buf.join("\n"))}</code></pre>`,
      );
      continue;
    }

    // 标题
    const hm = line.match(/^(#{1,4})\s+(.*)$/);
    if (hm) {
      closeList();
      const level = hm[1].length;
      html.push(`<h${level}>${inlineMd(hm[2])}</h${level}>`);
      i++;
      continue;
    }

    // 表格行（支持有/无首尾竖线的 GFM 表格）
    if (/^\s*\|.*\|\s*$/.test(line) || /^\s*\S+\s*\|\s*\S/.test(line)) {
      closeList();
      const rows: string[] = [];
      while (
        i < lines.length &&
        (/^\s*\|.*\|\s*$/.test(lines[i]) || /^\s*\S+\s*\|\s*\S/.test(lines[i]))
      ) {
        rows.push(lines[i]);
        i++;
      }
      html.push(renderTable(rows));
      continue;
    }

    // 无序列表
    const ulm = line.match(/^\s*[-*]\s+(.*)$/);
    // 有序列表
    const olm = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ulm || olm) {
      const type: "ul" | "ol" = ulm ? "ul" : "ol";
      if (listType !== type) {
        closeList();
        html.push(type === "ul" ? "<ul>" : "<ol>");
        listType = type;
      }
      html.push(`<li>${inlineMd(ulm ? ulm[1] : olm![1])}</li>`);
      i++;
      continue;
    }
    closeList();

    // 引用
    const qm = line.match(/^\s*>\s?(.*)$/);
    if (qm) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      html.push(`<blockquote>${inlineMd(buf.join(" "))}</blockquote>`);
      continue;
    }

    // 空行
    if (line.trim() === "") {
      i++;
      continue;
    }

    // 普通段落（合并连续行）
    const buf: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^\s*```/.test(lines[i]) &&
      !/^(#{1,4})\s/.test(lines[i]) &&
      !/^\s*\|.*\|\s*$/.test(lines[i]) &&
      !/^\s*\S+\s*\|\s*\S/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+[.)]\s+/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i++;
    }
    html.push(`<p>${inlineMd(buf.join(" "))}</p>`);
  }

  closeList();
  return html.join("\n");
}
