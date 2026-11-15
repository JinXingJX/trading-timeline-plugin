import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  LoaderCircle,
  Plus,
  Radar,
  RefreshCw,
  Settings2,
  TimerReset,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { runAutomationCycle } from "../automation";
import { mutateTimelineState } from "../domain/store";
import { createId } from "../domain/values";
import { dailyHost, errorMessage } from "../host";
import type { AutomationRun, MarketEvent, TimelineSettings, TimelineState } from "../types";
import { AddEventPanel } from "./AddEventPanel";
import { EventInspector, EventRow } from "./EventViews";
import {
  cloneSettings,
  formatDayHeading,
  formatMinutes,
  formatShortTime,
  groupEventsByDay,
  relativeFuture,
  relativeTime,
  validateSettings,
} from "./format";
import { SettingsPanel } from "./SettingsPanel";
import { useTimelineState } from "./useTimelineState";

type TimelineFilter = "upcoming" | "completed" | "all";

const WORKER_OFFLINE_MS = 90_000;
const PENDING_STATUSES: MarketEvent["status"][] = ["scheduled", "waiting", "analyzing"];

export function TradingTimelineApp() {
  const { state, setState, worker, loadError, refresh } = useTimelineState();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<TimelineFilter>("upcoming");
  const [settingsDraft, setSettingsDraft] = useState<TimelineSettings | null>(null);
  const [addEventOpen, setAddEventOpen] = useState(false);
  /** Set of in-flight actions, so a long scan doesn't block dismissing or editing. */
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => setNow(Date.now()), [state]);

  const hasUnsavedForm = settingsDraft !== null || addEventOpen;
  useEffect(() => {
    void dailyHost().host.setDirty(hasUnsavedForm).catch(() => undefined);
  }, [hasUnsavedForm]);
  useEffect(() => () => {
    void dailyHost().host.setDirty(false).catch(() => undefined);
  }, []);

  const visibleEvents = useMemo(() => {
    if (!state) return [];
    return state.events
      .filter((event) => event.status !== "dismissed")
      .filter((event) => {
        if (filter === "all") return true;
        if (filter === "completed") return event.status === "completed";
        return event.status !== "completed";
      })
      .sort((left, right) => Date.parse(left.scheduledAt) - Date.parse(right.scheduledAt));
  }, [filter, state]);

  const eventGroups = useMemo(
    () => groupEventsByDay(visibleEvents, state?.settings.timezone ?? "UTC"),
    [state?.settings.timezone, visibleEvents],
  );

  async function runAction(key: string, fallback: string, action: () => Promise<TimelineState>) {
    setBusy((current) => new Set(current).add(key));
    setError(null);
    try {
      setState(await action());
      return true;
    } catch (nextError) {
      setError(errorMessage(nextError, fallback));
      void refresh();
      return false;
    } finally {
      setBusy((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  }

  const owner = (kind: string) => createId(`dashboard-${kind}`);

  if (!state) {
    return (
      <div className="timeline-loading" role="status" aria-live="polite">
        <LoaderCircle className="spin" size={18} />
        <div>
          <strong>正在接入市场信号</strong>
          <span>{loadError ?? "初始化时间线与后台巡检…"}</span>
        </div>
      </div>
    );
  }

  const selectedEvent = state.events.find((event) => event.id === selectedId && event.status !== "dismissed")
    ?? visibleEvents[0]
    ?? null;
  const workerOnline = Boolean(worker && now - worker.heartbeatAt < WORKER_OFFLINE_MS);
  const upcoming = state.events.filter((event) => PENDING_STATUSES.includes(event.status));
  const completed = state.events.filter((event) => event.status === "completed");
  const highImpact = upcoming.filter((event) => event.impact === "high").length;
  const enabledSources = state.settings.sources.filter((source) => source.enabled);
  const healthySources = enabledSources.filter((source) => !source.lastError).length;
  const firstFutureId = visibleEvents.find((event) => Date.parse(event.scheduledAt) > now)?.id ?? null;
  const scanning = busy.has("scan") || Boolean(state.discoveryLease && state.discoveryLease.expiresAt > now);
  const scanDisabled = scanning;
  const shownError = error ?? loadError ?? state.lastError;

  const handleScanNow = () => runAction("scan", "市场扫描失败。", async () =>
    (await runAutomationCycle({ owner: owner("scan"), forceDiscovery: true })).state);

  const handleAnalyze = (eventId: string) => {
    setSelectedId(eventId);
    return runAction(`analyze:${eventId}`, "事件分析失败。", async () =>
      (await runAutomationCycle({ owner: owner("analyze"), analyzeEventId: eventId })).state);
  };

  const handleDismiss = async (eventId: string) => {
    const ok = await runAction(`dismiss:${eventId}`, "移出时间线失败。", () =>
      mutateTimelineState(owner("mutation"), (latest, at) => ({
        ...latest,
        // Clearing the lease makes any in-flight analysis discard its result.
        events: latest.events.map((event) => event.id === eventId
          ? { ...event, status: "dismissed", lease: null, updatedAt: at }
          : event),
      })));
    if (ok && selectedId === eventId) setSelectedId(null);
  };

  const handleSaveSettings = async () => {
    if (!settingsDraft) return;
    const validationError = validateSettings(settingsDraft);
    if (validationError) {
      setError(validationError);
      return;
    }
    const draft = settingsDraft;
    const ok = await runAction("settings", "保存自动化设置失败。", () =>
      mutateTimelineState(owner("mutation"), (latest, at) => ({
        ...latest,
        settings: {
          ...draft,
          // Saving is an explicit "try again" for paused sources.
          sources: draft.sources.map((source) => ({ ...source, consecutiveFailures: 0, retryAfter: null })),
        },
        nextDiscoveryAt: Math.min(latest.nextDiscoveryAt, at),
      })));
    if (ok) setSettingsDraft(null);
  };

  const handleAddEvent = async (event: MarketEvent) => {
    const ok = await runAction("add-event", "添加事件失败。", () =>
      mutateTimelineState(owner("mutation"), (latest) => ({ ...latest, events: [...latest.events, event] })));
    if (ok) {
      setSelectedId(event.id);
      setAddEventOpen(false);
    }
  };

  const handleDismissError = async () => {
    setError(null);
    if (!state.lastError) return;
    await runAction("clear-error", "清除错误状态失败。", () =>
      mutateTimelineState(owner("mutation"), (latest) => ({ ...latest, lastError: null })));
  };

  return (
    <div className="timeline-app">
      <aside className="tl-rail" aria-label="时间线控制">
        <div className="tl-rail-head">
          <h1>交易时间线</h1>
          <p>研究辅助，不构成投资建议</p>
        </div>
        <div className="tl-rail-body">
          <section className="tl-card">
            <div className="tl-card-row">
              <span className={`tl-led ${workerOnline ? "on" : ""}`} aria-hidden="true" />
              <strong className="tl-grow">{workerOnline ? "自动扫描运行中" : "后台未连接"}</strong>
              <button type="button" className="tl-btn small" onClick={() => setSettingsDraft(cloneSettings(state.settings))}>
                <Settings2 size={13} />设置
              </button>
            </div>
            <p className="tl-card-note">{worker?.message ?? "等待后台心跳"}</p>
            <dl className="tl-stats">
              <div><dt>扫描间隔</dt><dd>{formatMinutes(state.settings.discoveryIntervalMinutes)}</dd></div>
              <div><dt>下次扫描</dt><dd>{scanning ? "扫描中" : relativeFuture(state.nextDiscoveryAt)}</dd></div>
              <div><dt>到点后等待</dt><dd>{state.settings.analysisDelayMinutes ? formatMinutes(state.settings.analysisDelayMinutes) : "立即"}</dd></div>
              <div><dt>上次扫描</dt><dd>{state.lastDiscoveryAt ? relativeTime(state.lastDiscoveryAt) : "尚未扫描"}</dd></div>
            </dl>
          </section>

          <section>
            <div className="tl-label">今日态势</div>
            <div className="tl-summary">
              <div><strong>{upcoming.length}</strong><span>待观察</span></div>
              <div><strong className={highImpact ? "hot" : ""}>{highImpact}</strong><span>高影响</span></div>
              <div><strong>{completed.length}</strong><span>已分析</span></div>
            </div>
          </section>

          <section>
            <div className="tl-label">显示</div>
            <div className="tl-segmented" role="group" aria-label="事件筛选">
              <FilterButton active={filter === "upcoming"} onClick={() => setFilter("upcoming")}>待发生</FilterButton>
              <FilterButton active={filter === "completed"} onClick={() => setFilter("completed")}>已分析</FilterButton>
              <FilterButton active={filter === "all"} onClick={() => setFilter("all")}>全部</FilterButton>
            </div>
          </section>

          <section>
            <div className="tl-label with-action">
              <span>关注资产</span>
              <button type="button" className="tl-link" onClick={() => setSettingsDraft(cloneSettings(state.settings))}>编辑</button>
            </div>
            <div className="tl-chips">
              {state.settings.watchlist.map((symbol) => <span key={symbol}>{symbol}</span>)}
            </div>
          </section>

          <section>
            <div className="tl-label with-action">
              <span>信号源</span>
              <span className="tl-label-meta">{healthySources} / {enabledSources.length} 正常</span>
            </div>
            <div className="tl-sources">
              {state.settings.sources.map((source) => {
                const failing = source.enabled && Boolean(source.lastError);
                const paused = failing && source.retryAfter !== null && source.retryAfter > now;
                const label = !source.enabled
                  ? "已停用"
                  : paused
                    ? `暂停至 ${formatShortTime(new Date(source.retryAfter ?? now), state.settings.timezone)}`
                    : failing
                      ? "拉取失败"
                      : source.lastFetchedAt ? relativeTime(source.lastFetchedAt) : "等待抓取";
                return (
                  <div className={`tl-source ${failing ? "failing" : ""} ${source.enabled ? "" : "off"}`} key={source.id} title={source.lastError ?? source.url}>
                    <span className={`tl-source-dot ${!source.enabled ? "off" : failing ? "bad" : "ok"}`} aria-hidden="true" />
                    <span className="tl-grow tl-ellipsis">{source.name}</span>
                    <small>{label}</small>
                  </div>
                );
              })}
            </div>
          </section>

          {state.runs.length ? (
            <section>
              <div className="tl-label">自动化记录</div>
              <div className="tl-runs">
                {state.runs.slice(0, 5).map((run) => (
                  <div className="tl-run" key={run.id} title={run.message}>
                    <RunIcon status={run.status} />
                    <div className="tl-grow"><strong>{run.kind === "discovery" ? "市场扫描" : "到点分析"}</strong><span>{run.message}</span></div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </aside>

      <main className="tl-main">
        <header className="tl-bar">
          <div className="tl-bar-title">
            <strong>影响事件</strong>
            <span>{formatDayHeading(new Date(now), state.settings.timezone)} · {state.settings.timezone}</span>
          </div>
          <button type="button" className="tl-btn" onClick={() => setAddEventOpen(true)}><Plus size={14} />手动事件</button>
          <button type="button" className="tl-btn primary" disabled={scanDisabled} onClick={() => void handleScanNow()}>
            {scanning ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}{scanning ? "扫描中" : "立即扫描"}
          </button>
        </header>

        {shownError ? (
          <div className="tl-notice error" role="alert">
            <AlertTriangle size={15} />
            <span>{shownError}</span>
            <button type="button" className="tl-icon-btn" onClick={() => void handleDismissError()} aria-label="关闭错误提示"><X size={14} /></button>
          </div>
        ) : null}

        <div className="tl-scroll">
          {visibleEvents.length ? (
            <div className="tl-timeline">
              {eventGroups.map((group) => (
                <section className="tl-day" key={group.key} aria-label={group.label}>
                  <h2 className="tl-day-label">{group.label}</h2>
                  {group.events.map((event) => (
                    <div key={event.id}>
                      {event.id === firstFutureId && filter !== "upcoming" ? <NowMarker timezone={state.settings.timezone} now={now} /> : null}
                      <EventRow
                        event={event}
                        settings={state.settings}
                        active={selectedEvent?.id === event.id}
                        past={Date.parse(event.scheduledAt) <= now}
                        now={now}
                        onClick={() => setSelectedId(event.id)}
                      />
                    </div>
                  ))}
                </section>
              ))}
              {filter === "all" && !firstFutureId ? <NowMarker timezone={state.settings.timezone} now={now} /> : null}
            </div>
          ) : (
            <div className="tl-empty">
              <div className="tl-empty-mark"><Radar size={22} /></div>
              <h2>{filter === "completed" ? "还没有已分析的事件" : "时间线上暂时没有事件"}</h2>
              <p>只有来源中给出明确时间的中高影响事件才会自动加入。可以立即扫描，或先补充关注资产与数据源。</p>
              <div className="tl-actions">
                <button type="button" className="tl-btn primary" disabled={scanDisabled} onClick={() => void handleScanNow()}><RefreshCw size={14} />扫描市场</button>
                <button type="button" className="tl-btn" onClick={() => setAddEventOpen(true)}><Plus size={14} />手动添加</button>
              </div>
            </div>
          )}
        </div>
      </main>

      <aside className="tl-inspector" aria-label="事件详情">
        {selectedEvent ? (
          <EventInspector
            event={selectedEvent}
            settings={state.settings}
            busy={busy.has(`analyze:${selectedEvent.id}`) || busy.has(`dismiss:${selectedEvent.id}`)}
            now={now}
            onAnalyze={() => void handleAnalyze(selectedEvent.id)}
            onDismiss={() => void handleDismiss(selectedEvent.id)}
          />
        ) : (
          <div className="tl-inspector-empty"><CircleDot size={20} /><span>选择一个事件，查看事前假设与到点分析。</span></div>
        )}
      </aside>

      {settingsDraft ? (
        <SettingsPanel
          draft={settingsDraft}
          busy={busy.has("settings")}
          onChange={setSettingsDraft}
          onClose={() => setSettingsDraft(null)}
          onSave={() => void handleSaveSettings()}
        />
      ) : null}
      {addEventOpen ? (
        <AddEventPanel
          timezone={state.settings.timezone}
          onClose={() => setAddEventOpen(false)}
          onAdd={(event) => void handleAddEvent(event)}
        />
      ) : null}
    </div>
  );
}

function RunIcon({ status }: { status: AutomationRun["status"] }) {
  if (status === "running") return <LoaderCircle className="spin" size={13} />;
  if (status === "completed") return <CheckCircle2 size={13} className="ok" />;
  if (status === "interrupted") return <TimerReset size={13} className="muted" />;
  return <AlertTriangle size={13} className="bad" />;
}

function NowMarker({ timezone, now }: { timezone: string; now: number }) {
  return (
    <div className="tl-now" role="separator" aria-label="现在">
      <time>{formatShortTime(new Date(now), timezone)}</time>
      <span className="tl-now-dot" aria-hidden="true" />
      <span className="tl-now-label">现在</span>
      <span className="tl-now-line" aria-hidden="true" />
    </div>
  );
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return <button type="button" onClick={onClick} aria-pressed={active}>{children}</button>;
}
