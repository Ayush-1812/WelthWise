import { SplitNav } from "./_components/split-nav";

export const metadata = {
  title: "Split Expenses | WealthWise",
  description: "Share expenses with friends and groups, and settle up.",
};

export default function SplitLayout({ children }) {
  return (
    <div className="px-5">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="gradient-title text-6xl font-bold tracking-tight">
          Split Expenses
        </h1>
      </div>
      <SplitNav />
      {children}
    </div>
  );
}
