/** 仅在项目窗口可见且获得焦点时运行前台工作，合并连续到达的窗口事件。 */
export function observeWindowActivity(onActivity: (active: boolean) => void): () => void {
  let previous: boolean | undefined;
  const update = (focused: boolean) => {
    const active = focused && document.visibilityState === "visible";
    if (active === previous) return;
    previous = active;
    onActivity(active);
  };
  const onFocus = () => update(true);
  const onBlur = () => update(false);
  const readActivity = () => update(document.hasFocus());

  window.addEventListener("focus", onFocus);
  window.addEventListener("blur", onBlur);
  document.addEventListener("visibilitychange", readActivity);
  readActivity();
  return () => {
    window.removeEventListener("focus", onFocus);
    window.removeEventListener("blur", onBlur);
    document.removeEventListener("visibilitychange", readActivity);
  };
}
