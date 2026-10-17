import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { type DB } from "./db";
export function activityTimes(
  day: string,
  start: string,
  end: string,
  opening = 1440,
  waiting = 15,
) {
  const starts = fromZonedTime(`${day}T${start}:00`, "Asia/Jerusalem");
  const ends = fromZonedTime(`${day}T${end}:00`, "Asia/Jerusalem");
  return {
    starts,
    ends,
    opens: new Date(+starts - opening * 60000),
    waiting: new Date(+starts - (opening + waiting) * 60000),
  };
}
export async function generateActivities(db: DB, now = new Date()) {
  const schedules = (
    await db.query<{
      id: string;
      weekday: number;
      start_time: string;
      end_time: string;
      opening_minutes: number;
      waiting_minutes: number;
    }>("SELECT * FROM machsan.weekly_schedules WHERE active")
  ).rows;
  const today = formatInTimeZone(now, "Asia/Jerusalem", "yyyy-MM-dd");
  for (let i = 0; i < 28; i++) {
    const date = new Date(`${today}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + i);
    const day = date.toISOString().slice(0, 10);
    for (const s of schedules.filter((s) => s.weekday === date.getUTCDay())) {
      const t = activityTimes(
        day,
        s.start_time,
        s.end_time,
        s.opening_minutes,
        s.waiting_minutes,
      );
      await db.query(
        "INSERT INTO machsan.activities(title,starts_at,ends_at,opens_at,waiting_at,closes_at,schedule_key) VALUES('פעולה שבטית',$1,$2,$3,$4,$1,$5) ON CONFLICT(schedule_key) DO NOTHING",
        [t.starts, t.ends, t.opens, t.waiting, `${s.id}:${day}`],
      );
    }
  }
}
