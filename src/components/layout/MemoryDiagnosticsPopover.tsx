import {
  CheckOutlined,
  CloseOutlined,
  CopyOutlined,
  DeleteOutlined,
  ExclamationCircleOutlined,
  LineChartOutlined,
} from "@ant-design/icons";
import { Button, Popover } from "antd";
import { useId, useRef, useState, type KeyboardEvent, type MouseEvent, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import {
  BYTES_PER_MIB,
  MEMORY_SAMPLE_INTERVAL_MS,
  MEMORY_SERIES,
  memoryChartGaps,
  memoryChartPath,
  memoryChartScale,
  type MemorySample,
} from "@/lib/memoryDiagnostics";
import { useMemoryDiagnosticsStore } from "@/store/slices/memoryDiagnostics";
import "./MemoryDiagnosticsPopover.css";

type FormatValue = (value: number | null | undefined, signed?: boolean) => string;
type DetailTab = "workspace" | "allocations";
const PLOT_WIDTH = 720;
const PLOT_HEIGHT = 144;

function MemoryTrend({ samples, formatBytes }: { samples: readonly MemorySample[]; formatBytes: FormatValue }) {
  const { t, i18n } = useTranslation();
  const chartTitle = useId();
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const scale = memoryChartScale(samples);
  const gaps = memoryChartGaps(samples, PLOT_WIDTH);
  const time = new Intl.DateTimeFormat(i18n.language, { hour: "numeric", minute: "2-digit", second: "2-digit" });
  const hasData = samples.some((sample) => MEMORY_SERIES.some((series) => series.value(sample) !== null));
  const first = samples[0];
  const last = samples.at(-1);
  const hovered = hoveredIndex !== null ? samples[hoveredIndex] : undefined;
  const span = first && last ? Math.max(MEMORY_SAMPLE_INTERVAL_MS, last.at - first.at) : MEMORY_SAMPLE_INTERVAL_MS;
  const hoveredX = hovered && first
    ? (((hovered.at - first.at) / span) * (PLOT_WIDTH - 4) + 2).toFixed(2)
    : undefined;

  const onPlotMove = (event: MouseEvent<HTMLDivElement>) => {
    if (!first || !last || samples.length === 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const targetAt = first.at + ratio * (last.at - first.at);
    let nearest = 0;
    let bestDiff = Math.abs(samples[0].at - targetAt);
    for (let i = 1; i < samples.length; i++) {
      const diff = Math.abs(samples[i].at - targetAt);
      if (diff < bestDiff) {
        bestDiff = diff;
        nearest = i;
      }
    }
    setHoveredIndex(nearest);
  };

  return (
    <figure className="app-memory-trend" aria-labelledby={chartTitle}>
      <figcaption id={chartTitle} className="app-memory-trend__legend">
        {MEMORY_SERIES.map(({ key }) => (
          <span key={key}><i data-series={key} aria-hidden="true" />{t(`settings.memoryDiagnostics.metrics.${key}`)}</span>
        ))}
      </figcaption>
      {first && last && hasData && (
        <span className="app-memory-trend__sr">
          {t("settings.memoryDiagnostics.trendSrSummary", {
            start: time.format(first.at),
            end: time.format(last.at),
            count: samples.length,
            resident: formatBytes(MEMORY_SERIES[0].value(last)),
          })}
        </span>
      )}
      <div className="app-memory-trend__graph">
        <div className="app-memory-trend__scale" aria-hidden="true">
          {[1, .75, .5, .25, 0].map((fraction) => <span key={fraction}>{formatBytes(scale * fraction)}</span>)}
        </div>
        <div
          className="app-memory-trend__plot"
          onMouseMove={onPlotMove}
          onMouseLeave={() => setHoveredIndex(null)}
        >
          <svg viewBox={`0 0 ${PLOT_WIDTH} ${PLOT_HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
            {gaps.map((gap, index) => (
              <rect
                key={index}
                className="app-memory-trend__gap"
                x={gap.x.toFixed(2)}
                y="0"
                width={gap.width.toFixed(2)}
                height={PLOT_HEIGHT}
              />
            ))}
            {[2, 37, 72, 107, 142].map((y) => <line key={y} x1="0" x2={PLOT_WIDTH} y1={y} y2={y} />)}
            {hoveredX && <line className="app-memory-trend__cursor" x1={hoveredX} x2={hoveredX} y1="0" y2={PLOT_HEIGHT} />}
            {MEMORY_SERIES.map(({ key, value }) => (
              <path key={key} data-series={key} d={memoryChartPath(samples, value, PLOT_WIDTH, PLOT_HEIGHT, scale)} />
            ))}
            {samples.length === 1 && MEMORY_SERIES.map(({ key, value }) => {
              const pointValue = value(samples[0]);
              if (pointValue === null) return null;
              const cy = ((1 - pointValue / scale) * (PLOT_HEIGHT - 4) + 2).toFixed(2);
              return <circle key={key} data-series={key} cx="2" cy={cy} r="4" />;
            })}
          </svg>
          {hovered && (
            <div className="app-memory-trend__tooltip" aria-hidden="true">
              <span>{time.format(hovered.at)}</span>
              <span>{formatBytes(MEMORY_SERIES[0].value(hovered))}</span>
            </div>
          )}
          {!hovered && gaps.length > 0 && (
            <span className="app-memory-trend__gap-badge" aria-hidden="true">
              {t("settings.memoryDiagnostics.pausedGap")}
            </span>
          )}
          {!hasData && <span className="app-memory-trend__empty">{t("settings.memoryDiagnostics.emptyTrend")}</span>}
        </div>
        {first && last && (
          <div className="app-memory-trend__time" aria-hidden="true">
            <span>{time.format(first.at)}</span>{first !== last && <span>{time.format(last.at)}</span>}
          </div>
        )}
      </div>
    </figure>
  );
}

export function MemoryDiagnosticsPopover() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const recording = useMemoryDiagnosticsStore((state) => state.recording);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const title = t("settings.memoryDiagnostics.title");

  const dismiss = () => {
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  };

  const onEscape = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || !open) return;
    event.preventDefault();
    event.stopPropagation();
    dismiss();
  };

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      afterOpenChange={(visible) => {
        if (visible && !panel.current?.contains(document.activeElement)) {
          panel.current?.focus({ preventScroll: true });
        }
      }}
      trigger="click"
      placement="topRight"
      arrow={false}
      destroyOnHidden
      classNames={{ root: "app-memory-diagnostics-popover" }}
      content={<MemoryDiagnosticsCard id={panelId} panel={panel} dismiss={dismiss} onEscape={onEscape} />}
    >
      <button
        ref={trigger}
        type="button"
        className="app-memory-diagnostics-icon"
        aria-label={title}
        title={title}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        data-recording={recording}
        onKeyDown={onEscape}
      >
        <LineChartOutlined aria-hidden="true" />
      </button>
    </Popover>
  );
}

function MemoryDiagnosticsCard({ id, panel, dismiss, onEscape }: {
  id: string;
  panel: RefObject<HTMLDivElement | null>;
  dismiss: () => void;
  onEscape: (event: KeyboardEvent<HTMLElement>) => void;
}) {
  const { t, i18n } = useTranslation();
  const { recording, setRecording, clearSamples, samples, error, captures, capture, captureStatus } = useMemoryDiagnosticsStore();
  const [activeTab, setActiveTab] = useState<DetailTab>("workspace");
  const [copied, setCopied] = useState(false);
  const number = new Intl.NumberFormat(i18n.language);
  const mib = new Intl.NumberFormat(i18n.language, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const signedMib = new Intl.NumberFormat(i18n.language, { minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: "exceptZero" });
  const time = new Intl.DateTimeFormat(i18n.language, { hour: "numeric", minute: "2-digit", second: "2-digit" });
  const formatCount: FormatValue = (value) => value == null ? "—" : number.format(value);
  const formatBytes: FormatValue = (value, signed) => value == null ? "—" : t("settings.memoryDiagnostics.mib", {
    value: (signed ? signedMib : mib).format(value / BYTES_PER_MIB),
  });
  const latest = samples.at(-1);
  const renderer = latest?.renderer;
  const unsupported = latest?.supported === false;
  const breakdown = captures.at(-1);
  const previous = captures.length === 2 && captures[0].pid === breakdown?.pid ? captures[0] : undefined;
  const statusState = unsupported
    ? "unsupported"
    : error
      ? "error"
      : recording
        ? "recording"
        : latest
          ? "paused"
          : "ready";
  const statusKey = unsupported
    ? "settings.memoryDiagnostics.unsupported"
    : error
      ? "settings.memoryDiagnostics.sampleError"
      : recording
        ? "settings.memoryDiagnostics.recording"
        : latest
          ? "settings.memoryDiagnostics.paused"
          : "settings.memoryDiagnostics.ready";
  const details = [
    { metric: "workingSet", value: formatBytes(renderer?.workingSetBytes) },
    { metric: "heapTotal", value: formatBytes(latest?.heap?.totalSize) },
    { metric: "embedderHeap", value: formatBytes(latest?.heap?.embedderHeapUsedSize) },
    { metric: "backingStorage", value: formatBytes(latest?.heap?.backingStorageSize) },
    { metric: "documents", value: formatCount(latest?.dom?.documents) },
    { metric: "nodes", value: formatCount(latest?.dom?.nodes) },
    { metric: "listeners", value: formatCount(latest?.dom?.jsEventListeners) },
    { metric: "terminals", value: formatCount(latest?.terminals.mounted) },
    { metric: "alternateTerminals", value: formatCount(latest?.terminals.alternate) },
    { metric: "scrollbackRows", value: formatCount(latest?.terminals.scrollbackRows) },
    { metric: "editorModels", value: formatCount(latest?.editorModels) },
    { metric: "editorCodeUnits", value: formatCount(latest?.editorCodeUnits) },
  ];

  const copySummary = () => {
    const lines = [
      t("settings.memoryDiagnostics.title"),
      ...(renderer ? [t("settings.memoryDiagnostics.process", { pid: renderer.pid, count: renderer.frameCount })] : []),
      ...MEMORY_SERIES.map(({ key, value }) => `${t(`settings.memoryDiagnostics.metrics.${key}`)}: ${formatBytes(latest ? value(latest) : null)}`),
      ...(latest ? [t("settings.memoryDiagnostics.workspaceSummary", {
        terminals: number.format(latest.terminals.mounted),
        rows: number.format(latest.terminals.scrollbackRows),
        editors: number.format(latest.editorModels),
      })] : []),
    ];
    void navigator.clipboard?.writeText(lines.join("\n")).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    });
  };

  return (
    <div
      ref={panel}
      id={id}
      role="dialog"
      tabIndex={-1}
      aria-labelledby={`${id}-title`}
      className="app-memory-diagnostics"
      onKeyDown={onEscape}
    >
      <header className="app-memory-diagnostics__header">
        <h2 id={`${id}-title`}>{t("settings.memoryDiagnostics.title")}</h2>
        <div className="app-memory-diagnostics__header-actions">
          <button
            type="button"
            className="app-memory-diagnostics-icon"
            aria-label={t(copied ? "settings.memoryDiagnostics.copied" : "settings.memoryDiagnostics.copy")}
            title={t(copied ? "settings.memoryDiagnostics.copied" : "settings.memoryDiagnostics.copy")}
            disabled={!latest}
            onClick={copySummary}
          >
            {copied ? <CheckOutlined aria-hidden="true" /> : <CopyOutlined aria-hidden="true" />}
          </button>
          <button
            type="button"
            className="app-memory-diagnostics-icon"
            aria-label={t("settings.memoryDiagnostics.clear")}
            title={t("settings.memoryDiagnostics.clear")}
            disabled={samples.length === 0}
            onClick={clearSamples}
          >
            <DeleteOutlined aria-hidden="true" />
          </button>
          <button type="button" className="app-memory-diagnostics-icon" aria-label={t("common.close")} title={t("common.close")} onClick={dismiss}>
            <CloseOutlined aria-hidden="true" />
          </button>
        </div>
      </header>
      <div className="app-memory-diagnostics__scroll">
        <section className="app-memory-diagnostics__section">
          <div className="app-memory-diagnostics__row">
            <div className="app-memory-diagnostics__title-group">
              <h3>{t("settings.memoryDiagnostics.renderer")}</h3>
              <span className="app-memory-diagnostics__badge" data-state={statusState} role="status">
                {t(statusKey)}
              </span>
            </div>
            <Button size="small" className="app-memory-diagnostics__action" disabled={unsupported} onClick={() => setRecording(!recording)}>
              {t(recording ? "settings.memoryDiagnostics.stop" : "settings.memoryDiagnostics.start")}
            </Button>
          </div>
          <dl className="app-memory-diagnostics__headline">
            {MEMORY_SERIES.map(({ key, value }) => (
              <div key={key} data-primary={key === "resident" ? "true" : undefined}>
                <dt>{t(`settings.memoryDiagnostics.metrics.${key}`)}</dt>
                <dd>{formatBytes(latest ? value(latest) : null)}</dd>
              </div>
            ))}
          </dl>
          {latest && (
            <div className="app-memory-diagnostics__workspace-strip">
              {t("settings.memoryDiagnostics.workspaceSummary", {
                terminals: number.format(latest.terminals.mounted),
                rows: number.format(latest.terminals.scrollbackRows),
                editors: number.format(latest.editorModels),
              })}
            </div>
          )}
          <MemoryTrend samples={samples} formatBytes={formatBytes} />
          <div className="app-memory-diagnostics__meta">
            {renderer && <span>{t("settings.memoryDiagnostics.process", { pid: renderer.pid, count: renderer.frameCount })}</span>}
            {latest && <span>{t("settings.memoryDiagnostics.updated", { time: time.format(latest.at) })}</span>}
          </div>
        </section>

        <section className="app-memory-diagnostics__section">
          <div className="app-memory-diagnostics__tabs" role="tablist" aria-label={t("settings.memoryDiagnostics.title")}>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "workspace"}
              className="app-memory-diagnostics__tab"
              onClick={() => setActiveTab("workspace")}
            >
              {t("settings.memoryDiagnostics.workspace")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "allocations"}
              className="app-memory-diagnostics__tab"
              onClick={() => setActiveTab("allocations")}
            >
              {t("settings.memoryDiagnostics.allocations")}
            </button>
          </div>

          {activeTab === "workspace" ? (
            <>
              <p className="app-memory-diagnostics__status">{t("settings.memoryDiagnostics.workspaceNote")}</p>
              <dl className="app-memory-diagnostics__details">
                {details.map(({ metric, value }) => (
                  <div key={metric}>
                    <dt>{t(`settings.memoryDiagnostics.metrics.${metric}`)}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </>
          ) : (
            <>
              <div className="app-memory-diagnostics__row">
                <p className="app-memory-diagnostics__status">{t("settings.memoryDiagnostics.allocationNote")}</p>
                <Button
                  size="small"
                  className="app-memory-diagnostics__action"
                  disabled={!renderer}
                  loading={captureStatus === "capturing"}
                  onClick={() => void capture()}
                >{t("settings.memoryDiagnostics.capture")}</Button>
              </div>
              {(captureStatus === "error" || captureStatus === "busy") && (
                <p className="app-memory-diagnostics__status" data-status={captureStatus} role="status">
                  {captureStatus === "error" && <ExclamationCircleOutlined aria-hidden="true" />}
                  <span>{t(`settings.memoryDiagnostics.captureStatus.${captureStatus}`)}</span>
                </p>
              )}
              {breakdown ? (
                <table className="app-memory-diagnostics__table">
                  <caption>{t("settings.memoryDiagnostics.captureInfo", { pid: breakdown.pid, time: time.format(breakdown.at) })}</caption>
                  <thead><tr>
                    <th scope="col">{t("settings.memoryDiagnostics.category")}</th>
                    <th scope="col">{t("settings.memoryDiagnostics.size")}</th>
                    <th scope="col">{t("settings.memoryDiagnostics.change")}</th>
                  </tr></thead>
                  <tbody>
                    {breakdown.allocations.map(({ category, bytes }) => {
                      const before = previous?.allocations.find((item) => item.category === category)?.bytes;
                      return <tr key={category}>
                        <th scope="row">{t(`settings.memoryDiagnostics.categories.${category}`, { defaultValue: category })}</th>
                        <td>{formatBytes(bytes)}</td>
                        <td>{formatBytes(before === undefined ? null : bytes - before, true)}</td>
                      </tr>;
                    })}
                  </tbody>
                </table>
              ) : <p className="app-memory-diagnostics__status">{t("settings.memoryDiagnostics.emptyCapture")}</p>}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
