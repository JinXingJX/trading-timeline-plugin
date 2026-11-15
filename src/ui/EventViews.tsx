import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  LoaderCircle,
  TimerReset,
  Trash2,
  TrendingUp,
  Zap,
} from "lucide-react";
import type { ReactNode } from "react";
import { analysisDueAt, isEventLeased, MAX_ANALYSIS_ATTEMPTS } from "../domain/scheduler";
import { isSafePublicHttpUrl } from "../domain/urls";
import type { ImpactLevel, MarketEvent, MarketVerdict, TimelineSettings } from "../types";
import {
  compactUrl,
  countdown,
  directionLabel,
  formatDateOnly,
  formatFullDate,
  formatShortTime,
  impactLabel,
  statusLabel,
  verdictLabel,
} from "./format";

export function ImpactBadge({ impact }: { impact: ImpactLevel }) {
  const glyph = impact === "high" ? "▲" : impact === "medium" ? "◆" : "·";
  return <span className={`tl-impact ${impact}`}>{glyph} {impactLabel(impact).replace("影响", "")}</span>;
}

function VerdictTag({ verdict }: { verdict: MarketVerdict }) {
  const glyph = verdict === "bullish" ? "▲" : verdict === "bearish" ? "▼" : verdict === "mixed" ? "↕" : "–";
  return <span className={`tl-verdict ${verdict}`}>{glyph} {verdictLabel(verdict)}</span>;
}

/** Short schedule hint shown on rows and in the inspector for events without a result. */
function scheduleHint(event: MarketEvent, settings: TimelineSettings, now: number): { text: string; tone: string } {
  if (isEventLeased(event, now)) return { text: "分析中", tone: "analyzing" };
  const dueAt = analysisDueAt(event, settings);
  switch (event.status) {
    case "failed": return { text: "需手动重试", tone: "failed" };
    case "waiting": return { text: `复查 ${countdown(dueAt)}`, tone: "waiting" };
    case "scheduled":
      return event.attempts > 0
        ? { text: `重试 ${countdown(dueAt)}`, tone: "retry" }
        : { text: countdown(dueAt), tone: "scheduled" };
    default: return { text: countdown(dueAt), tone: event.status };
  }
}

function eventTime(event: MarketEvent, short: boolean): string {
  const date = new Date(event.scheduledAt);
  if (!event.timeConfirmed) return formatDateOnly(date, event.timezone);
  return short ? formatShortTime(date, event.timezone) : formatFullDate(date, event.timezone);
}

export function EventRow({
  event,
  settings,
  active,
  past,
  now,
  onClick,
}: {
  event: MarketEvent;
  settings: TimelineSettings;
  active: boolean;
  past: boolean;
  now: number;
  onClick: () => void;
}) {
  const hint = scheduleHint(event, settings, now);
  const detail = event.analysis?.summary ?? (event.thesis || event.rationale);
  return (
    <div className={`tl-row ${past ? "past" : "future"}`}>
      <time className="tl-row-time">{event.timeConfirmed ? formatShortTime(new Date(event.scheduledAt), event.timezone) : "全天"}</time>
      <span className={`tl-row-node impact-${event.impact} status-${event.status}`} aria-hidden="true" />
      <button type="button" className={`tl-event status-${event.status} ${active ? "active" : ""}`} aria-pressed={active} onClick={onClick}>
        <span className="tl-event-head">
          <ImpactBadge impact={event.impact} />
          <span className="tl-event-title">{event.title}</span>
          {event.analysis && hint.tone !== "analyzing" ? (
            <VerdictTag verdict={event.analysis.verdict} />
          ) : (
            <span className={`tl-event-when ${hint.tone}`}>
              {hint.tone === "analyzing" ? <LoaderCircle className="spin" size={12} /> : null}{hint.text}
            </span>
          )}
        </span>
        <span className="tl-event-meta">
          <span>{statusLabel(event)}</span>
          {event.category ? <span>{event.category}</span> : null}
          {event.symbols.length ? <span className="tl-mono">{event.symbols.slice(0, 5).join(" · ")}</span> : null}
        </span>
        {detail ? <span className="tl-event-detail">{detail}</span> : null}
      </button>
    </div>
  );
}

