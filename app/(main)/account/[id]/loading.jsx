import { BarLoader } from "react-spinners";

/** Fallback while the account, its transactions and its chart data load. */
export default function AccountLoading() {
  return (
    <div className="space-y-8 px-5 py-6">
      <BarLoader width={"100%"} color="#9333ea" />
    </div>
  );
}
