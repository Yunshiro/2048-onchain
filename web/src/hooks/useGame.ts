import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAccount, useSwitchChain, useWriteContract } from "wagmi";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  formatEther,
  parseEther,
  zeroAddress,
  type Hash,
  type PrivateKeyAccount,
  type TransactionReceipt,
} from "viem";
import {
  contractAddress,
  contractConfigured,
  game2048Abi,
  monadTestnet,
  RPC_POLLING_INTERVAL,
  rpcTransport,
} from "../config/chain";
import { applyPredictedMove, Direction } from "../lib/engine";
import { isUnsupportedContractError } from "../lib/contractSafety";
import { addMoveGasSafetyMargin, MOVE_GAS_FLOOR } from "../lib/gas";
import { forgetSessionAccount, getOrCreateSessionAccount } from "../lib/session";
import { MAX_PENDING_TRANSACTIONS, TransactionQueue } from "../lib/txQueue";

const publicClient = createPublicClient({
  chain: monadTestnet,
  pollingInterval: RPC_POLLING_INTERVAL,
  transport: rpcTransport(),
});

const MIN_GAS_TOP_UP = parseEther("1");
const FALLBACK_MAX_SESSION_REFUND = parseEther("5");
const REQUIRED_SESSION_BOOTSTRAP = parseEther("0.5");
const REQUIRED_MAX_REFUND_PER_MOVE = parseEther("0.1");

function waitForReceipt(hash: Hash) {
  return publicClient.waitForTransactionReceipt({
    hash,
    confirmations: 1,
    pollingInterval: RPC_POLLING_INTERVAL,
  });
}

type GameStatus = "idle" | "checking" | "needs-authorization" | "ready" | "starting" | "error";

type SafetyParameters = {
  maxRefund: bigint;
  sessionBootstrap: bigint;
  maxRefundPerMove: bigint;
};

function readableError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("User rejected") || message.includes("rejected the request")) return "钱包已取消请求。";
  if (message.includes("insufficient funds") || message.includes("insufficient balance")) {
    return "会话钱包无法覆盖交易的预估 gas，请使用登录钱包补充会话垫资。";
  }
  if (message.includes("NoMove")) return "链上状态已变化，这一步无法执行。";
  if (message.includes("NotAuthorized")) return "会话授权已失效，请重新授权。";
  if (message.includes("SessionExpired")) return "会话已过期，请重新授权。";
  if (message.includes("ContractPaused")) return "合约已紧急暂停，请稍后再试。";
  if (message.includes("move reverted")) return "移动交易已回滚，棋盘已重新同步，请再试一次。";
  return "交易未完成，请检查网络后重试。";
}

