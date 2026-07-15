import { useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { ArrowsClockwise, Plug, SignOut, Wallet } from "@phosphor-icons/react";
import { monadTestnet } from "../config/chain";
import { shortAddress } from "../lib/session";

export function ConnectBar({
  address,
  chainId,
  isConnected,
}: {
  address?: string;
  chainId?: number;
  isConnected: boolean;
}) {
  const { connectors, connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const wrongNetwork = isConnected && chainId !== monadTestnet.id;

  if (!isConnected) {
    return (
      <button className="button button-primary connect-button" type="button" disabled={isPending} onClick={() => connect({ connector: connectors[0] })}>
        <Wallet size={18} />
        {isPending ? "正在连接" : "连接钱包"}
      </button>
    );
  }

  if (wrongNetwork) {
    return (
      <button className="button button-primary connect-button" type="button" disabled={isSwitching} onClick={() => switchChain({ chainId: monadTestnet.id })}>
        <ArrowsClockwise size={18} />
        {isSwitching ? "正在切换" : "切换到 Monad"}
      </button>
    );
  }

  return (
    <div className="wallet-connected">
      <Plug size={16} weight="fill" />
      <span>{shortAddress(address)}</span>
      <button type="button" onClick={() => disconnect()} aria-label="断开钱包">
        <SignOut size={17} />
      </button>
    </div>
  );
}
