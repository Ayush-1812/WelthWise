# WelthWise — Resume-Targeted Interview Questions & Answers

> These questions are mapped to the **exact words** in your resume bullets. An interviewer reads your resume, picks a keyword, and digs into it. Every keyword below is covered.

---

## Resume Bullet 1

> **Built WealthWise, an AI finance platform (Next.js 15, React 19, PostgreSQL, Prisma) with Clerk auth, Recharts dashboards, Gemini receipt OCR, and Inngest automated budget alerts and reports.**

---

### Next.js 15 & React 19

---

**Q1: Why did you pick Next.js 15 specifically? What's new in v15 that helped you?**

**A:** Next.js 15 uses the **App Router** by default, which gives us React Server Components out of the box. That means our dashboard page fetches data on the server and sends ready-made HTML to the browser — no loading spinners. It also has **Server Actions** — I can write a function with `"use server"` and call it from a component like a normal function, but it executes on the server. This replaced the need for building REST APIs entirely. The `revalidatePath()` function also lets me refresh specific pages after a mutation without a full page reload.

---

**Q2: What's the difference between Server Components and Client Components? Give examples from your project.**

**A:** **Server Components** run only on the server. They can directly call the database, read environment variables, and never ship any JavaScript to the browser. In my project, the dashboard page (`app/(main)/dashboard/page.jsx`) is a Server Component — it calls `getUserAccounts()` and `getDashboardData()` directly from Prisma and renders the HTML on the server.

**Client Components** are marked with `"use client"` and run in the browser. They handle interactivity — forms, charts, dropdowns, modals. For example, the `BudgetProgress` component is a Client Component because users interact with it (updating the budget amount), and the Recharts charts are Client Components because they need the browser's canvas API to draw.

The key rule: Server Components can import Client Components, but not the other way around. Data flows from server to client via props.

---

**Q3: What are Server Actions and how did you use them?**

**A:** Server Actions are functions marked with `"use server"` that execute on the server but can be called from client-side code. Next.js automatically handles the network request behind the scenes.

In my project, all data mutations are Server Actions:
- `createAccount()` in `actions/dashboard.js` — creates a bank account
- `createTransaction()` in `actions/transaction.js` — adds an income/expense
- `scanReceipt()` in `actions/transaction.js` — sends an image to Gemini AI

When a user submits a form, the Client Component calls the Server Action directly (no `fetch()`, no API route). Next.js sends the arguments as a POST request internally, executes the function on the server, and returns the result to the client. It's simpler, type-safe, and eliminates API boilerplate.

---

**Q4: What does React 19 bring to the table? Why not React 18?**

**A:** React 19 improves Server Components and Server Actions — they're now stable (they were experimental in React 18). It also has better Suspense support for loading states, which we use with `loading.js` files in each route folder. The `use()` hook is new in React 19 — it lets you unwrap promises and context directly in the render function. We also benefit from automatic batching improvements, meaning multiple state updates trigger only one re-render.

---

**Q5: How does file-based routing work in your app? Explain the folder structure.**

**A:** In the App Router, every folder inside `app/` is a route. The `page.jsx` file inside a folder is the component that renders at that URL.

- `app/page.tsx` → `/` (landing page)
- `app/(main)/dashboard/page.jsx` → `/dashboard`
- `app/(main)/account/[id]/page.jsx` → `/account/abc-123` (dynamic route)
- `app/(main)/split/groups/page.jsx` → `/split/groups`

The `(main)` and `(auth)` folders are **route groups** — the parentheses mean they don't add to the URL path. They're just for organizing layouts. `(auth)` routes get a centered layout, `(main)` routes get a padded layout with the sidebar.

`layout.js` files wrap all children routes. `loading.js` files show a loading skeleton while the page is being fetched.

---

### PostgreSQL & Prisma

---

**Q6: Why PostgreSQL over MongoDB for a finance app?**

**A:** Three reasons:

1. **Relational data** — A transaction belongs to an account, which belongs to a user. An expense has splits, which reference users and groups. These are relationships, and PostgreSQL handles them with foreign keys and JOINs naturally. MongoDB would need manual denormalization.

2. **ACID transactions** — When I create a transaction and update the account balance, both must succeed or both must fail. PostgreSQL wraps this in a single transaction with `BEGIN/COMMIT/ROLLBACK`. MongoDB only got multi-document transactions in v4.0, and they're still slower.

3. **Decimal columns** — PostgreSQL has native `NUMERIC`/`DECIMAL` type for exact money arithmetic. MongoDB stores everything as `Double` (IEEE 754 floating-point), which means `0.1 + 0.2 = 0.30000000000000004`. For a finance app, that's unacceptable.

---

**Q7: What is Prisma and why not use raw SQL?**

**A:** Prisma is an ORM (Object-Relational Mapper) that auto-generates a typed JavaScript client from a schema file. 

Instead of writing:
```sql
SELECT * FROM users WHERE clerk_user_id = 'abc123';
```

I write:
```js
db.user.findUnique({ where: { clerkUserId: 'abc123' } })
```

Benefits: (1) **Type safety** — auto-completion and compile-time error checking. (2) **Migrations** — `prisma migrate` tracks schema changes like Git tracks code. (3) **Relations** — I define `user.accounts` once and Prisma generates the JOIN automatically. (4) **Decimal support** — Prisma has a first-class `Decimal` type that maps to PostgreSQL's `NUMERIC`.

I could use raw SQL, but I'd lose type safety and have to write my own migration system.

---

**Q8: What is `$transaction()` in Prisma? Where did you use it?**

**A:** `$transaction()` wraps multiple database operations in a single atomic transaction. Either ALL succeed or ALL are rolled back.

I used it everywhere money moves:
```js
await db.$transaction(async (tx) => {
  // 1. Create the transaction record
  await tx.transaction.create({ data: { ... } });
  
  // 2. Update account balance
  await tx.account.update({
    where: { id: accountId },
    data: { balance: { increment: amount } },
  });
});
```

If step 2 fails (say the database crashes), step 1 is rolled back too. Without this, we'd have a transaction record but a wrong balance — the money would be "lost" in the system.

