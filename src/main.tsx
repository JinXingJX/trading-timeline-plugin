import { pluginDesignStyles } from "@daily/plugin-sdk";
import { definePlugin } from "@daily/plugin-sdk";
import { startBackgroundWorker } from "./backgroundWorker";
import { setView } from "./view";

export default definePlugin({
  activate: () => startBackgroundWorker(),
  views: {
    "timeline.dashboard": {
      async mount(container, view) {
        const [{ createRoot }, { styles }, { TradingTimelineApp }] = await Promise.all([
          import("react-dom/client"), import("./styles"), import("./ui/TradingTimelineApp"),
        ]);
        if (view.signal.aborted) return;
        view.addStyles(pluginDesignStyles);
        view.addStyles(styles);
        setView(view);
        const root = createRoot(container);
        root.render(<TradingTimelineApp />);
        return () => {
          root.unmount();
          setView(null);
        };
      },
    },
  },
});
