export interface AgentFileDropEntry {
  path: string;
  kind: "file" | "directory";
  name?: string;
}

export function sanitizePromptPath(path: string): string {
  return path.replace(/[\x00-\x1f\x7f]/g, " ").trim();
}

function normalizePath(path: string): string {
  // Preserve the leading double slash in UNC paths.
  const normalized = sanitizePromptPath(path).replace(/\\/g, "/");
  if (normalized === "/" || /^[a-z]:\/$/i.test(normalized)) return normalized;
  return normalized.replace(/\/$/, "");
}

function quoteReference(path: string): string {
  return /[\s"'`$;&|<>()]/.test(path)
    ? `"${path.replace(/"/g, '\\"')}"`
    : path;
}

export function buildAgentFileReferencePrompt({ agentId, entries }: {
  agentId: string | undefined;
  entries: AgentFileDropEntry[];
}): string {
  return entries.filter((entry) => sanitizePromptPath(entry.path)).map((entry) => {
    const original = sanitizePromptPath(entry.path);
    if (agentId === "powershell") return `'${original.replace(/'/g, "''")}'`;
    if (agentId === "cmd") return `"${original.replace(/"/g, '""')}"`;
    const reference = quoteReference(normalizePath(original));
    if (["claude", "antigravity", "opencode"].includes(agentId ?? "")) return `@${reference}`;
    return entry.kind === "directory" && ["codex", "qoder"].includes(agentId ?? "")
      ? `${reference} (directory)`
      : reference;
  }).join(" ");
}
