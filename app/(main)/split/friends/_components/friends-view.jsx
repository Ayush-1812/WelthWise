"use client";

import { useRouter } from "next/navigation";

import { AddFriend } from "./add-friend";
import { PendingRequests } from "./pending-requests";
import { FriendList } from "./friend-list";

/**
 * Client shell for the Friends section.
 *
 * Data is fetched on the server and passed in; every mutation calls
 * router.refresh() so the server component re-renders with fresh rows rather
 * than this component keeping a second copy of the truth in local state.
 */
export function FriendsView({ friends, incoming, outgoing }) {
  const router = useRouter();
  const refresh = () => router.refresh();

  return (
    <div className="space-y-6">
      <AddFriend onChanged={refresh} />
      <PendingRequests
        incoming={incoming}
        outgoing={outgoing}
        onChanged={refresh}
      />
      <FriendList friends={friends} onChanged={refresh} />
    </div>
  );
}

export default FriendsView;
