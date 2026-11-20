-- Migration 037: asset status values, employee_contacts.updated_at, missing updated_at triggers
-- Non-destructive, idempotent.

-- ============================================================
-- 1. employee_assets: allow 'not_assigned' status (required set:
--    not_assigned, assigned, returned, lost, damaged)
-- ============================================================
ALTER TABLE employee_assets DROP CONSTRAINT IF EXISTS employee_assets_status_check;
ALTER TABLE employee_assets
  ADD CONSTRAINT employee_assets_status_check
  CHECK (status IN ('not_assigned', 'assigned', 'returned', 'lost', 'damaged'));

-- ============================================================
-- 2. employee_contacts: add updated_at (lifecycleRoutes updates it)
-- ============================================================
ALTER TABLE employee_contacts
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

-- Backfill existing rows
UPDATE employee_contacts SET updated_at = created_at WHERE updated_at IS NULL;

-- ============================================================
-- 3. Missing updated_at triggers (029 defined functions but the
--    triggers for these tables were never created)
-- ============================================================
CREATE OR REPLACE FUNCTION update_employee_checklist_item_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_employee_checklist_item_updated_at ON employee_checklist_items;
CREATE TRIGGER trigger_update_employee_checklist_item_updated_at
  BEFORE UPDATE ON employee_checklist_items
  FOR EACH ROW EXECUTE FUNCTION update_employee_checklist_item_updated_at();

CREATE OR REPLACE FUNCTION update_employee_asset_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_employee_asset_updated_at ON employee_assets;
CREATE TRIGGER trigger_update_employee_asset_updated_at
  BEFORE UPDATE ON employee_assets
  FOR EACH ROW EXECUTE FUNCTION update_employee_asset_updated_at();

CREATE OR REPLACE FUNCTION update_employee_access_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_employee_access_updated_at ON employee_access;
CREATE TRIGGER trigger_update_employee_access_updated_at
  BEFORE UPDATE ON employee_access
  FOR EACH ROW EXECUTE FUNCTION update_employee_access_updated_at();

CREATE OR REPLACE FUNCTION update_employee_handover_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_employee_handover_updated_at ON employee_handovers;
CREATE TRIGGER trigger_update_employee_handover_updated_at
  BEFORE UPDATE ON employee_handovers
  FOR EACH ROW EXECUTE FUNCTION update_employee_handover_updated_at();
