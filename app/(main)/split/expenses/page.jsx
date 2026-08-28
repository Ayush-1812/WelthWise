import { getSharedExpenses, getFilterOptions } from "@/actions/split/expenses";

import { ExpenseBrowser } from "./_components/expense-browser";

export default async function SplitExpensesPage() {
  // First page rendered on the server so the list is correct on first paint;
  // filtering and paging then run through the same action from the client.
  const [initial, optionsResult] = await Promise.all([
    getSharedExpenses({ limit: 25 }),
    getFilterOptions(),
  ]);

  const options = optionsResult.success
    ? optionsResult.data
    : { myUserId: null, groups: [], people: [] };

  return (
    <ExpenseBrowser
      initial={initial.success ? initial : { data: [], nextCursor: null }}
      options={options}
    />
  );
}
