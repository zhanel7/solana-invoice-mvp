"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { BN } from "@coral-xyz/anchor";
import { useAnchorWallet, useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { getInvoiceProgram, PROGRAM_ID } from "@/lib/anchor";

// The wallet button reads browser extension state. Do not server-render it.
const WalletMultiButton = dynamic(
  () =>
    import("@solana/wallet-adapter-react-ui").then(
      (module) => module.WalletMultiButton
    ),
  { ssr: false }
);

const LAMPORTS_PER_SOL = new BN("1000000000");

type InvoiceOnChain = {
  merchant: PublicKey;
  amount: BN;
  orderId: string;
  isPaid: boolean;
};

type InvoiceView = {
  address: string;
  merchant: string;
  orderId: string;
  amountSol: string;
  isPaid: boolean;
};

function toLamports(input: string): BN {
  const normalized = input.trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,9})?$/.test(normalized)) {
    throw new Error("Введите положительную сумму SOL (не более 9 знаков после запятой).");
  }
  const [whole, fraction = ""] = normalized.split(".");
  const result = new BN(whole)
    .mul(LAMPORTS_PER_SOL)
    .add(new BN(fraction.padEnd(9, "0") || "0"));
  if (result.isZero() || result.bitLength() > 64) {
    throw new Error("Сумма должна быть больше нуля и помещаться в u64.");
  }
  return result;
}

