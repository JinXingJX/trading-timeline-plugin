# 交易 Timeline

面向 Daily 的自动市场事件插件。它持续读取 RSS、Atom 或 JSON 信息源，用宿主配置的模型识别具有明确时间证据的高影响事件，并在事件到点后重新抓取最新信息生成结构化分析。

## 自动化闭环

1. 插件启用后，后台任务每 30 秒检查一次任务状态，并按设置的间隔抓取已启用信息源。
2. 模型从标题、摘要、发布时间与链接中提取未来 60 天内的宏观、央行、财报、监管、加密、商品或地缘事件。
3. 只有来源明确给出日期或时间、且达到最低影响级别的事件会进入时间线。
4. 到达事件时间并经过配置的观察延迟后，后台重新抓取原有信息源和事件专属新闻搜索。
5. 模型输出事实结论、市场定价、受影响资产、条件化场景、证据链与置信度。

插件不会自动下单，输出仅用于研究辅助，不构成投资建议。

## 安装到 Daily

需要 Node.js 22.12 或更高版本（工作区根目录提供了 `.nvmrc`）。

先构建插件：

```bash
npm ci
npm test
npm run build
```

在 Daily 的 `Settings → Plugins → Local plugin` 中填写：

```text
C:\src\daily-workspace\trading-timeline-plugin
```

启用后插件直接运行在 Daily 窗口内，用到以下宿主能力：

- `storage`：保存事件、分析、设置与任务状态。
- `network.fetch`：通过宿主抓取公开信息源。
- `model.invoke`：使用 Daily 当前配置的模型提取事件和生成分析。

开发模式可运行 `npm run dev`，然后在本地插件的 Dev URL 中填写 `http://127.0.0.1:5175`。

## 数据源

初始配置包含市场新闻搜索和美联储官方发布 RSS。可以在插件右上角设置中添加任何公开的 RSS、Atom 或常见 JSON feed；URL 中可使用 `{query}` 占位符，让插件根据关注资产构造查询。

所有状态都保存在插件私有存储中，不需要提交 API Key。模型鉴权继续使用 Daily 的本地设置。

## 安全与一致性

- 前台操作与后台巡检通过宿主原子 compare-and-swap 租约串行化，避免同时保存时覆盖事件或设置。
- 数据源和证据链接只接受无内嵌凭据的公网 HTTP(S) URL；本地、链路本地、私有和保留地址会在插件校验和宿主 DNS 校验两层被拒绝。
- 抓取响应、数据源数量、事件数量、运行记录、文本字段和模型输入均有上限。
- 模型只能引用本轮真实抓取结果中已有的 URL；分析证据由实际新闻记录重新构造，不直接信任模型生成的标题或来源。
- 时间输入按配置的 IANA 时区转换为 UTC，夏令时不存在的本地时间会被拒绝。
- 后台错误会写入 Worker 状态并在前台展示；插件不会自动下单。
- 切换到别的页面时插件界面保持原样；自动化设置或手动事件表单尚未提交时，关闭应用会先要求确认。

## 源码布局与 Windows

先将 `https://github.com/JinXingJX/daily.git` 克隆到同级的 `daliy` 目录，再运行 `npm ci`；共享 SDK 依赖路径为 `file:../daliy/packages/plugin-sdk`。完整安装顺序见 [Windows 使用指南](https://github.com/JinXingJX/daily/blob/main/docs/windows.md)。CI 覆盖 Linux、macOS、Windows，并提供构建后的 `.daily-plugin` 下载。

本地插件路径必须是绝对路径，macOS 也可使用自己的绝对路径。

## 许可

[MIT](LICENSE)，第三方依赖保留各自许可。
