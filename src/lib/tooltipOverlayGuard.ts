const ACTIVE_TOOLTIP_TRIGGER_SELECTOR = ".ant-tooltip-open";

/**
 * 主动收起当前处于打开状态的 Ant Design Tooltip。
 * React 的 onMouseLeave 底层监听冒泡的 mouseout，同时补发不冒泡的 mouseleave 兼容原生监听。
 */
export function dismissActiveTooltips(root: ParentNode = document): number {
  const triggers = root.querySelectorAll<HTMLElement>(ACTIVE_TOOLTIP_TRIGGER_SELECTOR);
  let dismissed = 0;
  for (const trigger of triggers) {
    trigger.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, cancelable: true }));
    trigger.dispatchEvent(new MouseEvent("mouseleave", { bubbles: false, cancelable: false }));
    dismissed += 1;
  }
  return dismissed;
}

/**
 * 全局浮层互斥守卫：
 * - 右键打开任意上下文菜单（contextmenu）时，立即收起当前悬停 Tooltip；
 * - 按下鼠标（pointerdown）打开下拉/气泡/弹窗或点击控件时，收起悬停 Tooltip（点击在 Tooltip 内部复制文本时除外）。
 */
export function installGlobalTooltipOverlayGuard(targetDocument: Document = document): () => void {
  const handleContextMenu = () => {
    dismissActiveTooltips(targetDocument);
  };

  const handlePointerDown = (event: PointerEvent) => {
    const target = event.target;
    if (target instanceof Element && target.closest(".ant-tooltip")) {
      return;
    }
    dismissActiveTooltips(targetDocument);
  };

  targetDocument.addEventListener("contextmenu", handleContextMenu, true);
  targetDocument.addEventListener("pointerdown", handlePointerDown, true);

  return () => {
    targetDocument.removeEventListener("contextmenu", handleContextMenu, true);
    targetDocument.removeEventListener("pointerdown", handlePointerDown, true);
  };
}
