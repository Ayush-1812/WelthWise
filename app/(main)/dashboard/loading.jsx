import { BarLoader } from "react-spinners";

/**
 * Streamed fallback for the dashboard.
 *
 * DashboardPage awaits accounts, transactions and the split summary together,
 * then the budget. Without this file the whole route blocks on the slowest of
 * those queries and the user sees nothing at all.
 */
export default function DashboardLoading() {
  return (
    <div className="space-y-8 px-5">
      <h1 className="gradient-title text-6xl font-bold">Dashboard</h1>
      <BarLoader width={"100%"} color="#9333ea" />
    </div>
  );
}
