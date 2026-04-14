/**
 * 轻量 Markdown 渲染组件，无额外依赖
 * 支持: 标题 h1-h4、粗体/斜体、代码块、行内代码、有序/无序列表、分割线、段落
 */

interface Props {
  content: string;
  className?: string;
}

export function MarkdownView({ content, className = "" }: Props) {
  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code block
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      elements.push(
        <pre key={i} className="bg-gray-900 text-gray-100 rounded-lg p-4 overflow-x-auto my-4 text-xs leading-relaxed">
          {lang && <div className="text-gray-500 text-xs mb-2 font-mono">{lang}</div>}
          <code>{codeLines.join("\n")}</code>
        </pre>
      );
      i++;
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,4})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      const cls = [
        "font-bold text-gray-900 mt-6 mb-2",
        level === 1 ? "text-xl border-b border-gray-200 pb-2" :
        level === 2 ? "text-lg" :
        level === 3 ? "text-base" : "text-sm",
      ].join(" ");
      const Tag = `h${level}` as "h1" | "h2" | "h3" | "h4";
      elements.push(<Tag key={i} className={cls}>{renderInline(text)}</Tag>);
      i++;
      continue;
    }

    // Horizontal rule
    if (/^[-*_]{3,}$/.test(line.trim())) {
      elements.push(<hr key={i} className="border-gray-200 my-4" />);
      i++;
      continue;
    }

    // Unordered list
    if (/^[-*+]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*+]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*+]\s/, ""));
        i++;
      }
      elements.push(
        <ul key={i} className="list-disc list-outside pl-5 my-3 space-y-1">
          {items.map((item, j) => (
            <li key={j} className="text-sm text-gray-700 leading-relaxed">{renderInline(item)}</li>
          ))}
        </ul>
      );
      continue;
    }

    // Ordered list
    if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s/, ""));
        i++;
      }
      elements.push(
        <ol key={i} className="list-decimal list-outside pl-5 my-3 space-y-1">
          {items.map((item, j) => (
            <li key={j} className="text-sm text-gray-700 leading-relaxed">{renderInline(item)}</li>
          ))}
        </ol>
      );
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith("> ")) {
        quoteLines.push(lines[i].slice(2));
        i++;
      }
      elements.push(
        <blockquote key={i} className="border-l-4 border-emerald-300 pl-4 my-3 italic text-stone-600 text-sm">
          {quoteLines.map((ql, j) => <p key={j}>{renderInline(ql)}</p>)}
        </blockquote>
      );
      continue;
    }

    // Empty line
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Paragraph
    const paraLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== "" && !lines[i].startsWith("#") && !lines[i].startsWith("```") && !/^[-*+]\s/.test(lines[i]) && !/^\d+\.\s/.test(lines[i]) && !/^[-*_]{3,}$/.test(lines[i].trim()) && !lines[i].startsWith("> ")) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      elements.push(
        <p key={i} className="text-sm text-gray-700 leading-relaxed my-2">
          {paraLines.map((pl, j) => (
            <span key={j}>{renderInline(pl)}{j < paraLines.length - 1 && <br />}</span>
          ))}
        </p>
      );
    }
  }

  return <div className={`markdown-body ${className}`}>{elements}</div>;
}

/** Inline element rendering: bold, italic, inline code, links */
function renderInline(text: string): React.ReactNode {
  // Split on **bold**, *italic*, `code`, [text](url)
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\))/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) {
      parts.push(text.slice(last, match.index));
    }
    if (match[0].startsWith("**")) {
      parts.push(<strong key={match.index} className="font-semibold text-gray-900">{match[2]}</strong>);
    } else if (match[0].startsWith("*")) {
      parts.push(<em key={match.index} className="italic">{match[3]}</em>);
    } else if (match[0].startsWith("`")) {
      parts.push(
        <code key={match.index} className="bg-gray-100 border border-gray-200 text-gray-800 px-1 py-0.5 rounded text-xs font-mono">
          {match[4]}
        </code>
      );
    } else if (match[0].startsWith("[")) {
      parts.push(
        <a key={match.index} href={match[6]} className="text-emerald-600 hover:underline" target="_blank" rel="noopener noreferrer">
          {match[5]}
        </a>
      );
    }
    last = match.index + match[0].length;
  }

  if (last < text.length) {
    parts.push(text.slice(last));
  }

  return parts.length === 1 ? parts[0] : <>{parts}</>;
}
