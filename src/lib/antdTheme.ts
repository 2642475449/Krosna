import type { ThemeConfig } from "antd";
import type { ThemeMode } from "@/store";

/**
 * Ant Design 主题 token 覆盖。
 *
 * 注意：AntD 的 `colorTextLightSolid` 不只用于主色按钮文字，Tooltip 等组件也用它作为文字色。
 * 全局把它设为 `--cs-text-on-primary`（深色主题下为近黑色）后，任何使用它的组件都必须
 * 同时显式指定配对的背景色，否则会出现“灰底深字”的低对比度问题。
 * 所有配色组合由 antdTheme.test.ts 按 WCAG AA 在 4 套主题下逐一校验。
 */

/** AntD colorPrimary：必须与 themes.css 中各主题的 --cs-primary 保持一致 */
export const ANTD_PRIMARY_COLORS: Record<ThemeMode, string> = {
  "light-glass": "#4263eb",
  "light-warm": "#a75d2b",
  "dark-starry": "#8198ff",
  "dark-mocha": "#f5bd69",
};

/** 全局 colorTextLightSolid：主色背景上的文字 */
export const ANTD_TEXT_LIGHT_SOLID = "var(--cs-text-on-primary)";

/** 自定义窗口关闭按钮：红底与白色图标必须成对配置，与 shell.css 保持一致。 */
export const WINDOW_CLOSE_BUTTON_COLORS = {
  hover: {
    background: "var(--cs-window-close-hover-bg)",
    foreground: "var(--cs-window-close-text)",
  },
  pressed: {
    background: "var(--cs-window-close-pressed-bg)",
    foreground: "var(--cs-window-close-text)",
  },
} as const;

/** 浮层共用主题配色；组件级配置也覆盖下拉菜单的 Portal 和子菜单。 */
const overlayTokens = {
  colorBgElevated: "var(--cs-overlay-bg)",
  colorText: "var(--cs-text-primary)",
  colorTextHeading: "var(--cs-text-primary)",
  colorTextDescription: "var(--cs-text-secondary)",
  colorTextDisabled: "var(--cs-text-tertiary)",
  colorBorder: "var(--cs-overlay-border)",
  colorSplit: "var(--cs-overlay-divider)",
  colorBgTextHover: "var(--cs-bg-hover)",
  colorBgTextActive: "var(--cs-bg-active)",
  controlItemBgHover: "var(--cs-bg-hover)",
  controlItemBgActive: "var(--cs-bg-active)",
  boxShadow: "var(--cs-overlay-shadow)",
  boxShadowSecondary: "var(--cs-overlay-shadow)",
  borderRadiusLG: 10,
};

/** 组件级 token 覆盖：文字色与背景色必须成对出现 */
export const ANTD_COMPONENT_OVERRIDES = {
  Button: {
    defaultBg: "var(--cs-bg-card-solid)",
    defaultColor: "var(--cs-text-primary)",
    defaultBorderColor: "var(--cs-border)",
    defaultHoverBg: "var(--cs-bg-hover)",
    defaultHoverColor: "var(--cs-text-primary)",
    defaultHoverBorderColor: "var(--cs-primary)",
    defaultActiveBg: "var(--cs-bg-active)",
    defaultActiveColor: "var(--cs-text-primary)",
    defaultActiveBorderColor: "var(--cs-primary)",
    defaultShadow: "none",
    primaryShadow: "none",
    dangerShadow: "none",
    borderRadius: 6,
  },
  Input: {
    colorBgContainer: "var(--cs-bg-card-solid)",
    colorText: "var(--cs-text-primary)",
    colorTextPlaceholder: "var(--cs-text-tertiary)",
    colorBorder: "var(--cs-border)",
    hoverBorderColor: "var(--cs-primary)",
    activeBorderColor: "var(--cs-primary)",
    activeShadow: "0 0 0 2px var(--cs-primary-light)",
  },
  InputNumber: {
    colorBgContainer: "var(--cs-bg-card-solid)",
    colorText: "var(--cs-text-primary)",
    colorBorder: "var(--cs-border)",
    hoverBorderColor: "var(--cs-primary)",
    activeBorderColor: "var(--cs-primary)",
    activeShadow: "0 0 0 2px var(--cs-primary-light)",
  },
  Segmented: {
    trackBg: "var(--cs-bg-app)",
    trackPadding: 3,
    itemColor: "var(--cs-text-secondary)",
    itemHoverColor: "var(--cs-text-primary)",
    itemHoverBg: "var(--cs-bg-hover)",
    itemSelectedBg: "var(--cs-bg-card-solid)",
    itemSelectedColor: "var(--cs-text-primary)",
    itemActiveBg: "var(--cs-bg-active)",
  },
  Table: {
    colorBgContainer: "var(--cs-bg-card-solid)",
    colorText: "var(--cs-text-primary)",
    headerBg: "var(--cs-bg-app)",
    headerColor: "var(--cs-text-secondary)",
    rowHoverBg: "var(--cs-bg-hover)",
    rowSelectedBg: "var(--cs-bg-active)",
    rowSelectedHoverBg: "var(--cs-bg-hover)",
    borderColor: "var(--cs-border-card)",
  },
  Modal: {
    ...overlayTokens,
    contentBg: "var(--cs-overlay-bg)",
    headerBg: "var(--cs-overlay-bg)",
    footerBg: "var(--cs-overlay-footer-bg)",
    borderRadiusLG: 14,
  },
  Drawer: { ...overlayTokens },
  Popover: { ...overlayTokens },
  Popconfirm: { ...overlayTokens },
  Dropdown: { ...overlayTokens },
  Select: {
    ...overlayTokens,
    optionSelectedBg: "var(--cs-bg-active)",
    optionSelectedColor: "var(--cs-text-primary)",
    optionActiveBg: "var(--cs-bg-hover)",
  },
  Cascader: { ...overlayTokens },
  TreeSelect: { ...overlayTokens },
  DatePicker: { ...overlayTokens },
  Mentions: { ...overlayTokens },
  Tooltip: {
    ...overlayTokens,
    colorBgSpotlight: "var(--cs-bg-elevated)",
    colorTextLightSolid: "var(--cs-text-primary)",
  },
} satisfies NonNullable<ThemeConfig["components"]>;
