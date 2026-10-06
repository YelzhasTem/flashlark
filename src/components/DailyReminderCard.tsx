import { Bell } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { getDailyReminder, isNativeApp, setDailyReminder } from "@/lib/native";

const DEFAULT_TIME = "19:00";

function toTime(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return { hour: hour || 0, minute: minute || 0 };
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

// Shown only in the iOS app: a daily local notification reminding the learner to review.
export function DailyReminderCard() {
  const [native, setNative] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [time, setTime] = useState(DEFAULT_TIME);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isNativeApp()) return;
    setNative(true);
    getDailyReminder()
      .then((reminder) => {
        if (!reminder) return;
        setEnabled(true);
        setTime(`${pad(reminder.hour)}:${pad(reminder.minute)}`);
      })
      .catch(() => undefined);
  }, []);

  if (!native) return null;

  const apply = async (nextEnabled: boolean, nextTime: string) => {
    setSaving(true);
    try {
      const ok = await setDailyReminder(nextEnabled ? toTime(nextTime) : null);
      if (nextEnabled && !ok) {
        setEnabled(false);
        toast.error("Allow notifications for Flashlark in iOS Settings to get reminders.");
        return;
      }
      setEnabled(nextEnabled);
      if (nextEnabled) toast.success(`Reminder set for ${nextTime} every day.`);
    } catch {
      toast.error("Could not update the reminder.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="mb-6 rounded-3xl border border-border bg-card p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-xl flex items-center gap-2">
            <Bell className="h-5 w-5 text-accent" /> Daily reminder
          </h2>
          <p className="mt-2 text-sm text-muted-foreground max-w-xl">
            Get a notification every day at the time you choose.
          </p>
        </div>
        <Switch
          checked={enabled}
          disabled={saving}
          onCheckedChange={(checked) => void apply(checked, time)}
          aria-label="Daily reminder"
        />
      </div>
      {enabled && (
        <div className="mt-4 flex items-center gap-3">
          <Label htmlFor="reminder-time">Time</Label>
          <Input
            id="reminder-time"
            type="time"
            value={time}
            disabled={saving}
            className="w-32"
            onChange={(event) => setTime(event.target.value)}
            onBlur={(event) => void apply(true, event.target.value)}
          />
        </div>
      )}
    </section>
  );
}
