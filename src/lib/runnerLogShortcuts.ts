import type { Terminal } from "@xterm/xterm";

type LogTerminal = Pick<Terminal,
  "selectAll" | "hasSelection" | "clearSelection" | "scrollToTop" | "scrollToBottom" | "scrollPages">;

/** 仅运行日志使用阅读快捷键；普通终端继续把 Ctrl+A 等按键交给 shell。 */
export function handleRunnerLogShortcut(
  event: Pick<KeyboardEvent, "key" | "type" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey" | "isComposing" | "preventDefault" | "stopPropagation">,
  terminal: LogTerminal,
  actions: { copy: () => void; paste: () => void; clear: () => void; find: () => void; autoScroll: (enabled: boolean) => void },
): boolean {
  if (event.isComposing || event.altKey) return false;
  const key = event.key.toLowerCase();
  const primary = event.ctrlKey || event.metaKey;
  let action: (() => void) | undefined;
  if (primary && !event.shiftKey && key === "a") action = () => terminal.selectAll();
  if (primary && !event.shiftKey && key === "f") action = actions.find;
  if (primary && key === "c" && (event.shiftKey || terminal.hasSelection())) action = actions.copy;
  if (primary && key === "v") action = actions.paste;
  if (primary && !event.shiftKey && (key === "l" || key === "k")) action = actions.clear;
  if (primary && !event.shiftKey && key === "home") action = () => {
    actions.autoScroll(false);
    terminal.scrollToTop();
  };
  if (primary && !event.shiftKey && key === "end") action = () => {
    actions.autoScroll(true);
    terminal.scrollToBottom();
  };
  if (!primary && (key === "pageup" || key === "pagedown")) action = () => {
    actions.autoScroll(false);
    terminal.scrollPages(key === "pageup" ? -1 : 1);
  };
  if (!primary && !event.shiftKey && key === "escape" && terminal.hasSelection()) {
    action = () => terminal.clearSelection();
  }
  if (!action) return false;
  event.preventDefault();
  event.stopPropagation();
  if (event.type === "keydown") action();
  return true;
}
