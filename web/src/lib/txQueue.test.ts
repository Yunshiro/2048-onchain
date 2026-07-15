import { describe, expect, it, vi } from "vitest";
import type { Hash } from "viem";
import { TransactionQueue } from "./txQueue";

const hash = `0x${"1".repeat(64)}` as Hash;

async function flushPromises() {
  for (let index = 0; index < 24; index += 1) await Promise.resolve();
}

describe("TransactionQueue", () => {
  it("broadcasts queued transactions without waiting for earlier receipts", async () => {
    const confirmations: Array<() => void> = [];
    const send = vi.fn(async (_nonce: number) => hash);
    const queue = new TransactionQueue({ getNonce: async () => 7 });

    const confirm = vi.fn(() => new Promise<void>((resolve) => confirmations.push(resolve)));
    expect(queue.enqueue(send, confirm)).toBe(true);
    expect(queue.enqueue(send, confirm)).toBe(true);
    expect(queue.enqueue(send, confirm)).toBe(true);
    expect(queue.pendingCount).toBe(3);

    await flushPromises();
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls.map(([nonce]) => nonce)).toEqual([7, 8, 9]);
    expect(confirm).toHaveBeenCalledTimes(1);

    confirmations.shift()?.();
    await flushPromises();
    expect(queue.pendingCount).toBe(2);
    expect(confirm).toHaveBeenCalledTimes(2);

    confirmations.shift()?.();
    await flushPromises();
    confirmations.shift()?.();
    await flushPromises();
    expect(queue.pendingCount).toBe(0);
  });

  it("caps the input buffer", () => {
    const queue = new TransactionQueue({ getNonce: async () => 0, maxPending: 2 });
    const never = () => new Promise<void>(() => undefined);
    expect(queue.enqueue(async () => hash, never)).toBe(true);
    expect(queue.enqueue(async () => hash, never)).toBe(true);
    expect(queue.enqueue(async () => hash, never)).toBe(false);
  });
});
