# Sample CSVs for Import

Three ready-to-import sample files, one per transaction type. Use them to see
the format, test the importer, or as a starting template for your own data.

| File | Rows | Purpose |
|---|---|---|
| `transactions_expenses_sample.csv` | 15 | Rent, groceries, fuel, bills, shopping, restaurant, subscriptions |
| `transactions_income_sample.csv` | 8 | Employment, business, investment income, refund, gift, cashback |
| `transactions_investments_sample.csv` | 8 | MF SIPs, stocks, FD, ELSS, SGB, crypto |

---

## How to import

1. Open the app → **Tools** → **Import Transactions**
2. Pick which type (Expense / Income / Investment) — the importer scopes to
   that list, so **use the matching sample file**
3. Tap **Pick file** and choose one of the CSVs
4. The importer auto-detects the columns from the headers — you'll see the
   mapping already filled in
5. Review the preview, then tap **Import** — you'll see a "Matched X of Y"
   summary before commit

---

## Column format

Only **Date** and **Amount** are required. Everything else is optional. Column
names are matched flexibly (case-insensitive, common synonyms):

| Column | Required | Accepted headers | Notes |
|---|---|---|---|
| Date | ✅ | `Date`, `Time`, `When` | See "Date formats" below |
| Amount | ✅ | `Amount`, `Value`, `Sum`, `Debit`, `Credit`, `Price` | Positive number; sign is stripped |
| Category | ⬜ | `Category` | Must match the label of a category YOU have (case-insensitive) |
| Sub Category | ⬜ | `Sub Category`, `Subcategory`, `Subtype` | Must belong to the row's matched category |
| Account | ⬜ | `Account`, `Wallet`, `Source` | Must match one of YOUR account labels |
| Note | ⬜ | `Note`, `Description`, `Narration`, `Memo`, `Remark` | Free text |
| Tags | ⬜ | `Tags`, `Labels` | Semicolon (`;`) or comma-separated. Max 8 tags |

If a row's category / sub-category / account **doesn't match** what you have
in the app, the importer falls back to the defaults you pick in step 3.
The importer tells you which values didn't match so you can either add them
first (in Settings) or accept the fallback.

---

## Category names in the samples

The samples use the app's **default category labels** so they import cleanly
on a fresh install. If you've renamed any category (e.g. changed "Food" to
"F&B"), edit the corresponding cells before importing, or accept the
fallback.

Default categories used:
- **Expenses**: Food, Transport, Shopping, Bills, Health, Fun, Other
- **Income**: Employment Income, Business Income, Investment Income, Rental
  Income, Pension & Benefits, Gift, Refund, Other
- **Investments**: Stocks, Mutual Funds, Crypto, Precious Metals, Bank
  Deposits, Real Estate, ETFs, Bonds & Fixed Income, Government Savings,
  Retirement, Derivatives, Insurance Investments, Alternative Investments

---

## Account column

The samples all use `Cash` because that's the only default account seeded on
a fresh install. If you have other accounts (HDFC Savings, ICICI, Paytm,
etc.), change the `Account` column to match their exact labels.

---

## Date formats

All of these work — pick whichever your source system exports:

| Format | Example | Notes |
|---|---|---|
| ISO | `2026-07-15` | Recommended; unambiguous |
| DD/MM/YYYY | `15/07/2026` | Indian convention (default when ambiguous) |
| DD-MM-YYYY | `15-07-2026` | Same as above |
| DD-MMM-YYYY | `15-Jul-2026` | Month names work in any case |
| MMM DD, YYYY | `Jul 15, 2026` | US-style also accepted |
| ISO 8601 with time | `2026-07-15T10:30:00Z` | Time part is preserved |

Invalid dates (e.g. `31/02/2026` or `13/13/2026`) are skipped with a clear
error, not silently rolled over to the wrong day.

---

## Tags

The `Tags` column accepts both semicolons and commas. Both of these work:

```
housing;monthly;rent
housing,monthly,rent
```

Tags are trimmed, deduped case-insensitively, and capped at 8 per row.

---

## Tips

- **Amounts are always positive.** The row's type (expense/income/investment
  — determined by which importer you're using) provides the sign. You don't
  need `-` for expenses.
- **You can re-import the same file safely** — each import gets a unique
  batch ID so re-importing creates new rows (it won't dedupe). If you want
  to reset, delete the previous batch first.
- **Test with a small file first** if you have hundreds of rows — get the
  column mapping and category matching right on a 5-row sample, then
  import the full file.
