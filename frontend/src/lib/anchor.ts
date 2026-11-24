
import {
  AnchorProvider,
  Program,
  type Idl,
} from "@coral-xyz/anchor";

import {
  PublicKey,
  type Connection,
} from "@solana/web3.js";

import type { AnchorWallet } from "@solana/wallet-adapter-react";

import idl from "@/idl.json";

// Program ID смарт-контракта Жанель
export const PROGRAM_ID = new PublicKey(
  "Gu7xt63mKXHKhs5vrnkGo44E5fkGCDw2upWwjbtBeJSo"
);

// Подключение к смарт-контракту
export function getInvoiceProgram(
  connection: Connection,
  wallet: AnchorWallet
) {
  const provider = new AnchorProvider(
    connection,
    wallet,
    {
      commitment: "confirmed",
    }
  );

  return new Program(
    idl as unknown as Idl,
    PROGRAM_ID,
    provider
  );
}
