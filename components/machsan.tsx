"use client";
import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type FormEvent,
} from "react";
import Link from "next/link";
import Image from "next/image";
import { signIn, signOut } from "next-auth/react";
import {
  Archive,
  ArrowUpLeft,
  House,
  Ticket,
  UserRound,
  ScanLine,
  Settings,
  LogOut,
  Leaf,
  CalendarDays,
  Clock3,
  Check,
  Users,
  ShieldCheck,
  PackageCheck,
  WifiOff,
  RefreshCw,
  ChevronLeft,
  Bell,
  Plus,
  Search,
  X,
} from "lucide-react";
import QRCode from "qrcode";
import { Button } from "./ui/button";
import { AdminPanel } from "./management";
export type Activity = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  opens_at: string;
  waiting_at: string;
  closes_at: string;
  cancelled: boolean;
  paused: boolean;
  queue_state: string | null;
  position: number | null;
  ahead: number;
  expires_at: string | null;
  available: number;
};
export type Reservation = {
  id: string;
  activity_id: string;
  qr_token: string;
  status: string;
  starts_at: string;
  ends_at: string;
  names: string;
  team_name: string;
  title: string;
};
type Person = { id: string; name: string };
type State = {
  user: Person & { role: string; team_id: string };
  activities: Activity[];
  reservations: Reservation[];
  members: Person[];
  requests: Person[];
  announcement: string;
  serverTime: string;
  realtimeEnabled?: boolean;
  configured: boolean;
  jobs: { id: string; last_success: string | null }[];
};
export const labels: Record<string, string> = {
  WAITING_ROOM: "בחדר ההמתנה",
  QUEUED: "בתור לשריון",
  OFFERED: "הגיע התור שלך",
  RESERVED: "מחצלת משוריינת",
  OFFER_EXPIRED: "זמן ההצעה הסתיים",
  WAITLISTED: "ברשימת ההמתנה",
  CANCELLED: "בוטלה",
  CLOSED: "ההרשמה נסגרה",
  DISTRIBUTED: "ממתינה להחזרה",
  RETURNED: "הוחזרה למחסן",
};
export function date(v: string) {
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: "Asia/Jerusalem",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(v));
}
export function time(v: string) {
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: "Asia/Jerusalem",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(v));
}
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch("/api/" + path, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const data = await r.json();
  if (!r.ok)
    throw Object.assign(new Error(data.error ?? "החיבור נכשל"), {
      status: r.status,
    });
  return data;
}
function values(e: FormEvent<HTMLFormElement>) {
  e.preventDefault();
  return Object.fromEntries(new FormData(e.currentTarget));
}
export type Mutate = (path: string, body: unknown) => Promise<boolean>;
export function Machsan() {
  const [state, setState] = useState<State | null>(null),
    [loading, setLoading] = useState(true),
    [teams, setTeams] = useState<Person[]>([]),
    [tab, setTab] = useState("home"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [offline, setOffline] = useState(false),
    [pass, setPass] = useState<Reservation | null>(null),
    [now, setNow] = useState(() => Date.now()),
    [offset, setOffset] = useState(0),
    [signup, setSignup] = useState(false),
    [selectedActivityId, setSelectedActivityId] = useState("");
  const refreshing = useRef(false);
  const reload = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      const s = await api<State>("state");
      setState(s);
      setOffset(+new Date(s.serverTime) - Date.now());
      setOffline(false);
    } catch (e) {
      if ((e as Error & { status?: number }).status === 401) setState(null);
      if ((e as Error).message !== "יש להתחבר כדי להמשיך")
        setError((e as Error).message);
    } finally {
      refreshing.current = false;
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    api<Person[]>("teams")
      .then(setTeams)
      .catch((e) => setError(e.message));
    reload();

    const clock = setInterval(() => setNow(Date.now()), 1000);
    const off = () => setOffline(true),
      on = () => {
        setOffline(false);
        reload();
      };
    window.addEventListener("offline", off);
    window.addEventListener("online", on);
    window.addEventListener("focus", on);
    if ("serviceWorker" in navigator)
      navigator.serviceWorker.register("/sw.js");
    return () => {
      clearInterval(clock);
      window.removeEventListener("offline", off);
      window.removeEventListener("online", on);
      window.removeEventListener("focus", on);
    };
  }, [reload]);
  useEffect(() => {
    if (!state?.user.id) return;
    const poll = setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine)
        void reload();
    }, 4000);
    return () => clearInterval(poll);
  }, [state?.user.id, reload]);
  useEffect(() => {
    if (!state?.user.id || !state.realtimeEnabled) return;
    const events = new EventSource("/api/events");
    let timer: ReturnType<typeof setTimeout> | undefined;
    events.addEventListener("change", () => {
      if (!timer)
        timer = setTimeout(() => {
          reload();
          timer = undefined;
        }, 500);
    });
    return () => {
      events.close();
      clearTimeout(timer);
    };
  }, [state?.user.id, state?.realtimeEnabled, reload]);
  const mutate: Mutate = async (path, body) => {
    setNotice("");
    if (!navigator.onLine) {
      setError("נדרש חיבור לשרת כדי לבצע את הפעולה");
      return false;
    }
    setBusy(true);
    setError("");
    try {
      await api(path, body);
      setNotice("הפעולה הושלמה בהצלחה");
      await reload();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const auth = async (e: FormEvent<HTMLFormElement>) => {
    const v = values(e);
    setBusy(true);
    setError("");
    try {
      if (signup)
        await api("register", { ...v, partnered: v.partnered === "on" });
      const result = await signIn("credentials", {
        phone: v.phone,
        password: v.password,
        redirect: false,
      });
      if (result?.error)
        throw new Error("לא ניתן להתחבר עם הפרטים האלה. בדקו אותם ונסו שוב.");
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const navigation = [
    { id: "home", label: "הבית שלי", icon: House },
    { id: "reservations", label: "ההזמנות שלי", icon: Ticket },
    { id: "profile", label: "הצוות שלי", icon: Users },
    ...(state?.user.role !== "INSTRUCTOR" && state
      ? [{ id: "warehouse", label: "עמדת מחסן", icon: ScanLine }]
      : []),
    ...(state?.user.role === "ADMIN"
      ? [{ id: "admin", label: "ניהול", icon: Settings }]
      : []),
  ];
  const selected =
    state?.activities.find(
      (a) => a.id === selectedActivityId && !a.cancelled,
    ) ??
    state?.activities.find(
      (a) => !a.cancelled && +new Date(a.ends_at) > now + offset,
    );
  const outstanding =
    state?.reservations.filter((r) => r.status === "DISTRIBUTED") ?? [];
  return (
    <div className="app">
      <aside className="sidebar">
        <Link className="brand" href="/">
          <span className="brand-icon">
            <Archive size={24} />
          </span>
          <span>
            מחסן<small>הציוד של השבט. בראש שקט.</small>
          </span>
        </Link>
        <div className="side-label">מרחב ההדרכה</div>
        <nav>
          {navigation.map((n) => (
            <button
              key={n.id}
              className={tab === n.id ? "nav-item active" : "nav-item"}
              onClick={() => setTab(n.id)}
            >
              <n.icon size={20} />
              {n.label}
              {tab === n.id && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <Leaf size={22} />
          <strong>
            פחות תורים.
            <br />
            יותר זמן לפעולה.
          </strong>
          <p>
            כל מה שצריך לשטח,
            <br />
            במקום אחד.
          </p>
        </div>
        <div className="side-user">
          <span className="avatar">{state?.user.name.slice(0, 1) ?? "מ"}</span>
          <div>
            <b>{state?.user.name ?? "ברוכים הבאים"}</b>
            <small>
              {state?.user.role === "ADMIN"
                ? "ניהול השבט"
                : state?.user.role === "STAFF"
                  ? "צוות המחסן"
                  : "מרחב המדריכים"}
            </small>
          </div>
          {state && (
            <button
              aria-label="יציאה"
              className="icon-button"
              onClick={() => signOut({ callbackUrl: "/" })}
            >
              <LogOut size={18} />
            </button>
          )}
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span className="mobile-brand">
            <Archive size={20} /> מחסן
          </span>
          <span className="breadcrumb">
            מרחב ההדרכה <ChevronLeft size={14} />{" "}
            {navigation.find((n) => n.id === tab)?.label}
          </span>
          <div className="top-status">
            <span className={offline ? "dot red" : "dot"} />
            {offline ? "אין חיבור" : "יחד, מוכנים לשטח"}
            <button className="icon-button" aria-label="רענון" onClick={reload}>
              <RefreshCw size={18} />
            </button>
          </div>
        </header>
        <main>
          {error && (
            <div role="alert" className="alert error">
              {error}
              <button aria-label="סגירה" onClick={() => setError("")}>
                <X size={18} />
              </button>
            </div>
          )}
          {notice && (
            <div role="status" className="alert success">
              {notice}
              <button aria-label="סגירה" onClick={() => setNotice("")}>
                <X size={18} />
              </button>
            </div>
          )}
          {offline && (
            <div className="alert error">
              <WifiOff /> המידע עשוי להיות לא מעודכן. פעולות דורשות חיבור.
            </div>
          )}
          {loading ? (
            <div className="loading">פותחים את המחסן…</div>
          ) : !state ? (
            <div className="auth-layout">
              <div className="welcome">
                <span className="eyebrow">המחסן של השבט, עכשיו בכיס</span>
                <h1>
                  מוכנים לפעולה?
                  <br />
                  <em>הציוד כבר בדרך.</em>
                </h1>
                <p>
                  משריינים מחצלת, מגיעים עם הקוד ואוספים.
                  <br />
                  פשוט, הוגן, ובלי לעמוד בתור.
                </p>
                <MatArt />
                <div className="feature-row">
                  <span>
                    <ShieldCheck /> תור הוגן לכולם
                  </span>
                  <span>
                    <ScanLine /> איסוף מהיר
                  </span>
                </div>
              </div>
              <section className="card auth-card">
                <span className="eyebrow">טוב לראות אותך</span>
                <h2>{signup ? "מצטרפים למחסן" : "כניסה למרחב שלי"}</h2>
                <p className="muted">עם מספר הטלפון והסיסמה שלך</p>
                <form onSubmit={auth}>
                  {signup && (
                    <>
                      <label>
                        שם מלא
                        <input
                          required
                          name="name"
                          autoComplete="name"
                          minLength={2}
                        />
                      </label>
                      <label>
                        קבוצת הדרכה
                        <select required name="teamId">
                          <option value="">בחירת קבוצה</option>
                          {teams.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    </>
                  )}
                  <label>
                    מספר טלפון
                    <input
                      required
                      name="phone"
                      type="tel"
                      dir="ltr"
                      placeholder="050-000-0000"
                      autoComplete="tel"
                    />
                  </label>
                  <label>
                    סיסמה
                    <input
                      required
                      name="password"
                      type="password"
                      minLength={signup ? 12 : 1}
                      maxLength={128}
                      autoComplete={
                        signup ? "new-password" : "current-password"
                      }
                    />
                  </label>
                  {signup && (
                    <>
                      <small>
                        לפחות 12 תווים. אין צורך באימות באמצעות SMS.
                      </small>
                      <label className="checkbox">
                        <input type="checkbox" name="partnered" /> אני מדריך/ה
                        עם שותף/ה
                      </label>
                      <small>לאחר ההרשמה ניתן לשלוח בקשת שותפות.</small>
                    </>
                  )}
                  <Button disabled={busy || offline} className="full">
                    {busy ? "רק רגע…" : signup ? "יצירת חשבון" : "כניסה למחסן"}
                    <ArrowUpLeft size={18} />
                  </Button>
                </form>
                <button
                  className="text-button"
                  onClick={() => setSignup(!signup)}
                >
                  {signup
                    ? "כבר יש חשבון? מתחברים"
                    : "פעם ראשונה כאן? יוצרים חשבון"}
                </button>
                <div className="auth-help">
                  שכחת את הסיסמה? צוות השבט יכול לסייע לאחר אימות זהות.
                </div>
              </section>
            </div>
          ) : (
            <>
              {state.configured &&
                state.jobs.some(
                  (j) =>
                    j.id === "queue" &&
                    (!j.last_success ||
                      now + offset - +new Date(j.last_success) > 30000),
                ) && (
                  <div className="alert error">
                    עדכוני התור מתעכבים. אפשר לפנות לצוות המחסן. המיקום שלכם
                    שמור. זמן הצעה קיימת אינו מתארך.
                  </div>
                )}
              {tab === "home" && (
                <>
                  <div className="page-heading">
                    <div>
                      <span className="eyebrow">השטח מחכה לנו</span>
                      <h1>
                        היי {state.user.name.split(" ")[0]}, טוב שבאת{" "}
                        <span className="wave">✳</span>
                      </h1>
                      <p>הפעולה הבאה מתחילה כאן. נדאג לציוד?</p>
                    </div>
                    <span className="date-pill">
                      <CalendarDays size={16} />
                      {date(new Date(now).toISOString())}
                    </span>
                  </div>
                  {state.activities.filter(
                    (a) => !a.cancelled && +new Date(a.ends_at) > now + offset,
                  ).length > 1 && (
                    <label className="activity-picker">
                      בחירת פעילות
                      <select
                        value={selected?.id ?? ""}
                        onChange={(e) => setSelectedActivityId(e.target.value)}
                      >
                        {state.activities
                          .filter(
                            (a) =>
                              !a.cancelled &&
                              +new Date(a.ends_at) > now + offset,
                          )
                          .map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.title} · {date(a.starts_at)}
                            </option>
                          ))}
                      </select>
                    </label>
                  )}
                  {state.announcement && (
                    <div className="announcement">
                      <Bell size={18} />
                      <span>{state.announcement}</span>
                    </div>
                  )}
                  <div className="dashboard-grid">
                    <div>
                      <section className="hero">
                        <div className="hero-top">
                          <span className="pill">הפעולה הקרובה</span>
                          <span className="hero-mark">יוצאים לשטח ↗</span>
                        </div>
                        <div className="hero-content">
                          <div>
                            <h2>{selected?.title ?? "מתכוננים לפעולה הבאה"}</h2>
                            <p>
                              {selected
                                ? date(selected.starts_at)
                                : "הפעילויות יופיעו כאן לאחר הגדרת המערכת"}
                            </p>
                            {selected && (
                              <span className="hero-time">
                                <Clock3 size={17} />
                                {time(selected.starts_at)}–
                                {time(selected.ends_at)}
                              </span>
                            )}
                          </div>
                          <MatArt />
                        </div>
                        {selected && (
                          <div className="hero-bottom">
                            <span>
                              <Check size={16} /> מחצלת אחת לכל צוות הדרכה
                            </span>
                            <span>כל מה שצריך, לפעולה טובה.</span>
                          </div>
                        )}
                      </section>
                      {selected ? (
                        <QueueCard
                          activity={selected}
                          configured={state.configured}
                          now={now + offset}
                          mutate={mutate}
                          busy={busy || offline}
                          reservation={state.reservations.find(
                            (r) => r.activity_id === selected.id,
                          )}
                          showPass={setPass}
                        />
                      ) : (
                        <section className="card">
                          <h3>עדיין אין פעילות מתוכננת</h3>
                          <p>מנהל השבט יכול להוסיף פעילויות בלוח הניהול.</p>
                        </section>
                      )}
                      <div className="section-title">
                        <h3>איך זה עובד?</h3>
                        <span>שלושה צעדים, ואתם בשטח</span>
                      </div>
                      <div className="steps">
                        {[
                          {
                            n: "01",
                            title: "נכנסים לתור",
                            text: "מצטרפים לחדר ההמתנה לפני פתיחת ההרשמה.",
                          },
                          {
                            n: "02",
                            title: "משריינים מחצלת",
                            text: "כשהתור מגיע, מאשרים בתוך 90 שניות.",
                          },
                          {
                            n: "03",
                            title: "אוספים ויוצאים",
                            text: "מציגים את הקוד לצוות המחסן. פעולה נעימה!",
                          },
                        ].map((s) => (
                          <div className="card step" key={s.n}>
                            <span>{s.n}</span>
                            <h4>{s.title}</h4>
                            <p>{s.text}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="right-column">
                      <section className="card team-card">
                        <div className="section-title">
                          <h3>הצוות שלי</h3>
                          <Users size={20} />
                        </div>
                        <div className="avatars">
                          {state.members.map((m) => (
                            <span className="avatar large" key={m.id}>
                              {m.name[0]}
                            </span>
                          ))}
                        </div>
                        <h3>{state.members.map((m) => m.name).join(" ו")}</h3>
                        <p>
                          {teams.find((t) => t.id === state.user.team_id)?.name}
                        </p>
                        <span className="soft-tag">
                          {state.members.length === 2
                            ? "מדריכים יחד • משריינים יחד"
                            : "יחידת הדרכה אישית"}
                        </span>
                        <button
                          className="text-button"
                          onClick={() => setTab("profile")}
                        >
                          פרטי הצוות <ChevronLeft size={16} />
                        </button>
                      </section>
                      <section className="card">
                        <div className="section-title">
                          <h3>אצלנו בידיים</h3>
                          <PackageCheck size={20} />
                        </div>
                        {outstanding.length ? (
                          <>
                            <strong className="big-number">
                              {outstanding.length}
                            </strong>
                            <p>מחצלות שמחכות לחזור למחסן</p>
                            <Button
                              variant="outline"
                              onClick={() => setTab("reservations")}
                            >
                              לפרטי ההשאלות
                            </Button>
                          </>
                        ) : (
                          <>
                            <div className="empty-icon">
                              <Check size={28} />
                            </div>
                            <h4>הכול במקום</h4>
                            <p className="muted">
                              אין כרגע ציוד שממתין להחזרה.
                              <br />
                              תודה ששומרים על הציוד של כולנו.
                            </p>
                          </>
                        )}
                      </section>
                      <div className="tip">
                        <Leaf size={22} />
                        <div>
                          <strong>ציוד משותף, אחריות משותפת</strong>
                          <p>
                            מחזירים את המחצלת נקייה ומקופלת, כדי שגם הפעולה הבאה
                            תתחיל טוב.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}
              {tab === "reservations" && (
                <>
                  <Heading
                    title="ההזמנות שלי"
                    text="השריונים, הקודים וכל מה שממתין להחזרה"
                  />
                  <div className="reservation-grid">
                    {state.reservations.length ? (
                      state.reservations.map((r) => (
                        <section className="card" key={r.id}>
                          <span className="soft-tag">{labels[r.status]}</span>
                          <h2>{r.title}</h2>
                          <p>
                            {date(r.starts_at)} · {time(r.starts_at)}
                          </p>
                          <Button onClick={() => setPass(r)}>
                            <Ticket size={18} /> הצגת QR
                          </Button>
                          {r.status === "RESERVED" && (
                            <Button
                              variant="ghost"
                              disabled={busy}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    "לבטל את ההזמנה? המחצלת תוצע לצוות הבא בתור.",
                                  )
                                )
                                  mutate("cancel", { id: r.id });
                              }}
                            >
                              ביטול הזמנה
                            </Button>
                          )}
                        </section>
                      ))
                    ) : (
                      <section className="card empty">
                        <Ticket />
                        <h3>ההזמנה הבאה שלך תופיע כאן</h3>
                        <p>מצטרפים לתור מהבית שלי, ומאשרים כשההצעה מגיעה.</p>
                      </section>
                    )}
                  </div>
                </>
              )}
              {tab === "profile" && (
                <Profile
                  state={state}
                  teams={teams}
                  mutate={mutate}
                  busy={busy}
                />
              )}
              {tab === "warehouse" && (
                <Warehouse
                  activities={state.activities}
                  mutate={mutate}
                  busy={busy}
                />
              )}
              {tab === "admin" && (
                <AdminPanel
                  activities={state.activities}
                  mutate={mutate}
                  busy={busy}
                />
              )}
            </>
          )}
          {state && (
            <div className="mobile-logout">
              <Button
                variant="ghost"
                onClick={() => signOut({ callbackUrl: "/" })}
              >
                <LogOut size={16} /> יציאה מהחשבון
              </Button>
            </div>
          )}
          <footer>
            <span>מחסן · בשביל הפעולה הבאה</span>
            <details>
              <summary>התקנה בנייד</summary>
              <p>
                באייפון: פתחו ב־Safari, לחצו על שיתוף ואז ״הוסף למסך הבית״.
                באנדרואיד: בתפריט Chrome בחרו ״התקנת אפליקציה״ או ״הוספה למסך
                הבית״.
              </p>
            </details>
          </footer>
        </main>
      </div>
      {state && (
        <nav className="bottom-nav">
          {navigation.map((n) => (
            <button
              className={tab === n.id ? "active" : ""}
              key={n.id}
              onClick={() => setTab(n.id)}
            >
              <n.icon size={21} />
              <span>{n.label}</span>
            </button>
          ))}
        </nav>
      )}
      {pass && <Pass reservation={pass} onClose={() => setPass(null)} />}
    </div>
  );
}
export function Heading({ title, text }: { title: string; text: string }) {
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow">המחסן של השבט</span>
        <h1>{title}</h1>
        <p>{text}</p>
      </div>
    </div>
  );
}
function MatArt() {
  return (
    <div className="mat-art" aria-hidden="true">
      <div className="orbit" />
      <div className="mat mat-one">
        <i />
        <b />
      </div>
      <div className="mat mat-two">
        <i />
        <b />
      </div>
      <span className="spark s1">✳</span>
      <span className="spark s2">+</span>
      <span className="art-caption">READY FOR THE OUTDOORS</span>
    </div>
  );
}
function QueueCard({
  activity: a,
  configured,
  now,
  mutate,
  busy,
  reservation,
  showPass,
}: {
  activity: Activity;
  configured: boolean;
  now: number;
  mutate: Mutate;
  busy: boolean;
  reservation?: Reservation;
  showPass: (r: Reservation) => void;
}) {
  const open = +new Date(a.opens_at),
    wait = +new Date(a.waiting_at),
    close = +new Date(a.closes_at);
  const deadline = a.expires_at ? +new Date(a.expires_at) : open;
  const seconds = Math.max(0, Math.ceil((deadline - now) / 1000));
  const countdown = `${Math.floor(seconds / 3600) ? Math.floor(seconds / 3600) + ":" : ""}${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  return (
    <section className="card queue-card">
      <div className="section-title">
        <span className="soft-tag">
          <span className="dot" />
          {a.queue_state
            ? labels[a.queue_state]
            : now < wait
              ? "עוד מעט נפגשים"
              : now < open
                ? "חדר ההמתנה פתוח"
                : "הרשמה למחצלות"}
        </span>
        <span className="muted">{a.available} מחצלות זמינות</span>
      </div>
      {!configured ? (
        <>
          <h2>המלאי עדיין בהכנה</h2>
          <p>השריון ייפתח לאחר שצוות המחסן יגדיר מלאי.</p>
        </>
      ) : reservation && reservation.status !== "CANCELLED" ? (
        <>
          <h2>המחצלת שלך מחכה לך</h2>
          <p>{labels[reservation.status]} · מציגים את הקוד במחסן</p>
          <Button onClick={() => showPass(reservation)}>
            הצגת QR <ScanLine size={18} />
          </Button>
        </>
      ) : a.queue_state === "OFFERED" ? (
        <>
          <h2>הגיע התור שלך!</h2>
          <p>מחצלת שמורה לך זמנית. יש לאשר לפני שהזמן מסתיים.</p>
          <strong className="countdown" dir="ltr">
            {countdown}
          </strong>
          <Button
            disabled={busy || seconds === 0}
            onClick={() => mutate("confirm", { activityId: a.id })}
          >
            שריון מחצלת <Check size={18} />
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => mutate("decline", { activityId: a.id })}
          >
            ויתור על ההצעה
          </Button>
        </>
      ) : a.queue_state === "WAITING_ROOM" ? (
        <>
          <h2>אתם בפנים. עוד רגע מתחילים.</h2>
          <div className="countdown" dir="ltr">
            {countdown}
          </div>
          <p>עם פתיחת ההרשמה נערבב את התור. לכולם בחדר ההמתנה סיכוי שווה.</p>
        </>
      ) : ["QUEUED", "WAITLISTED"].includes(a.queue_state ?? "") ? (
        <>
          <h2>המקום שלכם בתור: {a.position}</h2>
          <p>
            {a.ahead} צוותים לפניכם ·{" "}
            {a.paused ? "התור מושהה כרגע" : "נעדכן כאן כשיגיע תורכם"}
          </p>
          <div className="progress">
            <span
              style={{ width: `${Math.max(5, 100 - Number(a.ahead) * 3)}%` }}
            />
          </div>
          <p className="muted">
            חשוב להשאיר את האפליקציה פתוחה. כשהצעה מגיעה, יש 90 שניות לאישור.
          </p>
        </>
      ) : a.queue_state === "OFFER_EXPIRED" ? (
        <>
          <h2>זמן ההצעה הסתיים</h2>
          <p>המחצלת עברה לצוות הבא. לבירור חריג ניתן לפנות למנהל השבט.</p>
        </>
      ) : now >= close ? (
        <>
          <h2>ההרשמה הסתיימה</h2>
          <p>נתראה בפעולה הבאה.</p>
        </>
      ) : a.queue_state === "RESERVED" ||
        reservation?.status === "CANCELLED" ? (
        <>
          <h2>ההזמנה בוטלה</h2>
          <p>לא ניתן להיכנס שוב לתור לפעילות זו.</p>
        </>
      ) : (
        <>
          <h2>
            {now < wait ? "קצת סבלנות, עוד מעט נפתחים" : "מוכנים לשריין מחצלת?"}
          </h2>
          <p>
            ההרשמה נפתחת {date(a.opens_at)} ב־{time(a.opens_at)}
          </p>
          {now < open && (
            <div className="countdown" dir="ltr">
              {countdown}
            </div>
          )}
          <Button
            disabled={busy || now < wait}
            onClick={() => mutate("join", { activityId: a.id })}
          >
            {now < wait
              ? "חדר ההמתנה ייפתח ב־" + time(a.waiting_at)
              : "הצטרפות לחדר ההמתנה"}
            <ArrowUpLeft size={19} />
          </Button>
          <p className="fine-print">
            <ShieldCheck size={15} /> מצטרפים לפני הפתיחה? סדר התור ייקבע בהגרלה
            הוגנת.
          </p>
        </>
      )}
    </section>
  );
}
function Pass({
  reservation: r,
  onClose,
}: {
  reservation: Reservation;
  onClose: () => void;
}) {
  const [qr, setQr] = useState("");
  useEffect(() => {
    QRCode.toDataURL(r.qr_token, {
      width: 320,
      margin: 4,
      errorCorrectionLevel: "M",
    }).then(setQr);
  }, [r.qr_token]);
  return (
    <div className="modal-backdrop">
      <section
        role="dialog"
        aria-modal="true"
        aria-label="כרטיס הזמנה"
        className="card pass"
      >
        <button
          className="icon-button close"
          onClick={onClose}
          aria-label="סגירה"
        >
          <X />
        </button>
        <span className="soft-tag">{labels[r.status]}</span>
        <h2>הכרטיס שלכם לשטח</h2>
        <p>
          {r.names} · {r.team_name}
        </p>
        {qr && (
          <Image
            unoptimized
            src={qr}
            alt="קוד QR להצגה לצוות המחסן"
            width={280}
            height={280}
          />
        )}
        <h3>{r.title}</h3>
        <p>
          {date(r.starts_at)} · {time(r.starts_at)}
        </p>
        <p className="muted">מציגים לצוות המחסן באיסוף ובהחזרה</p>
        <Button variant="outline" onClick={onClose}>
          סגירה
        </Button>
      </section>
    </div>
  );
}
function Profile({
  state,
  teams,
  mutate,
  busy,
}: {
  state: State;
  teams: Person[];
  mutate: Mutate;
  busy: boolean;
}) {
  const [results, setResults] = useState<Person[]>([]),
    [error, setError] = useState("");
  return (
    <>
      <Heading
        title="הצוות שלי"
        text="כל אחד עם החשבון שלו. יחד עם אותו שריון."
      />
      <div className="two-columns">
        <section className="card">
          <h2>הפרטים שלי</h2>
          <form onSubmit={(e) => mutate("profile", values(e))}>
            <label>
              שם מלא
              <input name="name" defaultValue={state.user.name} required />
            </label>
            <label>
              קבוצת הדרכה
              <select name="teamId" defaultValue={state.user.team_id}>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <Button disabled={busy}>שמירת פרטים</Button>
          </form>
        </section>
        <section className="card">
          <h2>שותפים להדרכה</h2>
          <p>{state.members.map((m) => m.name).join(" ו")}</p>
          {state.requests.map((r) => (
            <div className="list-row" key={r.id}>
              <span>{r.name} רוצה להדריך איתך</span>
              <Button
                disabled={busy}
                onClick={() =>
                  mutate("partnership", { action: "accept", target: r.id })
                }
              >
                אישור
              </Button>
              <Button
                variant="ghost"
                onClick={() =>
                  mutate("partnership", { action: "reject", target: r.id })
                }
              >
                דחייה
              </Button>
            </div>
          ))}
          {state.members.length === 1 && (
            <>
              <form
                onSubmit={async (e) => {
                  const v = values(e);
                  try {
                    setResults(
                      await api<Person[]>(
                        "partners?q=" + encodeURIComponent(String(v.q)),
                      ),
                    );
                    setError("");
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                <label>
                  חיפוש שותף/ה בקבוצה
                  <input
                    name="q"
                    required
                    minLength={3}
                    placeholder="לפחות שלוש אותיות בשם"
                  />
                </label>
                <Button variant="outline">
                  <Search size={18} /> חיפוש
                </Button>
              </form>
              {error && <p role="alert">{error}</p>}
              {results.map((r) => (
                <div className="list-row" key={r.id}>
                  <span>{r.name}</span>
                  <Button
                    disabled={busy}
                    onClick={() =>
                      mutate("partnership", { action: "request", target: r.id })
                    }
                  >
                    שליחת בקשה
                  </Button>
                </div>
              ))}
            </>
          )}
          <p className="muted">
            השותפות מתחילה רק לאחר אישור. שינוי שותפות אפשרי לאחר סיום התורים
            והחזרת הציוד, בסיוע מנהל.
          </p>
        </section>
      </div>
    </>
  );
}
function Warehouse({
  activities,
  mutate,
  busy,
}: {
  activities: Activity[];
  mutate: Mutate;
  busy: boolean;
}) {
  const [rows, setRows] = useState<Reservation[]>([]),
    [inventory, setInventory] = useState<{
      total: number;
      damaged: number;
      physical_available: number;
    } | null>(null),
    [error, setError] = useState(""),
    [scanning, setScanning] = useState(false),
    [people, setPeople] = useState<(Person & { phone: string })[]>([]);
  const video = useRef<HTMLVideoElement>(null);
  const load = useCallback(async (q = "") => {
    try {
      const d = await api<{ rows: Reservation[]; inventory: typeof inventory }>(
        "warehouse?" + q,
      );
      setRows(d.rows);
      setInventory(d.inventory);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (!scanning) return;
    let stop: (() => void) | undefined;
    let alive = true;
    let last = "";
    import("@zxing/browser").then(async ({ BrowserQRCodeReader }) => {
      try {
        const reader = new BrowserQRCodeReader();
        const control = await reader.decodeFromConstraints(
          { video: { facingMode: "environment" } },
          video.current!,
          (result) => {
            if (!alive || !result) return;
            const token = result.getText();
            if (token === last) return;
            last = token;
            if (!/^[0-9a-f-]{36}$/i.test(token)) {
              setError("הקוד אינו כרטיס מחסן תקין");
              return;
            }
            load("token=" + encodeURIComponent(token));
            navigator.vibrate?.(80);
            setScanning(false);
          },
        );
        stop = () => control.stop();
        if (!alive) stop();
      } catch {
        setError(
          "לא ניתן לפתוח מצלמה. יש לאפשר גישה בהגדרות הדפדפן ולהשתמש ב־HTTPS. אפשר גם לחפש ידנית.",
        );
        setScanning(false);
      }
    });
    return () => {
      alive = false;
      stop?.();
    };
  }, [scanning, load]);
  return (
    <>
      <Heading title="עמדת המחסן" text="סורקים, מוסרים, וממשיכים לפעולה." />
      <div className="stats">
        <div className="card">
          <span>במחסן עכשיו</span>
          <strong>{inventory?.physical_available ?? "—"}</strong>
        </div>
        <div className="card">
          <span>מלאי כולל</span>
          <strong>{inventory?.total ?? "—"}</strong>
        </div>
        <div className="card">
          <span>לא זמינות</span>
          <strong>{inventory?.damaged ?? "—"}</strong>
        </div>
      </div>
      <section className="card">
        <Button onClick={() => setScanning(!scanning)}>
          <ScanLine /> {scanning ? "סגירת מצלמה" : "סריקת QR"}
        </Button>
        {scanning && (
          <video ref={video} className="scanner" muted playsInline />
        )}
        <form
          className="inline-form"
          onSubmit={(e) => {
            const v = values(e);
            load("q=" + encodeURIComponent(String(v.q)));
          }}
        >
          <input
            aria-label="חיפוש הזמנה"
            name="q"
            placeholder="שם, טלפון או קבוצה"
          />
          <Button variant="outline">
            <Search /> חיפוש
          </Button>
        </form>
        {error && <p role="alert">{error}</p>}
        {rows.map((r) => (
          <div className="list-row" key={r.id}>
            <div>
              <strong>{r.names}</strong>
              <p>
                {r.team_name} · {date(r.starts_at)} · {labels[r.status]}
              </p>
            </div>
            {["RESERVED", "DISTRIBUTED"].includes(r.status) && (
              <Button
                disabled={busy}
                onClick={async () => {
                  const ok = await mutate("warehouse", {
                    token: r.qr_token,
                    action: r.status === "RESERVED" ? "pickup" : "return",
                  });
                  if (ok) {
                    await load();
                    setScanning(true);
                  }
                }}
              >
                {r.status === "RESERVED" ? "מסירת מחצלת" : "החזרת מחצלת"}
              </Button>
            )}
          </div>
        ))}
        {!rows.length && <p className="muted">לא נמצאו הזמנות.</p>}
      </section>
      <section className="card">
        <h2>הזמנה ידנית</h2>
        <p className="muted">
          עקיפת תור נרשמת ביומן. גם הזמנה ידנית כפופה למלאי.
        </p>
        <form
          onSubmit={async (e) => {
            const v = values(e);
            try {
              setPeople(
                await api("people?q=" + encodeURIComponent(String(v.q))),
              );
            } catch (e) {
              setError((e as Error).message);
            }
          }}
          className="inline-form"
        >
          <input
            name="q"
            required
            minLength={3}
            placeholder="שם או טלפון של מדריך"
            aria-label="חיפוש מדריך"
          />
          <Button variant="outline">חיפוש מדריך</Button>
        </form>
        <form onSubmit={(e) => mutate("manual", values(e))}>
          <label>
            מדריך
            <select name="userId" required>
              <option value="">בחירת מדריך מתוצאות החיפוש</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.phone}
                </option>
              ))}
            </select>
          </label>
          <label>
            פעילות
            <select name="activityId" required>
              {activities
                .filter((a) => !a.cancelled)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.title} · {date(a.starts_at)}
                  </option>
                ))}
            </select>
          </label>
          <label>
            סיבה לחריגה
            <input name="reason" minLength={8} required />
          </label>
          <Button disabled={busy}>
            יצירת הזמנה מתועדת <Plus size={18} />
          </Button>
        </form>
      </section>
    </>
  );
}
