import { auth } from "@clerk/nextjs/server";
import { seedTransactions } from "../../../actions/seed";

// Destructive: wipes and regenerates transactions for the seed account.
// Never expose this in production, and never to anonymous callers.
export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await seedTransactions();
  return Response.json(result, { status: result.success ? 200 : 500 });
}
