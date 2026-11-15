import type { ModelInvokeRequest } from "@daily/plugin-sdk";
import { asRecord, errorText } from "../domain/values";
import { dailyHost } from "../host";

/** Thrown when model output is unusable; carries a user-facing reason. */
export class ModelOutputError extends Error {}

/**
 * Invokes the model and validates its JSON with `parse`. Malformed or invalid output gets
 * one corrective retry that quotes the problem; transport errors propagate unchanged
 * (the host already retries those) so the job's backoff can handle them.
 */
export async function invokeModelJson<T>(
  request: ModelInvokeRequest,
  parse: (record: Record<string, unknown>) => T,
): Promise<T> {
  const first = await dailyHost().model.invoke(request);
  try {
    return parse(parseJsonObject(first.text));
  } catch (error) {
    if (!(error instanceof ModelOutputError)) throw error;
    const retry = await dailyHost().model.invoke({
      ...request,
      prompt: `${request.prompt}\n\n上一次输出不可用：${error.message}\n请严格按 outputSchema 只返回一个 JSON 对象，不要 Markdown 或解释。`,
    });
    return parse(parseJsonObject(retry.text));
  }
}

export function parseJsonObject(text: string): Record<string, unknown> {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new ModelOutputError("模型响应不是有效 JSON。");
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1));
  } catch (error) {
    throw new ModelOutputError(`无法解析模型 JSON：${errorText(error, "格式错误")}`);
  }
  const record = asRecord(parsed);
  if (!record) throw new ModelOutputError("模型 JSON 顶层必须是对象。");
  return record;
}

/** Short, user-facing description of a failed job, keeping the raw cause for diagnosis. */
export function describeJobError(error: unknown, fallback: string): string {
  const raw = errorText(error, fallback);
  if (error instanceof ModelOutputError) return raw;
  if (/Transport error|decoding response body|stream timed out|Codex request failed:|connection|timed? ?out/i.test(raw)) {
    return `模型连接中断，将自动重试。（${raw.slice(0, 300)}）`;
  }
  if (/Unknown model provider|is not available for provider/.test(raw)) {
    return `所选模型已不在 Daily 设置中，请在自动化设置里重新选择。（${raw.slice(0, 300)}）`;
  }
  if (/status 429|rate limit/i.test(raw)) return `模型请求过于频繁，将稍后重试。（${raw.slice(0, 300)}）`;
  return raw.slice(0, 600);
}
