import { useId, useState, type ReactNode } from "react";
import { DownOutlined } from "@ant-design/icons";

interface SettingsSectionProps {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  "aria-label"?: string;
}

/** 设置页统一使用细线分组；不增加卡片背景或阴影。 */
export function SettingsSection({
  title,
  description,
  actions,
  children,
  className = "",
  "aria-label": ariaLabel,
}: SettingsSectionProps) {
  const titleId = useId();
  const hasHeader = Boolean(title || description || actions);
  return (
    <section
      className={`app-settings-section ${className}`}
      aria-labelledby={title ? titleId : undefined}
      aria-label={!title ? ariaLabel : undefined}
    >
      {hasHeader && (
        <header className="app-settings-section__header">
          <div className="min-w-0">
            {title && <h2 id={titleId} className="app-settings-section__title">{title}</h2>}
            {description && <div className="app-settings-section__description">{description}</div>}
          </div>
          {actions && <div className="app-settings-section__actions">{actions}</div>}
        </header>
      )}
      <div className="app-settings-section__body">{children}</div>
    </section>
  );
}

export function SettingsField({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="app-settings-field">
      <label htmlFor={htmlFor} className="app-settings-field__label">{label}</label>
      {children}
    </div>
  );
}

export function SettingsDisclosure({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <div className="app-settings-disclosure" data-open={open ? "true" : "false"}>
      <button
        type="button"
        className="app-settings-disclosure__trigger"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <DownOutlined aria-hidden="true" className="app-settings-disclosure__chevron text-[10px]" />
        <span>{title}</span>
      </button>
      <div id={panelId} className="app-accordion" data-open={open ? "true" : "false"} aria-hidden={!open}>
        <div className="app-accordion__inner">
          <div className="pt-3">{children}</div>
        </div>
      </div>
    </div>
  );
}
