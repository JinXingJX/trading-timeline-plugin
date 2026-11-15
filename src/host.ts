import { dailyHost as sdkHost, type DailyPluginApi } from "@daily/plugin-sdk";

export { errorMessage, hostErrorCode, type DailyPluginApi } from "@daily/plugin-sdk";

export function dailyHost(): DailyPluginApi {
  return sdkHost("Daily 插件宿主 SDK 不可用。");
}
