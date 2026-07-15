import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { PrivateKeyAccount } from "viem";

const inMemorySessions = new Map<string, PrivateKeyAccount>();

export function getOrCreateSessionAccount(owner: string): PrivateKeyAccount {
  const key = owner.toLowerCase();
  const existing = inMemorySessions.get(key);
  if (existing) return existing;
  const account = privateKeyToAccount(generatePrivateKey());
  inMemorySessions.set(key, account);
  return account;
}

export function forgetSessionAccount(owner: string): void {
  inMemorySessions.delete(owner.toLowerCase());
}

export function shortAddress(address?: string): string {
  if (!address) return "未连接";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