---

**Q9: How does the Prisma Decimal type work with JavaScript?**

**A:** Prisma stores money as `Decimal` in PostgreSQL (arbitrary-precision) and returns it as a special Decimal object in JavaScript. The problem is:

1. Prisma's Decimal `valueOf()` returns a **string**, so `0 + prismaDecimal` concatenates instead of adding.
2. Next.js **cannot serialize** Decimal objects across the server/client boundary.

I solved both: `toDecimal()` in `lib/money.js` normalizes any input (string, number, Prisma Decimal) into a proper Decimal.js instance. And `serializeMoney()` recursively converts all Decimal values to Numbers before passing data to Client Components.

---

### Clerk Auth

---

**Q10: How does authentication work in your app?**

**A:** I use **Clerk** for authentication. The flow is:

1. **Sign up/Sign in** — Clerk provides pre-built UI components (`<SignInButton>`, `<UserButton>`). Users can sign in with email, Google, or other OAuth providers.

2. **Middleware** — `middleware.js` uses `clerkMiddleware()` to protect routes. If an unauthenticated user visits `/dashboard`, `/account`, `/transaction`, or `/split`, they're redirected to the sign-in page.

3. **User sync** — Clerk manages identities, but our app has its own `User` table. `checkUser()` runs on every page load (from the Header). It checks if the Clerk user exists in our database — if not, it creates a new row with their name, email, and profile image.

4. **Authorization** — Every Server Action calls `auth()` to get the `userId`. We then look up our database user via `clerkUserId`. If the user doesn't exist, we throw "Unauthorized".

---

**Q11: Why Clerk instead of building your own auth or using NextAuth?**

**A:** Building auth from scratch means handling: password hashing, session tokens, email verification, OAuth integration, password reset, rate limiting login attempts, CSRF protection. That's weeks of work and security risk.

Clerk gives all of that out of the box, plus pre-built UI components, social login, and multi-factor auth. NextAuth is an option, but it requires more manual setup — you build your own sign-in page, manage session storage, configure each OAuth provider manually. Clerk is more "batteries included."

The trade-off is vendor lock-in and cost at scale, but for a project of this size, the time savings are worth it.

---

**Q12: What is the `checkUser()` function doing? Why is it needed?**

**A:** Clerk manages user identities (email, password, OAuth tokens), but our app needs its own `User` table to store app-specific data (accounts, transactions, budgets, group memberships, preferences).

`checkUser()` is a **just-in-time provisioning** function. It runs on every page load:
1. Gets the current Clerk user via `currentUser()`
2. Looks up our DB for a user with that `clerkUserId`
3. If found → return it
4. If not found → create a new DB user with their Clerk name, email, and image URL

This means a user is created in our database the first time they visit any page after signing up with Clerk. We don't need a separate registration flow.

It also has a try-catch around `currentUser()` because Clerk throws (not returns null) on certain internal routes like the 404 page where its middleware isn't active. The header renders on every page, so this must never crash.

---

### Recharts Dashboards

---

**Q13: What charts did you build and what library did you use?**

**A:** I used **Recharts** — a declarative charting library built on D3 and React. The dashboard has:

1. **Income vs. Expense bar chart** — monthly comparison of total income and expenses
2. **Category breakdown pie chart** — shows spending by category (housing, food, transportation, etc.)
3. **Budget progress bar** — visual indicator of how much of the monthly budget is used (with color change at 80%)
4. **Account cards** — balance display for each bank account with transaction count

