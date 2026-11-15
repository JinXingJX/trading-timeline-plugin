import { describe, expect, it } from "vitest";
import { eventSearchTerms, headlineKey, nextSourceBackoff, parseFeed, prioritizeHeadlines, resolveSourceUrl } from "./feeds";
import { makeEvent, makeState, NOW } from "./test/fixtures";
import type { Headline } from "./types";

const headline = (title: string, publishedAt = "2026-10-10T00:00:00.000Z", url = `https://n.example.com/${encodeURIComponent(title)}`): Headline => ({
  id: title, title, url, summary: "", publishedAt, sourceId: "s", sourceName: "S",
});

describe("feeds", () => {
  it("parses nested live-flash JSON that keeps the story in content_text", () => {
    const payload = JSON.stringify({
      code: 20000,
      data: {
        items: [{
          title: "",
          content_text: "国家统计局：第三季度金融业GDP同比增长4.1%",
          display_time: 1792461265,
          uri: "https://wallstreetcn.com/livenews/3181525",
        }],
      },
    });
    const [item] = parseFeed(payload, { id: "wscn", name: "WSCN" }, "https://api-one-wscn.awtmt.com/apiv1/content/lives", NOW);
    expect(item).toMatchObject({
      title: "国家统计局：第三季度金融业GDP同比增长4.1%",
      url: "https://wallstreetcn.com/livenews/3181525",
      publishedAt: new Date(1792461265 * 1000).toISOString(),
    });
  });

  it("treats syndicated copies of a story as one headline", () => {
    expect(headlineKey("Fed holds rates steady - Reuters")).toBe(headlineKey("Fed holds rates steady — Bloomberg"));
    expect(headlineKey("Fed holds rates steady")).not.toBe(headlineKey("Fed cuts rates"));
  });

  it("keeps event evidence first, then fills with the newest general headlines", () => {
    const primary = [headline("Event A", "2026-10-09T00:00:00.000Z"), headline("Shared - Reuters")];
    const general = [
      headline("Shared - CNBC", "2026-10-10T05:00:00.000Z"),
      headline("Old", "2026-10-01T00:00:00.000Z"),
      headline("New", "2026-10-10T06:00:00.000Z"),
    ];
    expect(prioritizeHeadlines(primary, general, 3).map((item) => item.title)).toEqual(["Shared - Reuters", "Event A", "New"]);
  });

  it("caps event evidence so general context still fits", () => {
    const primary = Array.from({ length: 10 }, (_, index) => headline(`P${index}`));
    const general = Array.from({ length: 10 }, (_, index) => headline(`G${index}`));
    const titles = prioritizeHeadlines(primary, general, 6).map((item) => item.title);
    expect(titles.filter((title) => title.startsWith("P"))).toHaveLength(4);
    expect(titles).toHaveLength(6);
  });

  it("builds English search terms for CJK titles and watchlists", () => {
    const state = makeState();
    expect(eventSearchTerms(makeEvent({ searchQuery: "  FOMC decision " }), state)).toBe("FOMC decision");
    expect(eventSearchTerms(makeEvent({ searchQuery: "", title: "英伟达 NVDA 财报", symbols: ["黄金"] }), state)).toBe("NVDA gold");
    const url = decodeURIComponent(resolveSourceUrl("https://x.example.com/?q={query}", { ...state, settings: { ...state.settings, watchlist: ["黄金"] } }));
    expect(url).toContain("黄金 OR gold");
    expect(url).toMatch(/\) when:1d$/);
  });

  it("backs off failing sources exponentially up to six hours", () => {
    expect(nextSourceBackoff(1, NOW) - NOW).toBe(5 * 60_000);
    expect(nextSourceBackoff(3, NOW) - NOW).toBe(20 * 60_000);
    expect(nextSourceBackoff(20, NOW) - NOW).toBe(6 * 60 * 60_000);
  });
});
