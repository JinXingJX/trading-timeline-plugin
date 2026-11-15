import { afterEach, describe, expect, it } from "vitest";
import { installFakeHost, uninstallFakeHost } from "../test/fakeHost";
import { makeEvent, makeState } from "../test/fixtures";
import { AUTOMATION_LOCK_KEY, loadRecoveredState, mutateTimelineState, STATE_KEY, transact, withTimelineLock } from "./store";

describe("timeline store", () => {
  afterEach(uninstallFakeHost);

  it("allows only one lock holder at a time", async () => {
    installFakeHost();
    let enterFirst = () => undefined as void;
    let finishFirst = () => undefined as void;
    const entered = new Promise<void>((resolve) => { enterFirst = resolve; });
    const finish = new Promise<void>((resolve) => { finishFirst = resolve; });
    const first = withTimelineLock("first", async () => {
      enterFirst();
      await finish;
      return "done";
    });
    await entered;
    await expect(withTimelineLock("second", async () => "unexpected")).resolves.toBeNull();
    finishFirst();
    await expect(first).resolves.toBe("done");
  });

  it("waits for a briefly held lock instead of failing the user's edit", async () => {
    const host = installFakeHost();
    host.storage.set(STATE_KEY, makeState());
    host.storage.set(AUTOMATION_LOCK_KEY, { owner: "worker", expiresAt: Date.now() + 60_000 });
    setTimeout(() => host.storage.delete(AUTOMATION_LOCK_KEY), 120);
    const next = await mutateTimelineState("user", (latest) => ({ ...latest, lastError: "edited" }));
    expect(next.lastError).toBe("edited");
  });

  it("persists recovery even when the transaction itself changes nothing", async () => {
    const host = installFakeHost();
    host.storage.set(STATE_KEY, makeState({
      events: [makeEvent({ status: "analyzing", lease: { owner: "dead", expiresAt: Date.now() - 1 } })],
    }));
    const { result } = await transact("reader", () => ({ result: 7 }));
    expect(result).toBe(7);
    expect((host.storage.get(STATE_KEY) as { events: { status: string }[] }).events[0].status).toBe("scheduled");
    expect((await loadRecoveredState()).events[0].attempts).toBe(1);
  });
});
