# 💰 WealthWise – AI-Powered Personal Finance Platform

> A modern full-stack personal finance platform that helps users track income, expenses, budgets, and financial goals with AI-powered insights and real-time analytics.

🌐 **Live Demo:** https://welth-wise-nwr1-git-main-ayush-carpenters-projects.vercel.app/

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
```

### Run migrations

```bash
npx prisma migrate dev
```

### Run locally

```bash
npm run dev
```

---

## 📈 Future Improvements

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

## ⭐ If you like this project

Give it a ⭐ on GitHub!
