# Migration Execution Plan

## Runner: backend/scripts/migrate.js
- Tracks applied migrations in schema_migrations(name PK, applied_at, checksum)
- Refuses database 'deployingg'
- Advisory lock (pg_try_advisory_lock 727301) prevents concurrent runs
- Per-file transaction; stops on first failure; never records failures
- Excludes 031_fix_migration.sql (destructive) and 032 (empty)
- Rejects files containing BEGIN/COMMIT unless --allow-tx (runner owns tx)
- Warns on checksum change for applied files; does NOT rerun or rewrite checksum
- Usage: node scripts/migrate.js [--status] [--only=<file>]

## Local status (overseas): all applied — 048 rows in schema_migrations
## Production plan
1. Backup deployingg (pg_dump custom format)
2. Verify prod schema has lifecycle/checklist tables BEFORE marking anything applied
3. Backfill schema_migrations ONLY for migrations verified present in prod
4. Apply 036 + 037 via runner or psql
5. pm2 restart; verify endpoints
6. Rollback: pg_restore dump + git revert
