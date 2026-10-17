"use client";
import { useEffect, useState, type FormEvent } from "react";
import { fromZonedTime } from "date-fns-tz";
import { Button } from "./ui/button";
import {
  api,
  date,
  Heading,
  labels,
  type Activity,
  type Mutate,
} from "./machsan";
type AdminData = {
  users: {
    id: string;
    name: string;
    phone: string;
    role: string;
    disabled: boolean;
    team_id: string;
  }[];
  teams: { id: string; name: string; active: boolean }[];
  schedules: {
    id: string;
    weekday: number;
    start_time: string;
    end_time: string;
    opening_minutes: number;
    waiting_minutes: number;
    active: boolean;
  }[];
  audits: {
    id: string;
    actor: string;
    action: string;
    created_at: string;
    details: unknown;
  }[];
  queue: {
    id: string;
    title: string;
    position: number;
    state: string;
    expires_at: string;
  }[];
  requests: { id: string; sender: string; recipient: string }[];
};
function fields(e: FormEvent<HTMLFormElement>) {
  e.preventDefault();
  return Object.fromEntries(new FormData(e.currentTarget));
}
export function AdminPanel({
  activities,
  mutate,
  busy,
}: {
  activities: Activity[];
  mutate: Mutate;
  busy: boolean;
}) {
  const [data, setData] = useState<AdminData | null>(null),
    [tab, setTab] = useState("inventory"),
    [error, setError] = useState(""),
    [search, setSearch] = useState("");
  const load = () =>
    api<AdminData>("admin")
      .then(setData)
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);
  const save = async (action: string, d: unknown) => {
    await mutate("admin", { action, data: d });
    load();
  };
  return (
    <>
      <Heading
        title="ניהול השבט"
        text="אנשים, פעילויות ומלאי. כל שינוי חשוב מתועד."
      />
      <div className="tabs">
        {Object.entries({
          inventory: "מלאי והודעות",
          activities: "פעילויות",
          users: "מדריכים",
          teams: "קבוצות",
          partners: "שותפויות",
          queue: "התור",
          audit: "יומן פעולות",
        }).map(([key, label]) => (
          <button
            className={tab === key ? "active" : ""}
            key={key}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {error && <p role="alert">{error}</p>}
      {!data ? (
        <p>טוענים נתונים…</p>
      ) : (
        <>
          {tab === "inventory" && (
            <div className="two-columns">
              <section className="card">
                <h2>מלאי מחצלות</h2>
                <p>
                  לפני הגדרה ראשונית, השריון חסום. הקטנת מלאי עם הקצאות פעילות
                  חסומה.
                </p>
                <form onSubmit={(e) => save("inventory", fields(e))}>
                  <label>
                    סך המחצלות
                    <input name="total" type="number" min="0" required />
                  </label>
                  <label>
                    פגומות או לא זמינות
                    <input
                      name="damaged"
                      type="number"
                      min="0"
                      required
                      defaultValue="0"
                    />
                  </label>
                  <Button disabled={busy}>עדכון מלאי</Button>
                </form>
              </section>
              <section className="card">
                <h2>הודעה למדריכים</h2>
                <form onSubmit={(e) => save("announcement", fields(e))}>
                  <label>
                    תוכן ההודעה
                    <textarea name="text" maxLength={500} />
                  </label>
                  <Button disabled={busy}>פרסום הודעה</Button>
                </form>
              </section>
            </div>
          )}
          {tab === "activities" && (
            <>
              <section className="card">
                <h2>לוח הפעילויות</h2>
                {activities.map((a) => (
                  <div className="list-row" key={a.id}>
                    <div>
                      <strong>
                        {a.title} · {date(a.starts_at)}
                      </strong>
                      <p>
                        {a.cancelled
                          ? "בוטלה"
                          : a.paused
                            ? "התור מושהה"
                            : "פעילה"}
                      </p>
                    </div>
                    <div className="actions">
                      {!a.cancelled &&
                        (
                          [
                            "pause",
                            "resume",
                            "open",
                            "close",
                            "cancel",
                          ] as const
                        ).map((operation) => (
                          <Button
                            key={operation}
                            variant="outline"
                            disabled={busy}
                            onClick={() => {
                              if (
                                operation !== "cancel" ||
                                window.confirm(
                                  "לבטל את הפעילות ואת השריונים שטרם נאספו?",
                                )
                              )
                                save("queue", { id: a.id, operation });
                            }}
                          >
                            {
                              {
                                pause: "השהיה",
                                resume: "המשך",
                                open: "פתיחה",
                                close: "סגירה",
                                cancel: "ביטול",
                              }[operation]
                            }
                          </Button>
                        ))}
                    </div>
                  </div>
                ))}
              </section>
              <section className="card">
                <h2>הוספה או תזמון מחדש</h2>
                <p className="muted">
                  כל השעות לפי ישראל. אין לשנות פעילות שכבר נכנסו אליה לתור.
                </p>
                <form
                  onSubmit={(e) => {
                    const v = fields(e);
                    const start = fromZonedTime(
                      String(v.start),
                      "Asia/Jerusalem",
                    );
                    const opening = fromZonedTime(
                      String(v.open),
                      "Asia/Jerusalem",
                    );
                    save("activity", {
                      id: v.id || undefined,
                      title: v.title,
                      startsAt: start.toISOString(),
                      endsAt: fromZonedTime(
                        String(v.end),
                        "Asia/Jerusalem",
                      ).toISOString(),
                      opensAt: opening.toISOString(),
                      waitingAt: new Date(
                        +opening - Number(v.waiting) * 60000,
                      ).toISOString(),
                      closesAt: start.toISOString(),
                    });
                  }}
                >
                  <label>
                    פעילות
                    <select name="id">
                      <option value="">פעילות חדשה</option>
                      {activities.map((a) => (
                        <option key={a.id} value={a.id}>
                          {date(a.starts_at)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    שם הפעילות
                    <input name="title" required defaultValue="פעולה שבטית" />
                  </label>
                  <div className="two-columns">
                    <label>
                      תחילת הפעילות
                      <input name="start" type="datetime-local" required />
                    </label>
                    <label>
                      סיום הפעילות
                      <input name="end" type="datetime-local" required />
                    </label>
                    <label>
                      פתיחת הרשמה
                      <input name="open" type="datetime-local" required />
                    </label>
                    <label>
                      דקות חדר המתנה
                      <input
                        name="waiting"
                        type="number"
                        min="0"
                        defaultValue="15"
                        required
                      />
                    </label>
                  </div>
                  <Button disabled={busy}>שמירת פעילות</Button>
                </form>
              </section>
              <section className="card">
                <h2>תבניות שבועיות</h2>
                <p>
                  עדכון חל על מופעים חדשים שייווצרו בהמשך. מופעים שכבר נוצרו
                  נערכים בנפרד.
                </p>
                {data.schedules.map((s) => (
                  <form
                    key={s.id}
                    className="schedule-form"
                    onSubmit={(e) => {
                      const v = fields(e);
                      save("schedule", {
                        ...v,
                        id: s.id,
                        active: v.active === "on",
                      });
                    }}
                  >
                    <label>
                      יום
                      <select name="weekday" defaultValue={s.weekday}>
                        {[
                          "ראשון",
                          "שני",
                          "שלישי",
                          "רביעי",
                          "חמישי",
                          "שישי",
                          "שבת",
                        ].map((d, i) => (
                          <option key={i} value={i}>
                            {d}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      התחלה
                      <input
                        name="start"
                        type="time"
                        defaultValue={s.start_time}
                      />
                    </label>
                    <label>
                      סיום
                      <input name="end" type="time" defaultValue={s.end_time} />
                    </label>
                    <label>
                      דקות לפני פתיחת הפעילות
                      <input
                        type="number"
                        name="opening"
                        min="1"
                        defaultValue={s.opening_minutes}
                      />
                    </label>
                    <label>
                      דקות המתנה
                      <input
                        type="number"
                        name="waiting"
                        min="0"
                        defaultValue={s.waiting_minutes}
                      />
                    </label>
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        name="active"
                        defaultChecked={s.active}
                      />{" "}
                      פעילה
                    </label>
                    <Button disabled={busy}>שמירת תבנית</Button>
                  </form>
                ))}
              </section>
            </>
          )}
          {tab === "users" && (
            <section className="card">
              <h2>מדריכים והרשאות</h2>
              <input
                aria-label="חיפוש מדריכים"
                placeholder="חיפוש לפי שם או טלפון"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {data.users
                .filter(
                  (u) => u.name.includes(search) || u.phone.includes(search),
                )
                .map((u) => (
                  <details className="user-details" key={u.id}>
                    <summary>
                      {u.name} · {u.phone} ·{" "}
                      {
                        {
                          ADMIN: "מנהל",
                          STAFF: "צוות מחסן",
                          INSTRUCTOR: "מדריך",
                        }[u.role]
                      }{" "}
                      {u.disabled ? "· מושבת" : ""}
                    </summary>
                    <form
                      onSubmit={(e) => {
                        const v = fields(e);
                        save("user", {
                          id: u.id,
                          role: v.role,
                          disabled: v.disabled === "on",
                          teamId: v.teamId === u.team_id ? undefined : v.teamId,
                        });
                      }}
                    >
                      <label>
                        הרשאה
                        <select name="role" defaultValue={u.role}>
                          <option value="INSTRUCTOR">מדריך</option>
                          <option value="STAFF">צוות מחסן</option>
                          <option value="ADMIN">מנהל</option>
                        </select>
                      </label>
                      <label>
                        קבוצה
                        <select name="teamId" defaultValue={u.team_id}>
                          {data.teams.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="checkbox">
                        <input
                          name="disabled"
                          type="checkbox"
                          defaultChecked={u.disabled}
                        />{" "}
                        השבתת חשבון
                      </label>
                      <Button disabled={busy}>שמירת הרשאות</Button>
                    </form>
                    <details>
                      <summary>שחזור חשבון לאחר אימות זהות</summary>
                      <form
                        onSubmit={(e) =>
                          save("recovery", { ...fields(e), id: u.id })
                        }
                      >
                        <label>
                          תיעוד אופן אימות הזהות
                          <input
                            name="verification"
                            minLength={12}
                            required
                            placeholder="אימות פנים אל פנים עם רכז מוכר"
                          />
                        </label>
                        <label>
                          סיסמה חדשה
                          <input
                            type="password"
                            name="password"
                            minLength={12}
                            autoComplete="new-password"
                            required
                          />
                        </label>
                        <Button disabled={busy}>
                          איפוס סיסמה וניתוק חיבורים
                        </Button>
                      </form>
                    </details>
                  </details>
                ))}
            </section>
          )}
          {tab === "teams" && (
            <section className="card">
              <h2>קבוצות הדרכה</h2>
              <form
                onSubmit={(e) => save("team", fields(e))}
                className="inline-form"
              >
                <input
                  name="name"
                  required
                  minLength={2}
                  placeholder="שם קבוצה חדשה"
                  aria-label="שם קבוצה חדשה"
                />
                <Button disabled={busy}>הוספה</Button>
              </form>
              {data.teams.map((t) => (
                <form
                  key={t.id}
                  className="list-row"
                  onSubmit={(e) => {
                    const v = fields(e);
                    save("team", {
                      id: t.id,
                      name: v.name,
                      active: v.active === "on",
                    });
                  }}
                >
                  <input
                    name="name"
                    defaultValue={t.name}
                    required
                    aria-label="שם קבוצה"
                  />
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      name="active"
                      defaultChecked={t.active}
                    />{" "}
                    פעילה
                  </label>
                  <Button disabled={busy} variant="outline">
                    שמירה
                  </Button>
                </form>
              ))}
            </section>
          )}
          {tab === "partners" && (
            <section className="card">
              <h2>שותפויות וחריגים</h2>
              {data.requests.map((r) => (
                <div className="list-row" key={r.id}>
                  <span>
                    {r.sender} + {r.recipient}
                  </span>
                  <Button
                    disabled={busy}
                    onClick={async () => {
                      await mutate("partnership", {
                        action: "accept",
                        target: r.id,
                        override: true,
                      });
                      load();
                    }}
                  >
                    אישור חריג מתועד
                  </Button>
                </div>
              ))}
              <form
                onSubmit={(e) => {
                  const v = fields(e);
                  if (
                    window.confirm(
                      "לפצל את יחידת ההדרכה? ניתן לבצע רק ללא תורים או השאלות פעילות.",
                    )
                  )
                    mutate("partnership", {
                      action: "dissolve",
                      target: v.target,
                    });
                }}
              >
                <label>
                  פירוק יחידה של מדריך
                  <select name="target">
                    {data.users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </label>
                <Button disabled={busy} variant="outline">
                  פירוק שותפות
                </Button>
              </form>
            </section>
          )}
          {tab === "queue" && (
            <section className="card">
              <h2>מצב התור</h2>
              <Button variant="outline" onClick={load}>
                רענון
              </Button>
              {data.queue.map((q) => (
                <div key={q.id} className="list-row">
                  <span>
                    {q.title} · מקום {q.position ?? "טרם הוגרל"}
                  </span>
                  <span>
                    {labels[q.state]}{" "}
                    {q.expires_at &&
                      "· " +
                        new Date(q.expires_at).toLocaleTimeString("he-IL", {
                          timeZone: "Asia/Jerusalem",
                        })}
                  </span>
                </div>
              ))}
              {!data.queue.length && <p>התור ריק כרגע.</p>}
            </section>
          )}
          {tab === "audit" && (
            <section className="card">
              <h2>יומן פעולות</h2>
              {data.audits.map((a) => (
                <details key={a.id} className="user-details">
                  <summary>
                    {a.actor ?? "המערכת"} ·{" "}
                    {(
                      {
                        REGISTER: "הרשמה",
                        RESERVE: "שריון",
                        CANCEL: "ביטול הזמנה",
                        pickup: "מסירה",
                        return: "החזרה",
                        PARTNERSHIP: "שותפות",
                        DISSOLVE: "פירוק שותפות",
                        MANUAL_RESERVATION: "הזמנה ידנית",
                        RECOVERY: "שחזור חשבון",
                        inventory: "מלאי",
                        team: "קבוצה",
                        user: "הרשאות",
                        activity: "פעילות",
                        queue: "ניהול תור",
                        schedule: "תבנית שבועית",
                        announcement: "הודעה",
                        PROFILE: "פרופיל",
                      } as Record<string, string>
                    )[a.action] ?? "פעולת מערכת"}{" "}
                    · {date(a.created_at)}
                  </summary>
                  <pre dir="ltr">{JSON.stringify(a.details, null, 2)}</pre>
                </details>
              ))}
            </section>
          )}
        </>
      )}
    </>
  );
}
