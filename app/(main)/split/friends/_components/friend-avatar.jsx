/* eslint-disable @next/next/no-img-element */

/**
 * Small avatar for a friend.
 *
 * Uses a plain <img> rather than next/image on purpose: Clerk serves avatars
 * from img.clerk.com, and next/image would need that host allow-listed in
 * next.config.ts. Not worth widening the remote-image config for a 32px icon.
 */
export function FriendAvatar({ user, size = 36 }) {
  const label = user?.name || user?.email || "?";
  const initials = label
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  if (user?.imageUrl) {
    return (
      <img
        src={user.imageUrl}
        alt=""
        width={size}
        height={size}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <div
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-full bg-purple-100 text-sm font-medium text-purple-700"
      style={{ width: size, height: size }}
    >
      {initials || "?"}
    </div>
  );
}

export default FriendAvatar;