export function useGame() {
  const { address, chainId, isConnected } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const [sessionAccount, setSessionAccount] = useState<PrivateKeyAccount | null>(null);
  const [status, setStatus] = useState<GameStatus>("idle");
  const [authorized, setAuthorized] = useState(false);
  const [hasActiveSession, setHasActiveSession] = useState(false);
  const [sessionBalance, setSessionBalance] = useState<bigint>(0n);
  const [gasBalance, setGasBalance] = useState<bigint>(0n);
  const [refundRemaining, setRefundRemaining] = useState<bigint>(0n);
  const [maxSessionRefund, setMaxSessionRefund] = useState(FALLBACK_MAX_SESSION_REFUND);
  const [topUpAmount, setTopUpAmount] = useState("1");
  const [sessionExpiresAt, setSessionExpiresAt] = useState<bigint>(0n);
  const [sponsorshipSupported, setSponsorshipSupported] = useState(false);
  const [contractPaused, setContractPaused] = useState(false);
  const [funding, setFunding] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [gameId, setGameId] = useState<bigint>(0n);
  const [board, setBoard] = useState<bigint>(0n);
  const [score, setScore] = useState(0n);
  const [highScore, setHighScore] = useState(0n);
  const [over, setOver] = useState(false);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [shakeKey, setShakeKey] = useState(0);
  const boardRef = useRef(0n);
  const scoreRef = useRef(0n);
  const confirmedBoardRef = useRef(0n);
  const confirmedScoreRef = useRef(0n);
  const confirmedOverRef = useRef(false);
  const moveCountRef = useRef(0);
  const confirmedMoveCountRef = useRef(0);
  const gameIdRef = useRef(0n);
  const refreshRef = useRef<() => Promise<void>>(async () => undefined);
  const safetyParametersRef = useRef<SafetyParameters | null>(null);

  useEffect(() => {
    setSessionAccount(address ? getOrCreateSessionAccount(address) : null);
  }, [address]);

  const sessionWallet = useMemo(() => {
    if (!sessionAccount) return null;
    return createWalletClient({
      account: sessionAccount,
      chain: monadTestnet,
      pollingInterval: RPC_POLLING_INTERVAL,
      transport: rpcTransport(),
    });
  }, [sessionAccount]);

  const refreshGame = useCallback(async () => {
    if (!address) return;
    const [activeId, best] = await Promise.all([
      publicClient.readContract({
        address: contractAddress,
        abi: game2048Abi,
        functionName: "activeGameOf",
        args: [address],
      }),
      publicClient.readContract({
        address: contractAddress,
        abi: game2048Abi,
        functionName: "highScore",
        args: [address],
      }),
    ]);
    setHighScore(best);
    setGameId(activeId);
    gameIdRef.current = activeId;

    if (activeId === 0n) {
      setBoard(0n);
      setScore(0n);
      setOver(false);
      boardRef.current = 0n;
      scoreRef.current = 0n;
      confirmedBoardRef.current = 0n;
      confirmedScoreRef.current = 0n;
      confirmedOverRef.current = false;
      moveCountRef.current = 0;
      confirmedMoveCountRef.current = 0;
      return;
    }

    const [, chainBoard, chainScore, chainMoveCount, chainOver] = await publicClient.readContract({
      address: contractAddress,
      abi: game2048Abi,
      functionName: "games",
      args: [activeId],
    });
    setBoard(chainBoard);
    setScore(chainScore);
    setOver(chainOver);
    boardRef.current = chainBoard;
    scoreRef.current = chainScore;
    confirmedBoardRef.current = chainBoard;
    confirmedScoreRef.current = chainScore;
    confirmedOverRef.current = chainOver;
    moveCountRef.current = chainMoveCount;
    confirmedMoveCountRef.current = chainMoveCount;
  }, [address]);

  useEffect(() => {
    refreshRef.current = refreshGame;
  }, [refreshGame]);

  const settleOptimisticState = useCallback(() => {
    boardRef.current = confirmedBoardRef.current;
    scoreRef.current = confirmedScoreRef.current;
    moveCountRef.current = confirmedMoveCountRef.current;
    setBoard(confirmedBoardRef.current);
    setScore(confirmedScoreRef.current);
    setOver(confirmedOverRef.current);
    if (confirmedOverRef.current) {
      setGameId(0n);
    } else {
      // A background read also covers rare RPC/send failures where no event was decoded.
      void refreshRef.current();
    }
  }, []);

  const queue = useMemo(() => {
    if (!sessionAccount) return null;
    return new TransactionQueue({
      getNonce: () => publicClient.getTransactionCount({ address: sessionAccount.address, blockTag: "pending" }),
      onPendingChange: setPending,
      onError: (queueError) => {
        setError(readableError(queueError));
      },
      onIdle: settleOptimisticState,
    });
  }, [sessionAccount, settleOptimisticState]);

  const refreshSession = useCallback(async () => {
    if (!address || !sessionAccount) return;
    const contractWasVerified = safetyParametersRef.current !== null;
    if (!contractWasVerified) setStatus("checking");
    setError(null);
    if (!contractConfigured) {
      setSponsorshipSupported(false);
      setHasActiveSession(false);
      setStatus("error");
      setError("尚未配置安全版 V2 合约地址，链上功能已禁用。");
      return;
    }
    try {
      let safetyParameters = safetyParametersRef.current;
      if (!safetyParameters) {
        const [maxRefund, sessionBootstrap, maxRefundPerMove] = await Promise.all([
          publicClient.readContract({
            address: contractAddress,
            abi: game2048Abi,
            functionName: "MAX_SESSION_REFUND",
          }),
          publicClient.readContract({
            address: contractAddress,
            abi: game2048Abi,
            functionName: "SESSION_BOOTSTRAP",
          }),
          publicClient.readContract({
            address: contractAddress,
            abi: game2048Abi,
            functionName: "MAX_REFUND_PER_MOVE",
          }),
        ]);
        safetyParameters = { maxRefund, sessionBootstrap, maxRefundPerMove };
        safetyParametersRef.current = safetyParameters;
      }

      const { maxRefund, sessionBootstrap, maxRefundPerMove } = safetyParameters;
      setMaxSessionRefund(maxRefund);
      setSponsorshipSupported(true);
      if (
        maxRefund < MIN_GAS_TOP_UP ||
        sessionBootstrap < REQUIRED_SESSION_BOOTSTRAP ||
        maxRefundPerMove < REQUIRED_MAX_REFUND_PER_MOVE
      ) {
        setAuthorized(false);
        setStatus("error");
        setError("当前合约的会话垫资不足，请部署 V2.3 并更新地址。旧会话仍可撤销，预存仍可取回。");
        return;
      }

      const [
        owner,
        balance,
        sponsoredBalance,
        activeSession,
        expiresAt,
        remaining,
        isPaused,
      ] = await Promise.all([
        publicClient.readContract({
          address: contractAddress,
          abi: game2048Abi,
          functionName: "sessionToOwner",
          args: [sessionAccount.address],
        }),
        publicClient.getBalance({ address: sessionAccount.address }),
        publicClient.readContract({
          address: contractAddress,
          abi: game2048Abi,
          functionName: "gasBalance",
          args: [address],
        }),
        publicClient.readContract({
          address: contractAddress,
          abi: game2048Abi,
          functionName: "activeSessionOf",
          args: [address],
        }),
        publicClient.readContract({
          address: contractAddress,
          abi: game2048Abi,
          functionName: "sessionExpiresAt",
          args: [sessionAccount.address],
        }),
        publicClient.readContract({
          address: contractAddress,
          abi: game2048Abi,
          functionName: "sessionRefundRemaining",
          args: [sessionAccount.address],
        }),
        publicClient.readContract({ address: contractAddress, abi: game2048Abi, functionName: "paused" }),
      ]);
      const now = BigInt(Math.floor(Date.now() / 1000));
      const isAuthorized =
        owner.toLowerCase() === address.toLowerCase() &&
        activeSession.toLowerCase() === sessionAccount.address.toLowerCase() &&
        expiresAt > now;
      setAuthorized(isAuthorized);
      setHasActiveSession(activeSession.toLowerCase() !== zeroAddress);
      setSessionBalance(balance);
      setGasBalance(sponsoredBalance);
      setRefundRemaining(remaining);
      setSessionExpiresAt(expiresAt);
      setContractPaused(isPaused);
      setStatus(isAuthorized ? "ready" : "needs-authorization");
      if (isAuthorized) await refreshGame();
    } catch (refreshError) {
      if (!safetyParametersRef.current && isUnsupportedContractError(refreshError)) {
        setSponsorshipSupported(false);
        setHasActiveSession(false);
        setStatus("error");
        setError("当前合约地址不是安全版 V2，请部署新合约并更新地址。");
        return;
      }

      if (safetyParametersRef.current) {
        setSponsorshipSupported(true);
        setStatus((current) => current === "checking" ? "needs-authorization" : current);
        setError("V2.3 合约已确认，但 Monad RPC 暂时无法读取会话状态。补充交易可能已经成功，请稍后重新检测。");
        return;
      }

      setSponsorshipSupported(false);
      setHasActiveSession(false);
      setStatus("error");
      setError("Monad RPC 暂时不可用，无法验证合约版本。请检查网络后重新检测。");
    }
  }, [address, refreshGame, sessionAccount]);

  useEffect(() => {
    if (!isConnected || !address || !sessionAccount) {
      setStatus("idle");
      setAuthorized(false);
      setHasActiveSession(false);
      return;
    }
    void refreshSession();
  }, [address, isConnected, refreshSession, sessionAccount]);

  const ensureChain = useCallback(async () => {
    if (chainId !== monadTestnet.id) await switchChainAsync({ chainId: monadTestnet.id });
  }, [chainId, switchChainAsync]);

  const getTopUpValue = useCallback((): bigint | null => {
    try {
      const value = parseEther(topUpAmount.trim());
      if (value < MIN_GAS_TOP_UP) {
        setError("单次预存不能低于 1 MON。");
        return null;
      }
      if (value > maxSessionRefund) {
        setError(`当前合约单会话最多允许 ${formatEther(maxSessionRefund)} MON。`);
        return null;
      }
      return value;
    } catch {
      setError("请输入有效的 MON 数量。");
      return null;
    }
  }, [maxSessionRefund, topUpAmount]);

  const authorize = useCallback(async () => {
    if (!sessionAccount || !address) return;
    setError(null);
    const topUpValue = getTopUpValue();
    if (topUpValue === null) return;
    try {
      await ensureChain();
      const hash = await writeContractAsync({
        address: contractAddress,
        abi: game2048Abi,
        functionName: "authorizeSession",
        args: [sessionAccount.address],
        chain: monadTestnet,
        account: address,
        value: topUpValue,
      });
      await waitForReceipt(hash);
      setAuthorized(true);
      setStatus("ready");
      setNotice(`会话已授权 24 小时，登录钱包已预存 ${topUpAmount} MON 游戏 gas。`);
      await refreshSession();
    } catch (authorizeError) {
      setError(readableError(authorizeError));
    }
  }, [address, ensureChain, getTopUpValue, refreshSession, sessionAccount, topUpAmount, writeContractAsync]);

  const fundGameGas = useCallback(async () => {
    if (!sessionAccount || !address || !sponsorshipSupported) return;
    setFunding(true);
    setError(null);
    const topUpValue = getTopUpValue();
    if (topUpValue === null) {
      setFunding(false);
      return;
    }
    try {
      await ensureChain();
      const hash = await writeContractAsync({
        address: contractAddress,
        abi: game2048Abi,
        functionName: "fundSession",
        args: [sessionAccount.address],
        value: topUpValue,
        chain: monadTestnet,
        account: address,
      });
      await waitForReceipt(hash);
      await refreshSession();
      setNotice(`已从登录钱包补充 ${topUpAmount} MON 游戏 gas。`);
    } catch (fundError) {
      setError(readableError(fundError));
    } finally {
      setFunding(false);
    }
  }, [address, ensureChain, getTopUpValue, refreshSession, sessionAccount, sponsorshipSupported, topUpAmount, writeContractAsync]);

  const revokeSession = useCallback(async () => {
    if (!address || !hasActiveSession || pending > 0) return;
    setRevoking(true);
    setError(null);
    try {
      await ensureChain();
      const hash = await writeContractAsync({
        address: contractAddress,
        abi: game2048Abi,
        functionName: "revokeSession",
        chain: monadTestnet,
        account: address,
      });
      await waitForReceipt(hash);
      forgetSessionAccount(address);
      setSessionAccount(getOrCreateSessionAccount(address));
      setAuthorized(false);
      setHasActiveSession(false);
      setRefundRemaining(0n);
      setSessionExpiresAt(0n);
      setStatus("needs-authorization");
      setNotice("旧会话已链上撤销，本地密钥已销毁。");
    } catch (revokeError) {
      setError(readableError(revokeError));
    } finally {
      setRevoking(false);
    }
  }, [address, ensureChain, hasActiveSession, pending, writeContractAsync]);

  const withdrawGas = useCallback(async () => {
    if (!address || gasBalance === 0n || pending > 0) return;
    setWithdrawing(true);
    setError(null);
    try {
      await ensureChain();
      const hash = await writeContractAsync({
        address: contractAddress,
        abi: game2048Abi,
        functionName: "withdrawGas",
        args: [gasBalance],
        chain: monadTestnet,
        account: address,
      });
      await waitForReceipt(hash);
      setGasBalance(0n);
      setNotice("未使用的游戏 gas 已全部退回登录钱包。");
    } catch (withdrawError) {
      setError(readableError(withdrawError));
    } finally {
      setWithdrawing(false);
    }
  }, [address, ensureChain, gasBalance, pending, writeContractAsync]);

  const startGame = useCallback(async () => {
    if (!address || !sessionAccount || !authorized) return;
    if (sessionBalance === 0n) {
      setError(
        sponsorshipSupported
          ? "会话启动金不足，请用登录钱包补充游戏 gas。"
          : "会话钱包余额为 0，请先向会话地址充值测试 MON。",
      );
      return;
    }
    setStatus("starting");
    setError(null);
    try {
      await ensureChain();
      const hash = await writeContractAsync({
        address: contractAddress,
        abi: game2048Abi,
        functionName: "startGame",
        chain: monadTestnet,
        account: address,
      });
      const receipt = await waitForReceipt(hash);
      if (receipt.status !== "success") throw new Error("startGame reverted");

      let startedEvent: { gameId: bigint; board: bigint } | null = null;
      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({ abi: game2048Abi, data: log.data, topics: log.topics });
          if (decoded.eventName === "GameStarted") {
            startedEvent = { gameId: decoded.args.gameId, board: decoded.args.board };
          }
        } catch {
          // Ignore logs emitted by other contracts in the receipt.
        }
      }

      if (startedEvent) {
        gameIdRef.current = startedEvent.gameId;
        boardRef.current = startedEvent.board;
        scoreRef.current = 0n;
        confirmedBoardRef.current = startedEvent.board;
        confirmedScoreRef.current = 0n;
        confirmedOverRef.current = false;
        moveCountRef.current = 0;
        confirmedMoveCountRef.current = 0;
        setGameId(startedEvent.gameId);
        setBoard(startedEvent.board);
        setScore(0n);
        setOver(false);
      } else {
        await refreshGame();
      }
      setStatus("ready");
      setNotice("新游戏已在 Monad 测试网上创建。");
    } catch (startError) {
      setStatus("ready");
      setError(readableError(startError));
    }
  }, [address, authorized, ensureChain, refreshGame, sessionAccount, sessionBalance, sponsorshipSupported, writeContractAsync]);

  const reconcileReceipt = useCallback(async (receipt: TransactionReceipt) => {
    if (receipt.status !== "success") throw new Error("move reverted");
    let movedEvent: { board: bigint; score: bigint; moveCount: number; over: boolean } | null = null;
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({ abi: game2048Abi, data: log.data, topics: log.topics });
        if (decoded.eventName === "Moved") {
          const args = decoded.args;
          movedEvent = { board: args.board, score: args.score, moveCount: args.moveCount, over: args.over };
        }
      } catch {
        // Ignore logs emitted by other contracts in the receipt.
      }
    }
    if (!movedEvent) {
      throw new Error("move receipt missing event");
    }
    confirmedBoardRef.current = movedEvent.board;
    confirmedScoreRef.current = movedEvent.score;
    confirmedOverRef.current = movedEvent.over;
    confirmedMoveCountRef.current = movedEvent.moveCount;
    setHighScore((current) => (movedEvent && movedEvent.score > current ? movedEvent.score : current));
  }, []);

  const move = useCallback((direction: Direction) => {
    if (
      !queue ||
      !sessionWallet ||
      !sessionAccount ||
      gameIdRef.current === 0n ||
      over ||
      queue.pendingCount >= MAX_PENDING_TRANSACTIONS
    ) return;
    const optimistic = applyPredictedMove(boardRef.current, direction, gameIdRef.current, moveCountRef.current);
    if (!optimistic.moved) {
      setShakeKey((current) => current + 1);
      return;
    }

    const queuedGameId = gameIdRef.current;
    const accepted = queue.enqueue(
      async (nonce: number): Promise<Hash> => {
        const gas = await publicClient
          .estimateContractGas({
            account: sessionAccount.address,
            address: contractAddress,
            abi: game2048Abi,
            functionName: "move",
            args: [queuedGameId, direction],
          })
          .then(addMoveGasSafetyMargin)
          .catch(() => MOVE_GAS_FLOOR);

        return sessionWallet.writeContract({
          address: contractAddress,
          abi: game2048Abi,
          functionName: "move",
          args: [queuedGameId, direction],
          gas,
          nonce,
        });
      },
      async (hash) => {
        const receipt = await waitForReceipt(hash);
        await reconcileReceipt(receipt);
        void publicClient
          .getBalance({ address: sessionAccount!.address })
          .then(setSessionBalance)
          .catch(() => undefined);
        if (address) {
          void Promise.all([
            publicClient.readContract({
              address: contractAddress,
              abi: game2048Abi,
              functionName: "gasBalance",
              args: [address],
            }),
            publicClient.readContract({
              address: contractAddress,
              abi: game2048Abi,
              functionName: "sessionRefundRemaining",
              args: [sessionAccount.address],
            }),
          ]).then(([pool, remaining]) => {
            setGasBalance(pool);
            setRefundRemaining(remaining);
          }).catch(() => undefined);
        }
      },
    );

    if (!accepted) return;
    moveCountRef.current += 1;
    boardRef.current = optimistic.board;
    scoreRef.current += BigInt(optimistic.gained);
    setBoard(optimistic.board);
    setScore(scoreRef.current);
    setError(null);
  }, [address, over, queue, reconcileReceipt, sessionAccount, sessionWallet]);

  return {
    address,
    chainId,
    isConnected,
    sessionAddress: sessionAccount?.address,
    sessionBalance,
    sessionBalanceLabel: Number(formatEther(sessionBalance)).toFixed(3),
    gasBalance,
    gasBalanceLabel: Number(formatEther(gasBalance)).toFixed(3),
    refundRemaining,
    refundRemainingLabel: Number(formatEther(refundRemaining)).toFixed(4),
    maxSessionRefund,
    maxSessionRefundLabel: formatEther(maxSessionRefund),
    topUpAmount,
    setTopUpAmount,
    sessionExpiresAt,
    sessionExpiryLabel: sessionExpiresAt > 0n ? new Date(Number(sessionExpiresAt) * 1000).toLocaleString() : "未授权",
    sponsorshipSupported,
    contractPaused,
    funding,
    revoking,
    withdrawing,
    lowBalance: sponsorshipSupported
      ? gasBalance < 200_000_000_000_000_000n ||
        refundRemaining < 200_000_000_000_000_000n ||
        sessionBalance < 100_000_000_000_000_000n
      : sessionBalance < 50_000_000_000_000_000n,
    hasGasBalance: sessionBalance > 0n,
    status,
    authorized,
    hasActiveSession,
    gameId,
    board,
    score,
    highScore,
    over,
    pending,
    error,
    notice,
    shakeKey,
    authorize,
    fundGameGas,
    revokeSession,
    withdrawGas,
    startGame,
    move,
    refreshSession,
    clearMessage: () => {
      setError(null);
      setNotice(null);
    },
  };
}
