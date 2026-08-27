export const defaultCategories = [
  // Income Categories
  {
    id: "salary",
    name: "Salary",
    type: "INCOME",
    color: "#22c55e", // green-500
    icon: "Wallet",
  },
  {
    id: "freelance",
    name: "Freelance",
    type: "INCOME",
    color: "#06b6d4", // cyan-500
    icon: "Laptop",
  },
  {
    id: "investments",
    name: "Investments",
    type: "INCOME",
    color: "#6366f1", // indigo-500
    icon: "TrendingUp",
  },
  {
    id: "business",
    name: "Business",
    type: "INCOME",
    color: "#ec4899", // pink-500
    icon: "Building",
  },
  {
    id: "rental",
    name: "Rental",
    type: "INCOME",
    color: "#f59e0b", // amber-500
    icon: "Home",
  },
  {
    id: "other-income",
    name: "Other Income",
    type: "INCOME",
    color: "#64748b", // slate-500
    icon: "Plus",
  },

  // Expense Categories
  {
    id: "housing",
    name: "Housing",
    type: "EXPENSE",
    color: "#ef4444", // red-500
    icon: "Home",
    subcategories: ["Rent", "Mortgage", "Property Tax", "Maintenance"],
  },
  {
    id: "transportation",
    name: "Transportation",
    type: "EXPENSE",
    color: "#f97316", // orange-500
    icon: "Car",
    subcategories: ["Fuel", "Public Transport", "Maintenance", "Parking"],
  },
  {
    id: "groceries",
    name: "Groceries",
    type: "EXPENSE",
    color: "#84cc16", // lime-500
    icon: "Shopping",
  },
  {
    id: "utilities",
    name: "Utilities",
    type: "EXPENSE",
    color: "#06b6d4", // cyan-500
    icon: "Zap",
    subcategories: ["Electricity", "Water", "Gas", "Internet", "Phone"],
  },
  {
    id: "entertainment",
    name: "Entertainment",
    type: "EXPENSE",
    color: "#8b5cf6", // violet-500
    icon: "Film",
    subcategories: ["Movies", "Games", "Streaming Services"],
  },
  {
    id: "food",
    name: "Food",
    type: "EXPENSE",
    color: "#f43f5e", // rose-500
    icon: "UtensilsCrossed",
  },
  {
    id: "shopping",
    name: "Shopping",
    type: "EXPENSE",
    color: "#ec4899", // pink-500
    icon: "ShoppingBag",
    subcategories: ["Clothing", "Electronics", "Home Goods"],
  },
  {
    id: "healthcare",
    name: "Healthcare",
    type: "EXPENSE",
    color: "#14b8a6", // teal-500
    icon: "HeartPulse",
    subcategories: ["Medical", "Dental", "Pharmacy", "Insurance"],
  },
  {
    id: "education",
    name: "Education",
    type: "EXPENSE",
    color: "#6366f1", // indigo-500
    icon: "GraduationCap",
    subcategories: ["Tuition", "Books", "Courses"],
  },
  {
    id: "personal",
    name: "Personal Care",
    type: "EXPENSE",
    color: "#d946ef", // fuchsia-500
    icon: "Smile",
    subcategories: ["Haircut", "Gym", "Beauty"],
  },
  {
    id: "travel",
    name: "Travel",
    type: "EXPENSE",
    color: "#0ea5e9", // sky-500
    icon: "Plane",
  },
  {
    id: "insurance",
    name: "Insurance",
    type: "EXPENSE",
    color: "#64748b", // slate-500
    icon: "Shield",
    subcategories: ["Life", "Home", "Vehicle"],
  },
  {
    id: "gifts",
    name: "Gifts & Donations",
    type: "EXPENSE",
    color: "#f472b6", // pink-400
    icon: "Gift",
  },
  {
    id: "bills",
    name: "Bills & Fees",
    type: "EXPENSE",
    color: "#fb7185", // rose-400
    icon: "Receipt",
    subcategories: ["Bank Fees", "Late Fees", "Service Charges"],
  },
  {
    id: "other-expense",
    name: "Other Expenses",
    type: "EXPENSE",
    color: "#94a3b8", // slate-400
    icon: "MoreHorizontal",
  },
  {
    id: "rent",
    name: "Rent",
    type: "EXPENSE",
    color: "#a855f7", // purple-500
    icon: "KeyRound",
    subcategories: ["Rent", "Maintenance", "Deposit"],
  },
  {
    id: "hotel",
    name: "Hotel",
    type: "EXPENSE",
    color: "#0ea5e9", // sky-500
    icon: "BedDouble",
    subcategories: ["Hotels", "Hostels", "Homestays"],
  },

  // --- System categories (M14) -------------------------------------------
  // Used by the Split Expenses ledger for cash movements that are NOT personal
  // consumption. Marked as system so they never appear in a category picker,
  // and always written with isTransfer=true so analytics skip them entirely.
  {
    id: "shared-lent",
    name: "Paid for others",
    type: "EXPENSE",
    color: "#64748b", // slate-500
    icon: "HandCoins",
    system: true,
  },
  {
    id: "shared-settlement",
    name: "Settlement",
    type: "EXPENSE",
    color: "#64748b", // slate-500
    icon: "ArrowLeftRight",
    system: true,
  },
  {
    id: "shared-settlement-received",
    name: "Settlement received",
    type: "INCOME",
    color: "#64748b", // slate-500
    icon: "ArrowLeftRight",
    system: true,
  },
];

export const categoryColors = defaultCategories.reduce((acc, category) => {
  acc[category.id] = category.color;
  return acc;
}, {});

/** Categories a user may pick. System buckets are ledger plumbing, not choices. */
export const selectableCategories = defaultCategories.filter((c) => !c.system);

export const expenseCategories = selectableCategories.filter(
  (c) => c.type === "EXPENSE"
);
export const incomeCategories = selectableCategories.filter(
  (c) => c.type === "INCOME"
);

const categoriesById = defaultCategories.reduce((acc, category) => {
  acc[category.id] = category;
  return acc;
}, {});

/** Look up a category by id, including system ones. */
export function getCategory(id) {
  return categoriesById[id] ?? null;
}

/**
 * Display name for a category id. Falls back to the raw id rather than
 * rendering nothing, so an unknown value stays visible instead of blank.
 */
export function categoryName(id) {
  return categoriesById[id]?.name ?? id ?? "Uncategorised";
}

/** Colour for a category id, with a neutral fallback. */
export function categoryColor(id) {
  return categoriesById[id]?.color ?? "#94a3b8";
}

/** True when a category is ledger plumbing rather than a user choice. */
export function isSystemCategory(id) {
  return Boolean(categoriesById[id]?.system);
}
