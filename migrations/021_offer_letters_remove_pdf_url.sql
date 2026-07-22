-- Run this only after 020 is deployed and the no-persistent-PDF release has
-- been verified in the target environment. It removes legacy stored-PDF data.
-- Do not run automatically against production without a backup/approval.
--
ALTER TABLE offer_letters DROP COLUMN IF EXISTS pdf_url;
