import { Unicode11Addon } from "@xterm/addon-unicode11";
import type { IUnicodeVersionProvider, Terminal } from "@xterm/xterm";
import { TERMINAL_LINE_HEIGHT } from "./terminalSettings";

const UNICODE_VERSION = "krosna-11-zwj";
const ZERO_WIDTH_JOINER = 0x200d;

type TerminalUnicodeCore = {
  _core?: { unicodeService?: { _providers?: Record<string, IUnicodeVersionProvider> } };
};

/** Apply before the first PTY byte: reflow/refresh cannot fix cell widths already parsed. */
export function initializePtyTextLayout(terminal: Terminal): void {
  // All PTY surfaces use the same fixed row spacing, independent of legacy settings.
  terminal.options.lineHeight = TERMINAL_LINE_HEIGHT;
  // PTYs own CR/LF translation; an extra CR moves positioned TUI text to column zero.
  terminal.options.convertEol = false;
  terminal.options.allowProposedApi = true;
  if (terminal.unicode.activeVersion === UNICODE_VERSION) return;

  terminal.loadAddon(new Unicode11Addon());
  // xterm exposes registration but no provider lookup; keep this pinned-version access isolated.
  const base = (terminal as Terminal & TerminalUnicodeCore)._core?.unicodeService?._providers?.["11"];
  if (!base) {
    terminal.unicode.activeVersion = "11";
    return;
  }

  const properties = (kind: number, width: number) => (kind << 3) | (width << 1) | 1;
  terminal.unicode.register({
    version: UNICODE_VERSION,
    wcwidth: (codepoint) => base.wcwidth(codepoint),
    charProperties(codepoint, preceding) {
      const width = (preceding >> 1) & 3;
      if (codepoint === ZERO_WIDTH_JOINER && width > 0) {
        return properties(ZERO_WIDTH_JOINER, width);
      }
      if ((preceding >> 3) === ZERO_WIDTH_JOINER && width > 0 && base.wcwidth(codepoint) > 0) {
        // A joined emoji occupies the preceding glyph's cells, rather than advancing again.
        return properties(codepoint, width);
      }
      return base.charProperties(codepoint, preceding);
    },
  });
  terminal.unicode.activeVersion = UNICODE_VERSION;
}
