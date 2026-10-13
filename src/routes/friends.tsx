import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Clock, Loader2, Search, UserMinus, UserPlus, Users, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  acceptFriendRequest,
  deleteFriendship,
  listFriendships,
  searchFriendProfiles,
  sendFriendRequest,
  type FriendRpcRow,
} from "@/lib/friends.functions";
import { OFFLINE_SAVE_MESSAGE, isBrowserOnline } from "@/lib/online-status";
import { getUserErrorMessage } from "@/lib/user-errors";

export const Route = createFileRoute("/friends")({
  head: () => ({
    meta: [
      { title: "Friends — Flashlark" },
      {
        name: "description",
        content: "Find friends, send requests, and manage your Flashlark friends list.",
      },
    ],
  }),
  component: FriendsPage,
});

const FRIENDS_QUERY_KEY = ["friends"] as const;

type Relationship = "none" | "incoming" | "outgoing" | "friends";

type FriendRow = {
  friendshipId: string | null;
  relationship: Relationship;
  status: string | null;
  userId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

type FriendAction =
  | { type: "send"; userId: string }
  | { type: "accept"; friendshipId: string }
  | { type: "cancel"; friendshipId: string }
  | { type: "decline"; friendshipId: string }
  | { type: "remove"; friendshipId: string };

function normalizeFriendRow(row: FriendRpcRow): FriendRow {
  return {
    friendshipId: row.friendship_id ?? null,
    relationship: (row.relationship ?? "none") as Relationship,
    status: row.status ?? null,
    userId: row.user_id,
    username: row.username,
    displayName: row.display_name ?? null,
    avatarUrl: row.avatar_url ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

function displayName(friend: FriendRow) {
  return friend.displayName?.trim() || `@${friend.username}`;
}

function initials(friend: FriendRow) {
  return friend.username.slice(0, 2).toUpperCase();
}

function successMessage(action: FriendAction) {
  switch (action.type) {
    case "send":
      return "Friend request sent.";
    case "accept":
      return "Friend request accepted.";
    case "cancel":
      return "Friend request canceled.";
    case "decline":
      return "Friend request declined.";
    case "remove":
      return "Friend removed.";
  }
}

function FriendsPage() {
  const queryClient = useQueryClient();
  const listFriendsFn = useServerFn(listFriendships);
  const searchFriendsFn = useServerFn(searchFriendProfiles);
  const sendRequestFn = useServerFn(sendFriendRequest);
  const acceptRequestFn = useServerFn(acceptFriendRequest);
  const deleteFriendshipFn = useServerFn(deleteFriendship);
  const [search, setSearch] = useState("");

  const normalizedSearch = search.trim().toLowerCase();

  const friendsQuery = useQuery({
    queryKey: FRIENDS_QUERY_KEY,
    queryFn: async () => {
      const result = await listFriendsFn();
      return (result.friends ?? []).map(normalizeFriendRow);
    },
  });

  const searchQuery = useQuery({
    queryKey: ["friend-search", normalizedSearch],
    enabled: normalizedSearch.length >= 2,
    queryFn: async () => {
      const result = await searchFriendsFn({ data: { query: normalizedSearch } });
      return (result.users ?? []).map(normalizeFriendRow);
    },
    staleTime: 10_000,
  });

  const actionMutation = useMutation({
    mutationFn: async (action: FriendAction) => {
      if (!isBrowserOnline()) throw new Error(OFFLINE_SAVE_MESSAGE);

      switch (action.type) {
        case "send":
          return sendRequestFn({ data: { userId: action.userId } });
        case "accept":
          return acceptRequestFn({ data: { friendshipId: action.friendshipId } });
        case "cancel":
        case "decline":
        case "remove":
          return deleteFriendshipFn({ data: { friendshipId: action.friendshipId } });
      }
    },
    onSuccess: (_result, action) => {
      toast.success(successMessage(action));
      queryClient.invalidateQueries({ queryKey: FRIENDS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ["friend-search"] });
    },
    onError: (error) => {
      toast.error(getUserErrorMessage(error, "Could not update friends."));
    },
  });

  const allFriends = useMemo(() => friendsQuery.data ?? [], [friendsQuery.data]);
  const groups = useMemo(
    () => ({
      friends: allFriends.filter((friend) => friend.relationship === "friends"),
      incoming: allFriends.filter((friend) => friend.relationship === "incoming"),
      outgoing: allFriends.filter((friend) => friend.relationship === "outgoing"),
    }),
    [allFriends],
  );

  const searchedUsers = searchQuery.data ?? [];

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-6 py-10 space-y-8">
        <section className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.14em] text-primary">Friends</p>
            <h1 className="mt-2 font-display text-4xl font-bold tracking-tight">
              Learn with people you know
            </h1>
            <p className="mt-3 max-w-2xl text-muted-foreground">
              Find classmates by username, send friend requests, and build your study circle.
            </p>
          </div>
          <div className="rounded-full border border-border bg-card px-4 py-2 text-sm text-muted-foreground">
            {groups.friends.length} {groups.friends.length === 1 ? "friend" : "friends"}
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-card p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by username..."
              className="pl-10"
            />
          </div>
          {normalizedSearch.length > 0 && normalizedSearch.length < 2 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Type at least 2 characters to search.
            </p>
          ) : null}

          {normalizedSearch.length >= 2 ? (
            <div className="mt-5 space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Search className="h-4 w-4 text-accent" />
                Search results
              </div>
              {searchQuery.isLoading ? (
                <div className="flex items-center gap-2 rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Searching...
                </div>
              ) : searchedUsers.length > 0 ? (
                <div className="grid gap-3 md:grid-cols-2">
                  {searchedUsers.map((friend) => (
                    <FriendCard
                      key={friend.userId}
                      friend={friend}
                      actionPending={actionMutation.isPending}
                      onAction={(action) => actionMutation.mutate(action)}
                    />
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                  No users found.
                </div>
              )}
            </div>
          ) : null}
        </section>

        {friendsQuery.isLoading ? (
          <div className="flex items-center gap-2 rounded-2xl border border-dashed border-border p-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading friends...
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-3">
            <FriendSection
              title="Friends"
              icon={<Users className="h-4 w-4" />}
              friends={groups.friends}
              empty="No friends yet."
              actionPending={actionMutation.isPending}
              onAction={(action) => actionMutation.mutate(action)}
            />
            <FriendSection
              title="Requests"
              icon={<UserPlus className="h-4 w-4" />}
              friends={groups.incoming}
              empty="No incoming requests."
              actionPending={actionMutation.isPending}
              onAction={(action) => actionMutation.mutate(action)}
            />
            <FriendSection
              title="Sent"
              icon={<Clock className="h-4 w-4" />}
              friends={groups.outgoing}
              empty="No sent requests."
              actionPending={actionMutation.isPending}
              onAction={(action) => actionMutation.mutate(action)}
            />
          </div>
        )}
      </main>
    </div>
  );
}

function FriendSection({
  title,
  icon,
  friends,
  empty,
  actionPending,
  onAction,
}: {
  title: string;
  icon: ReactNode;
  friends: FriendRow[];
  empty: string;
  actionPending: boolean;
  onAction: (action: FriendAction) => void;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="mb-4 flex items-center gap-2 font-display text-lg font-semibold">
        <span className="text-accent">{icon}</span>
        {title}
      </div>
      {friends.length > 0 ? (
        <div className="space-y-3">
          {friends.map((friend) => (
            <FriendCard
              key={friend.friendshipId ?? friend.userId}
              friend={friend}
              actionPending={actionPending}
              onAction={onAction}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
          {empty}
        </div>
      )}
    </section>
  );
}

function FriendCard({
  friend,
  actionPending,
  onAction,
}: {
  friend: FriendRow;
  actionPending: boolean;
  onAction: (action: FriendAction) => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        {friend.avatarUrl ? (
          <img
            src={friend.avatarUrl}
            alt=""
            className="h-11 w-11 shrink-0 rounded-full object-cover"
          />
        ) : (
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary/10 text-sm font-bold text-primary">
            {initials(friend)}
          </div>
        )}
        <div className="min-w-0">
          <p className="truncate font-semibold">{displayName(friend)}</p>
          <p className="truncate text-sm text-muted-foreground">@{friend.username}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 sm:justify-end">
        <FriendActions friend={friend} disabled={actionPending} onAction={onAction} />
      </div>
    </div>
  );
}

function FriendActions({
  friend,
  disabled,
  onAction,
}: {
  friend: FriendRow;
  disabled: boolean;
  onAction: (action: FriendAction) => void;
}) {
  const friendshipId = friend.friendshipId;

  if (friend.relationship === "none") {
    return (
      <Button
        type="button"
        size="sm"
        className="rounded-full"
        disabled={disabled}
        onClick={() => onAction({ type: "send", userId: friend.userId })}
      >
        <UserPlus className="h-4 w-4" />
        Add friend
      </Button>
    );
  }

  if (friend.relationship === "incoming" && friendshipId) {
    return (
      <>
        <Button
          type="button"
          size="sm"
          className="rounded-full"
          disabled={disabled}
          onClick={() => onAction({ type: "accept", friendshipId })}
        >
          <Check className="h-4 w-4" />
          Accept
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="rounded-full"
          disabled={disabled}
          onClick={() => onAction({ type: "decline", friendshipId })}
        >
          <X className="h-4 w-4" />
          Decline
        </Button>
      </>
    );
  }

  if (friend.relationship === "outgoing" && friendshipId) {
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="rounded-full"
        disabled={disabled}
        onClick={() => onAction({ type: "cancel", friendshipId })}
      >
        <X className="h-4 w-4" />
        Cancel
      </Button>
    );
  }

  if (friend.relationship === "friends" && friendshipId) {
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="rounded-full"
        disabled={disabled}
        onClick={() => onAction({ type: "remove", friendshipId })}
      >
        <UserMinus className="h-4 w-4" />
        Remove
      </Button>
    );
  }

  return (
    <span className="rounded-full bg-secondary px-3 py-1.5 text-sm text-muted-foreground">
      Request sent
    </span>
  );
}
