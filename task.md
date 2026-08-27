# Split Expenses — Module-by-Module Build Plan

A Splitwise-style shared-expense system built **inside** WealthWise, reusing its
auth, users, database, and design system. Not a separate app.

**How to use this file:** build one module at a time, top to bottom. Each module
lists what it depends on, what to change, and a testable "Done when". Do not
start a module until its dependencies are green. Tick boxes as you go.

---

## 0. Reality check — what the spec assumes vs. what exists

The feature spec says "reuse the existing X where available." I checked. Here is
what is actually in the repo today, because four of those assumptions are wrong
and change the scope significantly.

| Spec assumes | Reality | Impact |
|---|---|---|
| Existing **notification system** (#16) | ❌ Does not exist. Only `sonner` toasts (client-side, ephemeral) and Resend email fired from Inngest with a 2-branch template | M16 is a **net-new build**, not an integration |
| Existing **multi-currency** (#20) | ❌ Does not exist. No `currency` column anywhere; UI hardcodes `$`; "Multi-Currency" is marketing copy in `data/landing.js` | M22 is **net-new**, and touches the existing `Transaction` model too |
| Existing **receipt/OCR** to reuse (#19) | ⚠️ Half. `scanReceipt()` works (Gemini vision), but `Transaction.receiptUrl` is a **dead column** — never read, never written. No blob storage dependency installed | OCR reusable; **persistence must be built** (M20) |
| Nav with **Investments / Budgets** (#26) | ⚠️ Budgets exist (one per user). Investments does **not** exist | Don't build nav around a section that isn't there |
| Existing **profile system** (#13) | ✅ Clerk + `User.name` / `User.imageUrl` | Genuinely reusable |
| Existing **categories** (#12) | ✅ 21 categories in `data/categories.js`, 15 expense-type | Genuinely reusable |
| Existing **auth / user IDs** (#13) | ✅ Clerk → `User.clerkUserId` → `User.id` | Genuinely reusable |

**Also note:** Gemini is currently returning `403 denied access` for this Google
project, so anything depending on OCR (M21) is blocked externally until billing
or a different project is sorted.

---

## 1. Non-negotiable rules

These apply to **every** module. Violating one is a bug even if tests pass.

### Money
- **Never use JS floating-point for money.** Use Prisma's `Decimal`
  (`@prisma/client/runtime/library`) for all arithmetic.
- This codebase has already shipped this exact bug once: summing `Decimal` with
  `+` produced the string `"0100.550.25"` instead of `120.75`. `Decimal.valueOf()`
  returns a **string**, so `number + Decimal` concatenates.
- Storage stays `Decimal` (matches the existing `Transaction.amount` convention).
- **Rounding rule for splits:** use largest-remainder allocation. ₹100 split 3
  ways is `33.34 / 33.33 / 33.33`, never `33.33 × 3 = 99.99`. The leftover minor
  unit goes to the payer first, then by descending remainder. Pin this in one
  helper so every split method shares it.
- Serialize `Decimal` → `Number` before returning to any Client Component.
  Next.js cannot serialize `Decimal` across the boundary.

### Ledger
- **The ledger is the only source of truth.** Balances are always *derived* from
  `SharedExpense` + `ExpenseSplit` + `Settlement`. Never store a mutable balance
  column and never write to one directly.
- Core formula:
  ```
  net(u) = Σ paid(u) − Σ share(u) + Σ settlementsSent(u) − Σ settlementsReceived(u)
  ```
  Positive = owed to the user. Negative = the user owes.
- **Invariant: within any group, Σ net(all members) === 0.** Assert this in tests.
- `Σ splits === expense.amount` exactly. Reject the write otherwise.
- Every expense has **exactly one** payer.
- **Soft-delete expenses** (`isDeleted`). Hard deletes destroy ledger history and
  make past settlements unexplainable.

### Separation of concerns
Three things that must never be conflated:
- **Personal expense** (existing `Transaction`) — money the user actually consumed
- **Shared expense** (`SharedExpense`) — a group event with a payer and splits
- **Settlement** (`Settlement`) — a transfer between people; **not** income or expense

A ₹1,000 repayment from Rahul is not ₹1,000 of income. Treating it as such is the
single most damaging mistake this module can make.

### Security
- All balance math is **server-side only**. Never trust a client-supplied share,
  total, or balance.
- Every action re-derives the caller via `auth()` → `clerkUserId` → `User.id`,
  matching the existing pattern in `actions/*.js`.
- Every group/expense read and write must assert membership. A group ID in a URL
  is not authorization.

### Conventions to follow (from the existing schema)
- Models PascalCase singular, `@@map("snake_case_plural")`
- `id String @id @default(uuid())`
- `createdAt DateTime @default(now())`, `updatedAt DateTime @updatedAt`
- Enums `SCREAMING_CASE`
- `onDelete: Cascade` on user-owned relations
- `@@index([userId])` on every foreign key you filter by
- Server actions live in `actions/*.js` with `"use server"`
- Feature UI lives in `app/(main)/<feature>/_components/`
- Zod schemas go in `app/lib/schema.js`
- Client calls server actions through the `useFetch` hook

---

## 2. Dependency graph

```
PHASE 0 ─ FOUNDATION
  M0 Money primitives
  M1 Schema + migration        ← depends on M0 (rounding decisions shape columns)
  M2 Access control helpers    ← M1
  M3 Route shell + nav         ← M2

PHASE 1 ─ CORE LEDGER
  M4 Friends                   ← M2, M3
  M5 Groups & members          ← M4
  M6 Split engine (pure)       ← M0          ⚠ pure functions + tests, NO UI
  M7 Add expense               ← M5, M6
  M8 Balance derivation        ← M7
  M9 Who owes whom + detail    ← M8
  M10 Settlements              ← M8
  M11 Edit / delete expense    ← M8, M10

PHASE 2 ─ INTEGRATION & ADVANCED
  M12 Personal-finance link    ← M11   ⚠ highest-risk module
  M13 Debt simplification      ← M8
  M14 Categories               ← M7
  M15 Activity feed            ← M11
  M16 Notification infra       ← M15   ⚠ net-new, not an integration
  M17 Recurring shared expenses← M16
  M18 Search & filters         ← M11
  M19 Dashboard integration    ← M12

PHASE 3 ─ PREMIUM
  M20 Receipt storage          ← M11   ⚠ needs a blob-storage decision
  M21 Itemized split + OCR     ← M20   ⚠ blocked: Gemini 403
  M22 Multi-currency           ← M11   ⚠ net-new, touches existing Transaction
  M23 Shared analytics         ← M12

DEFERRED (scoped separately)
  M24 Transaction import
  M25 Offline sync
```

**Ordering note:** M6 (split engine) comes *before* M7 (add expense) on purpose.
Build the split math as pure, unit-tested functions with no database and no UI.
Split math is where the money bugs live; do not discover them through a form.

---

# PHASE 0 — Foundation

## M0 · Money primitives ✅ DONE

**Goal:** one module that every other module imports for money math. Nothing else
in the feature is allowed to do arithmetic on money.

**Files**
- `lib/money.js` (new)

**Work**
- [x] `toDecimal(value)` — normalize string/number/Decimal to `Decimal`
- [x] `add`, `sub`, `mul`, `div` wrappers that never fall back to JS numbers
- [x] `allocate(total, weights[])` — largest-remainder distribution; returns
      `Decimal[]` that **provably** sums to `total`
- [x] `serializeMoney(obj)` — `Decimal` → `Number` for Client Components
- [x] `formatMoney(value, currency)` — single place that owns the currency symbol
      (today the app hardcodes `$`; this is where that gets fixed later)
- [x] `equals(a, b)` — exact `Decimal` comparison, never `===`

**Done when**
- `allocate(100, [1,1,1])` → `[33.34, 33.33, 33.33]` summing to exactly `100`
- `allocate(0.03, [1,1,1])` → `[0.01, 0.01, 0.01]`
- A test asserts `allocate` output sums to input across 1,000 random cases
- No other file in the feature imports `Decimal` directly

**Gotcha:** decide minor-unit precision now (2 for INR/USD) and encode it in one
constant. Retrofitting precision later means a data migration.

---

## M1 · Database schema ✅ DONE

**Goal:** all entities in one migration. Extends the existing schema; does not
create a parallel database.

**Files**
- `prisma/schema.prisma` (modify)
- one new migration

**Models**

```prisma
enum FriendshipStatus { PENDING ACCEPTED BLOCKED }
enum GroupRole        { OWNER ADMIN MEMBER }
enum SplitMethod      { EQUAL EXACT PERCENTAGE SHARES CUSTOM ITEMIZED }
enum SettlementMethod { CASH BANK_TRANSFER UPI EXTERNAL OTHER }
enum ActivityType     { EXPENSE_ADDED EXPENSE_EDITED EXPENSE_DELETED
                        MEMBER_ADDED MEMBER_REMOVED SETTLEMENT_RECORDED
                        RECURRING_GENERATED GROUP_CREATED }
```

- `Friendship` — `requesterId`, `addresseeId`, `status`, `@@unique([requesterId, addresseeId])`
- `ExpenseGroup` — `name`, `imageUrl?`, `icon?`, `createdById`, `isArchived`
- `GroupMember` — `groupId`, `userId`, `role`, `joinedAt`, `leftAt?`, `@@unique([groupId, userId])`
- `SharedExpense` — `groupId?` (null ⇒ 1:1 friend expense), `description`,
  `amount Decimal`, `currency`, `date`, `category`, `notes?`, `splitMethod`,
  `paidById`, `createdById`, `isDeleted Boolean @default(false)`
- `ExpenseSplit` — `expenseId`, `userId`, `shareAmount Decimal`,
  `shareInput Decimal?` (raw percent/shares/exact as entered),
  `@@unique([expenseId, userId])`
- `Settlement` — `groupId?`, `fromUserId`, `toUserId`, `amount Decimal`,
  `currency`, `method`, `note?`, `settledAt`
- `SharedExpenseActivity` — `groupId?`, `actorId`, `type ActivityType`,
  `expenseId?`, `settlementId?`, `metadata Json?`
- `ExpenseItem` — deferred to M21, but add the table now to avoid a second migration
- `RecurringSharedExpense` — deferred to M17, same reasoning
- Add reverse relations to the existing `User` model

**Work**
- [x] Write the models following the conventions in §1
- [x] Add `@@index` on every FK used in a filter (`groupId`, `userId`, `paidById`,
      `expenseId`, `fromUserId`, `toUserId`, `date`)
- [x] `npx prisma migrate dev --name add_split_expenses`
- [x] `npx prisma generate`

**Done when**
- `npx prisma migrate status` → "Database schema is up to date"
- The existing `User`, `Account`, `Transaction`, `Budget` models are **unchanged**
- `npx next build` still exits 0

**Decisions baked in here — read before writing:**
1. **`ExpenseParticipants` and `ExpenseSplits` are merged into one table.** The
   spec lists both, but a participant *is* a split row with a share. Two tables
   would let them drift out of sync, which is exactly the kind of inconsistency
   rule #25 forbids. A participant with a ₹0 share is representable.
2. **`groupId` is nullable on `SharedExpense`** so a 1:1 friend expense (#2) uses
   the same ledger as a group expense. One code path, one balance formula.
3. **Soft delete, not hard delete.** `isDeleted` keeps history explainable.

---

## M2 · Access control & data-access helpers ✅ DONE

**Goal:** authorization in one place, so no action can forget it.

**Files**
- `lib/split/auth.js` (new)

**Work**
- [x] `getCurrentAppUser()` — `auth()` → `clerkUserId` → `User`, throws if absent
      (this pattern is currently copy-pasted into every action; centralize it)
- [x] `assertGroupMember(groupId, userId)` — throws unless an active member
- [x] `assertCanEditExpense(expenseId, userId)` — payer, creator, or group admin
- [x] `assertFriends(userA, userB)` — for group-less expenses
- [x] `getGroupMemberIds(groupId)`

**Done when**
- A non-member calling any group action gets a thrown error, not data
- No server action in later modules queries a group without going through this file

---

## M3 · Route shell & navigation ✅ DONE

**Goal:** the section exists and is reachable, using the existing visual language.

**Files**
- `app/(main)/split/layout.js`, `page.jsx`, `loading.js` (new)
- `app/(main)/split/_components/split-nav.jsx` (new)
- `components/header.jsx` (modify)

**Work**
- [x] Sub-routes: `overview`, `friends`, `groups`, `balances`, `expenses`,
      `settlements`, `analytics`, `settings`
- [x] Add "Split Expenses" to the header nav
- [x] Placeholder pages for each sub-route
- [x] Reuse `components/ui/*`, `gradient-title`, `BarLoader` — no new design system

**Done when**
- Every sub-route renders and is auth-gated
- `middleware.js` `isProtectedRoute` includes `/split(.*)`
- Visually indistinguishable in style from `/dashboard`

**Note:** the spec's nav sketch (#26) lists "Investments", which does not exist in
this app. Do not add an empty section for it.

---

# PHASE 1 — Core ledger

## M4 · Friends ✅ DONE

**Files:** `actions/split/friends.js`, `app/(main)/split/friends/`

**Work**
- [x] Search users by email or name (exact-email match; **do not** expose a
      fuzzy directory of all users — that is a privacy leak)
- [x] Send / accept / decline / remove friend request
- [x] Friends list with net balance per friend (stub until M8)
- [x] Prevent duplicate reciprocal rows: store the pair canonically
      (lower UUID as `requesterId`) or enforce both orderings in a check

**Done when**
- A→B and B→A cannot both exist
- Removing a friend does **not** delete shared history
- Searching a non-existent email returns empty, not an error

---

## M5 · Groups & members ✅ DONE

**Files:** `actions/split/groups.js`, `app/(main)/split/groups/`

**Work**
- [x] Create group (name, icon/emoji, optional image)
- [x] Add members (from friends list) / remove members
- [x] Roles: OWNER / ADMIN / MEMBER
- [x] Group detail shell: balance, expenses, activity tabs
- [x] Archive group

**Done when**
- A member with a **non-zero balance cannot be removed** — settle first, or the
  ledger stops summing to zero
- Removal sets `leftAt`; it does not delete the row or their past splits
- The last OWNER cannot leave without transferring ownership

---

## M6 · Split engine ✅ DONE

**Goal:** all six split methods as tested pure functions. **No database. No UI.**

**Files:** `lib/split/engine.js`, `lib/split/engine.test.js`

**Work**
- [x] `splitEqual(total, participantIds[])`
- [x] `splitExact(total, {userId: amount})` — validate sum === total
- [x] `splitPercentage(total, {userId: pct})` — validate Σpct === 100
- [x] `splitShares(total, {userId: shares})` — weighted `allocate`
- [x] `splitCustom(total, {userId: amount})`
- [x] `splitItemized(items[])` — stub returning `NOT_IMPLEMENTED` until M21
- [x] `validateSplit(total, splits[])` — the single gate every write passes through

**Done when**
- Every method returns splits summing to **exactly** the total, verified over
  randomized property tests
- ₹3,000 across 3 of 4 group members gives `1000/1000/1000` and the fourth is absent
- ₹100 / 3 does not lose or invent a paisa
- Percentages summing to 99.99 are **rejected**, not silently corrected
- Negative amounts, zero total, and empty participants are all rejected

**This is the module to over-test.** Everything downstream inherits its bugs.

---

## M7 · Add expense ✅ DONE

**Files:** `actions/split/expenses.js`, `app/(main)/split/expenses/`,
`app/lib/schema.js` (extend)

**Flow:** name → amount → paid by → participants → split method → category →
date → notes → save

**Work**
- [x] Zod schema mirroring the existing `transactionSchema` style
- [x] Participant picker (subset of group members)
- [x] Split-method UI with a **live running total and remainder indicator**
- [x] Server action: re-validate the split server-side via `validateSplit`, then
      write expense + splits in a single `db.$transaction`
- [x] Support `groupId: null` for a direct friend expense

**Done when**
- A tampered client payload whose splits don't sum is rejected server-side
- Expense + splits are written atomically — no orphan expense on failure
- Save is blocked while the remainder is non-zero

---

## M8 · Balance derivation ✅ DONE

**Files:** `actions/split/balances.js`, `lib/split/balances.js`

**Work**
- [x] `computeNetBalances(scope)` implementing the §1 formula
- [x] `computePairwiseBalances(groupId)` — who owes whom, raw
- [x] Exclude `isDeleted` expenses
- [x] Totals: you owe / owed to you / net
- [x] Per-friend and per-group balances

**Done when**
- Σ net across a group === **0**, asserted in a test with randomized ledgers
- The worked example reconciles:
  - Ayush pays ₹3,000, split 3 ways → Ayush `+2000`, Rahul `−1000`, Priya `−1000`
  - Rahul settles ₹600 → Rahul `−400`, Ayush `+1400`, sum still `0`
- Deleting an expense (M11) returns every balance to its prior value

**Performance note:** derive from the ledger. If it gets slow, add a cache
*keyed off the ledger* — never a hand-maintained balance column.

---

## M9 · Who owes whom & expense detail ✅ DONE

**Files:** `app/(main)/split/balances/`, `app/(main)/split/expenses/[id]/`

**Work**
- [x] "Rahul owes you ₹500" list, both directions
- [x] Drill-down: click a balance → the expenses that created it
- [x] Expense detail page showing everything in spec #18: name, total, payer,
      participants, individual shares, method, date, category, notes, receipt,
      resulting debts, edit/delete where permitted

**Done when**
- Every rupee of a displayed balance traces to specific expenses/settlements
- `await params` is used (Next 15) — the codebase had this bug once already

---

## M10 · Settlements ✅ DONE

**Files:** `actions/split/settlements.js`, `app/(main)/split/settlements/`

**Work**
- [x] Full settlement (prefill the exact outstanding amount)
- [x] Partial settlement
- [x] Record an external payment (cash/UPI/bank + note)
- [x] Settlement history
- [x] Reject settlements exceeding the outstanding debt
- [x] Reject zero/negative amounts and self-settlement

**Done when**
- Rahul owes ₹1,000, pays ₹600 → remaining is exactly ₹400
- A settlement **never** appears as income or expense anywhere
- Group balances still sum to zero afterward

---

## M11 · Edit & delete expense ✅ DONE

**Files:** `actions/split/expenses.js` (extend)

**Work**
- [x] Edit amount, payer, participants, split method, category, date, notes
- [x] Re-validate and rewrite splits atomically
- [x] Soft delete
- [x] Block edits that would leave a settled balance incoherent (or warn clearly)

**Done when**
- Editing recalculates every affected balance in the same transaction
- Deleting fully reverses the expense's effect on all balances
- Both write an activity record (consumed in M15)

---

# PHASE 2 — Integration & advanced

## M12 · Personal-finance integration ✅ DONE

**Goal:** shared expenses must not inflate personal spending. This is the module
that makes the feature *WealthWise* rather than a bolted-on clone.

**The worked example (spec #14).** Ayush pays ₹4,000 for a group hotel bill; his
own share is ₹1,000:

| Concept | Amount | Where it belongs |
|---|---|---|
| Cash actually out of Ayush's account | ₹4,000 | Account balance |
| Ayush's real expense | ₹1,000 | Personal spending analytics |
| Recoverable from others | ₹3,000 | A receivable — **not** an expense |

**Work**
- [x] Decide the linkage model and write it down before coding. Recommended:
      link a `SharedExpense` to an optional personal `Transaction` for the cash
      outflow, but derive **personal spending analytics from the user's share**,
      not the paid amount
- [x] Add a nullable `sharedExpenseId` link on `Transaction`
- [x] Ensure dashboard/monthly-report totals use share, not paid
- [x] Ensure incoming settlements never register as INCOME

**Done when**
- Paying ₹4,000 with a ₹1,000 share moves the account balance by ₹4,000 and
  personal category spending by ₹1,000
- Receiving a ₹3,000 repayment restores the account balance and adds **zero**
  income
- Existing monthly reports and budget alerts are unaffected by shared activity
  except through the user's true share

**Get this wrong and every personal analytic in the app becomes untrustworthy.**
Consider building it behind a flag and reconciling against a known dataset first.

---

## M13 · Debt simplification ✅ DONE

**Files:** `lib/split/simplify.js`, `lib/split/simplify.test.js`

**Work**
- [x] Greedy min-cash-flow: repeatedly match the largest creditor with the
      largest debtor
- [x] Present as a **recommendation**; do not mutate the ledger
- [x] Show before/after transaction counts

**Done when**
- Every participant's net balance is **identical** before and after
- A owes B ₹500, B owes C ₹500 → one payment: A → C ₹500
- Output transaction count ≤ input count
- Property test: random ledgers preserve all net balances

---

## M14 · Categories ✅ DONE

- [x] Reuse the 15 expense categories from `data/categories.js` — do not create a
      parallel list
- [x] Add any genuinely missing ones (Hotel, Rent) to the shared source
- [x] Category shown on expense detail, used in filters (M18) and analytics (M23)

**Done when** personal and shared expenses use one category vocabulary.

---

## M15 · Activity feed ✅ DONE

- [x] Write `SharedExpenseActivity` rows from M5, M7, M10, M11
- [x] Group activity tab, reverse-chronological, paginated
- [x] Human strings: "Ayush added ₹2,000 hotel expense", "Priya settled ₹500 with Ayush"

**Done when** every ledger-mutating action produces exactly one activity row.

---

## M16 · Notification infrastructure ✅ DONE

**There is nothing to reuse here.** The app has `sonner` toasts and Resend email
fired from Inngest. There is no persisted, user-facing notification system.

**Work**
- [x] `Notification` model: `userId`, `type`, `title`, `body`, `linkUrl`,
      `readAt?`, `metadata Json?`
- [x] Server action to create; bell UI in the header with unread count
- [x] Mark read / mark all read
- [x] Email for high-value events via the existing Resend + Inngest path
- [x] Extend `emails/template.jsx` (currently only `monthly-report` and
      `budget-alert`) with shared-expense branches
- [x] Triggers: added to group, friend request, expense added, expense edited,
      settlement, partial settlement, recurring created/generated, reminder due

**Done when** each trigger creates exactly one notification, and email failures
degrade gracefully (in-app still works).

**External blocker:** Resend has **0 verified domains**, so email currently only
delivers to the account owner. In-app notifications should not depend on email.

---

## M17 · Recurring shared expenses ✅ DONE

- [x] `RecurringSharedExpense`: template + `frequency` + `nextRunDate` + `lastRunAt`
- [x] Weekly / monthly / yearly / custom
- [x] Inngest cron function, mirroring `triggerRecurringTransactions` in
      `lib/inngest/functions.js`
- [x] Give the function an explicit `id` (the existing `checkBudgetAlerts` was
      missing one)
- [x] Notify participants on generation
- [x] Pause / resume / end date

**Done when** a monthly rent template generates exactly one expense per period —
**idempotent**, so a retry or double-fire cannot double-charge.

---

## M18 · Search & filters

- [ ] Filter by group, person, category, date range, amount range, currency, name
- [ ] Server-side filtering and pagination (the existing transaction table
      filters client-side; that will not hold at ledger scale)

---

## M19 · Dashboard integration

- [ ] Summary card on `/dashboard`: You owe ₹X · Owed to you ₹Y · Net ₹Z
- [ ] Recent shared expenses, recent settlements, active groups, upcoming recurring
- [ ] "View All" → `/split`
- [ ] Must not slow the dashboard — it already does 3 sequential queries

---

# PHASE 3 — Premium

## M20 · Receipt storage ⚠ needs a decision

`Transaction.receiptUrl` exists but is **dead** — never read, never written. No
storage dependency is installed.

- [ ] **Decide the storage backend first:** Supabase Storage (you already use
      Supabase), Vercel Blob, S3, or UploadThing
- [ ] Upload action with type/size validation (the scanner caps at 5MB today)
- [ ] `SharedExpenseReceipt` rows, or reuse the existing `receiptUrl` pattern
- [ ] Signed URLs — receipts must not be publicly enumerable
- [ ] Retrofit personal transactions to actually persist receipts too

---

## M21 · Itemized split + OCR ⚠ externally blocked

- [ ] Reuse `scanReceipt()` from `actions/transaction.js`
- [ ] Extract line items → assign each to members → derive shares
- [ ] `ExpenseItem` rows; Σ items === expense total
- [ ] Manual correction UI — OCR will be wrong sometimes

**Blocked until** the Gemini `403 denied access` is resolved. Build the manual
itemized path first so the feature works without OCR.

---

## M22 · Multi-currency ⚠ net-new

There is **no** currency support today. Amounts are `Decimal` with a hardcoded `$`.

- [ ] `currency` on `SharedExpense` and `Settlement` (default from user profile)
- [ ] Store `originalAmount`, `originalCurrency`, `exchangeRate`, `convertedAmount`
- [ ] **Never overwrite original values** — store the rate used, at the time used
- [ ] Pick and integrate a rate source; cache daily
- [ ] Balances per currency; do not silently sum across currencies
- [ ] Replace hardcoded `$` app-wide via `formatMoney` from M0

---

## M23 · Shared analytics

- [ ] Total group spending, by category, by member, over time
- [ ] Total paid by user, total recovered, total owed
- [ ] **Kept separate from personal analytics**
- [ ] Inter-member transfers are **never** counted as income or expense

---

# Deferred

| Module | Why it's deferred |
|---|---|
| M24 Transaction import | Bank/CSV import is its own project with its own parsing, dedup, and mapping concerns |
| M25 Offline sync | Requires client-side persistence, conflict resolution, and a mutation queue. Effectively a re-architecture; do not attempt before M0–M23 are stable |

---

## Definition of done for the whole feature

- [ ] Group balances always sum to zero, verified by an automated invariant test
- [ ] No money value passes through a JS float anywhere in the feature
- [ ] Every balance shown traces to specific ledger rows
- [ ] Personal spending analytics reflect the user's **share**, never the amount paid
- [ ] Settlements never appear as income or expense
- [ ] Editing recalculates; deleting reverses; partial settlement leaves the remainder
- [ ] Every group action is authorization-checked server-side
- [ ] `npx next build` exits 0 with no new ESLint errors
- [ ] The module is visually indistinguishable from the rest of WealthWise
  