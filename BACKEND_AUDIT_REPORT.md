# Backend Audit Report — lifecycle/onboarding scope

## SQL query → schema mapping (verified against live `overseas`)
All tables/columns referenced by routes/lifecycleRoutes.js and routes/checklistRoutes.js exist:
- lifecycle: cases/tasks/templates, documents, system_access, department_setup, assets, joining_formalities, contacts, section_completion, users(employment_status/offer_letter_id/reporting_manager_id), offer_letters(status/accepted_at/employee_id)
- checklists: templates/items/checklists/items + employee_assets/access/document_acknowledgments/employee_handovers

## Route fixes applied
- lifecycleRoutes.js:
  - GET /lifecycle/employee/:id/details — password only for SUPER_ADMIN/HR/MANAGER/OPERATIONAL_MANAGER/SUB_ADMIN (+password_visible flag)
  - POST /lifecycle/assets — sets assigned_by+assigned_date (fixes checklist join)
  - POST /lifecycle/asset-return — 404 on missing row; stores condition_notes; deduct_cost defaults FALSE
  - POST /lifecycle/reonboard-employee — status 'IN_PROGRESS'→'OPEN' (was violating CHECK → 500)
- checklistRoutes.js:
  - POST /checklists/assets — accepts tag_number/imei/phone_number/condition/notes; sets created_by
  - PUT /checklists/assets/:id — accepts condition/notes/deduct_cost/tag/imei/phone/asset fields

## Endpoint auth audit
- All lifecycle writes: verifyToken + authorizeRoles(SUPER_ADMIN,HR,MANAGER); sensitive ops HR/SUPER_ADMIN only
- checklist writes: verifyToken + hasHrOrAdminRole
- Passwords: never logged, never in error messages; gated by role on the only endpoint returning them

## Test results
- node --check both route files: PASS
- Smoke test vs overseas: contact upsert, asset assigner-name join, asset return rowCount+deduct_cost, missing-asset rowCount=0, not_assigned status, partial unique index — ALL PASS
- Suite: 117 pass / 14 fail — all pre-existing (placeholderService formatDate, policy drift), unrelated
