import { useState } from "react";
import { ArrowRight, ArrowSquareOut, Check, Copy, Drop, Lightning, ShieldCheck, Warning } from "@phosphor-icons/react";
import { Board } from "./components/Board";
import { ConnectBar } from "./components/ConnectBar";
import { Controls } from "./components/Controls";
import { GameOverOverlay } from "./components/GameOverOverlay";
import { ScorePanel } from "./components/ScorePanel";
import { contractAddress, monadTestnet } from "./config/chain";
import { useGame } from "./hooks/useGame";
import { packBoard } from "./lib/engine";
import { shortAddress } from "./lib/session";
import { MAX_PENDING_TRANSACTIONS } from "./lib/txQueue";

const demoBoard = packBoard([1, 2, 3, 4, 0, 5, 6, 0, 0, 0, 7, 0, 0, 0, 0, 8]);

export default function App() {
  const game = useGame();
  const [copied, setCopied] = useState(false);
  const activeBoard = game.board === 0n ? demoBoard : game.board;
  const hasGame = game.gameId !== 0n || game.over;
  const controlsDisabled = !hasGame || game.over || game.contractPaused || game.pending >= MAX_PENDING_TRANSACTIONS || !game.authorized;

  const copySessionAddress = async () => {
    if (!game.sessionAddress) return;
    await navigator.clipboard.writeText(game.sessionAddress);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="/" aria-label="Chain2048 首页">
          <span className="brand-mark">2048</span>
          <span>ONCHAIN</span>
        </a>
        <div className="network-label"><span /> MONAD TESTNET // LIVE</div>
        <ConnectBar address={game.address} chainId={game.chainId} isConnected={game.isConnected} />
      </header>

      <main className="game-layout">
        <aside className="left-rail">
          <div className="intro-copy">
            <p className="eyebrow">MONAD // ONCHAIN 2048</p>
            <h1>合并数字。<br /><span>写入链上。</span></h1>
            <p>滑动即时响应，移动由会话钱包静默广播。每一次合并，都在 Monad 留下可验证记录。</p>
          </div>

          <ScorePanel board={game.board} score={game.score} highScore={game.highScore} pending={game.pending} />

          <a className="contract-link" href={`${monadTestnet.blockExplorers.default.url}/address/${contractAddress}`} target="_blank" rel="noreferrer">
            <span><small>游戏合约</small>{shortAddress(contractAddress)}</span>
            <ArrowSquareOut size={18} />
          </a>
        </aside>

        <section className="board-stage">
          <div className="board-meta">
            <span>{hasGame ? `GAME ID // ${game.gameId || "ENDED"}` : "SYSTEM // STANDBY"}</span>
            <span>{game.pending > 0 ? `SYNCING // ${game.pending} MOVES` : "CHAIN // SYNCED"}</span>
          </div>
          <div className="board-wrap">
            <Board board={activeBoard} disabled={controlsDisabled} shakeKey={game.shakeKey} onMove={game.move} />
            {!hasGame && (
              <div className="board-gate">
                {!game.isConnected && <><h2>连接主钱包</h2><p>授权限时会话后即可开始，每步移动不再弹窗。</p></>}
                {game.isConnected && game.status === "error" && <><h2>链上状态读取失败</h2><p>{game.error ?? "暂时无法确认合约和会话状态。"}</p><button className="button button-primary" type="button" onClick={game.refreshSession}>重新检测</button></>}
                {game.isConnected && game.status !== "error" && game.contractPaused && <><h2>合约已紧急暂停</h2><p>可继续撤销会话或取回预存，暂时不能开局和移动。</p></>}
                {game.isConnected && game.status !== "error" && !game.contractPaused && !game.authorized && <><h2>授权 24 小时会话</h2><p>密钥仅驻留当前页面内存，本次预存 {game.topUpAmount || "0"} MON。</p><button className="button button-primary" type="button" onClick={game.authorize}><ShieldCheck size={18} />授权并预存 Gas</button></>}
                {game.isConnected && game.status !== "error" && !game.contractPaused && game.authorized && <><h2>{game.hasGasBalance ? "2048 已经准备好" : "需要补充 MON"}</h2><p>{game.hasGasBalance ? "新游戏由登录钱包确认，后续移动保持静默。" : "补充会话燃料后即可连续移动。"}</p><button className="button button-primary" type="button" disabled={game.status === "starting" || game.funding} onClick={game.hasGasBalance ? game.startGame : game.fundGameGas}><Drop size={18} />{game.funding ? "正在补充" : game.status === "starting" ? "正在创建" : game.hasGasBalance ? "开始 2048" : `补充 ${game.topUpAmount || "0"} MON`}</button></>}
              </div>
            )}
          </div>
          {game.over && <GameOverOverlay score={game.score} highScore={game.highScore} onRestart={game.startGame} />}
        </section>

        <aside className="right-rail">
          <Controls disabled={controlsDisabled} onMove={game.move} />

          <section className="session-panel">
            <div className="panel-title">
              <span>会话钱包</span>
              <strong className={game.authorized ? "status-ok" : "status-wait"}>{game.authorized ? "已授权" : "待授权"}</strong>
            </div>
            <button className="session-address" type="button" onClick={copySessionAddress} disabled={!game.sessionAddress}>
              <span>{shortAddress(game.sessionAddress)}</span>
              {copied ? <Check size={17} /> : <Copy size={17} />}
            </button>
            {game.sponsorshipSupported && <><div className="balance-row"><span>登录钱包预存</span><strong>{game.gasBalanceLabel} MON</strong></div><div className="balance-row"><span>会话剩余限额</span><strong>{game.refundRemainingLabel} MON</strong></div></>}
            <div className="balance-row"><span>会话垫资</span><strong>{game.sessionBalanceLabel} MON</strong></div>
            <div className="balance-row"><span>授权到期</span><strong>{game.sessionExpiryLabel}</strong></div>
            {game.lowBalance && game.isConnected && (
              <div className="balance-warning">
                <Warning size={18} />
                <p>会话返还额度或垫资偏低，建议用登录钱包补充。</p>
              </div>
            )}
            <label className="gas-amount-field">
              <span>本次预存</span>
              <div>
                <input
                  type="number"
                  inputMode="decimal"
                  min="1"
                  max={game.maxSessionRefundLabel}
                  step="0.1"
                  value={game.topUpAmount}
                  onChange={(event) => game.setTopUpAmount(event.target.value)}
                  aria-label="本次预存 MON 数量"
                />
                <strong>MON</strong>
              </div>
              <small>可输入 1–{game.maxSessionRefundLabel} MON</small>
            </label>
            {game.sponsorshipSupported ? (
              <button className="gas-topup-button" type="button" disabled={game.funding || !game.authorized || game.contractPaused} onClick={game.fundGameGas}>
                <span className="gas-topup-icon"><Lightning size={22} weight="fill" /></span>
                <span className="gas-topup-copy">
                  <strong>{game.funding ? "正在补充 MON" : `补充 ${game.topUpAmount || "0"} MON`}</strong>
                  <small>登录钱包确认 · 扩充移动燃料</small>
                </span>
                <ArrowRight size={19} />
              </button>
            ) : (
              <a className="text-link" href="https://faucet.monad.xyz" target="_blank" rel="noreferrer">打开 Monad 水龙头 <ArrowSquareOut size={15} /></a>
            )}
            <div className="session-actions">
              <button type="button" disabled={!game.hasActiveSession || game.revoking || game.pending > 0} onClick={game.revokeSession}>{game.revoking ? "撤销中…" : "撤销会话"}</button>
              <button type="button" disabled={game.gasBalance === 0n || game.withdrawing || game.pending > 0} onClick={game.withdrawGas}>{game.withdrawing ? "退回中…" : "取回预存"}</button>
            </div>
          </section>

          <section className="settlement-panel">
            <h2>一笔移动如何确认</h2>
            <ol>
              <li><span>本地</span><p>先计算合并结果并更新棋盘。</p></li>
              <li><span>会话</span><p>24 小时过期，每步和总 gas 都有上限。</p></li>
              <li><span>链上</span><p>确定性方块生成，本地与事件精确对账。</p></li>
            </ol>
          </section>
        </aside>
      </main>

      {(game.error || game.notice) && (
        <button className={`toast ${game.error ? "toast-error" : "toast-success"}`} type="button" onClick={game.clearMessage}>
          {game.error ? <Warning size={19} /> : <Check size={19} />}
          <span>{game.error ?? game.notice}</span>
        </button>
      )}
    </div>
  );
}
