import { redirect } from "next/navigation";

/**
 * /split has no content of its own - Overview is a real route so the nav can
 * highlight it like every other section.
 */
export default function SplitIndexPage() {
  redirect("/split/overview");
}
