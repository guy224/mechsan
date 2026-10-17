/** HTTP integration test. Only run against a disposable localhost database. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
const base = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
assert(
  ["localhost", "127.0.0.1"].includes(new URL(base).hostname),
  "Smoke tests only target localhost",
);
class BrowserSession {
  cookies = new Map<string, string>();
  async request(path: string, body?: unknown, form = false, origin = base) {
    const response = await fetch(base + "/api/" + path, {
      method: body ? "POST" : "GET",
      headers: {
        Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "),
        ...(body
          ? {
              "Content-Type": form
                ? "application/x-www-form-urlencoded"
                : "application/json",
              Origin: origin,
            }
          : {}),
      },
      body: body
        ? form
          ? new URLSearchParams(body as Record<string, string>).toString()
          : JSON.stringify(body)
        : undefined,
      redirect: "manual",
    });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";")[0];
      const i = pair.indexOf("=");
      this.cookies.set(pair.slice(0, i), pair.slice(i + 1));
    }
    const text = await response.text();
    return { status: response.status, data: text ? JSON.parse(text) : null };
  }
  async login(phone: string, password: string) {
    const csrf = await this.request("auth/csrf");
    const result = await this.request(
      "auth/callback/credentials",
      {
        phone,
        password,
        csrfToken: csrf.data.csrfToken,
        json: "true",
        callbackUrl: base,
      },
      true,
    );
    assert(!result.data.url.includes("error="), JSON.stringify(result.data));
    assert.equal((await this.request("state")).status, 200);
  }
  async post(path: string, body: unknown) {
    const r = await this.request(path, body);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return r.data;
  }
}
async function run() {
  const admin = new BrowserSession();
  await admin.login(process.env.ADMIN_PHONE!, process.env.ADMIN_PASSWORD!);
  console.log("PASS phone/password login and authenticated session");
  const team = (await admin.request("teams")).data[0].id;
  const pass = randomBytes(16).toString("hex");
  const phone = () =>
    `05${Math.floor(Math.random() * 1e8)
      .toString()
      .padStart(8, "0")}`;
  const p1 = phone(),
    p2 = phone();
  const x = new BrowserSession(),
    y = new BrowserSession();
  for (const [session, p, name] of [
    [x, p1, "מדריך בדיקה א"],
    [y, p2, "מדריך בדיקה ב"],
  ] as const) {
    await session.post("register", {
      name,
      phone: p,
      password: pass,
      teamId: team,
    });
    await session.login(p, pass);
  }
  console.log("PASS registration, normalization and login");
  const sx = (await x.request("state")).data,
    sy = (await y.request("state")).data;
  assert.equal((await x.request("admin")).status, 403);
  assert.equal(
    (
      await x.request(
        "join",
        { activityId: randomBytes(16).toString("hex") },
        false,
        "https://untrusted.invalid",
      )
    ).status,
    403,
  );
  console.log("PASS role authorization and cross-origin rejection");
  await x.post("partnership", { action: "request", target: sy.user.id });
  const request = (await y.request("state")).data.requests[0];
  await y.post("partnership", { action: "accept", target: request.id });
  console.log("PASS partnership request and acceptance");
  await admin.post("admin", {
    action: "inventory",
    data: { total: 3, damaged: 0 },
  });
  const now = Date.now();
  const title = "בדיקת קצה " + now;
  await admin.post("admin", {
    action: "activity",
    data: {
      title,
      startsAt: new Date(now + 1800000).toISOString(),
      endsAt: new Date(now + 7200000).toISOString(),
      opensAt: new Date(now + 60000).toISOString(),
      waitingAt: new Date(now - 60000).toISOString(),
      closesAt: new Date(now + 1800000).toISOString(),
    },
  });
  const activity = (await x.request("state")).data.activities.find(
    (a: { title: string }) => a.title === title,
  );
  await Promise.all([
    x.post("join", { activityId: activity.id }),
    y.post("join", { activityId: activity.id }),
  ]);
  await admin.post("admin", {
    action: "queue",
    data: { id: activity.id, operation: "open" },
  });
  for (let i = 0; i < 20; i++) {
    const s = (await x.request("state")).data.activities.find(
      (a: { id: string }) => a.id === activity.id,
    );
    if (s.queue_state === "OFFERED") break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const before = (await x.request("state")).data.activities.find(
    (a: { id: string }) => a.id === activity.id,
  );
  assert.equal(before.queue_state, "OFFERED");
  await Promise.all([
    x.post("confirm", { activityId: activity.id }),
    y.post("confirm", { activityId: activity.id }),
  ]);
  const xr = (await x.request("state")).data.reservations.find(
      (r: { activity_id: string }) => r.activity_id === activity.id,
    ),
    yr = (await y.request("state")).data.reservations.find(
      (r: { activity_id: string }) => r.activity_id === activity.id,
    );
  assert.equal(xr.id, yr.id);
  console.log(
    "PASS shared waiting room, randomized opening, offer and simultaneous confirmations",
  );
  assert.equal(
    (await x.request("warehouse", { token: xr.qr_token, action: "pickup" }))
      .status,
    403,
  );
  for (const action of ["pickup", "pickup", "return", "return"])
    await admin.post("warehouse", { token: xr.qr_token, action });
  const returned = (await x.request("state")).data.reservations.find(
    (r: { id: string }) => r.id === xr.id,
  );
  assert.equal(returned.status, "RETURNED");
  console.log(
    "PASS QR lookup, authorized distribution, idempotent repeat scan, return",
  );
  const csrf = await x.request("auth/csrf");
  await x.request(
    "auth/signout",
    { csrfToken: csrf.data.csrfToken, json: "true", callbackUrl: base },
    true,
  );
  assert.equal((await x.request("state")).status, 401);
  console.log("PASS logout invalidates browser session");
  const old = new BrowserSession();
  await old.login(p2, pass);
  await admin.post("admin", {
    action: "recovery",
    data: {
      id: sy.user.id,
      password: randomBytes(16).toString("hex"),
      verification: "בדיקה אוטומטית בסביבת בדיקה מבודדת",
    },
  });
  assert.equal((await old.request("state")).status, 401);
  console.log("PASS administrator recovery revokes prior sessions");
  console.log("HTTP end-to-end workflow passed");
}
run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
