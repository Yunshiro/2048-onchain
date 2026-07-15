import type { Hash } from "viem";

type QueueOptions = {
  getNonce: () => Promise<number>;
  onPendingChange?: (pending: number) => void;
  onError?: (error: unknown) => void;
  onIdle?: () => void;
  maxPending?: number;
};

export const MAX_PENDING_TRANSACTIONS = 12;

export class TransactionQueue {
  private nextNonce: number | null = null;
  private sendTail: Promise<void> = Promise.resolve();
  private confirmTail: Promise<void> = Promise.resolve();
  private generation = 0;
  private pending = 0;

  constructor(private readonly options: QueueOptions) {}

  get pendingCount(): number {
    return this.pending;
  }

  enqueue(
    send: (nonce: number) => Promise<Hash>,
    confirm: (hash: Hash) => Promise<void>,
  ): boolean {
    if (this.pending >= (this.options.maxPending ?? MAX_PENDING_TRANSACTIONS)) return false;

    const queuedGeneration = this.generation;
    this.setPending(this.pending + 1);

    this.sendTail = this.sendTail
      .then(async () => {
        if (queuedGeneration !== this.generation) return;
        if (this.nextNonce === null) this.nextNonce = await this.options.getNonce();
        const nonce = this.nextNonce;
        this.nextNonce += 1;
        let hash: Hash;
        try {
          hash = await send(nonce);
        } catch (error) {
          if (queuedGeneration === this.generation) this.reset(error);
          return;
        }

        this.confirmTail = this.confirmTail.then(async () => {
          if (queuedGeneration !== this.generation) return;
          try {
            await confirm(hash);
          } catch (error) {
            this.options.onError?.(error);
          } finally {
            if (queuedGeneration === this.generation) {
              this.setPending(Math.max(0, this.pending - 1));
            }
          }
        });
      })
      .catch((error) => {
        if (queuedGeneration === this.generation) this.reset(error);
      });

    return true;
  }

  reset(error?: unknown): void {
    this.generation += 1;
    this.nextNonce = null;
    this.sendTail = Promise.resolve();
    this.confirmTail = Promise.resolve();
    this.setPending(0);
    if (error) this.options.onError?.(error);
  }

  private setPending(value: number): void {
    const wasPending = this.pending;
    this.pending = value;
    this.options.onPendingChange?.(value);
    if (wasPending > 0 && value === 0) this.options.onIdle?.();
  }
}