function fromLamports(value: BN): string {
  const whole = value.div(LAMPORTS_PER_SOL).toString();
  const decimals = value
    .mod(LAMPORTS_PER_SOL)
    .toString()
    .padStart(9, "0")
    .replace(/0+$/, "");
  return decimals ? `${whole}.${decimals}` : whole;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function Home() {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const { publicKey } = useWallet();

  const [orderId, setOrderId] = useState("INV-101");
  const [amountSol, setAmountSol] = useState("0.05");
  const [invoiceAddress, setInvoiceAddress] = useState("");
  const [invoice, setInvoice] = useState<InvoiceView | null>(null);
  const [status, setStatus] = useState("Подключите кошелёк и создайте или загрузите счёт.");
  const [transaction, setTransaction] = useState("");
  const [busy, setBusy] = useState(false);

  async function fetchInvoice(address: string): Promise<InvoiceView> {
    if (!wallet) throw new Error("Сначала подключите Phantom или Solflare.");
    const pda = new PublicKey(address.trim());
    const info = await connection.getAccountInfo(pda, "confirmed");
    if (!info) throw new Error("Счёт не найден в Solana Devnet.");
    if (!info.owner.equals(PROGRAM_ID)) {
      throw new Error("Этот адрес не принадлежит программе Solana Invoice Gateway.");
    }

    const program = getInvoiceProgram(connection, wallet);
    const data = (await program.account.invoice.fetch(pda)) as InvoiceOnChain;
    return {
      address: pda.toBase58(),
      merchant: data.merchant.toBase58(),
      orderId: data.orderId,
      amountSol: fromLamports(data.amount),
      isPaid: data.isPaid,
    };
  }

  async function createInvoice() {
    if (!wallet || !publicKey) {
      setStatus("Сначала подключите кошелёк.");
      return;
    }

    setBusy(true);
    setTransaction("");
    try {
      const cleanOrderId = orderId.trim();
      const orderBytes = new TextEncoder().encode(cleanOrderId);
      if (orderBytes.length === 0 || orderBytes.length > 32) {
        throw new Error("Order ID должен содержать от 1 до 32 байт UTF-8.");
      }

      const lamports = toLamports(amountSol);
      const programInfo = await connection.getAccountInfo(PROGRAM_ID, "confirmed");
      if (!programInfo?.executable) {
        throw new Error("Смарт-контракт пока не найден в Devnet. Попросите Жанель проверить деплой и Program ID.");
      }

      const [pda] = PublicKey.findProgramAddressSync(
        [new TextEncoder().encode("invoice"), publicKey.toBytes(), orderBytes],
        PROGRAM_ID
      );

      setStatus("Подтвердите создание счёта в кошельке...");
      const program = getInvoiceProgram(connection, wallet);
      const signature = await program.methods
        .createInvoice(lamports, cleanOrderId)
        .accounts({
          invoice: pda,
          merchant: publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      setTransaction(signature);
      setInvoiceAddress(pda.toBase58());
      setInvoice({
        address: pda.toBase58(),
        merchant: publicKey.toBase58(),
        orderId: cleanOrderId,
        amountSol: fromLamports(lamports),
        isPaid: false,
      });
      setStatus("Транзакция создания отправлена и подтверждена. Счёт ожидает оплаты.");
    } catch (error) {
      setStatus(`Не удалось создать счёт: ${describeError(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function loadInvoice() {
    setBusy(true);
    try {
      const loaded = await fetchInvoice(invoiceAddress);
      setInvoice(loaded);
      setStatus(loaded.isPaid ? "Счёт уже оплачен." : "Счёт найден в Devnet, можно оплачивать.");
    } catch (error) {
      setInvoice(null);
      setStatus(`Не удалось загрузить счёт: ${describeError(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function payInvoice() {
    if (!wallet || !publicKey || !invoice) {
      setStatus("Подключите кошелёк и загрузите счёт.");
      return;
    }

    setBusy(true);
    setTransaction("");
    try {
      // Always re-read the actual blockchain amount and merchant before payment.
      const current = await fetchInvoice(invoice.address);
      setInvoice(current);
      if (current.isPaid) throw new Error("Этот счёт уже оплачен.");
      if (publicKey.toBase58() === current.merchant) {
        throw new Error("Для проверки оплаты подключите кошелёк покупателя, отличный от продавца.");
      }

      setStatus(`Подтвердите оплату ${current.amountSol} SOL в кошельке...`);
      const program = getInvoiceProgram(connection, wallet);
      const signature = await program.methods
        .payInvoice()
        .accounts({
          invoice: new PublicKey(current.address),
          payer: publicKey,
          merchant: new PublicKey(current.merchant),
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      setTransaction(signature);
      setStatus("Транзакция оплаты подтверждена. Проверяем состояние счёта...");
      try {
        const refreshed = await fetchInvoice(current.address);
        setInvoice(refreshed);
        setStatus(
          refreshed.isPaid
            ? "Оплачено! Статус подтверждён данными блокчейна."
            : "Транзакция подтверждена, но статус ещё не обновился. Нажмите «Загрузить счёт»."
        );
      } catch {
        setStatus("Транзакция подтверждена. Проверьте её в Explorer и обновите счёт.");
      }
    } catch (error) {
      setStatus(`Ошибка оплаты: ${describeError(error)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#080B14] text-white">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <header className="flex flex-wrap items-center justify-between gap-5 border-b border-white/10 pb-7">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-purple-500 to-emerald-400 text-xl font-bold">
              S
            </div>
            <div>
              <h1 className="text-xl font-bold">Solana Invoice Gateway</h1>
              <p className="text-sm text-slate-400">Decentralized Payment Infrastructure</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <span className="rounded-full border border-purple-500/30 bg-purple-500/10 px-4 py-2 text-sm text-purple-300">
              ● Solana Devnet
            </span>
            <WalletMultiButton />
          </div>
        </header>

        <section className="pb-10 pt-14">
          <div className="mb-5 inline-block rounded-full border border-emerald-500/20 bg-emerald-500/10 px-4 py-2 text-xs font-medium text-emerald-400">
            WEB3 PAYMENT GATEWAY
          </div>
          <h2 className="max-w-2xl text-4xl font-bold tracking-tight md:text-5xl">
            Crypto payments.
            <br />
            <span className="bg-gradient-to-r from-purple-400 to-emerald-400 bg-clip-text text-transparent">
              Made simple.
            </span>
          </h2>
          <p className="mt-5 max-w-xl text-slate-400">
            Create and manage decentralized invoices on Solana. Secure, transparent and powered by blockchain.
          </p>
        </section>

        <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-[#111625] p-7">
            <div className="mb-8">
              <span className="text-sm font-medium text-purple-400">01 / MERCHANT</span>
              <h3 className="mt-2 text-2xl font-semibold">Create Invoice</h3>
              <p className="mt-2 text-sm text-slate-400">Generate a new on-chain payment request.</p>
            </div>
            <div className="space-y-5">
              <div>
                <label htmlFor="orderId" className="mb-2 block text-sm text-slate-300">Order ID</label>
                <input
                  id="orderId"
                  value={orderId}
                  maxLength={32}
                  onChange={(event) => setOrderId(event.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-[#080B14] px-4 py-3 outline-none focus:border-purple-500"
                  placeholder="INV-101"
                />
              </div>
              <div>
                <label htmlFor="amount" className="mb-2 block text-sm text-slate-300">Amount (SOL)</label>
                <input
                  id="amount"
                  type="text"
                  inputMode="decimal"
                  value={amountSol}
                  onChange={(event) => setAmountSol(event.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-[#080B14] px-4 py-3 outline-none focus:border-purple-500"
                  placeholder="0.05"
                />
              </div>
              <button
                type="button"
                onClick={createInvoice}
                disabled={busy}
                className="mt-3 w-full rounded-xl bg-purple-600 py-3.5 font-semibold hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? "Processing..." : "Create Invoice"}
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-[#111625] p-7">
            <div className="mb-8">
              <span className="text-sm font-medium text-emerald-400">02 / CUSTOMER</span>
              <h3 className="mt-2 text-2xl font-semibold">Pay Invoice</h3>
              <p className="mt-2 text-sm text-slate-400">Load an invoice by PDA and pay from another wallet.</p>
            </div>
            <label htmlFor="invoicePda" className="mb-2 block text-sm text-slate-300">Invoice PDA</label>
            <div className="mb-5 flex flex-col gap-3 sm:flex-row">
              <input
                id="invoicePda"
                value={invoiceAddress}
                onChange={(event) => {
                  setInvoiceAddress(event.target.value);
                  setInvoice(null);
                }}
                className="min-w-0 flex-1 rounded-xl border border-white/10 bg-[#080B14] px-4 py-3 text-sm outline-none focus:border-emerald-500"
                placeholder="Paste invoice PDA"
              />
              <button
                type="button"
                onClick={loadInvoice}
                disabled={busy || !invoiceAddress.trim()}
                className="rounded-xl border border-emerald-500/40 px-4 py-3 text-sm font-semibold text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50"
              >
                Load
              </button>
            </div>
            <div className="space-y-4 rounded-xl border border-white/5 bg-[#080B14] p-5 text-sm">
              <div className="flex flex-wrap justify-between gap-4">
                <span className="text-slate-400">Invoice</span>
                <span>{invoice?.orderId || "Not loaded"}</span>
              </div>
              <div className="flex flex-wrap justify-between gap-4">
                <span className="text-slate-400">Network</span><span>Solana Devnet</span>
              </div>
              <div className="flex flex-wrap justify-between gap-4">
                <span className="text-slate-400">Status</span>
                <span className={invoice?.isPaid ? "font-semibold text-emerald-400" : "text-amber-400"}>
                  {invoice ? (invoice.isPaid ? "PAID" : "UNPAID") : "Not loaded"}
                </span>
              </div>
              {invoice && (
                <div className="break-all text-xs text-slate-400">
                  Merchant: {invoice.merchant}
                </div>
              )}
              <div className="border-t border-white/10 pt-4">
                <p className="text-slate-400">Total amount (from blockchain)</p>
                <p className="mt-2 text-3xl font-bold">{invoice?.amountSol || "—"} SOL</p>
              </div>
            </div>
            <button
              type="button"
              onClick={payInvoice}
              disabled={busy || !invoice || invoice.isPaid}
              className="mt-5 w-full rounded-xl bg-emerald-600 py-3.5 font-semibold hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {invoice?.isPaid ? "Invoice Paid" : "Pay Invoice"}
            </button>
          </div>
        </section>

        <section className="mt-6 rounded-xl border border-white/10 bg-[#111625] p-5">
          <p className="text-sm font-medium">Transaction status</p>
          <p role="status" aria-live="polite" className="mt-2 break-words text-sm text-slate-300">
            {status}
          </p>
          {invoice && (
            <div className="mt-3 break-all text-xs text-slate-400">
              Invoice PDA: {invoice.address}
              <button
                type="button"
                className="ml-3 text-emerald-400 underline"
                onClick={() => navigator.clipboard.writeText(invoice.address)}
              >
                Copy PDA
              </button>
            </div>
          )}
          {transaction && (
            <a
              className="mt-3 inline-block break-all text-sm text-emerald-400 underline"
              href={`https://explorer.solana.com/tx/${transaction}?cluster=devnet`}
              target="_blank"
              rel="noreferrer"
            >
              View transaction in Solana Explorer
            </a>
          )}
        </section>

        <footer className="mt-12 border-t border-white/10 py-6 text-center text-xs text-slate-500">
          Solana Invoice Gateway · Capstone Project · Devnet
        </footer>
      </div>
    </main>
  );
}
