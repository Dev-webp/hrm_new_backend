# Onboarding/Offboarding fix — progress (local 'overseas' DB only)

## DB state (verified 2026-11-20 via information_schema)
- ALL lifecycle/checklist tables EXIST with full columns: employee_documents (has document_name, verification_status, verified_by/at, is_custom_document + legacy cols), employee_system_access (password plaintext col + revoked_by/at), employee_assets (FULL unified schema incl tag_number, imei, phone_number, condition, deduct_cost bool, created_by), employee_joining_formalities, employee_section_completion, employee_access, document_acknowledgments, employee_handovers, lifecycle_templates(10 rows), lifecycle_cases, lifecycle_tasks, checklist_templates(2)+items(15+17, stage cols present).
- MISSING: employee_contacts (routes/lifecycleRoutes.js ~L1076-1089 uses id,employee_id,contact_type,contact_value,created_by,created_at).
- lifecycle_cases has UNIQUE constraint 'unique_open_case_per_employee_type' UNIQUE(employee_id,type) DEFERRABLE — replace w/ partial unique index on status='OPEN'.
- offer_letters: 1 row, status ISSUED — 033 already applied locally; users has employment_status/offer_letter_id/reporting_manager_id.
- Checklist triggers exist for templates/checklists/section_completion (items trigger may be missing).
- 031_fix_migration.sql = destructive, NEVER run. 032 empty. Duplicate numbers 007/008/019/034.

## User conditions
- Keep plaintext passwords visible in UI but restrict GET to authorized roles (SUPER_ADMIN/HR/MANAGER/OPERATIONAL_MANAGER already on writes; check the big GET employee-details route guard).
- No auto offer-letter backfill needed (already ISSUED).
- Backup before migrations. Local overseas only. No push/deploy.

## TODO next
1. migrations/036_employee_contacts_and_lifecycle_unique.sql (contacts table + drop deferrable unique + partial index WHERE status='OPEN').
2. scripts/migrate.js runner w/ schema_migrations table, transactional, ordered file list excluding 031/032/standalone scripts.
3. Check GET route returning system_access passwords — ensure role guard covers it.
4. pg_dump backup, apply, verify, run tests, write deployment package.

## Phase 4-6 continuation (2026-11-20)
- migration 037 applied: employee_assets status CHECK now includes not_assigned; employee_contacts.updated_at added; updated_at triggers created for employee_checklist_items/assets/access/handovers.
- lifecycleRoutes fixes: POST /lifecycle/assets now sets assigned_by+assigned_date (fixes checklist GET join name); POST /lifecycle/asset-return returns 404 on rowCount=0, stores condition_notes+notes, deduct_cost defaults FALSE.
- checklistRoutes fixes: POST /checklists/assets accepts+stores tag_number/imei/phone_number/condition/notes and sets created_by; PUT /checklists/assets/:id accepts condition/notes/deduct_cost/tag/imei/phone/asset fields.
- Smoke test vs overseas: contact upsert OK, asset assigner name resolves, return rowCount=1 + deduct_cost=true, missing asset rowCount=0, not_assigned allowed, partial index confirmed.
- schema_migrations now 48 rows.

## Phase 7 (2026-11-20)
- migrate.js hardened: advisory lock, checksum warn-no-rewrite, --only validation, tx-control rejection, runner owns transactions.
- 036/037 stripped of BEGIN/COMMIT (runner owns tx).
- Fixed reonboard-employee status 'IN_PROGRESS'->'OPEN' (CHECK violation).
- Reports: BACKEND_AUDIT_REPORT.md, DATABASE_SCHEMA_AUDIT.md, MIGRATION_EXECUTION_PLAN.md created.
