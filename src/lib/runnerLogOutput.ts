const ESC = "\x1b";
const MAX_LINE_CHARS = 16 * 1024;
const PARTIAL_LINE_WAIT_MS = 32;
// 覆盖常见 Java/Tomcat、Spring、Node 日志前缀，避免把正文里的 error 等词当级别。
const LOG_LEVEL = /^(?:(?:\d{4}-\d{2}-\d{2}|\d{1,2}-[a-z]{3}-\d{4}|\d{1,2}\/\d{1,2}\/\d{4})[T\s]+)?(?:\d{1,2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?\s*)?(?:\[[^\]\r\n]{0,80}\]\s*){0,3}\[?(TRACE|DEBUG|INFO|WARN(?:ING)?|ERROR|FATAL|SEVERE|信息|警告|严重|错误)\]?(?=$|[\s:])/i;
const EXCEPTION = /^\s*(?:Caused by:|Suppressed:|Exception in thread\b|[\w.$]*(?:Exception|Error)(?=:|$))/;

function colorLogLine(line: string): string {
  const level = LOG_LEVEL.exec(line.slice(0, 512))?.[1].toUpperCase();
  const color = level && /^(ERROR|FATAL|SEVERE|严重|错误)$/.test(level) ? 31
    : level && /^(WARN|WARNING|警告)$/.test(level) ? 33
    : level && /^(INFO|信息)$/.test(level) ? 34
    : level ? 36 : EXCEPTION.test(line) ? 31 : null;
  if (color === null) return line;
  const text = line.replace(/\r?\n$/, "");
  return `${ESC}[${color}m${text}${ESC}[39m${line.slice(text.length)}`;
}

/** 仅为无 ANSI 样式的完整日志行补色；原始内容与进程自带样式保持原样。 */
export function createRunnerLogOutput(write: (data: string) => void, isColorizeEnabled: () => boolean = () => true) {
  let pending = "";
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let mode: "text" | "escape" | "csi" | "string" = "text";
  let csi = "";
  let osc = false;
  let stringEscape = false;
  let styled = false;
  let alternateScreen = false;
  let plainLine = true;

  // 控制序列可跨行、跨块；记录状态，绝不向尚未闭合的 CSI/OSC 或有样式的正文插色。
  const scan = (char: string) => {
    if (mode === "string") {
      if (char === "\x9c" || (osc && char === "\x07") || (stringEscape && char === "\\")) mode = "text";
      stringEscape = char === ESC;
    } else if (char === "\x18" || char === "\x1a") {
      mode = "text";
    } else if (mode === "csi") {
      if (/[\x40-\x7e]/.test(char)) {
        if (char === "m") {
          // 遇到未知/扩展 SGR 保守保留，直到明确 reset。
          const params = csi.split(";");
          if (params.every((value) => value === "" || value === "0")) styled = false;
          else styled = true;
        }
        if (/^\?(?:47|1047|1049)$/.test(csi) && (char === "h" || char === "l")) alternateScreen = char === "h";
        mode = "text";
      } else if (char === ESC) mode = "escape";
      else if (csi.length < 128) csi += char;
    } else if (mode === "escape") {
      if (char === "[") { mode = "csi"; csi = ""; }
      else if ("]PX^_".includes(char)) { mode = "string"; osc = char === "]"; stringEscape = false; }
      else if (!/[\x20-\x2f]/.test(char)) {
        mode = char === ESC ? "escape" : "text";
        if (char === "c") { styled = false; alternateScreen = false; }
      }
    } else if (char === ESC) mode = "escape";
    else if (char === "\x9b") { mode = "csi"; csi = ""; }
    else if ("\x90\x98\x9d\x9e\x9f".includes(char)) {
      mode = "string"; osc = char === "\x9d"; stringEscape = false;
    }
  };
  const cancelTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const flush = () => {
    cancelTimer();
    if (!pending || disposed) return;
    const data = pending;
    pending = "";
    // 无换行的提示符须及时显示，后续片段不再当作新行。
    plainLine = false;
    write(data);
  };
  return {
    write(data: string) {
      if (disposed || !data) return;
      const output: string[] = [];
      for (const char of data) {
        if (mode !== "text" || styled || alternateScreen || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(char)) plainLine = false;
        // 回车重绘的进度信息不按普通日志处理；CRLF 则保留。
        if (pending.endsWith("\r") && char !== "\n") plainLine = false;
        scan(char);
        pending += char;
        if (char === "\n") {
          output.push(plainLine && isColorizeEnabled() ? colorLogLine(pending) : pending);
          pending = "";
          plainLine = mode === "text" && !styled && !alternateScreen;
        } else if (pending.length >= MAX_LINE_CHARS) {
          output.push(pending);
          pending = "";
          plainLine = false;
        }
      }
      if (!pending) cancelTimer();
      else if (timer === null) timer = setTimeout(flush, PARTIAL_LINE_WAIT_MS);
      if (output.length) write(output.join(""));
    },
    getBufferedChars: () => pending.length,
    flush,
    dispose() { cancelTimer(); pending = ""; disposed = true; },
  };
}
