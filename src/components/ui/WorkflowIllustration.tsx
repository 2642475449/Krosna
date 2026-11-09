import { useId } from "react";
import "./WorkflowIllustration.css";

const RIBBON_STRANDS = Array.from({ length: 7 }, (_, index) => {
  const offset = index * 3.8;
  return `M 27 ${103 + offset} C 64 ${115 + offset}, 81 ${34 + offset}, 119 ${38 + offset} S 174 ${111 + offset}, 213 ${65 + offset}`;
});

/** Native vector paths keep decorative artwork sharp at any display scale. */
export function WorkflowIllustration({ className = "" }: { className?: string }) {
  const id = useId();
  return (
    <svg
      className={`app-workflow-artwork app-workflow-illustration ${className}`}
      viewBox="0 0 240 160"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={`${id}-ribbon`} x1="28" y1="120" x2="210" y2="48" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--workflow-shade)" />
          <stop offset="0.32" stopColor="var(--workflow-mid)" />
          <stop offset="0.55" stopColor="var(--workflow-highlight)" />
          <stop offset="0.78" stopColor="var(--workflow-mid)" />
          <stop offset="1" stopColor="var(--workflow-shade)" />
        </linearGradient>
        <linearGradient id={`${id}-fold`} x1="66" y1="50" x2="167" y2="120" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--workflow-highlight)" />
          <stop offset="0.45" stopColor="var(--workflow-mid)" />
          <stop offset="1" stopColor="var(--workflow-shade)" />
        </linearGradient>
      </defs>
      <path
        d="M 42 69 C 74 25, 107 36, 132 79 S 180 128, 203 99 L 197 121 C 169 146, 139 117, 117 81 S 74 48, 48 88 Z"
        fill={`url(#${id}-fold)`}
        opacity="0.55"
      />
      <g stroke={`url(#${id}-ribbon)`} strokeWidth="3" strokeLinecap="round">
        {RIBBON_STRANDS.map((path) => <path key={path} d={path} />)}
      </g>
      <path
        d="M 69 47 C 92 30, 112 48, 130 78 S 162 121, 184 117 L 181 127 C 152 132, 132 106, 117 82 S 88 47, 69 58 Z"
        fill={`url(#${id}-fold)`}
      />
      <path d="M 70 47 C 94 32, 113 50, 130 78 S 163 121, 184 117" stroke="var(--workflow-highlight)" strokeOpacity="0.5" strokeWidth="0.8" />
    </svg>
  );
}
