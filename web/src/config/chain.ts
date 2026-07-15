import { defineChain, getAddress, http, isAddress, zeroAddress } from "viem";
import { createConfig } from "wagmi";
import { injected } from "wagmi/connectors";

export const RPC_POLLING_INTERVAL = 250;
export const rpcUrl = import.meta.env.VITE_MONAD_RPC_URL?.trim() || "https://testnet-rpc.monad.xyz";

export function rpcTransport() {
  return http(rpcUrl, {
    retryCount: 2,
    retryDelay: 150,
    timeout: 10_000,
  });
}

export const monadTestnet = defineChain({
  id: 10_143,
  name: "Monad Testnet",
  blockTime: 400,
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://testnet-rpc.monad.xyz"] },
  },
  blockExplorers: {
    default: { name: "Monad Explorer", url: "https://testnet.monadexplorer.com" },
  },
  testnet: true,
});

export const deployedContractAddress = "0x77Edd2DE70e55bEC89D3412B409a6C788Cf95E31" as const;
const requestedContractAddress = import.meta.env.VITE_GAME_CONTRACT_ADDRESS?.trim() || deployedContractAddress;

// Fail closed for malformed overrides. The built-in default is the verified V2.3
// deployment and never falls back to the legacy V1 contract.
export const contractConfigured = isAddress(requestedContractAddress) && requestedContractAddress !== zeroAddress;
export const contractAddress = contractConfigured ? getAddress(requestedContractAddress) : zeroAddress;

export const game2048Abi = [
  {
    type: "function",
    name: "MAX_SESSION_REFUND",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "MAX_REFUND_PER_MOVE",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "SESSION_BOOTSTRAP",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "activeGameOf",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "activeSessionOf",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "authorizeSession",
    stateMutability: "payable",
    inputs: [{ name: "sessionKey", type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "paused",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "revokeSession",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "sessionExpiresAt",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint64" }],
  },
  {
    type: "function",
    name: "sessionRefundRemaining",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "fundSession",
    stateMutability: "payable",
    inputs: [{ name: "sessionKey", type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "gasBalance",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "games",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "owner", type: "address" },
      { name: "board", type: "uint256" },
      { name: "score", type: "uint256" },
      { name: "moveCount", type: "uint32" },
      { name: "over", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "getBoard",
    stateMutability: "view",
    inputs: [{ name: "gameId", type: "uint256" }],
    outputs: [
      { name: "cells", type: "uint8[16]" },
      { name: "score", type: "uint256" },
      { name: "over", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "highScore",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "move",
    stateMutability: "nonpayable",
    inputs: [
      { name: "gameId", type: "uint256" },
      { name: "dir", type: "uint8" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "sessionToOwner",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "withdrawGas",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  { type: "function", name: "startGame", stateMutability: "nonpayable", inputs: [], outputs: [{ name: "gameId", type: "uint256" }] },
  {
    type: "event",
    name: "GameStarted",
    anonymous: false,
    inputs: [
      { name: "gameId", type: "uint256", indexed: true },
      { name: "owner", type: "address", indexed: true },
      { name: "board", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Moved",
    anonymous: false,
    inputs: [
      { name: "gameId", type: "uint256", indexed: true },
      { name: "dir", type: "uint8", indexed: false },
      { name: "board", type: "uint256", indexed: false },
      { name: "score", type: "uint256", indexed: false },
      { name: "moveCount", type: "uint32", indexed: false },
      { name: "over", type: "bool", indexed: false },
    ],
  },
] as const;

export const wagmiConfig = createConfig({
  chains: [monadTestnet],
  connectors: [injected()],
  pollingInterval: RPC_POLLING_INTERVAL,
  transports: { [monadTestnet.id]: rpcTransport() },
});
