import { serve } from "inngest/next";
import {inngest} from "@/lib/inngest/client"
import {checkBudgetAlerts,processRecurringTransaction,triggerRecurringTransactions,generateMonthlyReports,generateRecurringSharedExpenses} from "@/lib/inngest/functions"

// Serves all five background jobs: the recurring-transaction trigger and its
// per-transaction worker, recurring shared expenses, budget alerts, and the
// monthly report. Adding a function to lib/inngest/functions.js is not enough -
// it must be listed here or its cron never fires.
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
     checkBudgetAlerts,
     processRecurringTransaction,
     triggerRecurringTransactions,
     generateMonthlyReports,
     generateRecurringSharedExpenses,

  ],
});