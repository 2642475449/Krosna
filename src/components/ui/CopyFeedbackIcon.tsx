import { CheckOutlined, CopyOutlined } from "@ant-design/icons";

/** 原地切换复制与完成确认图标，配合 CSS keyframe 提供克制的缩放淡入微反馈。 */
export function CopyFeedbackIcon({ copied }: { copied: boolean }) {
  return (
    <span
      key={copied ? "copied" : "copy"}
      className={`app-copy-icon ${copied ? "is-copied" : ""}`}
      aria-hidden="true"
    >
      {copied ? <CheckOutlined /> : <CopyOutlined />}
    </span>
  );
}
