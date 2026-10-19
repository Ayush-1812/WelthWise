#  WealthWise – AI-Powered Personal Finance Platform

A modern full-stack personal finance platform that helps users track income, expenses, budgets, and financial goals with AI-powered insights and real-time analytics.

🌐 **Live Demo:** https://welth-wise-nwr1.vercel.app/

---

## ✨ Features
- 📊 Interactive financial dashboard
- 💸 Income & expense management
- 🤖 AI-powered financial insights and recommendations
- 📈 Visual spending analytics and reports
- 📅 Monthly financial summaries
- 🔔 Automated recurring transactions and budget alerts
- 🧾 AI receipt scanning (Gemini vision)
- 🔄 Automatic account balance calculation
---

## 🛠️ Tech Stack

### Frontend
- Next.js 15
- React 19
- Tailwind CSS
- Shadcn/UI
- Lucide React

### Backend
- Next.js API Routes
- Prisma ORM
- Inngest
- Clerk Authentication

### Database
- PostgreSQL (Supabase)

### AI
- Google Gemini API

### Deployment
- Vercel

---

# 🏗️ Technical Architecture

```text
                          ┌─────────────────────────┐
                          │        Client           │
                          │  Next.js + React UI     │
                          └──────────┬──────────────┘
                                     │
                                     │ HTTPS
                                     ▼
                    ┌────────────────────────────────┐
                    │        Next.js Server          │
                    │    API Routes / Server Actions │
                    └──────────┬─────────┬───────────┘
                               │         │
                Authentication │         │ Business Logic
                               │         │
                               ▼         ▼
                     ┌─────────────┐   ┌──────────────────┐
                     │   Clerk     │   │     Prisma ORM    │
                     └─────────────┘   └─────────┬─────────┘
                                                 │
                                                 ▼
                                    ┌────────────────────────┐
                                    │ PostgreSQL (Supabase)  │
                                    └────────────────────────┘

                               │
                               │ AI Requests
                               ▼
                      ┌─────────────────────┐
                      │ Google Gemini API   │
                      └─────────────────────┘

                               │
                               │ Background Jobs
                               ▼
                      ┌─────────────────────┐
                      │      Inngest        │
                      └─────────────────────┘
```

---

## 📂 Project Structure

```
wealthwise
│
├── app/
├── components/
├── actions/
├── lib/
├── prisma/
├── hooks/
├── public/
├── styles/
├── utils/
└── middleware.ts
```

---

## 🚀 Getting Started

### Clone the repository

```bash
git clone https://github.com/<your-username>/wealthwise.git
```

### Install dependencies

```bash
npm install
```

### Configure Environment Variables

Copy `.env.example` to `.env` and fill in each value.

```bash
cp .env.example .env
```

```env
# Database (Supabase Postgres)
DATABASE_URL=          # pooled, port 6543 + pgbouncer
DIRECT_URL=            # direct, port 5432 (Prisma Migrate)

# Auth (Clerk)
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=

# Background jobs (Inngest)
INNGEST_EVENT_KEY=
INNGEST_SIGNING_KEY=

# Rate limiting (Arcjet)
ARCJET_KEY=

# AI (Google Gemini) - needs billing enabled on the project
GEMINI_API_KEY=

# Email (Resend) - needs a verified domain to send to other addresses
RESEND_API_KEY=
RESEND_FROM=           # e.g. WealthWise <alerts@yourdomain.com>; unset = test sender

# Receipt storage (Supabase Storage) - uploads disable themselves if unset
NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

### Run migrations

```bash
npx prisma migrate dev     # local development
npx prisma migrate deploy  # a fresh or restored database
```

### Run locally

```bash
npm run dev
```

### Run the tests

```bash
npm test        # 597 unit and property-based tests, no database required
npx eslint .    # 0 errors, 0 warnings
```

The money and split logic in `lib/` is deliberately free of Prisma and React
imports, so the whole suite runs in about a second against no infrastructure.

The end-to-end scripts in `scripts/e2e/` are different: they create and delete
real rows in whatever database `DATABASE_URL` points at. They refuse to run
unless you opt in, so point `DATABASE_URL` at a disposable database first:

```bash
E2E_ALLOW_WRITES=1 node scripts/e2e/m13-e2e.mjs
```

---

## 🛟 Troubleshooting

### `FATAL: (ENOTFOUND) tenant or user not found`

The Supabase project named in `DATABASE_URL` no longer exists. Free-tier
projects pause after about a week of inactivity and are eventually deleted, and
the pooler hostname keeps resolving afterwards, so this looks like a credentials
problem rather than a missing database.

Recovery:

1. Create a new Supabase project.
2. Put its pooled connection string in `DATABASE_URL` (port 6543, with
   `?pgbouncer=true`) and its direct one in `DIRECT_URL` (port 5432).
3. `npx prisma migrate deploy` to replay all nine migrations.
4. Create the private `receipts` bucket, then set `NEXT_PUBLIC_SUPABASE_URL`
   and `SUPABASE_SERVICE_ROLE_KEY`.

The app will still boot and serve the landing page without a database, because
the header treats user provisioning as best-effort. Signing in is what surfaces
the failure.

---

##  Future Improvements

- SplitWise-style shared expense tracking and settlement
- Group expense management and debt simplification
- Expense sharing via invite links
- Redis caching for dashboard analytics
- Multi-currency support
- Investment portfolio tracking
- Export reports as PDF
- Financial goal prediction using AI

---

## 👨‍💻 Author

**Ayush Carpenter**

- GitHub: https://github.com/Ayush-1812

---

##  If you like this project

Give it a ⭐ on GitHub!
