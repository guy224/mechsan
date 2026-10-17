-- Run as the migration owner after creating a login named machsan_app with
-- a strong password through your database administrator (never commit it).
-- Migration owner remains separate from the web/worker runtime role.
GRANT USAGE ON SCHEMA machsan TO machsan_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA machsan TO machsan_app;
GRANT DELETE ON machsan.rate_limits TO machsan_app;
REVOKE UPDATE ON machsan.audit_logs, machsan.inventory_transactions FROM machsan_app;
REVOKE INSERT, UPDATE ON machsan.migrations FROM machsan_app;
GRANT EXECUTE ON FUNCTION machsan.reservation_snapshot() TO machsan_app;
