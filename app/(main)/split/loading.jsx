import { BarLoader } from "react-spinners";

/**
 * Shared fallback for every /split/* route.
 *
 * Balance pages derive their numbers from the whole ledger on each request, so
 * they are the slowest reads in the app and the ones that most need a skeleton.
 */
export default function SplitLoading() {
  return (
    <div className="space-y-6">
      <BarLoader width={"100%"} color="#9333ea" />
    </div>
  );
}
