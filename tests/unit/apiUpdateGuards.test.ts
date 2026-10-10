import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, hasPendingApiMutations, hasPendingSessionChanges, withAdminIdentityConfirmation } from "../../src/lib/api";
import { holdPwaTransition, releasePwaTransition } from "../../src/lib/pwaTransition";

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.stubGlobal("location", { hostname: "hortvitalmix.vercel.app" });
  vi.stubGlobal("localStorage", { getItem: () => null });
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe("safe application update guards", () => {
  it("holds new writes during an activation vote and resumes each exactly once on abort", async () => {
    holdPwaTransition("synthetic-vote");
    fetchMock.mockResolvedValueOnce(Response.json({ status: "success" }));
    const write = api("/v1/cart/items", { method: "POST", body: "{}" });
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
    releasePwaTransition("synthetic-vote");
    await write;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("holds reload while either of two writes is pending, including a failed write", async () => {
    let completeFirst!: (value: Response) => void;
    let completeSecond!: (value: Response) => void;
    fetchMock
      .mockReturnValueOnce(new Promise(resolve => { completeFirst = resolve; }))
      .mockReturnValueOnce(new Promise(resolve => { completeSecond = resolve; }));
    const first = api("/v1/admin/app-distribution", { method: "PATCH", body: "{}" });
    const second = api("/v1/admin/invites", { method: "POST", body: "{}" });
    const rejection = expect(second).rejects.toMatchObject({ status: 422 });
    expect(hasPendingApiMutations()).toBe(true);
    completeFirst(Response.json({ status: "success" }));
    await first;
    expect(hasPendingApiMutations()).toBe(true);
    completeSecond(Response.json({ error: "VALIDATION_FAILED" }, { status: 422 }));
    await rejection;
    expect(hasPendingApiMutations()).toBe(false);
  });

  it("does not lock application updates for a background read", async () => {
    let complete!: (value: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise(resolve => { complete = resolve; }));
    const read = api("/v1/app-distribution");
    expect(hasPendingApiMutations()).toBe(false);
    complete(Response.json({ revision: 1 }));
    await read;
  });

  it("keeps identity adoption and revocation protected until confirmation finishes", async () => {
    let release!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; });
    const confirmation = withAdminIdentityConfirmation(async () => { await wait; });
    await vi.waitFor(() => expect(hasPendingSessionChanges()).toBe(true));
    expect(hasPendingApiMutations()).toBe(false);
    release();
    await confirmation;
    expect(hasPendingSessionChanges()).toBe(false);
  });
});
