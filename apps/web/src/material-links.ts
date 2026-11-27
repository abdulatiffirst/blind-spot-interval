import { safeUrl } from "../../../packages/shared/src/client";

type MaterialPart = string | { text: string; href: string };

const links =
  /\[(?<label>[^\n\r[\]]+)\]\((?<labeled>https?:\/\/(?:[^\s<>"'()]|\([^\s<>"'()]*\))+)\)|(?<![\p{L}\p{N}_+./:@-])(?<bare>https?:\/\/[^\s<>"']+)/giu;

function trimProsePunctuation(url: string) {
  let end = url.length;
  let parentheses = 0;
  let brackets = 0;
  for (const char of url) {
    if (char === "(") parentheses++;
    if (char === ")") parentheses--;
    if (char === "[") brackets++;
    if (char === "]") brackets--;
  }
  while (end > 0) {
    const last = url[end - 1];
    if (last === ")" && parentheses < 0) parentheses++;
    else if (last === "]" && brackets < 0) brackets++;
    else if (!/[.,!?;:»”]/u.test(last)) break;
    end--;
  }
  return url.slice(0, end);
}

export function materialParts(text: string): MaterialPart[] {
  const parts: MaterialPart[] = [];
  const standalone = text.trim();
  let cursor = 0;
  for (const match of text.matchAll(links)) {
    const { label, labeled, bare } = match.groups!;
    const rawUrl =
      labeled ?? (bare === standalone ? bare : trimProsePunctuation(bare));
    const href = safeUrl(rawUrl);
    if (!href) continue;
    if (match.index > cursor) parts.push(text.slice(cursor, match.index));
    parts.push({ text: label ?? rawUrl, href });
    cursor = match.index + (labeled ? match[0].length : rawUrl.length);
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}
