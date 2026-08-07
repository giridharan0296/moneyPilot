// Keep one Net Worth "Cash & Bank" asset mirrored for every account.
// Balance comes from the account ledger (opening balance + activity).
// Manual cash assets without linkedAccountId are left alone.

import { useEffect } from 'react';

import { useSettings } from '../contexts/SettingsContext';
import { useTransactions } from '../contexts/TransactionsContext';
import { useTransfers } from '../contexts/TransfersContext';
import { useNetWorth } from '../contexts/NetWorthContext';
import { computeAccountBalances } from '../lib/accountBalances';

export default function AccountNetWorthSync() {
  const { accounts, ready: settingsReady } = useSettings();
  const { income, expenses, investments, ready: txReady } = useTransactions();
  const { transfers, ready: transfersReady } = useTransfers();
  const {
    assets,
    ready: nwReady,
    addAsset,
    updateAsset,
    deleteAsset,
  } = useNetWorth();

  const ready = settingsReady && txReady && transfersReady && nwReady;

  useEffect(() => {
    if (!ready) return;

    const balances = computeAccountBalances({
      accounts,
      income,
      expenses,
      investments,
      transfers,
    });

    const linkedByAccount = new Map();
    for (const asset of assets) {
      if (asset?.linkedAccountId) linkedByAccount.set(asset.linkedAccountId, asset);
    }

    const accountIds = new Set(accounts.map((account) => account.id));

    for (const [accountId, asset] of linkedByAccount) {
      if (!accountIds.has(accountId)) {
        deleteAsset(asset.id);
      }
    }

    for (const account of accounts) {
      const balance = Math.max(0, Number(balances.get(account.id)) || 0);
      const name = `${account.emoji ? `${account.emoji} ` : ''}${account.label}`.trim();
      const currency = account.currency ?? null;
      const existing = linkedByAccount.get(account.id);

      if (!existing) {
        addAsset({
          name,
          categoryId: 'cash',
          value: balance,
          note: 'Synced from account balance',
          currency,
          linkedAccountId: account.id,
        });
        continue;
      }

      const nextName = name || existing.name;
      const needsUpdate =
        Number(existing.value) !== balance
        || existing.name !== nextName
        || (existing.currency ?? null) !== currency
        || existing.categoryId !== 'cash'
        || existing.linkedAccountId !== account.id;

      if (needsUpdate) {
        updateAsset(existing.id, {
          name: nextName,
          value: balance,
          currency,
          categoryId: 'cash',
          note: existing.note || 'Synced from account balance',
          linkedAccountId: account.id,
          valueInBase: null,
          fxRate: null,
        });
      }
    }
  }, [
    ready,
    accounts,
    income,
    expenses,
    investments,
    transfers,
    assets,
    addAsset,
    updateAsset,
    deleteAsset,
  ]);

  return null;
}
