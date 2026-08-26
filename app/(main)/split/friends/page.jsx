import { getFriends, getPendingRequests } from "@/actions/split/friends";

import { FriendsView } from "./_components/friends-view";

export default async function SplitFriendsPage() {
  const [friendsResult, pendingResult] = await Promise.all([
    getFriends(),
    getPendingRequests(),
  ]);

  const friends = friendsResult.success ? friendsResult.data : [];
  const incoming = pendingResult.success ? pendingResult.data.incoming : [];
  const outgoing = pendingResult.success ? pendingResult.data.outgoing : [];

  return (
    <FriendsView friends={friends} incoming={incoming} outgoing={outgoing} />
  );
}