export function EventInspector({
  event,
  settings,
  busy,
  now,
  onAnalyze,
  onDismiss,
}: {
  event: MarketEvent;
  settings: TimelineSettings;
  busy: boolean;
  now: number;
  onAnalyze: () => void;
  onDismiss: () => void;
}) {
  const analysis = event.analysis;
  const leased = isEventLeased(event, now);
  const hint = scheduleHint(event, settings, now);
  const confidence = analysis ? Math.max(0, Math.min(100, analysis.confidence)) : 0;
  const attemptNote = event.status === "scheduled" && event.attempts > 0
    ? `已失败 ${event.attempts} 次，最多自动尝试 ${MAX_ANALYSIS_ATTEMPTS} 次`
    : event.status === "failed"
      ? `已自动尝试 ${event.attempts} 次仍未成功`
      : null;
  return (
    <div className="tl-dossier">
      <header className="tl-dossier-head">
        <div className="tl-dossier-meta">
          <ImpactBadge impact={event.impact} />
          <span>{eventTime(event, false)} · {statusLabel(event)}</span>
          {!event.timeConfirmed ? <span className="tl-tag">仅确认日期</span> : null}
        </div>
        <h2>{event.title}</h2>
        {event.symbols.length ? <div className="tl-chips small">{event.symbols.map((symbol) => <span key={symbol}>{symbol}</span>)}</div> : null}
      </header>

      <div className="tl-dossier-body">
        {event.failureReason && event.status !== "dismissed" ? (
          <div className={`tl-notice ${event.status === "waiting" ? "" : "error"} inline`}>
            <AlertTriangle size={15} />
            <span>{event.failureReason}{attemptNote ? `（${attemptNote}）` : ""}</span>
          </div>
        ) : null}
        {analysis ? (
          <>
            <section className="tl-verdict-card">
              <div className="tl-verdict-top"><span>结论</span><span>置信度 {confidence}%</span></div>
              <div className={`tl-verdict-big ${analysis.verdict}`}>
                {analysis.verdict === "bullish" ? <ArrowUpRight size={22} /> : analysis.verdict === "bearish" ? <ArrowDownRight size={22} /> : <TrendingUp size={22} />}
                {verdictLabel(analysis.verdict)}
              </div>
              <div className="tl-confidence" aria-hidden="true"><span style={{ width: `${confidence}%` }} /></div>
              <p>{analysis.summary}</p>
            </section>
            {analysis.marketReaction ? <InspectorSection label="市场定价"><p>{analysis.marketReaction}</p></InspectorSection> : null}
            {analysis.affectedAssets.length ? (
              <InspectorSection label="受影响资产">
                <div className="tl-assets">
                  {analysis.affectedAssets.map((asset, index) => (
                    <div key={`${asset.symbol}-${index}`} className="tl-asset">
                      <strong className="tl-mono">{asset.symbol}</strong>
                      <span className="tl-asset-reason">{asset.reason}</span>
                      <span className={`tl-direction ${asset.direction}`}>{directionLabel(asset.direction)}</span>
                    </div>
                  ))}
                </div>
              </InspectorSection>
            ) : null}
            {event.thesis ? <InspectorSection label="事前假设"><p className="tl-quote">{event.thesis}</p></InspectorSection> : null}
            {analysis.scenarios.length ? (
              <InspectorSection label="后续验证"><ol className="tl-scenarios">{analysis.scenarios.map((scenario, index) => <li key={index}>{scenario}</li>)}</ol></InspectorSection>
            ) : null}
            {analysis.evidence.length ? (
              <InspectorSection label={`信息源 · ${analysis.evidence.length}`}>
                <div className="tl-evidence">
                  {analysis.evidence.map((item, index) => {
                    const href = isSafePublicHttpUrl(item.url) ? item.url : null;
                    const body = <><span className="tl-grow tl-ellipsis">{item.title}</span><small>{item.source}{item.publishedAt ? ` · ${formatShortTime(new Date(item.publishedAt), event.timezone)}` : ""}</small></>;
                    return href ? <a key={`${item.title}-${index}`} href={href} target="_blank" rel="noreferrer">{body}</a> : <div key={`${item.title}-${index}`}>{body}</div>;
                  })}
                </div>
              </InspectorSection>
            ) : null}
          </>
        ) : (
          <>
            <section className="tl-countdown">
              <TimerReset size={17} />
              <div><span>自动分析</span><strong>{leased ? "正在分析…" : hint.text}</strong></div>
            </section>
            <InspectorSection label="事前假设"><p className={event.thesis ? "tl-quote" : "tl-muted"}>{event.thesis || "还没有事前假设。写下你预期的结果，到点后可以与分析结论对照。"}</p></InspectorSection>
            {event.rationale ? <InspectorSection label="入选依据"><p>{event.rationale}</p></InspectorSection> : null}
            {event.sourceUrls.length ? (
              <InspectorSection label={`来源 · ${event.sourceUrls.length}`}>
                <div className="tl-evidence">{event.sourceUrls.map((url) => <a key={url} href={url} target="_blank" rel="noreferrer" title={url}><span className="tl-grow tl-ellipsis tl-mono">{compactUrl(url)}</span></a>)}</div>
              </InspectorSection>
            ) : null}
          </>
        )}
      </div>

      <footer className="tl-dossier-actions">
        <button type="button" className="tl-btn primary tl-grow" disabled={busy || leased} onClick={onAnalyze}>
          {busy || leased ? <LoaderCircle className="spin" size={14} /> : <Zap size={14} />}
          {analysis ? "重新分析" : "立即抓取并分析"}
        </button>
        <button type="button" className="tl-btn" disabled={busy} onClick={onDismiss} title="移出时间线"><Trash2 size={14} />移出</button>
      </footer>
    </div>
  );
}

function InspectorSection({ label, children }: { label: string; children: ReactNode }) {
  return <section className="tl-section"><h3>{label}</h3>{children}</section>;
}
