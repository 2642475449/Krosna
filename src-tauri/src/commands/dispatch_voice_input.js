// WebView2 会将返回值序列化给 Rust。仅 xterm 的输入框会注册这个入口。
((appOrigin, text, deadline) => {
  // WebView UI 线程恢复时，已超时的请求不能事后把文字插入新的焦点。
  if (Date.now() >= deadline) return null;
  const target = document.activeElement;
  if (location.origin !== appOrigin || !document.hasFocus() ||
      !(target instanceof HTMLTextAreaElement) || typeof target.krosnaPasteVoiceText !== "function") {
    return false;
  }
  target.krosnaPasteVoiceText(text);
  return true;
})
