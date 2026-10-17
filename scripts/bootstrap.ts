import { transaction, database, ensure, one } from "../lib/db";
import { register } from "../lib/operations";
async function run() {
  await transaction(async (db) => {
    ensure(
      !(await one(db, "SELECT id FROM machsan.users WHERE role='ADMIN'")),
      "An administrator already exists",
    );
    const team = await one<{ id: string }>(
      db,
      "INSERT INTO machsan.scout_teams(name) VALUES('צוות הדרכה') RETURNING id",
    );
    const u = await register(db, {
      name: process.env.ADMIN_NAME,
      phone: process.env.ADMIN_PHONE,
      password: process.env.ADMIN_PASSWORD,
      teamId: team.id,
    });
    await db.query("UPDATE machsan.users SET role='ADMIN' WHERE id=$1", [u.id]);
  });
  console.log("Administrator created");
  await database().end();
}
run().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
