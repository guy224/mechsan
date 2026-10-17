"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="card">
      <h1>משהו השתבש</h1>
      <p>המידע נשמר בשרת. אפשר לנסות שוב.</p>
      <button onClick={reset}>ניסיון נוסף</button>
    </main>
  );
}
