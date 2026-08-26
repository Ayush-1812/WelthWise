"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Check } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import useFetch from "@/hooks/use-fetch";
import { createGroup } from "@/actions/split/groups";
import { GROUP_ICON_PRESETS, DEFAULT_GROUP_ICON } from "@/lib/split/groups";

import { FriendAvatar } from "../../friends/_components/friend-avatar";

export function CreateGroupDrawer({ friends = [], children }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState(DEFAULT_GROUP_ICON);
  const [selected, setSelected] = useState([]);

  const { loading, fn: runCreate } = useFetch(createGroup);

  const toggle = (id) =>
    setSelected((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
    );

  const reset = () => {
    setName("");
    setDescription("");
    setIcon(DEFAULT_GROUP_ICON);
    setSelected([]);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    const result = await runCreate({
      name,
      description,
      icon,
      memberIds: selected,
    });

    if (result?.success) {
      toast.success(`"${result.data.name}" created`);
      reset();
      setOpen(false);
      router.refresh();
      router.push(`/split/groups/${result.data.id}`);
    } else if (result?.error) {
      toast.error(result.error);
    }
  };

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>{children}</DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Create a group</DrawerTitle>
        </DrawerHeader>
        <div className="max-h-[70vh] overflow-y-auto px-4 pb-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="group-name" className="text-sm font-medium">
                Group name
              </label>
              <Input
                id="group-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Goa Trip, Roommates, Office"
                maxLength={60}
                required
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="group-description" className="text-sm font-medium">
                Description <span className="text-muted-foreground">(optional)</span>
              </label>
              <Input
                id="group-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What is this group for?"
                maxLength={280}
              />
            </div>

            <div className="space-y-2">
              <span className="text-sm font-medium">Icon</span>
              <div className="flex flex-wrap gap-2">
                {GROUP_ICON_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setIcon(preset)}
                    aria-label={`Use ${preset} icon`}
                    aria-pressed={icon === preset}
                    className={cn(
                      "flex h-10 w-10 items-center justify-center rounded-lg border text-xl transition-colors",
                      icon === preset
                        ? "border-purple-600 bg-purple-50"
                        : "hover:bg-muted"
                    )}
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <span className="text-sm font-medium">
                Members{" "}
                <span className="text-muted-foreground">
                  ({selected.length} selected)
                </span>
              </span>

              {friends.length === 0 ? (
                <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                  You have no friends yet. Add friends first - you can only put
                  friends in a group. You can still create the group and add
                  people later.
                </p>
              ) : (
                <ul className="max-h-56 space-y-1 overflow-y-auto rounded-lg border p-1">
                  {friends.map((entry) => {
                    const user = entry.friend;
                    if (!user) return null;
                    const isSelected = selected.includes(user.id);

                    return (
                      <li key={user.id}>
                        <button
                          type="button"
                          onClick={() => toggle(user.id)}
                          aria-pressed={isSelected}
                          className={cn(
                            "flex w-full items-center justify-between gap-3 rounded-md p-2 text-left transition-colors",
                            isSelected ? "bg-purple-50" : "hover:bg-muted"
                          )}
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <FriendAvatar user={user} size={28} />
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-medium">
                                {user.name || user.email}
                              </span>
                              <span className="block truncate text-xs text-muted-foreground">
                                {user.email}
                              </span>
                            </span>
                          </span>
                          {isSelected && (
                            <Check className="h-4 w-4 shrink-0 text-purple-600" />
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="flex gap-4 pt-2">
              <DrawerClose asChild>
                <Button type="button" variant="outline" className="flex-1">
                  Cancel
                </Button>
              </DrawerClose>
              <Button
                type="submit"
                className="flex-1"
                disabled={loading || !name.trim()}
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Plus className="mr-2 h-4 w-4" />
                    Create group
                  </>
                )}
              </Button>
            </div>
          </form>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

export default CreateGroupDrawer;
