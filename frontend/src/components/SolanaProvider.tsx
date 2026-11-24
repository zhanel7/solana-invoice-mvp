
"use client";

import { useMemo, type ReactNode } from "react";

import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";

import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";

import { WalletAdapterNetwork } from "@solana/wallet-adapter-base";

import { clusterApiUrl } from "@solana/web3.js";

export default function SolanaProvider({
  children,
}: {
  children: ReactNode;
}) {
  const endpoint = useMemo(
    () => clusterApiUrl(WalletAdapterNetwork.Devnet),
    []
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={[]} autoConnect>
        <WalletModalProvider>
          {children}
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
