import {
  createElement,
  useEffect,
  useState,
  type CSSProperties,
  type Key,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  App as AntdApp,
  notification as staticNotification,
  type NotificationArgsProps,
} from "antd/es/index.js";
import type {
  NotificationConfig,
  NotificationInstance,
} from "antd/es/notification/interface";
import i18n from "@/i18n";
import { stripAnsiEscapeSequences } from "@/lib/textContent";

export type ToastLevel = "success" | "info" | "warning" | "error";

export interface ToastOptions {
  content: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  key?: Key;
  duration?: number;
  onClose?: () => void;
  onClick?: () => void;
  icon?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export type ToastInput = ReactNode | ToastOptions;

export const TOAST_TEXT_LIMIT = 300;

export function truncateToastText(text: string): string {
  if (text.length <= TOAST_TEXT_LIMIT) return text;
  return `${text.slice(0, TOAST_TEXT_LIMIT - 1).trimEnd()}…`;
}

const DEFAULT_DURATION: Record<ToastLevel, number> = {
  success: 3,
  info: 5,
  warning: 8,
  error: 8,
};

export const TOAST_NOTIFICATION_CONFIG: NotificationConfig = {
  placement: "bottomRight",
  bottom: 20,
  maxCount: 3,
  stack: { threshold: 3 },
  pauseOnHover: true,
};

let notificationApi: NotificationInstance = staticNotification;
const toastDurations = new Map<Key, NotificationArgsProps["duration"]>();

function ExpandableToastText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyText = async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return createElement(
    "div",
    {
      onClick: () => setExpanded((value) => !value),
      role: "button",
      tabIndex: 0,
      title: i18n.t(expanded ? "common.collapse" : "common.expand"),
      style: {
        cursor: "pointer",
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
      },
      onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          setExpanded((value) => !value);
        }
      },
    },
    createElement(
      "div",
      {
        style: expanded
          ? { maxHeight: "50vh", overflowY: "auto" }
          : undefined,
      },
      expanded ? text : truncateToastText(text),
    ),
    createElement(
      "div",
      {
        style: {
          display: "flex",
          gap: 12,
          marginTop: 8,
          fontSize: 12,
        },
      },
      createElement(
        "span",
        { style: { color: "var(--ant-color-primary)" } },
        i18n.t(expanded ? "common.collapse" : "common.expand"),
      ),
      createElement(
        "button",
        {
          type: "button",
          onClick: copyText,
          style: {
            appearance: "none",
            border: 0,
            padding: 0,
            background: "transparent",
            color: "var(--ant-color-primary)",
            cursor: "pointer",
            font: "inherit",
          },
        },
        i18n.t(copied ? "common.copied" : "common.copy"),
      ),
    ),
  );
}

export function guardToastText(content: ReactNode): ReactNode {
  if (typeof content !== "string") {
    return content;
  }
  const sanitizedContent = stripAnsiEscapeSequences(content);
  if (sanitizedContent.length <= TOAST_TEXT_LIMIT) {
    return sanitizedContent;
  }
  return createElement(ExpandableToastText, { text: sanitizedContent });
}

function isToastOptions(input: ToastInput): input is ToastOptions {
  return Boolean(
    input
      && typeof input === "object"
      && !Array.isArray(input)
      && "content" in input,
  );
}

function getToastKey(level: ToastLevel, title: ReactNode, description: ReactNode): Key | undefined {
  // Only derive keys from plain text. Custom React content keeps its own lifecycle.
  const isText = (value: ReactNode) => value == null || typeof value === "string" || typeof value === "number";
  if (!isText(title) || !isText(description)) return undefined;
  const normalize = (value: ReactNode) => value == null ? null : stripAnsiEscapeSequences(String(value));
  // Use full text before truncation so distinct error details never share a key.
  return `krosna-toast:${JSON.stringify([level, normalize(title), normalize(description)])}`;
}

export function createToastArgs(
  level: ToastLevel,
  input: ToastInput,
): NotificationArgsProps {
  const options: ToastOptions = isToastOptions(input) ? input : { content: input };
  const hasTitle = options.title !== undefined;
  const duration = options.duration ?? DEFAULT_DURATION[level];
  const title = hasTitle ? options.title : options.content;
  const description = hasTitle ? options.description ?? options.content : options.description;

  return {
    title: guardToastText(title),
    description: guardToastText(description),
    key: options.key ?? getToastKey(level, title, description),
    duration,
    onClose: options.onClose,
    onClick: options.onClick,
    icon: options.icon,
    className: options.className,
    style: options.style,
    placement: "bottomRight",
    pauseOnHover: duration > 0,
    showProgress: duration > 0,
    role: level === "error" ? "alert" : "status",
  };
}

function show(level: ToastLevel, input: ToastInput) {
  const args = createToastArgs(level, input);
  const { key, duration, onClose } = args;
  if (key !== undefined) {
    if (typeof duration === "number" && duration > 0) {
      // This notification version resets its timer only when duration changes.
      // Alternate by 1ms on updates to restart both progress and hover-aware timing.
      args.duration = toastDurations.get(key) === duration ? duration + 0.001 : duration;
    }
    toastDurations.set(key, args.duration);
    // Match the visible stack's bound; never retain arbitrary feedback text.
    if (toastDurations.size > TOAST_NOTIFICATION_CONFIG.maxCount!) {
      toastDurations.delete(toastDurations.keys().next().value!);
    }
    args.onClose = () => {
      toastDurations.delete(key);
      onClose?.();
    };
  }
  notificationApi[level](args);
}

export interface ToastMessageApi {
  success: (input: ToastInput) => void;
  info: (input: ToastInput) => void;
  warning: (input: ToastInput) => void;
  error: (input: ToastInput) => void;
  open: (input: ToastInput) => void;
  destroy: (key?: Key) => void;
  useMessage: () => readonly [ToastMessageApi, ReactNode];
}

export const message: ToastMessageApi = {
  success: (input) => show("success", input),
  info: (input) => show("info", input),
  warning: (input) => show("warning", input),
  error: (input) => show("error", input),
  open: (input) => show("info", input),
  destroy: (key) => {
    if (key === undefined) toastDurations.clear();
    else toastDurations.delete(key);
    notificationApi.destroy(key);
  },
  useMessage: () => [message, null] as const,
};

export function ToastHost() {
  const { notification } = AntdApp.useApp();

  useEffect(() => {
    notificationApi = notification;
    return () => {
      toastDurations.clear();
      notificationApi = staticNotification;
    };
  }, [notification]);

  return null;
}
