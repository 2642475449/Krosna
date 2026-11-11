export interface GitConflictBlock {
  start: number;
  end: number;
  line: number;
  ours: string;
  theirs: string;
}

/** 保留偏移与原始换行；diff3/zdiff3 的祖先段不应进入任意一方的结果。 */
export function parseGitConflictBlocks(content: string): GitConflictBlock[] {
  const lines = Array.from(content.matchAll(/[^\n]*\n|[^\n]+$/g));
  const blocks: GitConflictBlock[] = [];
  for (let i = 0; i < lines.length; i++) {
    const opening = /^(<{7,})(?:[^\S\r\n].*)?\r?\n?$/.exec(lines[i][0]);
    if (!opening) continue;
    const width = opening[1].length;
    const marker = (line: string, char: string) => new RegExp(`^${char}{${width}}(?:[^\\S\\r\\n].*)?\\r?\\n?$`).test(line);
    let ancestor = -1;
    let separator = -1;
    let end = i + 1;
    for (; end < lines.length; end++) {
      const line = lines[end][0];
      if (/^<{7,}(?:\s|$)/.test(line)) break;
      if (separator < 0 && marker(line, "\\|")) ancestor = end;
      if (marker(line, "=") && separator < 0) separator = end;
      if (marker(line, ">")) break;
    }
    if (separator < 0 || end >= lines.length || !marker(lines[end][0], ">")) continue;
    blocks.push({
      start: lines[i].index!, end: lines[end].index! + lines[end][0].length, line: i + 1,
      ours: lines.slice(i + 1, ancestor < 0 ? separator : ancestor).map(line => line[0]).join(""),
      theirs: lines.slice(separator + 1, end).map(line => line[0]).join(""),
    });
    i = end;
  }
  return blocks;
}

export function hasGitConflictMarkers(content: string): boolean {
  return /^(?:<{7,}|={7,}|>{7,}|\|{7,})(?:\s|$)/m.test(content);
}

export function resolveGitConflictBlock(content: string, index: number, choice: "ours" | "theirs" | "both"): string {
  const block = parseGitConflictBlocks(content)[index];
  if (!block) return content;
  const replacement = choice === "both" ? block.ours + block.theirs : block[choice];
  return content.slice(0, block.start) + replacement + content.slice(block.end);
}
