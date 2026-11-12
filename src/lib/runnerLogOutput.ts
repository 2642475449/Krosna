const ESC = "\x1b";
const MAX_LINE_CHARS = 16 * 1024;
const PARTIAL_LINE_WAIT_MS = 32;
// 覆盖常见 Java/Tomcat、Spring、Node 日志前缀，避免把正文里的 error 等词当级别。
const LOG_LEVEL = /^(?:(?:\d{4}-\d{2}-\d{2}|\d{1,2}-[a-z]{3}-\d{4}|\d{1,2}\/\d{1,2}\/\d{4})[T\s]+)?(?:\d{1,2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?\s*)?(?:\[[^\]\r\n]{0,80}\]\s*){0,3}\[?(TRACE|DEBUG|INFO|WARN(?:ING)?|ERROR|FATAL|SEVERE|信息|警告|严重|错误)\]?(?=$|[\s:])/i;
const EXCEPTION = /^\s*(?:Caused by:|Suppressed:|Exception in thread\b|[\w.$]*(?:Exception|Error)(?=:|$))/;
// MyBatis StdOut 日志没有级别前缀；只识别行首的协议标记，不把结果正文当 SQL。
const MYBATIS_RECORD = /^[\t ]*(?:={2,}>|<={2,})[\t ]*(Preparing|Parameters|Columns|Row|Total|Updates)[\t ]*:/;
const MYBATIS_SESSION = /^(?:Creating a new SqlSession\b|(?:Closing (?:non transactional|transactional)|Releasing transactional) SqlSession\b|Registering transaction synchronization for SqlSession\b|Transaction synchronization (?:closing|committing|deregistering) SqlSession\b|Fetched SqlSession \[|SqlSession \[|JDBC Connection \[)/;
const SGR_STYLES: Readonly<Record<number, number>> = {
  1: 1, 2: 1, 3: 3, 20: 3, 4: 4, 21: 4, 5: 5, 6: 5, 7: 7, 8: 8, 9: 9,
  26: 26, 51: 51, 52: 51, 53: 53, 58: 58, 60: 60, 61: 60, 62: 60, 63: 60, 64: 60, 73: 73, 74: 73,
};
const SGR_RESETS: Readonly<Record<number, number>> = {
  10: 10, 22: 1, 23: 3, 24: 4, 25: 5, 27: 7, 28: 8, 29: 9, 39: 30, 49: 40,
  50: 26, 54: 51, 55: 53, 59: 58, 65: 60, 75: 73,
};

function updateNativeStyles(styles: Set<number>, parameters: string) {
  const params = parameters.split(";");
  for (let index = 0; index < params.length; index += 1) {
    const colonSyntax = params[index].includes(":");
    const code = Number(params[index].split(":", 1)[0]);
    if (code === 0 && !colonSyntax) styles.clear();
    else if (SGR_RESETS[code] !== undefined) styles.delete(SGR_RESETS[code]);
    else {
      const foreground = (code >= 30 && code <= 38) || (code >= 90 && code <= 97);
      const background = (code >= 40 && code <= 48) || (code >= 100 && code <= 107);
      // 只记录有限的属性类别；未知参数共用一个标记，避免状态随输入增长。
      styles.add(foreground ? 30 : background ? 40 : code >= 11 && code <= 19 ? 10 : SGR_STYLES[code] ?? -1);
      if (!colonSyntax && (code === 38 || code === 48 || code === 58)) {
        if (params[index + 1] === "2") index += 4;
        else if (params[index + 1] === "5") index += 2;
      }
    }
  }
}

function colorLogLine(line: string): string {
  const prefix = line.slice(0, 512);
  const level = LOG_LEVEL.exec(prefix)?.[1].toUpperCase();
  const color = level && /^(ERROR|FATAL|SEVERE|严重|错误)$/.test(level) ? 31
    : level && /^(WARN|WARNING|警告)$/.test(level) ? 33
    : level && /^(INFO|信息)$/.test(level) ? 34
    : level ? 36 : EXCEPTION.test(line) ? 31 : null;
  if (color === null) {
    const record = MYBATIS_RECORD.exec(prefix);
    if (record) {
      const markerColor = record[1] === "Preparing" ? 34
        : record[1] === "Parameters" || record[1] === "Columns" ? 36 : 32;
      // 只给标记补色，长行中的业务数据、SQL 参数和值仍使用默认正文色。
      return `${ESC}[${markerColor}m${record[0]}${ESC}[39m${line.slice(record[0].length)}`;
    }
    if (MYBATIS_SESSION.test(prefix)) {
      const text = line.replace(/\r?\n$/, "");
      return `${ESC}[90m${text}${ESC}[39m${line.slice(text.length)}`;
    }
    return line;
  }
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
  const nativeStyles = new Set<number>();
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
          // Spring 使用 0;39m，Logback 也会单独复位前景色；不能清掉其他有效属性。
          updateNativeStyles(nativeStyles, csi);
          styled = nativeStyles.size > 0;
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
        if (char === "c") { nativeStyles.clear(); styled = false; alternateScreen = false; }
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
