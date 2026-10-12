# WelthWise — AI-Powered Personal Finance & Split Expense Platform

> A full-stack, production-grade personal finance application built with **Next.js 15**, **React 19**, **Prisma**, **PostgreSQL (Supabase)**, **Clerk Auth**, **Google Gemini AI**, **Inngest**, and **Resend**. It combines personal budgeting, transaction tracking, AI-powered receipt scanning, and a Splitwise-style group expense splitting system into one unified platform.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack — What & Why](#2-tech-stack--what--why)
3. [Architecture — High Level Design (HLD)](#3-architecture--high-level-design-hld)
4. [Database Design (Schema)](#4-database-design-schema)
5. [Feature Breakdown — Every Feature Explained](#5-feature-breakdown--every-feature-explained)
6. [Background Jobs & Automation](#6-background-jobs--automation)
7. [Security & Rate Limiting](#7-security--rate-limiting)
8. [Money & Precision Handling](#8-money--precision-handling)
9. [File Storage (Receipts)](#9-file-storage-receipts)
10. [Email System](#10-email-system)
11. [Scaling & Future Architecture](#11-scaling--future-architecture)
12. [Folder Structure](#12-folder-structure)
13. [Interview Q&A — 60 Questions with Answers](#13-interview-qa--60-questions-with-answers)

---

## 1. Project Overview

**WelthWise** is a full-stack fintech web application that helps users:

- **Track personal income & expenses** across multiple accounts (Savings, Current)
- **Set monthly budgets** and get email alerts when spending crosses 80%
- **Scan receipts with AI** (Google Gemini) to auto-fill transaction forms
- **Split expenses** with friends and groups (like Splitwise) with 6 different split methods
- **Settle debts** with a simplified payment plan algorithm
- **Get monthly financial reports** with AI-generated insights via email
- **Manage recurring transactions** (personal + shared) that auto-generate daily
- **Upload and store receipts** securely in Supabase Storage with signed URLs
- **Receive in-app and email notifications** for friend requests, expenses, settlements, etc.

The app is designed for the **Indian market** (default currency INR, ₹ symbol) but supports multi-currency (USD, EUR, GBP) with exchange rate tracking.

---

## 2. Tech Stack — What & Why

### Frontend

| Technology | Why We Used It |
|---|---|
| **Next.js 15 (App Router)** | Server-side rendering (SSR) for SEO, Server Components for zero-JS on the client, built-in API routes, and Server Actions for direct server mutations without REST APIs |
| **React 19** | Latest React with concurrent features, Suspense for loading states, and improved performance |
| **Tailwind CSS v4** | Utility-first CSS for rapid UI development, responsive design without writing custom CSS |
| **Radix UI** | Headless, accessible UI primitives (Dialog, Select, Dropdown, Tooltip, Switch, Checkbox, Popover, Progress) — handles ARIA and keyboard navigation out of the box |
| **Recharts** | Declarative charting library for React — used for spending analytics charts on the dashboard |
| **Lucide React** | Beautiful, consistent icon library (lightweight alternative to FontAwesome) |
| **React Hook Form + Zod** | Form handling with schema-based validation — type-safe, performant (no re-renders on every keystroke) |
| **Sonner** | Toast notifications with rich styling — used for success/error messages |
| **next-themes** | Dark/light mode support |
| **react-day-picker** | Date picker component for transaction and expense forms |
| **react-spinners** | Loading spinner components |
| **Vaul** | Drawer component (mobile-friendly bottom sheet for account creation) |

### Backend

| Technology | Why We Used It |
|---|---|
| **Next.js Server Actions** | Direct server-side mutations from components — no REST API boilerplate. The `"use server"` directive turns functions into secure server endpoints |
| **Prisma ORM** | Type-safe database access with auto-generated client, migrations, and excellent DX. Handles Decimal types for money safely |
| **PostgreSQL (Supabase)** | Robust relational database for financial data — ACID transactions ensure money is never lost. Supabase provides managed hosting with connection pooling |
| **Clerk** | Complete authentication — sign-up, sign-in, OAuth, session management, user profiles. Zero custom auth code needed |
| **Google Gemini AI** | Powers two AI features: (1) receipt scanning — extracts amount, date, category from receipt photos; (2) monthly insights — generates personalized financial advice |
| **Inngest** | Serverless background job orchestration — runs cron jobs (recurring transactions, budget alerts, monthly reports) with built-in retry, throttling, and observability |
| **Resend** | Transactional email delivery — sends budget alerts and monthly reports with React-based email templates |
| **Arcjet** | Rate limiting — prevents abuse by limiting API calls per user (token bucket algorithm: 10 requests/hour) |
| **Supabase Storage** | Secure file storage for receipt uploads — private bucket with short-lived signed URLs |
| **Decimal.js** | Arbitrary-precision decimal arithmetic — prevents floating-point money bugs (`0.1 + 0.2 ≠ 0.3` in JavaScript) |

### DevDependencies

| Tool | Purpose |
|---|---|
| **TypeScript** | Type safety (mixed JS/TS codebase — layout and config in TS, features in JS) |
| **ESLint** | Code linting with Next.js config |
| **React Email** | Build and preview email templates in React before sending |
| **tw-animate-css** | Animation utilities for Tailwind |

---

## 3. Architecture — High Level Design (HLD)

```
┌─────────────────────────────────────────────────────────────┐
│                        CLIENT (Browser)                     │
│                                                             │
│  Next.js App Router  ←→  React 19 Server + Client Components│
│  Tailwind CSS + Radix UI + Recharts + React Hook Form       │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────┐     │
│  │ Landing Page  │  │  Dashboard   │  │  Split Module  │     │
│  │ (SSR / Static)│  │ (SSR + CSR)  │  │  (SSR + CSR)   │     │
│  └──────────────┘  └──────────────┘  └────────────────┘     │
└─────────────────┬───────────────────────────────────────────┘
                  │  Server Actions ("use server")
                  │  No REST API layer needed
                  ▼
┌─────────────────────────────────────────────────────────────┐
│                    SERVER (Next.js Runtime)                  │
│                                                             │
│  ┌──────────────────────────────────────────────────┐       │
│  │              Server Actions Layer                 │       │
│  │  actions/dashboard.js  actions/transaction.js     │       │
│  │  actions/account.js    actions/budget.js           │       │
│  │  actions/split/*.js    actions/send-email.js       │       │
│  └───────┬──────────────┬──────────────┬─────────────┘       │
│          │              │              │                     │
│  ┌───────▼──────┐ ┌────▼────┐  ┌──────▼──────┐             │
│  │   Prisma ORM │ │ Arcjet  │  │  Clerk Auth │             │
│  │  (DB Access) │ │ (Rate   │  │  (Identity) │             │
│  │              │ │ Limit)  │  │             │             │
│  └───────┬──────┘ └─────────┘  └─────────────┘             │
│          │                                                   │
│  ┌───────▼───────────────────────────────────────────┐       │
│  │           Business Logic Layer (lib/)              │       │
│  │  lib/money.js    lib/split/engine.js               │       │
│  │  lib/split/balances.js  lib/split/simplify.js      │       │
│  │  lib/storage.js  lib/format.js  lib/checkUser.js   │       │
│  └───────────────────────────────────────────────────┘       │
└───────────────────┬─────────────────┬───────────────────────┘
                    │                 │
        ┌───────────▼───┐    ┌────────▼────────┐
        │  PostgreSQL   │    │  External APIs   │
        │  (Supabase)   │    │                  │
        │               │    │  • Gemini AI     │
        │  • Users      │    │  • Resend Email  │
        │  • Accounts   │    │  • Supabase      │
        │  • Transactions│    │    Storage       │
        │  • Budgets    │    │  • Clerk         │
        │  • Groups     │    │  • Arcjet        │
        │  • Expenses   │    │                  │
        │  • Settlements│    └──────────────────┘
        │  • Notifications│
        └───────┬───────┘
                │
        ┌───────▼───────┐
        │   Inngest     │
        │  (Background  │
        │   Jobs)       │
        │               │
        │  CRON:        │
        │  • 00:00 daily│
        │    Recurring  │
        │    transactions│
        │  • 01:00 daily│
        │    Recurring  │
        │    shared exp │
        │  • Every 6hrs │
        │    Budget     │
        │    alerts     │
        │  • 1st of     │
        │    month      │
        │    Monthly    │
        │    reports    │
        └───────────────┘
```

### Key Architectural Decisions

1. **No REST API**: Server Actions replace traditional API routes. Functions marked `"use server"` are callable from the client but execute on the server. Simpler, fewer files, type-safe.

2. **SSR-first**: Dashboard, accounts, and split pages are **Server Components** — data is fetched on the server, HTML is sent pre-rendered. No loading spinners for initial page load.

3. **Progressive enhancement with Client Components**: Interactive parts (forms, dropdowns, charts) are `"use client"` components that hydrate after the SSR HTML loads.

4. **Ledger-based balance computation**: Split expense balances are **never stored** in the database. They are **derived** from expenses + splits + settlements every time. This is the source-of-truth pattern — it's impossible for balances to drift out of sync.

5. **Separation of pure logic**: `lib/split/engine.js`, `lib/split/balances.js`, `lib/split/simplify.js` are **pure functions** — no database, no UI, no side effects. This makes them easy to unit test.

---

## 4. Database Design (Schema)

### Entity-Relationship Overview

```
User ─────┬──── Account ──── Transaction
          │
          ├──── Budget
          │
          ├──── Friendship (canonical pair)
          │
          ├──── GroupMember ──── ExpenseGroup
          │                        │
          │                        ├── SharedExpense ──── ExpenseSplit
          │                        │                 ──── ExpenseItem (itemized)
          │                        ├── Settlement
          │                        ├── SharedExpenseActivity
          │                        ├── RecurringSharedExpense
          │                        └── GroupInvite
          │
          └──── Notification
```

### Core Tables (14 Models)

| Model | Purpose |
|---|---|
| **User** | Synced from Clerk. Stores preferences (currency, split method, email notifications) |
| **Account** | Bank accounts (Savings/Current). One user can have many accounts. One is `isDefault` |
| **Transaction** | Income/Expense entries. Links to Account. Supports recurring (daily/weekly/monthly/yearly). Has `isTransfer` flag to exclude shared-expense cash movements from personal analytics |
| **Budget** | One budget per user. Stores monthly limit and last alert timestamp |
| **Friendship** | Stores friend pairs canonically (smaller UUID first) so A→B and B→A cannot both exist. Has `initiatedById` to track who sent the request |
| **ExpenseGroup** | Groups for splitting expenses (like "Flat", "Trip"). Has roles (OWNER/ADMIN/MEMBER). Supports soft-archive |
| **GroupMember** | Membership with join/leave tracking. `leftAt` is set on removal instead of deleting (soft-ended) so historical splits remain explainable |
| **GroupInvite** | Shareable invite links with random tokens, expiry, max uses, and revocation support |
| **SharedExpense** | The core split expense. Can belong to a group OR be a 1:1 friend expense (groupId=null). Supports multi-currency with exchange rate provenance. Soft-deleted (isDeleted) |
| **ExpenseSplit** | Each participant's share of an expense. `shareAmount` is the resolved money value. `shareInput` preserves what the user typed (e.g., 60 for 60%) so edits can round-trip |
| **ExpenseItem** | Line items for itemized splits (e.g., "Pizza ₹500 → Ayush, Rahul") |
| **Settlement** | Money transfer between two users to settle debts. Supports cash, bank transfer, UPI, external methods |
| **RecurringSharedExpense** | Template for recurring shared expenses (e.g., monthly rent). Stores frozen participant weights. Guarded by UNIQUE(recurringId, periodKey) to prevent duplicates |
| **SharedExpenseActivity** | Append-only audit log of all ledger-mutating actions |
| **Notification** | In-app notifications with type, title, body, link, and read status |

### Key Schema Design Decisions

1. **Canonical friendship storage**: Smaller UUID is always `requesterId`. This + unique constraint prevents duplicate friend links.
2. **Soft deletes for expenses**: Hard deleting would orphan past settlements.
3. **`isTransfer` flag on transactions**: Money lent to others or settled is real cash movement but NOT personal consumption. This flag keeps dashboard analytics accurate.
4. **No stored balances**: Balances are computed from the ledger (expenses + splits + settlements). This eliminates sync bugs — the formula is the truth.
5. **`periodKey` on recurring expenses**: Combined with `recurringId`, this UNIQUE constraint makes retried or duplicated cron runs physically unable to create duplicate expenses.

---

## 5. Feature Breakdown — Every Feature Explained

### 5.1 Authentication (Clerk)

- **Sign up / Sign in** via email, Google OAuth, or other providers
- **Middleware protection**: Routes `/dashboard`, `/account`, `/transaction`, `/split` require auth
- **User sync**: `checkUser()` runs on every page load via the Header component. If the Clerk user doesn't exist in our DB, it creates a new User record

### 5.2 Account Management

- Users can create multiple accounts (Savings / Current type)
- Each account tracks its balance (Decimal precision)
- First account is automatically set as default
- Users can switch the default account
- Account balance updates atomically with every transaction via Prisma `$transaction`

### 5.3 Transaction Management

- **Create**: Add income/expense with amount, category, date, description
- **Update**: Edit existing transactions — balance changes are calculated as a net difference
- **Bulk Delete**: Select multiple transactions and delete — balances are recalculated per account
- **Recurring**: Mark any transaction as recurring (daily/weekly/monthly/yearly) — Inngest processes them automatically
- **Categories**: 15+ expense categories (housing, transportation, groceries, etc.) and 4 income categories

### 5.4 AI Receipt Scanning (Google Gemini)

- User uploads a receipt photo
- The image is converted to Base64 and sent to Gemini 3.6 Flash
- Gemini extracts: amount, date, description, merchant name, category
- The extracted data auto-fills the transaction form
- If it's not a receipt, Gemini returns an empty object

### 5.5 Budget Management

- Set a monthly spending limit
- Dashboard shows a progress bar of budget usage
- Every 6 hours, Inngest checks if spending exceeds 80% and sends an email alert (once per month)

### 5.6 Dashboard & Analytics

- **Budget progress bar** with percentage used
- **Split expenses summary** (owed to you / you owe)
- **Transaction overview charts** (Recharts) — income vs. expense trends
- **Account cards** showing balance and transaction count
- All data fetched via `Promise.all()` for parallel loading

### 5.7 Split Expenses (Splitwise-style)

This is the most complex feature — a complete expense-splitting system with 6 split methods.

#### 6 Split Methods

| Method | How It Works | Example |
|---|---|---|
| **EQUAL** | Divide equally among all participants. Leftover minor unit goes to the payer | ₹100 ÷ 3 = ₹33.34 + ₹33.33 + ₹33.33 |
| **EXACT** | Each person enters their exact amount. Must sum to the total | Ayush: ₹50, Rahul: ₹30, Priya: ₹20 = ₹100 |
| **PERCENTAGE** | Enter percentages. Must sum to 100% | 50% + 30% + 20% = 100% |
| **SHARES** | Weight-based. "Rahul counts double" = 2 shares | Shares: 1, 2, 1 → ₹25, ₹50, ₹25 |
| **CUSTOM** | Fixed adjustments on top of an equal base split | ₹3000, Rahul +₹200 → base ₹2800÷3 + adjustments |
| **ITEMIZED** | Line items assigned to specific people. Your share = sum of items you consumed | Pizza(₹500→Ayush,Rahul), Drink(₹100→Priya) |

All methods use the **Hamilton allocation algorithm** (largest remainder) to ensure shares sum to EXACTLY the total — no rounding errors.

#### Groups

- Create expense groups (e.g., "Flat", "Goa Trip")
- Add/remove members with roles (OWNER, ADMIN, MEMBER)
- Share invite links with random tokens, expiry, and max uses
- Archive groups (soft archive)

#### Friends

- Send/accept/reject friend requests
- Canonical storage (smaller UUID first) prevents duplicate links
- 1:1 expenses between friends (no group required)

#### Settlements

- Record payments between users (Cash, UPI, Bank Transfer, External)
- Optionally sync to personal accounts (creates a transfer transaction)
- Activity log tracks all settlements

#### Debt Simplification

- **Minimum cash flow algorithm**: If A owes B ₹500, B owes C ₹500 → simplified to A pays C ₹500 directly
- Reduces number of payments while keeping everyone's net position unchanged
- Shows before/after comparison (e.g., "5 payments simplified to 2")

#### Recurring Shared Expenses

- Create templates (e.g., monthly rent ₹15,000)
- Frozen participant weights stored as JSON
- Inngest cron generates expenses daily at 01:00
- UNIQUE(recurringId, periodKey) prevents duplicate generation

#### Activity Log

- Append-only log of all ledger-mutating actions
- Tracks: group created, member added/removed, expense added/edited/deleted, settlement recorded, recurring created/generated

#### Notifications

- **In-app**: Bell icon with unread count. Types: friend request, group added, expense added, settlement received, etc.
- **Email**: Sent via Resend after the in-app notification is created (best-effort, never blocks the action)

#### Multi-Currency Support

- Default currency INR, supports USD/EUR/GBP
- Exchange rate provenance: stores `originalAmount`, `originalCurrency`, `exchangeRate`, `rateAt`
- Balances computed per currency — ₹100 + $100 never produces ₹200
- Formatted with proper locale (en-IN for INR, en-US for USD, etc.)

### 5.8 Personal-Split Integration

- When a shared expense is created, the payer's personal account is debited (creates a Transaction with `isTransfer=true`)
- Transfer transactions move account balances but are excluded from all personal spending analytics (dashboard charts, budget calculations)
- When a settlement is recorded, it can optionally create debit/credit transactions on personal accounts

---

## 6. Background Jobs & Automation

All background jobs run on **Inngest** — a serverless job orchestration platform.

| Job | Schedule | What It Does |
|---|---|---|
| **triggerRecurringTransactions** | Daily at midnight (00:00) | Finds all personal recurring transactions that are due, sends events to process each one |
| **processRecurringTransaction** | Event-driven (per transaction) | Creates a new transaction copy and updates account balance. Throttled: 10/minute/user |
| **generateRecurringSharedExpenses** | Daily at 01:00 | Generates shared expenses from recurring templates. Idempotent via UNIQUE constraint |
| **checkBudgetAlerts** | Every 6 hours | Checks if any user has exceeded 80% of their budget. Sends email alert (once per month) |
| **generateMonthlyReports** | 1st of each month | Generates per-user monthly financial report with AI insights via Gemini and emails it via Resend |

**Why Inngest?**
- Built-in retry with exponential backoff
- Per-user throttling (prevents one user from hogging resources)
- Cron scheduling without managing infrastructure
- Step-based execution (each step is individually retryable)
- Observable via the Inngest dashboard

---

## 7. Security & Rate Limiting

### Authentication (Clerk Middleware)

```
Protected routes: /dashboard, /account, /transaction, /split
Unauthenticated users → redirected to sign-in page
```

- Every Server Action calls `auth()` to verify the user
- User ID from Clerk is mapped to our DB user via `clerkUserId`

### Rate Limiting (Arcjet)

- **Token bucket algorithm**: 10 requests per hour per user
- Applied to: account creation, transaction creation
- Returns structured error with remaining tokens and reset time
- Fails open (if Arcjet is misconfigured, the app still works)

### Email Security

- `send-email.js` uses `import "server-only"` — it is NOT a `"use server"` action
- This prevents it from being exposed as a callable endpoint (which would be an open relay on the Resend account)

### Receipt Storage Security

- Supabase bucket is **PRIVATE** — no public URLs
- Every read goes through a **signed URL** (10-minute TTL)
- Service-role key is server-side only (`import "server-only"`)

### Input Validation

- All forms validated with **Zod schemas** on both client and server
- Split amounts are re-validated via `validateSplit()` before persisting — never trust the client
- Canonical friendship storage prevents duplicate friend links

---

## 8. Money & Precision Handling

### The Problem

JavaScript floating-point arithmetic is broken for money:

```js
0.1 + 0.2 === 0.30000000000000004  // true, but wrong!
```

Prisma's Decimal type returns objects whose `valueOf()` is a string, so:

```js
0 + new Decimal("100.50") + new Decimal("50.25")  // → "0100.5050.25" (concatenation!)
```

### The Solution: `lib/money.js`

- All monetary calculations go through `toDecimal()`, `add()`, `sub()`, `mul()`, `div()`, `sum()`
- Uses **Decimal.js** with pinned precision (34 digits) for deterministic results
- `allocate()` uses the **Hamilton/largest-remainder algorithm** to distribute amounts with zero rounding error
- `serializeMoney()` converts Decimal values to Numbers for passing across the server/client boundary (Next.js cannot serialize Decimal)
- `checkSum()` is the gate every ledger write passes through — if shares don't sum to the total, the write fails

### Formatting: `lib/format.js`

- Client-safe (no Prisma import) — can be used in Client Components
- `formatMoney(1000, "INR")` → `"₹1,000.00"`
- `formatMoneyCompact(150000)` → `"₹1.5L"` (Indian numbering)
- Uses `Intl.NumberFormat` for proper locale-aware formatting

---

## 9. File Storage (Receipts)

```
Upload Flow:
  User → picks file → Server Action → Supabase Storage (private bucket)
                                              ↓
                                      stores path in DB

View Flow:
  Server Component → reads path from DB → creates signed URL (10 min TTL)
                                              ↓
                                      sends signed URL to browser
```

- Bucket name: `receipts`
- `upsert: false` — collisions fail loudly instead of silently overwriting
- Deletion is best-effort — a failed cleanup never blocks the expense edit
- If storage is not configured (missing env vars), upload is disabled and the UI says so

---

## 10. Email System

### Technology: Resend + React Email

Emails are built as **React components** (`emails/template.jsx`) and rendered to HTML by Resend.

### Email Types

| Type | Trigger | Content |
|---|---|---|
| **Monthly Report** | 1st of month (Inngest cron) | Income/expense summary, category breakdown, 3 AI-generated insights from Gemini |
| **Budget Alert** | Every 6 hours when spending > 80% | Budget amount, spent so far, remaining amount |
| **Notification Email** | Split expense events | Friend requests, new expenses, settlements (respects user's `emailNotifications` preference) |

---

## 11. Scaling & Future Architecture

### Current Bottlenecks & How to Scale

| Area | Current | Future Scaling Strategy |
|---|---|---|
| **Database** | Single Supabase Postgres | Read replicas for analytics queries, connection pooling via PgBouncer (already configured via `DATABASE_URL`/`DIRECT_URL` separation) |
| **Background Jobs** | Inngest (serverless) | Already horizontally scalable. Add dead-letter queues for failed jobs |
| **File Storage** | Supabase Storage | CDN layer (Cloudflare) for signed URLs. Move to S3 for higher throughput |
| **Auth** | Clerk (managed) | Already scalable. Add session caching with Redis |
| **Rate Limiting** | Arcjet (per-user) | Add IP-based rate limiting, CAPTCHA for sign-up |
| **AI** | Gemini API (pay-per-call) | Add response caching, batch processing for monthly reports |
| **Email** | Resend (pay-per-email) | Add email queue, bounce handling, unsubscribe management |

### Future Feature Roadmap

1. **Real-time notifications** via WebSockets or Server-Sent Events
2. **Bank account linking** via Plaid/Yodlee for automatic transaction import
3. **Investment tracking** (stocks, mutual funds, crypto)
4. **Goal-based savings** (save ₹50,000 for vacation)
5. **Mobile app** (React Native sharing the same server actions)
6. **Analytics dashboard** with ML-based spending predictions
7. **Multi-tenant** support for family/business accounts
8. **Export to CSV/PDF** for tax filing
9. **Recurring budget categories** (allocate ₹5000/month to groceries)
10. **Payment gateway integration** (Razorpay/Stripe) for in-app settlements

### Architecture at Scale

```
                    ┌─────────────┐
                    │   CDN       │
                    │ (Cloudflare)│
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │ Load Balancer│
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
        ┌─────▼────┐ ┌────▼─────┐ ┌───▼──────┐
        │ Next.js  │ │ Next.js  │ │ Next.js  │
        │ Instance │ │ Instance │ │ Instance │
        └────┬─────┘ └────┬─────┘ └────┬─────┘
             │            │            │
        ┌────▼────────────▼────────────▼────┐
        │         Connection Pooler          │
        │         (PgBouncer)               │
        └────┬──────────────────────┬───────┘
             │                      │
        ┌────▼──────┐         ┌────▼──────┐
        │ Postgres  │         │ Postgres  │
        │ Primary   │────────▶│ Read      │
        │ (Writes)  │  Repl.  │ Replicas  │
        └───────────┘         └───────────┘
             │
        ┌────▼──────┐    ┌──────────────┐
        │  Redis    │    │   Inngest    │
        │ (Cache +  │    │ (Background  │
        │  Sessions)│    │   Jobs)      │
        └───────────┘    └──────────────┘
```

---

## 12. Folder Structure

```
WelthWise/
├── app/                          # Next.js App Router
│   ├── layout.tsx                # Root layout (Clerk provider, header, footer)
│   ├── page.tsx                  # Landing page (hero, features, testimonials)
│   ├── globals.css               # Global styles (Tailwind)
│   ├── not-found.jsx             # 404 page
│   ├── (auth)/                   # Auth route group
│   │   ├── layout.js             # Auth layout (centered)
│   │   ├── sign-in/              # Clerk sign-in page
│   │   └── sign-up/              # Clerk sign-up page
│   ├── (main)/                   # Main app route group
│   │   ├── layout.js             # Main layout (padding, max-width)
│   │   ├── dashboard/            # Dashboard page + components
│   │   ├── account/[id]/         # Account detail page
│   │   ├── transaction/          # Transaction CRUD pages
│   │   └── split/                # Split expenses module
│   │       ├── overview/         # Split dashboard
│   │       ├── groups/           # Group management
│   │       ├── friends/          # Friends management
│   │       ├── expenses/         # Shared expense CRUD
│   │       ├── balances/         # Balance view
│   │       ├── settlements/      # Settlement recording
│   │       ├── analytics/        # Split analytics
│   │       ├── settings/         # User preferences
│   │       └── join/             # Group invite join page
│   ├── api/
│   │   ├── inngest/              # Inngest webhook handler
│   │   └── seed/                 # Database seeding endpoint
│   └── lib/                      # App-level utilities (Zod schemas)
│
├── actions/                      # Server Actions
│   ├── dashboard.js              # getUserAccounts, createAccount, getDashboardData
│   ├── transaction.js            # CRUD + receipt scanning (Gemini AI)
│   ├── account.js                # getAccountWithTransactions, bulkDelete, updateDefault
│   ├── budget.js                 # getCurrentBudget, updateBudget
│   ├── seed.js                   # Generate 90 days of sample transactions
│   ├── send-email.js             # Email delivery (server-only, NOT an action)
│   └── split/                    # Split expense actions (15 files)
│       ├── expenses.js           # SharedExpense CRUD (825 lines)
│       ├── groups.js             # Group CRUD, member management
│       ├── friends.js            # Friendship CRUD
│       ├── balances.js           # Balance computation for UI
│       ├── settlements.js        # Settlement recording
│       ├── recurring.js          # Recurring expense management
│       ├── analytics.js          # Split spending analytics
│       ├── notifications.js      # Notification CRUD
│       ├── invites.js            # Group invite management
│       ├── receipts.js           # Receipt upload/download
│       ├── personal-sync.js      # Sync shared expenses to personal accounts
│       ├── notify.js             # Notification creation + email delivery
│       ├── dashboard.js          # Split summary for main dashboard
│       ├── settings.js           # User preference management
│       └── activity.js           # Activity log queries
│
├── lib/                          # Core business logic
│   ├── prisma.js                 # Prisma client singleton
│   ├── arcjet.js                 # Rate limiting configuration
│   ├── checkUser.js              # Clerk → DB user sync
│   ├── money.js                  # Decimal arithmetic (285 lines)
│   ├── format.js                 # Client-safe money formatting
│   ├── storage.js                # Supabase receipt storage (server-only)
│   ├── utils.ts                  # cn() utility for Tailwind
│   ├── inngest/
│   │   ├── client.js             # Inngest client instance
│   │   └── functions.js          # 5 background jobs (406 lines)
│   └── split/                    # Split expense pure logic (39 files!)
│       ├── engine.js             # Split calculation (6 methods)
│       ├── balances.js           # Net balance derivation
│       ├── simplify.js           # Debt simplification algorithm
│       ├── currency.js           # Multi-currency utilities
│       ├── itemized.js           # Itemized split computation
│       ├── filters.js            # Expense query filters
│       ├── friends.js            # Friend list utilities
│       ├── groups.js             # Group utilities
│       ├── auth.js               # Access control (view/edit/delete)
│       ├── access.js             # Permission checks
│       ├── notifications.js      # Notification helpers
│       ├── receipts.js           # Receipt path utilities
│       ├── rates.js              # Exchange rate utilities
│       ├── generate-recurring.js # Recurring expense generation
│       ├── ledger.js             # Ledger query helpers
│       ├── personal.js           # Personal sync utilities
│       ├── settlements.js        # Settlement utilities
│       ├── invites.js            # Invite token utilities
│       ├── analytics.js          # Split analytics computation
│       ├── activity.js           # Activity log utilities
│       └── *.test.js             # Unit tests (20 test files!)
│
├── components/                   # Shared React components
│   ├── header.jsx                # Navigation bar (async Server Component)
│   ├── hero.jsx                  # Landing page hero section
│   ├── create-account-drawer.jsx # Account creation bottom sheet
│   ├── notification-bell.jsx     # Notification bell with unread count
│   └── ui/                       # Radix UI primitives (shadcn/ui)
│
├── data/                         # Static data
│   ├── landing.js                # Landing page content (features, stats, testimonials)
│   └── categories.js             # Expense/income categories with icons
│
├── emails/                       # React Email templates
│   ├── template.jsx              # Monthly report + budget alert templates
│   └── notification.jsx          # Split notification email template
│
├── hooks/                        # Custom React hooks
│   └── use-fetch.jsx             # Generic data fetching hook with loading/error states
│
├── prisma/
│   ├── schema.prisma             # Database schema (525 lines, 14 models)
│   └── migrations/               # Database migration history
│
├── middleware.js                  # Clerk auth middleware (route protection)
├── next.config.ts                # Next.js configuration
├── package.json                  # Dependencies
└── .env.example                  # Environment variable template
```

---

## 13. Interview Q&A — 60 Questions with Answers

### General Project Questions

---

**Q1: What is this project about? Give a brief overview.**

**A:** WelthWise is a full-stack AI-powered personal finance platform. It lets users track income and expenses, set budgets, scan receipts using AI to auto-fill transactions, split expenses with friends and groups (like Splitwise), settle debts, and receive monthly financial reports. It's built with Next.js 15, React 19, PostgreSQL, and integrates Google Gemini for AI features.

---

**Q2: What problem does this project solve?**

**A:** Managing money manually is hard. People forget to track expenses, don't know where their money goes, and splitting bills with friends leads to confusion and awkward conversations. WelthWise solves all three: automatic tracking with AI receipt scanning, visual analytics for spending awareness, and a built-in Splitwise-style system so everyone knows exactly who owes whom.

---

**Q3: What are the key features?**

**A:** (1) Multi-account management, (2) Transaction CRUD with recurring support, (3) AI receipt scanning via Google Gemini, (4) Monthly budgeting with email alerts, (5) Split expenses with 6 split methods, (6) Friend & group management, (7) Debt simplification algorithm, (8) Settlement tracking with personal account sync, (9) AI-generated monthly reports, (10) In-app & email notifications, (11) Secure receipt storage, (12) Multi-currency support.

---

**Q4: What is unique about your project compared to existing apps like Splitwise?**

**A:** Three things: (1) **Unified platform** — Splitwise only splits expenses, we also do personal finance tracking, budgets, and analytics in one app. (2) **AI receipt scanning** — scan a bill photo and the transaction is auto-filled. (3) **Itemized splits** — assign specific line items to specific people (e.g., "pizza goes to Ayush, salad goes to Priya"), not just equal/percentage splits.

---

### Tech Stack Questions

---

**Q5: Why did you choose Next.js over React alone?**

**A:** Next.js gives us three things React alone can't: (1) **Server-Side Rendering** — the dashboard loads with pre-rendered HTML, so users see data instantly instead of a loading spinner. (2) **Server Actions** — we can write server-side functions (`"use server"`) that are callable from components without building REST APIs. (3) **File-based routing** — no need for React Router, the folder structure IS the routing.

---

**Q6: Why Server Actions instead of REST APIs?**

**A:** Server Actions eliminate the boilerplate of REST APIs. Instead of creating a `/api/transactions` route, writing a handler, parsing the request body, and calling it with `fetch()`, we just write a function with `"use server"`, import it, and call it. It's type-safe, fewer files, and Next.js handles the network layer automatically.

---

**Q7: Why Prisma instead of raw SQL or another ORM like Sequelize?**

**A:** (1) **Type-safe queries** — Prisma auto-generates a typed client from the schema, so `db.user.findUnique()` knows the return shape at compile time. (2) **Migrations** — `prisma migrate` tracks schema changes like Git tracks code changes. (3) **Decimal support** — Prisma has first-class Decimal type, critical for money. (4) **Developer experience** — schema is readable, relations are explicit, and the client API is intuitive.

---

**Q8: Why PostgreSQL over MongoDB or MySQL?**

**A:** Financial data is inherently **relational** — a transaction belongs to an account, which belongs to a user. An expense has splits, which reference users. PostgreSQL gives us: (1) **ACID transactions** — if creating a transaction and updating the balance are wrapped in `$transaction`, either both succeed or neither does. (2) **Strong consistency** — we never read stale balance data. (3) **Decimal columns** — native arbitrary-precision arithmetic, not floating-point.

---

**Q9: Why Clerk for authentication instead of NextAuth or Firebase Auth?**

**A:** Clerk gives us a complete auth solution out of the box: sign-up, sign-in, OAuth (Google, GitHub), email verification, user profiles, and session management — all with pre-built UI components (`<SignInButton>`, `<UserButton>`). With NextAuth, we'd have to build our own sign-in UI, manage sessions, handle email verification, etc. Clerk saves weeks of development.

---

**Q10: What is Inngest and why did you use it?**

**A:** Inngest is a serverless background job orchestration platform. We use it for tasks that can't run in a request-response cycle: daily recurring transaction processing, monthly report generation, and budget alerts. Inngest gives us: (1) **Cron scheduling** without managing servers, (2) **Automatic retries** with exponential backoff if a step fails, (3) **Per-user throttling** so one user can't hog resources, (4) **Step-based execution** where each step is individually retryable.

---

**Q11: Why Arcjet for rate limiting? Why not implement it yourself?**

**A:** Arcjet provides a **token bucket rate limiter** as a service. Implementing our own would need Redis, custom middleware, and careful edge-case handling (distributed rate limiting across multiple server instances). Arcjet handles all that in one line of config: `tokenBucket({ refillRate: 10, interval: 3600 })`. It also fails open — if the service is down, the app still works.

---

**Q12: Why Supabase Storage instead of Cloudinary or AWS S3?**

**A:** We're already using Supabase for the database (PostgreSQL). Using Supabase Storage means one fewer provider to manage, one fewer set of credentials, and the storage is co-located with the database for low latency. We also get **private buckets with signed URLs** out of the box, which is critical for receipt privacy.

---

**Q13: Why Decimal.js? Why not just use `toFixed(2)`?**

**A:** `toFixed(2)` rounds a Number to 2 decimal places, but the Number itself is already wrong. `0.1 + 0.2 = 0.30000000000000004` — no amount of `toFixed()` makes the intermediate calculation correct. Decimal.js does arithmetic in base 10, like a calculator, so `0.1 + 0.2 = 0.3` exactly. For a finance app handling money, this is non-negotiable.

---

### Architecture Questions

---

**Q14: Explain the high-level architecture of the application.**

**A:** It's a **3-tier architecture**: (1) **Presentation** — Next.js with React Server Components for SSR and Client Components for interactivity. (2) **Business Logic** — Server Actions call pure functions in `lib/` for calculations, Prisma for DB access, and external APIs (Gemini, Resend, Supabase). (3) **Data** — PostgreSQL via Supabase with Prisma ORM, plus Supabase Storage for files. Background jobs run on Inngest as a sidecar.

---

**Q15: What is the difference between Server Components and Client Components in your app?**

**A:** **Server Components** (default in Next.js App Router) run on the server, can directly access the database, and send only HTML to the browser — zero JavaScript shipped. Our dashboard page, account list, and expense feeds are Server Components. **Client Components** (marked with `"use client"`) run in the browser for interactivity — forms, charts, dropdowns, modals. They hydrate after the SSR HTML loads.

---

**Q16: Why are balances never stored in the database?**

**A:** If we stored balances, we'd have to update them every time an expense, split, or settlement changes. That creates a **synchronization problem** — if the update fails, the balance is wrong and we might lose or invent money. Instead, we derive balances from the ledger (expenses + splits + settlements) on every read. The formula is the source of truth. It's slower but impossible to get wrong.

---

**Q17: Explain the split engine architecture.**

**A:** The split engine (`lib/split/engine.js`) is a set of **pure functions** — no database, no UI, no side effects. It takes (total, participants, values) and returns shares. Each split method (EQUAL, EXACT, PERCENTAGE, SHARES, CUSTOM, ITEMIZED) is a separate function. All methods go through `allocate()` from `lib/money.js`, which uses the Hamilton algorithm to distribute amounts with zero rounding error. A `validateSplit()` gate checks every result before it's persisted.

---

**Q18: What is the Hamilton allocation algorithm?**

**A:** It's a fair division algorithm. When you split ₹100 three ways, you get ₹33.33 × 3 = ₹99.99, missing ₹0.01. Hamilton fixes this: (1) Floor every share to the minor unit (33.33). (2) Calculate the leftover (₹0.01 = 1 paisa). (3) Give the leftover to the person with the largest fractional remainder. Result: ₹33.34 + ₹33.33 + ₹33.33 = ₹100.00 exactly. In our app, the payer gets the extra paisa.

---

**Q19: How does the debt simplification algorithm work?**

**A:** It uses the **minimum cash flow** algorithm. Steps: (1) Compute each person's net balance (positive = owed money, negative = owes money). (2) Pick the largest creditor and largest debtor. (3) The smaller of the two amounts is transferred between them, zeroing out one party. (4) Repeat until everyone is settled. This produces at most n-1 payments for n people. Example: A owes B ₹500, B owes C ₹500 → simplified to A pays C ₹500 (2 payments → 1).

---

**Q20: How do you handle the `isTransfer` flag?**

**A:** When a user pays ₹1000 for a shared dinner, their bank account actually spent ₹1000 — but they'll get ₹667 back from friends. If we count the full ₹1000 as a personal expense, the dashboard would overstate spending. The `isTransfer` flag marks these as "cash that moved but isn't consumption". All dashboard analytics, budget calculations, and monthly reports filter by `isTransfer: false`.

---

### Database Questions

---

**Q21: How do you ensure data consistency for financial transactions?**

**A:** We use Prisma's `$transaction()` for every operation that touches multiple tables. For example, creating a transaction AND updating the account balance happens in a single database transaction. If either fails, both are rolled back. We also use `Decimal` columns (not `Float`) for money, and all arithmetic goes through `Decimal.js` to avoid floating-point errors.

---

**Q22: Explain the canonical friendship storage pattern.**

**A:** To prevent duplicate friend links (A→B and B→A), we store the pair with the smaller UUID as `requesterId` and the larger as `addresseeId`. A unique constraint on `(requesterId, addresseeId)` physically prevents duplicates. We add a separate `initiatedById` field to know who actually sent the request, since the canonical ordering discards direction.

---

**Q23: Why use soft deletes for expenses?**

**A:** If we hard-delete an expense, any settlements that were recorded against it would become orphans — the numbers wouldn't add up. Soft deleting (`isDeleted = true, deletedAt = timestamp`) keeps the record for auditing. The balance formula skips deleted expenses (`if (expense.isDeleted) continue`), so the effect is the same as deletion from the user's perspective.

---

**Q24: How do you prevent duplicate recurring shared expenses?**

**A:** Each generated expense gets a `recurringId` (which template created it) and a `periodKey` (the scheduled run date, like "2026-09-10"). There's a `UNIQUE(recurringId, periodKey)` constraint in the database. If a cron job fires twice or Inngest retries the step, the second insert physically fails with a unique violation instead of creating a duplicate.

---

**Q25: What indexes have you created and why?**

**A:** Key indexes include: (1) `userId` on accounts, transactions, budgets — to quickly find a user's data. (2) `(groupId, isDeleted)` on shared expenses — to efficiently list active group expenses. (3) `(userId, readAt)` on notifications — the unread badge query. (4) `(userId, isTransfer)` on transactions — to filter out transfers for analytics. (5) `(isActive, nextRunDate)` on recurring shared expenses — to find due templates. All indexes are chosen based on the actual query patterns.

---

### AI & Integration Questions

---

**Q26: How does the AI receipt scanning work?**

**A:** (1) User uploads a photo in the transaction form. (2) The file is converted to Base64 on the server. (3) We send the Base64 image + a structured prompt to Google Gemini 3.6 Flash. (4) The prompt asks Gemini to extract amount, date, description, merchant, and category as JSON. (5) Gemini returns structured JSON. (6) We parse it, validate it, and auto-fill the transaction form. If it's not a receipt, Gemini returns an empty object.

---

**Q27: How do you handle Gemini API failures?**

**A:** For receipt scanning, errors are caught and re-thrown as "Failed to scan receipt" — the user can still fill the form manually. For monthly report insights, if Gemini fails, we fall back to three generic insights ("Your highest expense category needs attention", etc.) so the report still sends.

---

**Q28: How does the monthly report email work end-to-end?**

**A:** (1) Inngest cron fires on the 1st of every month. (2) We fetch all users with their accounts. (3) For each user, we compute last month's stats (total income, total expenses, spending by category). (4) We send the stats to Gemini with a prompt asking for 3 actionable insights. (5) We render a React Email template with the stats and insights. (6) Resend sends the email. Each user is processed in a separate Inngest step, so one failure doesn't block others.

---

### Security Questions

---

**Q29: How do you prevent unauthorized access to server actions?**

**A:** Every server action's first line is `const { userId } = await auth()`. If there's no authenticated user, it throws "Unauthorized". We then map the Clerk user ID to our database user. For split expenses, we have an additional `lib/split/auth.js` layer that checks: Can this user view this expense? Can they edit it? Do they belong to this group? These are called `assertCanViewExpense()`, `assertCanEditExpense()`, etc.

---

**Q30: How did you secure the email sending function?**

**A:** `send-email.js` imports `"server-only"` instead of using `"use server"`. Every export of a `"use server"` module is automatically a callable endpoint — if `sendEmail()` were an action, anyone could call it with any recipient and subject, turning our Resend account into an open relay. The `"server-only"` import makes it only callable from other server-side code, never from the browser.

---

**Q31: How does rate limiting work in this app?**

**A:** We use Arcjet's **token bucket** algorithm. Each user gets 10 tokens that refill at 10/hour. Every account creation or transaction creation costs 1 token. When tokens run out, the action throws "Too many requests" with a reset time. This prevents abuse (like creating thousands of accounts) while allowing normal usage.

---

**Q32: How do you protect receipt uploads?**

**A:** (1) The Supabase bucket is **private** — no one can guess a URL to access a receipt. (2) Viewing a receipt requires a **signed URL** with a 10-minute TTL, generated server-side. (3) The service-role key that creates signed URLs is in a `"server-only"` module, so it never ships to the browser. (4) Upload uses `upsert: false` — if a path already exists, the upload fails instead of overwriting.

---

### Code Quality & Patterns

---

**Q33: What design patterns did you use?**

**A:** (1) **Repository pattern** — Server Actions abstract database access, components never touch Prisma directly. (2) **Pure functions** — split engine, balance computation, and debt simplification are stateless and side-effect-free, making them testable. (3) **Strategy pattern** — `computeSplit()` dispatches to the correct split method based on a string key. (4) **Observer pattern** — Inngest events decouple the action (creating an expense) from the side effect (sending notifications). (5) **Singleton** — Prisma client is instantiated once and reused.

---

**Q34: How did you organize the codebase?**

**A:** By **feature and responsibility**: (1) `app/` — routes and UI (Next.js App Router). (2) `actions/` — server-side mutations (data access layer). (3) `lib/` — pure business logic (no DB, no UI). (4) `lib/split/` — all split expense logic with 20 test files. (5) `components/` — reusable UI components. (6) `data/` — static content. (7) `emails/` — email templates. This separation means changing the UI doesn't touch business logic, and vice versa.

---

**Q35: How do you handle form validation?**

**A:** **Two layers**: (1) **Client-side** — React Hook Form with Zod schemas validates inputs as the user types, showing instant feedback. (2) **Server-side** — Server Actions re-validate with the same Zod schemas (or `validateSplit()` for splits) before writing to the database. Never trust the client — a tampered request still reaches the server action.

---

**Q36: What testing strategy did you follow?**

**A:** The `lib/split/` directory has **20 unit test files** covering the pure logic: engine (split calculations), balances (net balance derivation), simplify (debt reduction), currency (multi-currency handling), itemized (line-item splits), filters, friends, groups, access control, receipts, invites, notifications, recurring generation, settlements, and personal sync. Tests run with Node's built-in test runner: `node --test`.

---

### Performance Questions

---

**Q37: How do you optimize dashboard loading?**

**A:** Three strategies: (1) **Parallel data fetching** — `Promise.all([getUserAccounts(), getDashboardData(), getDashboardSplitSummary()])` fetches three datasets simultaneously instead of sequentially. (2) **Server Components** — the dashboard is server-rendered, so the user sees data on the first paint. (3) **Loading state** — a `loading.js` file shows a skeleton while the server component resolves.

---

**Q38: How do you handle Prisma Decimal serialization?**

**A:** Prisma returns `Decimal` objects for monetary fields. Next.js cannot serialize these across the server/client boundary (Server Component → Client Component). We use `serializeMoney()` which recursively walks objects and converts Decimal instances to Numbers. It also handles Prisma's internal Decimal (a different copy of decimal.js) by duck-typing `toNumber()`.

---

**Q39: How do you prevent the Prisma runtime from shipping to the browser?**

**A:** `lib/format.js` (money formatting) is deliberately kept **free of Prisma/Decimal imports**. Client Components import formatting from here, not from `lib/money.js`. This prevents the 500KB+ Prisma runtime from entering the browser bundle. Server-side code imports from `lib/money.js`, which re-exports formatting for convenience.

---

### Split Expense Deep Dive

---

**Q40: Explain how the EQUAL split handles the rounding penny.**

**A:** When ₹100 is split 3 ways, `100/3 = 33.333...`. We can't give everyone ₹33.33 because that sums to ₹99.99. The `allocate()` function: (1) Floors each share (₹33.33 × 3). (2) Computes the remainder (₹0.01). (3) Gives the extra paisa to the payer (who is ordered first in the participant list). Result: payer gets ₹33.34, others get ₹33.33. Sum = ₹100.00 exactly.

---

**Q41: How does the CUSTOM split method work?**

**A:** It's "equal + adjustments". Say a ₹3000 dinner, and Rahul had an extra dessert worth ₹200. (1) Subtract adjustments from total: ₹3000 - ₹200 = ₹2800 base. (2) Split base equally: ₹2800 / 3 = ₹933.33 each. (3) Add Rahul's adjustment: ₹933.33 + ₹200 = ₹1133.33. (4) Final: Ayush ₹933.34, Rahul ₹1133.33, Priya ₹933.33 = ₹3000.00.

---

**Q42: How do group invites work securely?**

**A:** (1) An admin generates an invite with a **random token** (never derived from the group ID — a guessable token is an open door into the group's ledger). (2) The token is shared as a link. (3) The token has optional expiry, max uses, and can be revoked. (4) When someone visits the link, we validate the token, check expiry/max uses/revocation, and add them to the group. (5) Validity is expressed as data (not deletion) so a link that stops working can explain why.

---

**Q43: What happens when a member is removed from a group?**

**A:** (1) We check if the member has a non-zero balance. If they still owe or are owed money, removal is blocked — you can't remove someone who hasn't settled up. (2) If their balance is zero, `leftAt` is set to `now()` instead of deleting the row. This soft-end keeps historical splits explainable — you can still see "Priya paid ₹500 for groceries" even after she left the group.

---

**Q44: How does personal-split integration work?**

**A:** When Ayush pays ₹3000 for a group dinner: (1) A `SharedExpense` is created with splits. (2) A personal `Transaction` is created on Ayush's bank account for ₹3000 (type: EXPENSE, `isTransfer: true`). (3) The `isTransfer` flag means this ₹3000 won't appear in dashboard analytics or budget calculations — because Ayush will get ₹2000 back from friends. When friends settle up, reverse transactions are created.

---

**Q45: How does the notification system work?**

**A:** Two layers: (1) **In-app** — a `Notification` row is created in the same database transaction as the event (e.g., when an expense is added, notifications for all participants are created atomically). The header shows a bell icon with an unread count. (2) **Email** — after the in-app notification is created, an email is queued and sent via Resend (best-effort). Email failure never affects the in-app notification or blocks the original action.

---

### Scenario-Based Questions

---

**Q46: What happens if the Inngest cron job fires twice?**

**A:** For personal recurring transactions, Inngest's built-in deduplication and throttling prevent double processing. For shared recurring expenses, the `UNIQUE(recurringId, periodKey)` database constraint makes it physically impossible to create the same expense twice. The second attempt hits a unique violation and fails cleanly.

---

**Q47: What if the database goes down during a transaction?**

**A:** Prisma's `$transaction()` ensures atomicity. If the DB connection drops mid-transaction, the entire operation is rolled back. The account balance and the transaction either both succeed or both fail. The user sees an error and can retry.

---

**Q48: How do you handle a user who signs up with Clerk but isn't in your database yet?**

**A:** `checkUser()` runs on every page load via the Header component. It calls `currentUser()` from Clerk, looks up the user by `clerkUserId` in our DB. If not found, it creates a new User record with the name, email, and profile image from Clerk. This is a "just-in-time provisioning" pattern.

---

**Q49: What if Gemini returns invalid JSON for receipt scanning?**

**A:** The `scanReceipt()` function has a try-catch around `JSON.parse()`. If parsing fails, it throws "Invalid response format from Gemini". The UI catches this and shows an error toast, letting the user fill the form manually. We also strip markdown code fences (` ```json `) that Gemini sometimes wraps its output in.

---

**Q50: How would you add real-time notifications?**

**A:** Option 1: **Server-Sent Events (SSE)** — a long-lived HTTP connection from the client to a Next.js API route. When a notification is created, the server pushes it to the client's SSE stream. Option 2: **WebSockets** via a service like Pusher or Ably. Option 3: **Polling** — the `NotificationBell` component periodically calls `getUnreadCount()`. Currently, we use SSR (the count is fetched on page load) and would add SSE for real-time.

---

**Q51: How would you add payment gateway integration?**

**A:** (1) Integrate Razorpay/Stripe SDK. (2) When a user clicks "Settle Up", create a payment intent via the gateway API. (3) Redirect to the payment page. (4) On webhook confirmation, create a `Settlement` record and optionally sync to personal accounts. (5) Send notification to the recipient. The settlement amount and direction come from our existing `simplifyDebts()` algorithm.

---

**Q52: If you had to scale this to 1 million users, what would you change?**

**A:** (1) **Read replicas** — split analytics queries to read-only Postgres replicas. (2) **Redis caching** — cache user sessions, unread notification counts, and friend lists. (3) **CDN** — serve static assets and signed receipt URLs through Cloudflare. (4) **Queue** — move email sending to a dedicated queue (SQS/BullMQ) instead of inline Resend calls. (5) **Sharding** — partition the transactions table by userId for horizontal scaling. (6) **Rate limiting** — add IP-based limits alongside user-based limits. (7) **Materialized views** — pre-compute monthly statistics instead of aggregating on every dashboard load.

---

**Q53: What are the main trade-offs in your architecture?**

**A:** (1) **Computed balances vs. stored balances** — we trade read performance for absolute correctness. At scale, we'd add caching or materialized views. (2) **Server Actions vs. REST APIs** — simpler code but tightly coupled to Next.js. Migrating to a mobile app would require extracting the logic into a separate API. (3) **Managed services (Clerk, Inngest, Arcjet, Supabase) vs. self-hosted** — faster development but vendor lock-in and recurring costs.

---

**Q54: How do you ensure the split engine is correct?**

**A:** (1) **20 unit test files** with hundreds of test cases covering edge cases (zero amounts, single participant, negative adjustments, mixed currencies). (2) **`checkSum()` gate** — every split is verified to sum to exactly the total before being persisted. (3) **`validateSplit()` on write** — even if the client sends tampered data, the server re-validates. (4) **Pure functions** — the engine has no side effects, so tests are fast and deterministic.

---

**Q55: How does multi-currency work in split expenses?**

**A:** (1) Each expense stores `currency`, `originalAmount`, `originalCurrency`, `exchangeRate`, and `rateAt`. (2) Exchange rates are frozen at the time of expense creation — tomorrow's rate change must not rewrite yesterday's expense. (3) Balances are computed **per currency** — `computeNetBalancesByCurrency()` returns a separate balance map for each currency. (4) ₹100 + $100 never produces 200 of anything — the system throws if you try to sum across currencies without specifying which one.

---

**Q56: Walk me through the complete flow of adding a shared expense.**

**A:** (1) User fills the add-expense form (amount, category, participants, split method, values). (2) Client-side Zod validation runs. (3) Server Action `addExpense()` is called. (4) `auth()` verifies the user. (5) `assertValidParticipants()` checks that all participants are group members or friends. (6) `computeSplit()` calculates each person's share using the selected method. (7) `validateSplit()` verifies shares sum to the total. (8) A Prisma `$transaction` creates the SharedExpense + ExpenseSplit rows + Activity log + Notifications. (9) If enabled, `syncExpenseToPersonal()` creates a transfer Transaction on the payer's account. (10) Email notifications are queued via Resend. (11) `revalidatePath()` refreshes the UI.

---

**Q57: What is the difference between `DATABASE_URL` and `DIRECT_URL` in your Prisma config?**

**A:** `DATABASE_URL` uses port 6543 (PgBouncer connection pooler) — it's used at runtime by the app for efficient connection reuse. `DIRECT_URL` uses port 5432 (direct Postgres connection) — it's used by `prisma migrate` for schema changes, which need a persistent connection that PgBouncer can't provide. This is a Supabase-specific pattern.

---

**Q58: How does the `serializeMoney()` function handle Prisma's Decimal vs. your Decimal.js?**

**A:** Prisma bundles its own copy of `decimal.js`, so `instanceof Decimal` fails for values read from the database. `serializeMoney()` uses **duck typing**: if an object has both `toNumber()` and `toFixed()` methods, it's treated as a Decimal and converted to a Number. This makes it work with both our Decimal.js and Prisma's internal copy.

---

**Q59: What would happen if you removed `import "server-only"` from `send-email.js`?**

**A:** Nothing would break immediately. But `sendEmail()` would become importable from Client Components. If a developer accidentally imported it client-side, the Resend API key would ship in the browser bundle — a security vulnerability. And if it were a `"use server"` action, anyone could call it from the browser with any recipient, subject, and body — an open email relay. `"server-only"` is a build-time guardrail.

---

**Q60: How did you handle the "money concatenation bug" you mentioned in the code comments?**

**A:** Prisma's `Decimal.valueOf()` returns a string, so `0 + Decimal("100") + Decimal("50")` produces `"010050"` instead of `150`. The original `actions/account.js` had this exact bug. We fixed it with `lib/money.js`: the `toDecimal()` function normalizes all inputs into a proper Decimal instance, and arithmetic functions (`add()`, `sub()`, `sum()`) ensure operands are always Decimal values. The code comment serves as a warning for future developers.

---

## Summary

WelthWise is a production-grade, full-stack fintech platform that demonstrates:

- **Modern web development** (Next.js 15 App Router, React 19, Server Actions)
- **Financial engineering** (decimal arithmetic, Hamilton allocation, ledger-based balances)
- **AI integration** (Gemini for receipt scanning and financial insights)
- **Distributed systems** (background jobs, event-driven architecture, rate limiting)
- **Security best practices** (auth middleware, server-only modules, signed URLs, input validation)
- **Database design** (relational modeling, ACID transactions, indexing, soft deletes)
- **Testing** (20 test files covering pure business logic)

The codebase spans **~100+ files**, **~15,000+ lines of code**, and integrates **8 external services** into a cohesive, well-documented platform.
