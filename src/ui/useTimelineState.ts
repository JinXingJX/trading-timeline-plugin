import { useCallback, useEffect, useRef, useState } from "react";
import { createDefaultState } from "../domain/normalize";
import { loadRecoveredState, loadWorkerStatus } from "../domain/store";
import { dailyHost, errorMessage } from "../host";
import type { HostContext, TimelineState, WorkerStatus } from "../types";
import { onViewVisibilityChange, viewIsVisible } from "../view";

const REFRESH_MS = 15_000;

/** Polls the shared state (and the worker heartbeat) while the dashboard is visible. */
export function useTimelineState() {
  const [state, setState] = useState<TimelineState | null>(null);
  const [worker, setWorker] = useState<WorkerStatus | null>(null);
  const [hostContext, setHostContext] = useState<HostContext | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const refreshing = useRef(false);
  const disposed = useRef(false);

  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      const [nextState, nextWorker] = await Promise.all([loadRecoveredState(), loadWorkerStatus()]);
      if (disposed.current) return;
      setState(nextState);
      setWorker(nextWorker);
      setLoadError(null);
    } catch (error) {
      if (disposed.current) return;
      setState((current) => current ?? createDefaultState());
      setLoadError(errorMessage(error, "加载交易时间线失败。"));
    } finally {
      refreshing.current = false;
    }
  }, []);

  useEffect(() => {
    disposed.current = false;
    void dailyHost().host.getContext()
      .then((context) => { if (!disposed.current) setHostContext(context as HostContext); })
      .catch((error) => { if (!disposed.current) setLoadError(errorMessage(error, "无法读取插件授权状态。")); });
    void refresh();
    const offVisibility = onViewVisibilityChange(() => {
      if (viewIsVisible()) void refresh();
    });
    const timer = window.setInterval(() => {
      if (viewIsVisible()) void refresh();
    }, REFRESH_MS);
    return () => {
      disposed.current = true;
      offVisibility();
      window.clearInterval(timer);
    };
  }, [refresh]);

  return { state, setState, worker, hostContext, loadError, refresh };
}
