# Database Schema Audit — onboarding/offboarding scope (local `overseas`, verified 2026-11-20)

## Verified present & correct
- checklist_templates, checklist_items (+stage/stage_name/responsible_party), employee_checklists, employee_checklist_items — seeds: 2 templates, 15 onboarding + 17 offboarding items
- employee_assets — unified schema: all required cols incl tag_number, imei, phone_number, condition, deduct_cost BOOLEAN, serial_number, asset_id, condition_notes, assigned_*/returned_*/created_by, checklist_item_id
- employee_access, document_acknowledgments, employee_handovers — match route queries
- employee_documents — has document_name, document_type, document_number, issue_date, verification_notes, verification_status, verified_by/at, is_custom_document (+legacy cols upload_date/status/file_*)
- employee_system_access — password plaintext col, revoked_by/at
- employee_department_setup, employee_joining_formalities, employee_section_completion (UNIQUE employee_id+section_id), lifecycle_templates(10), lifecycle_cases, lifecycle_tasks, employee_contacts (036+037)

## Constraints verified
- lifecycle_cases.status CHECK: OPEN/COMPLETED/CANCELLED; type CHECK: ONBOARDING/OFFBOARD
- lifecycle_cases partial unique index uq_lifecycle_cases_open_emp_type (employee_id,type) WHERE status='OPEN'
- lifecycle_tasks status CHECK: PENDING/DONE/WAIVED; assignee_role CHECK: EMPLOYEE/HR/IT/FINANCE/MANAGER
- employee_assets status CHECK: not_assigned/assigned/returned/lost/damaged (fixed in 037)
- employee_joining_formalities status: pending/done/awaiting_signature/acknowledged
- employee_documents verification_status: pending/verified/rejected/expired; document_category: identity/address/education/experience/other
- employee_system_access status: pending/granted/failed/revoked
- employee_contacts UNIQUE (employee_id, contact_type, contact_value)

## Fixed this phase
- lifecycle_cases insert used status='IN_PROGRESS' (violates CHECK) → 'OPEN' (reonboard-employee was 500ing)
- employee_contacts.updated_at added (route UPDATE referenced it)
- employee_assets 'not_assigned' status allowed
- updated_at triggers added: employee_checklist_items, employee_assets, employee_access, employee_handovers
- migrate.js: runner owns transactions (BEGIN/COMMIT stripped from 036/037), advisory lock, checksum warn-no-rewrite, --only validation, tx-control guard

## Known remaining (non-blocking)
- 029 seed SQL itself is broken if run fresh (SELECT id from VALUES w/o id col) — mitigated: seeds already applied locally; prod must NOT rerun 029 (it is recorded applied). If prod lacks seeds, use a corrective seed migration instead.
- Duplicate migration numbers 007/008/019/034 coexist; runner orders deterministically.
