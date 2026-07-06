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
- 🔔 Automated recurring transaction reminders
- - 👥 SplitWise-style shared expense tracking and settlement
- 💳 Group expense management
- 🔄 Automatic balance calculation and debt simplification
- 📧 Expense sharing via invite links
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

Create a `.env` file.

```env
DATABASE_URL=

NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=

GEMINI_API_KEY=

NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

### Run locally

```bash
npm run dev
```

---

## 📈 Future Improvements

- Redis caching for dashboard analytics
- Email notifications
- Multi-currency support
- OCR receipt scanning
- Investment portfolio tracking
- Export reports as PDF
- Financial goal prediction using AI

---

## 📸 Screenshots

> Add screenshots of:
>
> - Dashboard
> - Budget Page
> - AI Insights
> - Transactions
> - Authentication

---

## 👨‍💻 Author

**Ayush Carpenter**

- GitHub: https://github.com/Ayush-1812

---

## ⭐ If you like this project

Give it a ⭐ on GitHub!
