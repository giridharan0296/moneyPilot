// Keep one Net Worth "Cash & Bank" asset mirrored for every account.
// Balance comes from the account ledger (opening balance + activity).
// Manual cash assets without linkedAccountId are left alone.

import { useEffect } from 'react';

import { useSettings } from '../contexts/SettingsContext';
import { useTransactions } from '../contexts/TransactionsContext';
import { useTransfers } from '../contexts/TransfersContext';
import { useNetWorth } from '../contexts/NetWorthContext';
import { computeAccountBalances } from '../lib/accountBalances';
import { lookupRateOrOne } from '../lib/currency';

export default function AccountNetWorthSync() {
  const { accounts, baseCurrency, fxRates, ready: settingsReady } = useSettings();
  const { income, expenses, investments, ready: txReady } = useTransactions();
  const { transfers, ready: transfersReady } = useTransfers();
  const {
    assets,
    liabilities,
    ready: nwReady,
    addAsset,
    updateAsset,
    deleteAsset,
    addLiability,
    updateLiability,
    deleteLiability,
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
      asOf: new Date().toISOString(),
    });

    const linkedByAccount = new Map();
    for (const asset of assets) {
      if (asset?.linkedAccountId) linkedByAccount.set(asset.linkedAccountId, asset);
    }
    const linkedLiabilityByAccount = new Map();
    for (const liability of liabilities) {
      if (liability?.linkedAccountId) linkedLiabilityByAccount.set(liability.linkedAccountId, liability);
    }

    const accountIds = new Set(accounts.map((account) => account.id));

    for (const [accountId, asset] of linkedByAccount) {
      if (!accountIds.has(accountId)) {
        deleteAsset(asset.id);
      }
    }
    for (const [accountId, liability] of linkedLiabilityByAccount) {
      if (!accountIds.has(accountId)) deleteLiability(liability.id);
    }

    for (const account of accounts) {
      const rawBalance = Number(balances.get(account.id)) || 0;
      const balance = Math.max(0, rawBalance);
      const overdraft = Math.max(0, -rawBalance);
      const name = `${account.emoji ? `${account.emoji} ` : ''}${account.label}`.trim();
      const currency = account.currency ?? null;
      const rate = lookupRateOrOne(fxRates, currency ?? baseCurrency, baseCurrency);
      const isForeign = currency && currency !== baseCurrency;
      const valueInBase = isForeign ? balance * rate : null;
      const outstandingInBase = isForeign ? overdraft * rate : null;
      const existing = linkedByAccount.get(account.id);
      const existingLiability = linkedLiabilityByAccount.get(account.id);

      if (overdraft > 0) {
        if (existing) deleteAsset(existing.id);
        if (!existingLiability) {
          addLiability({
            name: `${name} overdraft`,
            categoryId: 'other_liab',
            outstanding: overdraft,
            note: 'Synced from negative account balance',
            currency,
            outstandingInBase,
            fxRate: isForeign ? rate : null,
            linkedAccountId: account.id,
          });
        } else {
          const overdraftName = `${name} overdraft`;
          const overdraftFxRate = isForeign ? rate : null;
          const needsLiabilityUpdate =
            Number(existingLiability.outstanding) !== overdraft
            || existingLiability.name !== overdraftName
            || (existingLiability.currency ?? null) !== currency
            || (existingLiability.outstandingInBase ?? null) !== outstandingInBase
            || (existingLiability.fxRate ?? null) !== overdraftFxRate
            || existingLiability.categoryId !== 'other_liab'
            || existingLiability.linkedAccountId !== account.id;

          if (needsLiabilityUpdate) {
            updateLiability(existingLiability.id, {
              name: overdraftName,
              outstanding: overdraft,
              currency,
              categoryId: 'other_liab',
              linkedAccountId: account.id,
              outstandingInBase,
              fxRate: overdraftFxRate,
            });
          }
        }
        continue;
      }

      if (existingLiability) deleteLiability(existingLiability.id);

      if (!existing) {
        addAsset({
          name,
          categoryId: 'cash',
          value: balance,
          note: 'Synced from account balance',
          currency,
          valueInBase,
          fxRate: isForeign ? rate : null,
          linkedAccountId: account.id,
        });
        continue;
      }

      const nextName = name || existing.name;
      const needsUpdate =
        Number(existing.value) !== balance
        || existing.name !== nextName
        || (existing.currency ?? null) !== currency
        || (existing.valueInBase ?? null) !== valueInBase
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
          valueInBase,
          fxRate: isForeign ? rate : null,
        });
      }
    }
  }, [
    ready,
    accounts,
    baseCurrency,
    fxRates,
    income,
    expenses,
    investments,
    transfers,
    assets,
    liabilities,
    addAsset,
    updateAsset,
    deleteAsset,
    addLiability,
    updateLiability,
    deleteLiability,
  ]);

  return null;
}
