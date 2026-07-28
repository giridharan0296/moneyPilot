# Marketing screenshots

Phone-frame PNGs (420×920 @2x) captured from the Expo web app with **Load demo data**.

## Folders

| Path | Theme |
|------|--------|
| `marketing-screenshots/` | Light |
| `marketing-screenshots/dark/` | Dark |

## How to regenerate

```bash
# Terminal 1
npm run web

# Terminal 2 — light
npm run screenshots:marketing

# Terminal 2 — dark
npm run screenshots:marketing:dark
```

## Contents (both themes)

| File | Screen |
|------|--------|
| `01-dashboard.png` | Home / Dashboard |
| `02-dashboard-spend-chart.png` | Spend-over-time chart |
| `03-transactions-expense.png` | Expenses |
| `04-transactions-income.png` | Income |
| `05-investments.png` | Investments + donut |
| `06-portfolio.png` | Broker portfolio |
| `07-net-worth.png` | Net worth |
| `08-ai-insights.png` | AI Insights (off until API key) |
| `09-cash-flow.png` / `09b-reports.png` | Cash flow / Reports |
| `10`–`24-*.png` | Search, Budgets, Loans, Goals, Recurring, Transfers, Imports, Calculators, Fundamentals, Settings, Categories |

## Notes

- Demo dataset replaces local data while capturing (Backup first on a real device).
- **AI Insights** stays empty until an API key is configured in Settings.
- **Stock Fundamentals** live quote may be blank on web (CORS).
