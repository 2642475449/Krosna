import type { HookInfo } from "@/types";

export type HookSource = "krosna" | "orca" | "pebrel" | "other";
export const HOOK_SOURCES: readonly HookSource[] = ["krosna", "orca", "pebrel", "other"];

export function isKrosnaHook(hook: Pick<HookInfo, "command">): boolean {
  return /(?:^|[\\/\s"'])krosna-(?:hook\.cjs|agent-hook\.cjs|status\.js|agent-status\.js)(?=[\s"']|$)/i.test(hook.command);
}

// 来源仅根据已知脚本文件名推断，不代表身份认证或可安全整组删除。
export function getHookSource(hook: Pick<HookInfo, "command">): HookSource {
  if (isKrosnaHook(hook)) return "krosna";
  if (/(?:^|[\\/\s"'])orca-agent-hook\.exe(?=[\s"']|$)/i.test(hook.command)) return "orca";
  if (/(?:^|[\\/\s"'])pebrel-hook\.exe(?=[\s"']|$)/i.test(hook.command)) return "pebrel";
  return "other";
}

export function groupHooksBySource(hooks: readonly HookInfo[]) {
  return HOOK_SOURCES.map((source) => ({ source, hooks: hooks.filter((hook) => getHookSource(hook) === source) }))
    .filter((group) => group.hooks.length > 0);
}

export function getHookCommandName(hook: Pick<HookInfo, "command">): string {
  const tokens = (hook.command.match(/"[^"]*"|'[^']*'|[^\s]+/g) ?? [])
    .map((token) => token.replace(/^["']|["']$/g, ""));
  const executable = tokens.find((token) => /\.(?:cjs|mjs|js|exe|py|sh|ps1)$/i.test(token)) ?? tokens[0] ?? "";
  return executable.split(/[\\/]/).filter(Boolean).pop() ?? executable;
}
