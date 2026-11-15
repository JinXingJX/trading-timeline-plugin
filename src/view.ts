import type { PluginViewContext } from "@daily/plugin-sdk";

let view: PluginViewContext | null = null;

/** The mounted dashboard view; null in tests and before the view opens. */
export function setView(context: PluginViewContext | null) {
  view = context;
}

/** False while Daily shows another page; the dashboard stays mounted. */
export function viewIsVisible() {
  return (view?.visible ?? true) && document.visibilityState !== "hidden";
}

export function onViewVisibilityChange(listener: () => void): () => void {
  const off = view?.onVisibilityChange(listener);
  document.addEventListener("visibilitychange", listener);
  return () => {
    off?.();
    document.removeEventListener("visibilitychange", listener);
  };
}
