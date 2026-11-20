-- Add workflow stages support to checklist items
-- Migration: Add stage and responsible party fields
-- Date: 2026-11-13

-- Add stage column to checklist_items
ALTER TABLE checklist_items ADD COLUMN IF NOT EXISTS stage INTEGER DEFAULT 1;
ALTER TABLE checklist_items ADD COLUMN IF NOT EXISTS stage_name VARCHAR(100);

-- Add responsible_party column to checklist_items
ALTER TABLE checklist_items ADD COLUMN IF NOT EXISTS responsible_party VARCHAR(50); -- HR, Employee, IT, Manager

-- Update existing onboarding items with stages and responsible parties
UPDATE checklist_items
SET stage = 1,
    stage_name = 'Create employee',
    responsible_party = 'HR'
WHERE title = 'Create Employee Record';

UPDATE checklist_items
SET stage = 2,
    stage_name = 'Document collection',
    responsible_party = 'Employee'
WHERE title = 'Review Company Policies' OR title = 'Sign NDA' OR title = 'Review Employee Handbook';

UPDATE checklist_items
SET stage = 3,
    stage_name = 'Document verification',
    responsible_party = 'HR'
WHERE title = 'Setup Direct Deposit' OR title = 'Enroll in Benefits';

UPDATE checklist_items
SET stage = 4,
    stage_name = 'IT setup',
    responsible_party = 'IT'
WHERE title = 'Provision Email Account' OR title = 'Grant System Access' OR title = 'Setup Slack/Communication';

UPDATE checklist_items
SET stage = 5,
    stage_name = 'Department setup',
    responsible_party = 'Manager'
WHERE title = 'Assign Manager' OR title = 'Provide Team Introduction';

UPDATE checklist_items
SET stage = 6,
    stage_name = 'Asset allocation',
    responsible_party = 'IT'
WHERE title = 'Provide Laptop/Computer' OR title = 'Setup Workstation' OR title = 'Provide Access Card';

UPDATE checklist_items
SET stage = 7,
    stage_name = 'Joining formalities',
    responsible_party = 'HR'
WHERE title = 'Schedule Orientation';

-- Update existing offboarding items with stages and responsible parties
UPDATE checklist_items
SET stage = 1,
    stage_name = 'Initiate offboarding',
    responsible_party = 'HR'
WHERE title = 'Initiate Resignation Process' OR title = 'Collect Resignation Letter';

UPDATE checklist_items
SET stage = 2,
    stage_name = 'Notification',
    responsible_party = 'Manager'
WHERE title = 'Notify Team and Clients';

UPDATE checklist_items
SET stage = 3,
    stage_name = 'Handover',
    responsible_party = 'Manager'
WHERE title = 'Initiate Task Handover' OR title = 'Initiate Lead Handover';

UPDATE checklist_items
SET stage = 4,
    stage_name = 'Asset return',
    responsible_party = 'IT'
WHERE title = 'Return Laptop/Computer' OR title = 'Return Access Card' OR title = 'Return Other Assets';

UPDATE checklist_items
SET stage = 5,
    stage_name = 'Access revocation',
    responsible_party = 'IT'
WHERE title = 'Revoke Email Access' OR title = 'Revoke System Access' OR title = 'Revoke Slack/Communication' OR title = 'Revoke VPN Access';

UPDATE checklist_items
SET stage = 6,
    stage_name = 'Payroll processing',
    responsible_party = 'HR'
WHERE title = 'Process Final Payroll' OR title = 'Process Benefits';

UPDATE checklist_items
SET stage = 7,
    stage_name = 'Final formalities',
    responsible_party = 'HR'
WHERE title = 'Update Employee Status' OR title = 'Archive Employee Records';

UPDATE checklist_items
SET stage = 8,
    stage_name = 'Exit interview',
    responsible_party = 'HR'
WHERE title = 'Conduct Exit Interview';

-- Add indexes for stage queries
CREATE INDEX IF NOT EXISTS idx_checklist_items_stage ON checklist_items(stage);
CREATE INDEX IF NOT EXISTS idx_checklist_items_responsible ON checklist_items(responsible_party);