Recharts is Client Component-based (charts need the browser's SVG rendering), so these are `"use client"` components that receive data as props from the Server Component parent.

---

**Q14: How do you pass data from the server to the charts?**

**A:** The dashboard page is a Server Component. It fetches all data on the server:

```js
const [accounts, transactions, splitResult] = await Promise.all([
  getUserAccounts(),
  getDashboardData(),
  getDashboardSplitSummary(),
]);
```

This data is then passed as **props** to Client Components:
```jsx
<DashboardOverview accounts={accounts} transactions={transactions} />
```

Inside `DashboardOverview` (a Client Component), the data is processed and fed to Recharts components. The key insight: the server does the heavy lifting (DB queries), and the client just renders the pre-fetched data.

---

### Gemini Receipt OCR

---

**Q15: Explain the receipt scanning feature end-to-end.**

**A:** 

1. **User uploads a photo** in the transaction creation form (the form is a Client Component).
2. The Client Component calls the `scanReceipt()` Server Action with the file.
3. **On the server**: the file is converted to an `ArrayBuffer`, then to **Base64** string.
4. I send this Base64 image + a **structured prompt** to **Google Gemini 3.6 Flash** (a multimodal AI model that understands images).
5. The prompt says: "Extract amount, date, description, merchant, and category from this receipt as JSON."
6. Gemini returns a JSON string like `{ "amount": 450, "date": "2026-09-10", "description": "Groceries", "category": "groceries", "merchantName": "BigBazaar" }`.
7. I parse the JSON, validate it, and return the structured data to the client.
8. The Client Component **auto-fills** the transaction form with the extracted data.

If Gemini returns something that isn't a receipt, it returns an empty object and the user fills the form manually.

---

**Q16: Why Base64 and not a URL? Why not use a vision API like Google Cloud Vision?**

**A:** Base64 because the receipt isn't stored anywhere yet at the time of scanning — the user just selected a file. Converting to Base64 lets me send the raw image bytes directly in the API call without uploading it to a server first.

Gemini over Cloud Vision because Gemini is a **multimodal LLM** — it not only reads text (OCR) but also **understands** the receipt. Cloud Vision would extract every text string on the receipt, but I'd still need to write code to figure out which string is the amount, which is the date, etc. Gemini does both: it reads the text AND extracts structured fields intelligently.

---

**Q17: What happens if Gemini gives a wrong answer or returns gibberish?**

**A:** Multiple safety layers:

1. **JSON parsing try-catch** — If Gemini's output isn't valid JSON, I catch the parse error and throw "Invalid response format from Gemini". The UI shows an error toast, and the user fills the form manually.

2. **Markdown stripping** — Gemini sometimes wraps its output in ` ```json ... ``` ` code fences. I strip those with a regex before parsing: `text.replace(/```(?:json)?\n?/g, "").trim()`.

3. **The form is pre-filled, not auto-submitted** — Even if Gemini returns wrong data, the user sees the pre-filled form and can correct any field before submitting. It's a suggestion, not a commitment.

4. **Auth check** — The first thing `scanReceipt()` does is verify the user is authenticated, preventing unauthorized use of our Gemini API key.

---

### Inngest Automated Budget Alerts & Reports

---

**Q18: What is Inngest? Explain it like I've never heard of it.**

**A:** Inngest is a **background job runner**. In a normal web app, when a user clicks a button, the server handles the request and responds within seconds. But some tasks take too long or need to run on a schedule:

- Checking if users exceeded their budget — every 6 hours
- Generating monthly reports for all users — 1st of each month
- Processing recurring transactions — daily at midnight

These can't run inside a user's request. Inngest lets me define **functions** that run in the background, either on a **cron schedule** or triggered by an **event**. It handles retries (if a step fails, it retries automatically), throttling (don't process too many at once), and observability (I can see the status of every run in the Inngest dashboard).

---

**Q19: List all the background jobs and their schedules.**

**A:**

| Job | Schedule | What It Does |
|---|---|---|
| `triggerRecurringTransactions` | Daily at 00:00 | Finds personal recurring transactions that are due, sends events to process each |
| `processRecurringTransaction` | Event-driven | Creates a copy of the recurring transaction and updates account balance. **Throttled**: 10 per minute per user |
| `generateRecurringSharedExpenses` | Daily at 01:00 | Generates shared expenses from recurring templates. Idempotent via UNIQUE constraint |
| `checkBudgetAlerts` | Every 6 hours | If spending > 80% of budget, sends email alert (once per month per user) |
| `generateMonthlyReports` | 1st of each month | Computes monthly stats, gets AI insights from Gemini, sends report email via Resend |

---

**Q20: How does the budget alert work step by step?**

**A:**

1. Every 6 hours, Inngest triggers `checkBudgetAlerts`.
2. It fetches all users who have a budget set, including their default account.
3. For each user, it calculates total expenses this month for the default account (filtering out `isTransfer` transactions so shared-expense payments don't inflate spending).
4. It calculates `percentageUsed = (totalExpenses / budgetAmount) * 100`.
5. If `percentageUsed >= 80%` AND the alert hasn't been sent this month yet (`lastAlertSent` is checked):
   - It sends an email via Resend with a React Email template showing: budget amount, spent so far, remaining.
   - Updates `lastAlertSent` to `now()` so the same alert doesn't send again this month.

The "once per month" guard uses `isNewMonth()` — it compares the month and year of `lastAlertSent` with the current date.

---

**Q21: How does the monthly report generation work?**

**A:**

1. On the 1st of each month, Inngest fires `generateMonthlyReports`.
2. Fetch all users with their accounts.
3. For each user (each user is a separate Inngest **step**, so one failure doesn't block others):
   - Calculate last month's stats: total income, total expenses, spending by category.
   - Send the stats to **Gemini AI** with a prompt asking for "3 concise, actionable insights. Keep it friendly."
   - Gemini returns insights like: "Your housing costs are 43% of spending — consider reviewing", "Great job keeping entertainment expenses low!"
   - Render a **React Email** template with the stats + insights.
   - Send via **Resend**.

If Gemini fails, we fall back to 3 generic insights so the report still sends.

---

**Q22: What is "step-based execution" in Inngest and why does it matter?**

**A:** In Inngest, each function is broken into **steps** using `step.run("name", async () => { ... })`. Each step is independently:

- **Retryable** — if step 2 fails, only step 2 is retried, not the whole function.
- **Logged** — each step's input/output is visible in the Inngest dashboard.
- **Durable** — if the server crashes mid-function, Inngest resumes from the last completed step.

In `generateMonthlyReports`, each user is processed in a separate step (`generate-report-${user.id}`). If sending the email for user #50 fails, users #1–49 keep their reports, and only #50 is retried.

---

## Resume Bullet 2

> **Engineered a Splitwise-style shared-expense module with 5 split algorithms, group/friend management with RBAC, pairwise debt netting, and settlements on a derived-balance ledger across 9 tables.**

---

### Split Algorithms

---

**Q23: What are the 5 split algorithms and how does each work?**

**A:** (Actually we have 6 in the code, but the resume says 5 — you can mention 5 or 6)

| Method | How It Works | Example (₹300 among 3 people) |
|---|---|---|
| **EQUAL** | Divide equally. Leftover paisa goes to the payer. | ₹100 + ₹100 + ₹100 |
| **EXACT** | Each person enters their exact amount. Must sum to total. | ₹150 + ₹100 + ₹50 = ₹300 |
| **PERCENTAGE** | Each person enters a percentage. Must sum to 100%. | 50% + 30% + 20% → ₹150 + ₹90 + ₹60 |
| **SHARES** | Weight-based. "Rahul counts double." | Shares 1:2:1 → ₹75 + ₹150 + ₹75 |
| **CUSTOM** | Equal base + individual adjustments. | ₹300, Rahul +₹60 → base ₹240÷3 = ₹80 each → Rahul gets ₹80+₹60 = ₹140 |
| **ITEMIZED** | Line items assigned to specific people. | Pizza(₹200→Ayush,Rahul), Drink(₹100→Priya) |

Every method goes through the `allocate()` function from `lib/money.js` which uses the **Hamilton algorithm** to ensure shares sum to exactly the total with zero rounding error.

---

**Q24: What is the Hamilton algorithm? Why is it needed?**

**A:** When you split ₹100 among 3 people equally:
- Exact answer: ₹33.333...
- Rounded: ₹33.33 × 3 = ₹99.99 — we're **missing 1 paisa**!

Hamilton (also called "largest remainder method") fixes this:

1. Calculate each person's exact share: 33.333...
2. **Floor** each to the minor unit: 33.33, 33.33, 33.33
3. Sum the floors: ₹99.99
4. Leftover = ₹100 - ₹99.99 = **₹0.01** (1 paisa)
5. Sort people by their **fractional remainder** (0.333... for everyone — tie)
6. Give the leftover paisa to the first person (the payer, by our convention)

Result: ₹33.34 + ₹33.33 + ₹33.33 = **₹100.00 exactly**.

This matters because over thousands of transactions, those lost paisas add up. A finance app must never lose or invent money.

---

**Q25: Show me the code for the EQUAL split. Walk me through it.**

**A:**
```js
export function splitEqual(total, participantIds, { payerId = null } = {}) {
  const ids = assertParticipants(participantIds);  // Validate: non-empty, unique
  const value = assertPositiveTotal(total);         // Validate: positive, finite

  // Put the payer first so they absorb the leftover paisa
  const ordered = payerId && ids.includes(payerId)
    ? [payerId, ...ids.filter((id) => id !== payerId)]
    : ids;

  // allocate() does the Hamilton split — equal weights (all 1s)
  const amounts = allocate(value, ordered.map(() => 1));
  
  // Map amounts back to participant IDs
  const byId = new Map(ordered.map((id, index) => [id, amounts[index]]));
  return toSplits(ids, ids.map((id) => byId.get(id)));
}
```

The trick: we temporarily reorder participants to put the payer first, so `allocate()` gives them the extra paisa. Then we map the amounts back to the original order before returning.

---

**Q26: What happens in the EXACT method if amounts don't add up?**

**A:** It throws a clear error. The `splitExact()` function uses `checkSum()` to verify:

```js
const { ok, difference } = checkSum(value, entered);
if (!ok) {
  throw new SplitError(
    `Amounts add up to ${sum(entered)}, which is ${difference.abs()} 
     ${difference.isPositive() ? "over" : "under"} the total of ${value}`
  );
}
```

So if the total is ₹100 and the user enters ₹50 + ₹30 + ₹15 = ₹95, the error says: "Amounts add up to 95.00, which is 5.00 under the total of 100.00". The form won't submit until they fix it.

---

**Q27: How does the CUSTOM split work? Give a real-world example.**

**A:** Real-world: 4 friends at a restaurant, bill ₹4000. Everyone ate the same, but Rahul ordered an extra dessert worth ₹400.

1. Total adjustments: ₹400 (only Rahul)
2. Base amount: ₹4000 - ₹400 = ₹3600
3. Split base equally: ₹3600 ÷ 4 = ₹900 each
4. Add Rahul's adjustment: ₹900 + ₹400 = ₹1300

Final: Ayush ₹900, Rahul ₹1300, Priya ₹900, Neha ₹900 = ₹4000.

The code checks two things: (1) adjustments can't exceed the total (you can't adjust ₹5000 on a ₹4000 bill), (2) no one ends up with a negative share (you can't have a -₹200 adjustment that makes someone's share go below zero).

---

### Group/Friend Management with RBAC

---

**Q28: What is RBAC and how did you implement it?**

**A:** RBAC = **Role-Based Access Control**. Each group member has a role:

| Role | Can Add Expenses | Can Edit Others' Expenses | Can Remove Members | Can Delete Group | Can Manage Invites |
|---|---|---|---|---|---|
| **MEMBER** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **ADMIN** | ✅ | ✅ | ✅ | ❌ | ✅ |
| **OWNER** | ✅ | ✅ | ✅ | ✅ | ✅ |

This is enforced in `lib/split/auth.js` with functions like:
- `assertCanViewExpense()` — is this user a member of the group?
- `assertCanEditExpense()` — is this user the creator, or an admin/owner?
- `assertCanRemoveMember()` — is this user an admin or owner?

These **assert** functions throw an `AccessError` if the check fails. They run on the server inside Server Actions, so even a tampered client request is blocked.

---

**Q29: How does friendship work? What's "canonical storage"?**

**A:** The `Friendship` table stores friend pairs. The problem: if Ayush sends a request to Rahul, we create a row (Ayush → Rahul). But if Rahul also tries to send a request to Ayush, we'd create a duplicate row (Rahul → Ayush). Now we have two records for the same friendship.

**Canonical storage** solves this: we always store the pair with the **smaller UUID** as `requesterId` and the **larger UUID** as `addresseeId`:

```
If Ayush's UUID = "aaa..." and Rahul's UUID = "rrr..."
→ requesterId = "aaa..." (smaller), addresseeId = "rrr..." (larger)
```

A `UNIQUE(requesterId, addresseeId)` constraint makes it physically impossible to have both A→B and B→A.

But now we've lost information about who actually sent the request (it's always stored with the smaller UUID first, regardless of who initiated). So we add a separate `initiatedById` field that tracks who really pressed the "Add Friend" button.

---

**Q30: How do you handle group invites?**

**A:** Group invites use **random tokens** (not derived from the group ID — a guessable URL is an open door into the group's ledger).

The `GroupInvite` model has:
- `token` — a random, unique string that appears in the shareable URL
- `expiresAt` — optional expiry date (null = never expires)
- `maxUses` — optional limit (null = unlimited joins)
- `useCount` — how many times it's been used
- `revokedAt` — set when someone revokes the link

When someone visits the invite URL:
1. Find the invite by token
2. Check: is it expired? Is `useCount >= maxUses`? Is `revokedAt` set?
3. Check: is the user already a member?
4. If all good → add them to the group, increment `useCount`

We don't delete revoked invites — we keep the data so the UI can explain "this link was revoked on date X" rather than just showing a 404.

---

**Q31: What happens when you try to remove a member from a group?**

**A:** Two checks:

1. **Balance check** — We compute the member's net balance from the ledger. If it's non-zero (they owe money or are owed money), removal is **blocked**. The UI says "This member has unsettled balances." You can't remove someone who hasn't settled up.

2. **Soft removal** — If their balance is zero, we set `leftAt = now()` on their `GroupMember` row instead of deleting it. This way:
   - Their historical expense splits are still visible
   - The activity log still shows "Priya added an expense for ₹500"
   - They just can't add new expenses or see new activity

---

### Pairwise Debt Netting

---

**Q32: What is pairwise debt netting? Explain with an example.**

**A:** Pairwise netting means: instead of saying "the group balance is ₹500", we break it down into **who owes whom**.

Example: 3 friends in a group. After several expenses:
- Ayush paid ₹1000 for dinner (split equally → Rahul owes ₹333, Priya owes ₹333)
- Rahul paid ₹600 for movie (split equally → Ayush owes ₹200, Priya owes ₹200)

**Pairwise debts:**
- Rahul → Ayush: ₹333 - ₹200 = ₹133 (Rahul owes Ayush ₹133 net)
- Priya → Ayush: ₹333 (from dinner)
- Priya → Rahul: ₹200 (from movie)

This is what `computePairwiseBalances()` does — it loops through all expenses and settlements, builds a map of directional debts, then **nets** opposing debts between the same two people.

---

**Q33: What's the difference between net balance and pairwise balance?**

**A:** 

- **Net balance** = single number per person. "Ayush is owed ₹466 total." Useful for a summary.
- **Pairwise balance** = who owes whom specifically. "Rahul owes Ayush ₹133. Priya owes Ayush ₹333. Priya owes Rahul ₹200." Useful for settling up.

Net balance is what `computeNetBalances()` returns. Pairwise is what `computePairwiseBalances()` returns. Both are derived from the same ledger. The net of all pairwise debts involving a user equals their net balance.

---

**Q34: How does debt simplification work on top of pairwise netting?**

**A:** `simplifyDebts()` in `lib/split/simplify.js` reduces the number of payments.

Before simplification (raw pairwise):
- A owes B ₹500
- B owes C ₹500
- Total: 2 payments

After simplification:
- A owes C ₹500
- Total: 1 payment

Algorithm (minimum cash flow):
1. Compute each person's net balance: A = -500, B = 0, C = +500
2. Find the largest debtor (A, -500) and largest creditor (C, +500)
3. Transfer the smaller amount (₹500) from A to C
4. Both are now at zero. Done.

This produces at most **n-1 payments for n people**. The `preservesBalances()` function verifies that everyone's position is unchanged after simplification.

---

### Derived-Balance Ledger

---

**Q35: What does "derived-balance ledger" mean?**

**A:** It means balances are **never stored** in the database. They're **computed** every time from the raw data (expenses, splits, settlements).

The formula is:
```
net(user) = Σ paid(user) − Σ owed(user) + Σ settlementsSent(user) − Σ settlementsReceived(user)
```

If the result is positive → the user is owed money.
If negative → the user owes money.

Why not store balances? Because if we store them, every expense/settlement must update them. If that update fails (server crash, race condition), the stored balance is **wrong** and we've effectively lost or invented money. With derived balances, the raw ledger is the source of truth, and balances are always correct.

The trade-off: slower reads (we compute every time) but impossible to have stale data.

---

**Q36: What are the 9 tables? List them and their purpose.**

**A:** The 9 split-related tables in the schema:

| # | Table | Purpose |
|---|---|---|
| 1 | **Friendship** | Friend pairs (canonical storage, with status: PENDING/ACCEPTED/BLOCKED) |
| 2 | **ExpenseGroup** | Groups (name, description, icon, archive status) |
| 3 | **GroupMember** | Membership (user-group link with role and join/leave dates) |
| 4 | **GroupInvite** | Shareable invite links (token, expiry, max uses, revocation) |
| 5 | **SharedExpense** | The expense itself (amount, currency, split method, payer, soft-delete) |
| 6 | **ExpenseSplit** | Each participant's share (shareAmount + shareInput for round-trip) |
| 7 | **ExpenseItem** | Line items for itemized splits (name, amount, assignedTo) |
| 8 | **Settlement** | Money transfer between users (amount, method: cash/UPI/bank) |
| 9 | **SharedExpenseActivity** | Append-only audit log of all ledger-mutating actions |

Plus `RecurringSharedExpense` and `Notification` make it 11 total, but the core ledger is these 9.

---

**Q37: Why soft-delete expenses instead of hard-delete?**

**A:** If I hard-delete an expense, any settlements that were recorded to partially pay off that expense become **orphans** — the numbers won't reconcile. A user settled ₹500, but the ₹500 expense is gone — where did the settlement go?

Soft delete sets `isDeleted = true, deletedAt = timestamp`. The expense row stays in the database. The balance formula simply skips it:

```js
for (const expense of expenses) {
  if (expense.isDeleted) continue;  // Skip deleted expenses
  // ... compute balances
}
```

From the user's perspective, the expense is gone. From the ledger's perspective, it's still there for auditability, and past settlements remain explainable.

---

**Q38: What is `shareInput` vs `shareAmount` in ExpenseSplit?**

**A:** 

- `shareAmount` = the resolved money value in rupees. Always stored. This is what the balance formula uses.
- `shareInput` = what the user actually typed. Only for percentage/shares/custom splits.

Example with percentage split on ₹300:
- User types: Ayush 50%, Rahul 30%, Priya 20%
- `shareInput` = [50, 30, 20] (percentages)
- `shareAmount` = [₹150, ₹90, ₹60] (resolved amounts)

Why store both? For **round-trip editing**. If the user edits this expense later, we show them "50%, 30%, 20%" (the percentages they originally entered) rather than "₹150, ₹90, ₹60" (the computed amounts). Without `shareInput`, we'd have to reverse-engineer the percentages from the amounts, which is lossy due to rounding.

---

### Settlements

---

**Q39: How does the settlement flow work?**

**A:** 

1. User A sees "You owe Rahul ₹500" on the balances page (computed from the ledger).
2. User A clicks "Settle Up" and enters: amount ₹500, method UPI.
3. Server Action creates a `Settlement` row: `fromUserId = A, toUserId = Rahul, amount = 500, method = UPI`.
4. An `SharedExpenseActivity` row is created (audit log).
5. Notifications are sent to Rahul (in-app + email).
6. Optionally, the settlement syncs to personal accounts:
   - A's bank account: debit ₹500 (Transaction with `isTransfer = true`)
   - Rahul's bank account: credit ₹500 (Transaction with `isTransfer = true`)
7. `revalidatePath()` refreshes the UI — A now sees "You owe Rahul ₹0".

The `isTransfer` flag ensures these transactions don't appear in personal analytics or budget calculations.

---

**Q40: Can a user partially settle a debt?**

**A:** Yes. If A owes Rahul ₹500, A can settle ₹200. The system creates a settlement for ₹200. The balance formula recalculates:

```
Before: A owes Rahul ₹500
Settlement: A pays Rahul ₹200
After:  A owes Rahul ₹300
```

There's no "partial settlement" flag — it's just a settlement for a smaller amount. Multiple settlements between the same two people are accumulated by the balance formula.

---

## Resume Bullet 3

> **Built a decimal-safe money engine eliminating floating-point errors, with server-side validation and 260+ unit/property tests enforcing a balances-sum-to-zero invariant.**

---

### Decimal-Safe Money Engine

---

**Q41: What is the floating-point problem in JavaScript?**

**A:** JavaScript uses IEEE 754 double-precision floating-point for all numbers. This means:

```js
0.1 + 0.2 === 0.30000000000000004  // true!
0.1 + 0.2 === 0.3                   // false!
```

For a calculator or a game, this tiny error doesn't matter. For a **finance app**, it does. If I process 10,000 transactions, each with a ₹0.0000000000000004 error, those errors compound. Over time, account balances drift, split expenses don't sum to the total, and money is effectively "lost" or "created" in the system.

---

**Q42: How did you solve it? What is `lib/money.js`?**

**A:** `lib/money.js` is the **single module** through which all monetary calculations in the app pass. Nothing else imports `Decimal.js` directly.

It provides:
- `toDecimal(value)` — converts any input (string, number, Prisma Decimal) into a safe Decimal instance
- `add(a, b)`, `sub(a, b)`, `mul(a, b)`, `div(a, b)` — arithmetic that always works on Decimals
- `sum(values)` — sum a list safely
- `round(value)` — round to 2 decimal places using half-up (the rounding rule people expect for money)
- `allocate(total, weights)` — Hamilton algorithm for fair division
- `checkSum(total, parts)` — verify parts sum to total
- `equals(a, b)` — safe comparison (never use `===` on Decimals)

Decimal.js does arithmetic in **base 10** (like a calculator), not base 2 (like IEEE 754). So `0.1 + 0.2 = 0.3` exactly.

---

**Q43: What is the "money concatenation bug" you fixed?**

**A:** Prisma's Decimal type overrides `valueOf()` to return a **string**. So when you do JavaScript arithmetic:

```js
0 + prismaDecimal("100.50") + prismaDecimal("50.25")
// JavaScript evaluates this as:
// 0 + "100.50" + "50.25"
// = "0100.5050.25"  (string concatenation!)
```

This exact bug was in `actions/account.js` — the `bulkDeleteTransactions` function was calculating balance changes by adding Prisma Decimals directly. The fix: call `.toNumber()` first, or better, use `toDecimal()` from our money module to normalize everything.

The code comment in `lib/money.js` documents this bug as a warning:
```
// 0 + new Decimal("100.50") + new Decimal("50.25")  →  "0100.550.25"
// That exact bug already shipped in actions/account.js.
```

---

**Q44: Why pinned precision? What does `Decimal.set({ precision: 34 })` do?**

**A:** Decimal.js has a global precision setting that controls how many significant digits it tracks. If left at the default, different environments (Node.js version, browser) might use different defaults, making calculations **non-deterministic** — the same split could produce different results on different servers.

We pin it to 34 digits (more than enough for any currency) so results are identical everywhere:
```js
Decimal.set({ precision: 34, toExpNeg: -18, toExpPos: 30 });
```

`toExpNeg` and `toExpPos` control when Decimal switches to exponential notation. We set them to extreme values so money is always displayed in standard notation.

---

**Q45: What is `allocate()` and when is it used?**

**A:** `allocate(total, weights)` splits a total into parts proportional to the weights, with the guarantee that the parts sum to **exactly** the total.

```js
allocate(100, [1, 1, 1])   // → [33.34, 33.33, 33.33]  (sums to 100)
allocate(100, [50, 30, 20]) // → [50.00, 30.00, 20.00]  (sums to 100)
allocate(0.03, [1, 1, 1])  // → [0.01, 0.01, 0.01]     (sums to 0.03)
```

It's used in every split method:
- EQUAL → `allocate(total, [1, 1, 1, ...])`
- PERCENTAGE → `allocate(total, [50, 30, 20])`
- SHARES → `allocate(total, [1, 2, 1])`
- CUSTOM → `allocate(base, [1, 1, 1, ...])` + adjustments

The algorithm works in whole minor units (paisa/cents) internally to keep arithmetic integral, then converts back to rupees at the end.

---

**Q46: How does `serializeMoney()` work and why is it needed?**

**A:** Next.js Server Components pass data to Client Components via props. But Next.js can only serialize plain objects, arrays, strings, numbers, booleans, and Dates. It **cannot** serialize Decimal instances.

`serializeMoney()` recursively walks any object and converts Decimal values to Numbers:

```js
serializeMoney({ amount: new Decimal("100.50"), name: "Groceries" })
// → { amount: 100.50, name: "Groceries" }
```

The tricky part: Prisma uses its own bundled copy of Decimal.js, so `value instanceof Decimal` fails for database values. We use **duck typing** instead:
```js
if (typeof input === "object" && typeof input.toNumber === "function" && typeof input.toFixed === "function") {
  return input.toNumber();
}
```

If it looks like a Decimal (has `toNumber` and `toFixed` methods), treat it as one.

---

### Server-Side Validation

---

**Q47: Why validate on the server if you already validate on the client?**

**A:** **Never trust the client.** Anyone can:
1. Open browser DevTools and modify form data before submission
2. Use Postman/curl to call the Server Action directly with tampered data
3. Disable JavaScript, bypassing all client-side validation

Client-side validation (React Hook Form + Zod) is for **user experience** — instant feedback while typing. Server-side validation is for **security** — the last line of defense before data hits the database.

In our split expenses, the server re-validates every split:
```js
const result = validateSplit(total, splits);
if (!result.ok) throw new SplitError(result.errors[0]);
```

Even if the client sends `{ shareAmount: -100 }` (a negative share), the server catches it and rejects the request.

---

**Q48: What does `validateSplit()` check?**

**A:** It's the **gate every ledger write passes through**. It checks:

1. **Total is positive** — you can't create a ₹0 or negative expense
2. **At least one participant** — an expense needs someone to split it
3. **No duplicate participants** — the same person can't appear twice
4. **Every participant has a user ID** — no empty/null IDs
5. **No negative shares** — no one can owe a negative amount
6. **Correct precision** — shares can't have more decimal places than the currency allows (2 for most)
7. **Shares sum to total** — the most critical check. If shares add up to ₹99.99 but the total is ₹100, it throws: "Splits add up to 99.99 but the total is 100.00"

It returns `{ ok, errors, expected, actual, difference }` so the caller can show a helpful error message.

---

**Q49: What is the `assertValidSplit()` vs `validateSplit()` distinction?**

**A:** Same logic, different API:

- `validateSplit()` — returns a result object: `{ ok: true/false, errors: [...] }`. The caller decides what to do.
- `assertValidSplit()` — calls `validateSplit()` internally but **throws** on failure. Used when you want the write to fail immediately without checking the result.

This is the "validate and return" vs "assert and throw" pattern. We use `validateSplit()` in the API layer (to return user-friendly errors) and `assertValidSplit()` in tests (to fail fast).

---

### 260+ Unit/Property Tests

---

**Q50: What testing framework did you use?**

**A:** Node.js built-in test runner (`node:test`). No Jest, no Mocha. Run with:
```bash
node --test "lib/**/*.test.js"
```

Why the built-in runner? (1) Zero dependencies — no `jest`, `ts-jest`, `@types/jest` etc. (2) Fast startup — no transpilation step. (3) Native ESM support — our code uses ES modules, which Jest handles poorly without configuration.

---

**Q51: What do the 260+ tests cover?**

**A:** The `lib/split/` directory has **20 test files** covering:

| Test File | What It Tests |
|---|---|
| `engine.test.js` | All 6 split methods — correct amounts, edge cases, error handling |
| `balances.test.js` | Net balance derivation, pairwise balances, contributions between pairs |
| `simplify.test.js` | Debt simplification algorithm — correctness, invariant preservation |
| `currency.test.js` | Multi-currency filtering, cross-currency error handling |
| `itemized.test.js` | Itemized split computation, unassigned items, multiple assignees |
| `filters.test.js` | Expense query filter normalization and WHERE clause building |
| `friends.test.js` | Friend list derivation, canonical ordering |
| `groups.test.js` | Group access checks, role validation |
| `access.test.js` | Permission checks (view, edit, delete) |
| `receipts.test.js` | Receipt path validation, storage path detection |
| `invites.test.js` | Invite token validation, expiry, max uses |
| `notifications.test.js` | Notification formatting, type mapping |
| `recurring.test.js` | Recurring expense generation, idempotency |
| `settlements.test.js` | Settlement creation, balance effects |
| `personal.test.js` | Personal account sync logic |
| `categories.test.js` | Category validation |
| `money.test.js` | Core decimal arithmetic, allocation, round-trip |

The tests focus on **pure functions** (engine, balances, simplify, money) because they're the most critical and the easiest to test — no database, no network, no side effects.

---

**Q52: What is the "balances-sum-to-zero invariant"?**

**A:** In a closed ledger, the total of all net balances must be **exactly zero**. The money one person is owed is exactly the money others owe. If the sum is non-zero, it means the system has "created" or "destroyed" money — a bug.

```
Ayush: +500 (owed to him)
Rahul: -200 (he owes)
Priya: -300 (she owes)
Sum:   +500 - 200 - 300 = 0 ✅
```

We enforce this with:
1. `balancesSumToZero(ledger)` — a function that computes all net balances and checks their sum
2. Every test that creates expenses + settlements asserts this invariant
3. `simplifyDebts()` **refuses** to simplify if the input balances don't sum to zero — it throws `"Balances do not sum to zero (off by X) — the ledger is inconsistent"`

This invariant is the strongest correctness guarantee in the system. If it ever fails, there's a bug in the split engine or balance computation.

---

**Q53: Give an example of a property-based test.**

**A:** Property-based tests check that a **property** holds for many random inputs, rather than testing specific values.

Example: "For any total and any number of participants, the equal split must sum to exactly the total."

```js
// Pseudocode
for (let total of [0.01, 0.03, 1, 99.99, 100, 1000, 999999.99]) {
  for (let n = 1; n <= 20; n++) {
    const splits = splitEqual(total, generateIds(n));
    const sum = splits.reduce((s, sp) => s + sp.shareAmount, 0);
    assert(sum === total);  // Must hold for ALL inputs
  }
}
```

This catches edge cases that example-based tests miss — like splitting ₹0.03 among 7 people, or ₹999999.99 among 1 person.

---

### Deep Questions an Interviewer Might Ask

---

**Q54: If `computeNetBalances()` computes balances on every read, isn't that slow? How would you optimize it?**

**A:** Yes, it's O(expenses + settlements) on every read. For a group with 10,000 expenses, it would be slow. Ways to optimize:

1. **Materialized view** — PostgreSQL can precompute balances and update them incrementally when the underlying data changes.
2. **Redis cache** — Cache the balance result, invalidate when an expense or settlement is created/edited/deleted.
3. **Snapshot + delta** — Store a "balance snapshot" periodically, and only compute from the delta since the last snapshot.

For our current scale (hundreds of expenses per group), it's fast enough. Optimization would be needed at ~10K+ expenses per group.

---

**Q55: What if two users create an expense at the same time? Is there a race condition?**

**A:** No race condition on the **ledger** because each expense is an independent row — two concurrent inserts don't conflict. The balance is derived (not stored), so two concurrent reads both produce correct results based on whatever data exists at read time.

The potential issue is on **personal account balance updates** — two concurrent transactions updating the same account balance. We handle this with Prisma's `$transaction()` and PostgreSQL's row-level locking. The `{ balance: { increment: amount } }` syntax generates a SQL `UPDATE ... SET balance = balance + X`, which is atomic at the database level.

---

**Q56: How do you handle the edge case of splitting ₹0.01 among 3 people?**

**A:** `allocate(0.01, [1, 1, 1])` returns `[0.01, 0.00, 0.00]`. The first person (the payer) gets the entire paisa. The other two get zero. This is mathematically correct: you can't split 1 paisa into 3 equal parts. The Hamilton algorithm gives the leftover to the person with the largest fractional remainder, and since all remainders are equal, it goes to the first person by index (the payer).

---

**Q57: Why separate `lib/format.js` from `lib/money.js`?**

**A:** `lib/money.js` imports `Decimal.js` and `Prisma` types. If a Client Component imports `lib/money.js`, the entire Prisma runtime (500KB+) would ship to the browser.

`lib/format.js` contains ONLY formatting functions (`formatMoney()`, `formatMoneyCompact()`, `currencySymbol()`) with zero heavy imports. Client Components import from `lib/format.js`, server code imports from `lib/money.js` (which re-exports formatting for convenience).

This **tree-shaking boundary** keeps the browser bundle lean.

---

**Q58: What does `import "server-only"` do and where did you use it?**

**A:** `import "server-only"` is a Next.js convention. If any Client Component (or code that runs in the browser) tries to import a module that starts with `import "server-only"`, the **build fails** with a clear error.

I used it in two places:
1. `actions/send-email.js` — contains the Resend API key. If imported client-side, the key would leak.
2. `lib/storage.js` — contains the Supabase service-role key. Same risk.

It's a **compile-time guardrail**, not a runtime check. It prevents accidental leaks before the app is even deployed.

---

**Q59: Your schema has `@@index` annotations. How did you decide which indexes to create?**

**A:** Every index was chosen based on the actual queries the app runs:

- `@@index([userId])` on transactions → `WHERE userId = ?` is the most common query
- `@@index([groupId, isDeleted])` on shared_expenses → listing active group expenses
- `@@index([userId, readAt])` on notifications → the unread badge query (`WHERE userId = ? AND readAt IS NULL`)
- `@@index([userId, isTransfer])` on transactions → dashboard analytics filter (`WHERE isTransfer = false`)
- `@@index([isActive, nextRunDate])` on recurring_shared_expenses → the cron job finds due templates

The rule: if a column appears in a `WHERE` clause or `ORDER BY` in a query that runs frequently, it gets an index. I don't over-index because each index slows down writes.

---

**Q60: Walk me through what happens when the app starts and a brand new user visits for the first time.**

**A:**

1. User visits `/` → Landing page renders (Server Component, no auth needed).
2. User clicks "Start Free Trial" → navigated to `/dashboard`.
3. **Middleware fires** — `clerkMiddleware()` sees `/dashboard` is protected and the user isn't signed in → redirects to Clerk sign-in page.
4. User signs in with Google OAuth → Clerk creates a Clerk user, redirects back to `/dashboard`.
5. **Header renders** — it's an async Server Component that calls `checkUser()`:
   - `currentUser()` returns the Clerk user.
   - `db.user.findUnique({ where: { clerkUserId } })` returns `null` (first visit).
   - `db.user.create()` creates a new row in our Users table with their name, email, and profile image.
6. **Dashboard page renders** — fetches accounts (empty), transactions (empty), split summary (empty).
7. User sees "No budget set" and an "Add New Account" card.
8. User creates their first account → `createAccount()` Server Action runs:
   - Arcjet rate limiting check passes.
   - No existing accounts → `isDefault` is forced to `true`.
   - Account is created with the given balance.
   - `revalidatePath("/dashboard")` refreshes the page.
9. Dashboard now shows the account card with balance and "0 transactions".

The user is fully set up — no separate onboarding flow needed. Everything is just-in-time.

---

**Q61: If you had to rewrite this project from scratch, what would you do differently?**

**A:** 

1. **TypeScript everywhere** — Currently it's a mix of JS and TS. I'd use TS for all files to get full type safety on Server Actions and Prisma queries.

2. **tRPC or Hono** instead of Server Actions — Server Actions are great for simple mutations but don't give you a typed API contract. tRPC would give end-to-end type safety between server and client.

3. **Redis from day one** — For caching notification counts, dashboard summaries, and rate limiting (instead of Arcjet).

4. **Event sourcing** for the split ledger — Instead of mutable expense rows, I'd store immutable events ("Ayush added expense for ₹1000", "Rahul settled ₹500"). Balances would be projections of the event stream. This gives perfect auditability and time-travel.

5. **Separate API service** — The split expense module is complex enough to be its own microservice with its own database, communicating via events. This would let it scale independently.

---

**Q62: What was the hardest bug you encountered?**

**A:** The **Prisma Decimal concatenation bug**. Account balances were randomly wrong — sometimes absurdly large numbers like "05000.002500.00". It took a while to realize that Prisma's `Decimal.valueOf()` returns a string, so `+` was concatenating instead of adding.

The fix was systematic: I built `lib/money.js` so no code in the app ever does raw arithmetic on Prisma Decimals. Everything goes through `toDecimal()` first. The module has a comment documenting the exact bug as a warning for future developers.

The second hardest was getting the balance-sum-to-zero invariant to hold across all edge cases — deleted expenses, partial settlements, and multi-currency ledgers. Property-based tests found several subtle rounding issues that example-based tests missed.

---

**Q63: How confident are you that the money engine is correct?**

**A:** Very confident, because of four layers of protection:

1. **260+ tests** covering edge cases (₹0.01 splits, single participant, 20 participants, negative adjustments, mixed currencies, deleted expenses, partial settlements).

2. **Balances-sum-to-zero invariant** enforced in tests AND in production (`simplifyDebts` refuses to run if the invariant fails).

3. **Hamilton allocation** guarantees zero rounding loss mathematically — every `allocate()` call sums to exactly the input total.

4. **`validateSplit()` gate** on every write — even if the client sends tampered data, the server rejects anything that doesn't sum correctly.

If a new edge case is found, I add a test first (red), fix the code (green), and the invariant catches any regression.
