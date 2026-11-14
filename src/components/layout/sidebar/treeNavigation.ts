export interface NavigableTreeNode {
  entry: { path: string; kind: string };
  isExpanded: boolean;
  children: NavigableTreeNode[];
}

export function getTreeNavigation(
  nodes: NavigableTreeNode[],
  currentPath: string | null,
  key: string,
  searchMode = false,
): { type: "select" | "expand" | "collapse" | "open" | "preview"; path: string } | null {
  const rows: { node: NavigableTreeNode; parent: string | null }[] = [];
  const visit = (items: NavigableTreeNode[], parent: string | null) => {
    for (const node of items) {
      rows.push({ node, parent });
      if (node.isExpanded) visit(node.children, node.entry.path);
    }
  };
  visit(nodes, null);
  if (!rows.length) return null;
  const index = rows.findIndex(({ node }) => node.entry.path === currentPath);
  const select = (position: number) => ({ type: "select" as const, path: rows[position].node.entry.path });
  if (key === "Home") return select(0);
  if (key === "End") return select(rows.length - 1);
  if (key === "ArrowDown") return select(index < 0 ? 0 : Math.min(index + 1, rows.length - 1));
  if (key === "ArrowUp") return select(index < 0 ? rows.length - 1 : Math.max(index - 1, 0));
  if (!["ArrowLeft", "ArrowRight", "Enter", " "].includes(key)) return null;
  if (index < 0) return select(0);
  const { node, parent } = rows[index];
  const path = node.entry.path;
  const directory = node.entry.kind === "directory";
  if (key === "Enter") {
    if (!directory) return { type: "open", path };
    if (!searchMode) return { type: node.isExpanded ? "collapse" : "expand", path };
  }
  if (key === " ") {
    if (!directory) return { type: "preview", path };
    if (!searchMode) return { type: node.isExpanded ? "collapse" : "expand", path };
  }
  if (key === "ArrowRight" && directory) {
    if (!node.isExpanded && !searchMode) return { type: "expand", path };
    if (node.children.length) return { type: "select", path: node.children[0].entry.path };
  }
  if (key === "ArrowLeft") {
    if (directory && node.isExpanded && !searchMode) return { type: "collapse", path };
    if (parent) return { type: "select", path: parent };
  }
  return null;
}

export function getRenameSelectionRange(name: string, kind: string): { start: number; end: number } {
  if (kind === "directory") {
    return { start: 0, end: name.length };
  }

  const lastDot = name.lastIndexOf(".");
  if (lastDot > 0) {
    return { start: 0, end: lastDot };
  }

  return { start: 0, end: name.length };
}

export interface MarqueeRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ViewportRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function computeMarqueeRect(
  startX: number,
  startY: number,
  currentX: number,
  currentY: number,
): MarqueeRect {
  return {
    left: Math.min(startX, currentX),
    top: Math.min(startY, currentY),
    width: Math.abs(currentX - startX),
    height: Math.abs(currentY - startY),
  };
}

export function rectsIntersect(a: ViewportRect, b: ViewportRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

export function mergeMarqueeSelection(
  basePaths: string[],
  intersectedPaths: string[],
  additive: boolean,
): string[] {
  if (!additive) {
    return Array.from(new Set(intersectedPaths));
  }
  const merged = [...basePaths];
  const seen = new Set(basePaths);
  for (const path of intersectedPaths) {
    if (!seen.has(path)) {
      seen.add(path);
      merged.push(path);
    }
  }
  return merged;
}
