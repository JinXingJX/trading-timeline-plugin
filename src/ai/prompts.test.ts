import { afterEach, describe, expect, it } from "vitest";
import { installFakeHost, uninstallFakeHost } from "../test/fakeHost";
import { makeEvent, makeState, NOW } from "../test/fixtures";
import type { Headline } from "../types";
import { normalizeState } from "../domain/normalize";
import { buildAnalysisRequest, parseAnalysisResponse } from "./analysisPrompt";
import { buildDiscoveryRequest, parseDiscoveryResponse } from "./discoveryPrompt";
import { describeJobError, invokeModelJson, ModelOutputError, parseJsonObject } from "./modelJson";

const headlines: Headline[] = [
  { id: "h1", title: "CPI due Oct 15", url: "https://n.example.com/cpi", summary: "", publishedAt: "2026-10-10T00:00:00Z", sourceId: "s", sourceName: "S" },
];

describe("discovery parsing", () => {
  it("keeps only grounded, in-window events above the impact threshold", () => {
    const state = makeState({ events: [makeEvent({ id: "known" })] });
    const parsed = parseDiscoveryResponse({
      events: [
        { title: "美国CPI", scheduledAt: "2026-10-15T12:30:00Z", impact: "high", sourceUrls: ["https://n.example.com/cpi"], timeConfirmed: false, searchQuery: "US CPI", existingId: "known" },
        { title: "无来源", scheduledAt: "2026-10-15T12:30:00Z", impact: "high", sourceUrls: ["https://evil.example.com"] },
        { title: "太远", scheduledAt: "2027-06-01T00:00:00Z", impact: "high", sourceUrls: ["https://n.example.com/cpi"] },
        { title: "低影响", scheduledAt: "2026-10-15T12:30:00Z", impact: "low", sourceUrls: ["https://n.example.com/cpi"] },
        { title: "未知 id", scheduledAt: "2026-10-15T12:30:00Z", impact: "high", sourceUrls: ["https://n.example.com/cpi"], existingId: "made-up" },
      ],
    }, state, headlines, NOW);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ existingId: "known", event: { title: "美国CPI", timeConfirmed: false, searchQuery: "US CPI" } });
    expect(parsed[1].existingId).toBeNull();
    expect(() => parseDiscoveryResponse({}, state, headlines, NOW)).toThrow(ModelOutputError);
  });

  it("sends known upcoming events so the model can reuse their ids", () => {
    const state = makeState({ events: [makeEvent({ id: "known", scheduledAt: "2026-10-12T00:00:00Z" }), makeEvent({ id: "gone", status: "dismissed" })] });
    const prompt = JSON.parse(buildDiscoveryRequest(state, headlines, NOW).prompt) as { knownEvents: { id: string }[] };
    expect(prompt.knownEvents.map((event) => event.id)).toEqual(["known"]);
  });

  it("routes scanning and analysis to their chosen models", () => {
    const base = makeState();
    expect(buildDiscoveryRequest(base, headlines, NOW).model).toBeUndefined();
    const state = normalizeState({ ...base, settings: { ...base.settings, discoveryModel: { authConfigId: "codex-default", model: "gpt-5.4-mini" }, analysisModel: { model: "missing-provider" } } }, NOW);
    expect(buildDiscoveryRequest(state, headlines, NOW).model).toEqual({ authConfigId: "codex-default", model: "gpt-5.4-mini" });
    expect(state.settings.analysisModel).toBeNull();
    const analysed = { ...state, settings: { ...state.settings, analysisModel: { authConfigId: "codex-default", model: "gpt-5.5" } } };
    expect(buildAnalysisRequest(analysed, makeEvent(), headlines, { now: NOW, mustConclude: false }).model).toEqual({ authConfigId: "codex-default", model: "gpt-5.5" });
  });
});

describe("analysis parsing", () => {
  const options = { now: NOW, mustConclude: false };

  it("maps occurred results onto input evidence only", () => {
    const outcome = parseAnalysisResponse({
      eventStatus: "occurred", summary: "CPI 高于预期", verdict: "bearish", confidence: 140,
      evidence: [{ url: "https://n.example.com/cpi" }, { url: "https://n.example.com/cpi" }, { url: "https://fake.example.com" }],
      affectedAssets: [{ symbol: "SPY", direction: "sideways" }],
    }, headlines, options);
    expect(outcome.kind).toBe("occurred");
    if (outcome.kind !== "occurred") return;
    expect(outcome.analysis).toMatchObject({ verdict: "bearish", confidence: 100, affectedAssets: [{ symbol: "SPY", direction: "unclear" }] });
    expect(outcome.analysis.evidence).toHaveLength(1);
  });

  it("distinguishes not-yet from insufficient, and forces a conclusion past the deadline", () => {
    expect(parseAnalysisResponse({ eventStatus: "not_yet", reason: "推迟" }, headlines, options)).toEqual({ kind: "not_yet", reason: "推迟" });
    expect(parseAnalysisResponse({ eventStatus: "not_yet" }, headlines, { now: NOW, mustConclude: true }).kind).toBe("insufficient");
    expect(parseAnalysisResponse({ eventStatus: "insufficient" }, headlines, options).kind).toBe("insufficient");
    expect(() => parseAnalysisResponse({ eventStatus: "occurred", summary: "x", evidence: [] }, headlines, options)).toThrow(ModelOutputError);
  });
});

describe("model JSON", () => {
  afterEach(uninstallFakeHost);

  it("extracts JSON from fenced output", () => {
    expect(parseJsonObject("```json\n{\"a\":1}\n```")).toEqual({ a: 1 });
    expect(() => parseJsonObject("[1]")).toThrow(ModelOutputError);
  });

  it("retries once with the parse problem, but not on transport errors", async () => {
    const replies = ["not json", "{\"ok\":true}"];
    const host = installFakeHost({ model: () => replies.shift() ?? "" });
    await expect(invokeModelJson({ prompt: "p" }, (record) => record.ok)).resolves.toBe(true);
    expect(host.modelCalls).toHaveLength(2);
    expect(host.modelCalls[1].prompt).toContain("上一次输出不可用");

    const failing = installFakeHost({ model: () => { throw new Error("Transport error: error decoding response body"); } });
    await expect(invokeModelJson({ prompt: "p" }, () => 1)).rejects.toThrow("Transport error");
    expect(failing.modelCalls).toHaveLength(1);
  });

  it("describes transport failures as retryable", () => {
    expect(describeJobError(new Error("Failed to read Codex stream event: Transport error: x"), "f")).toMatch(/^模型连接中断/);
    expect(describeJobError(new ModelOutputError("bad"), "f")).toBe("bad");
  });
});
