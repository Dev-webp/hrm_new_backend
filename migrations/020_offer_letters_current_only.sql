-- Current-only offers are keyed by case-insensitive candidate email.
-- This migration intentionally never deletes or merges production rows.
-- If it reports duplicates, review/export them and approve a separate
-- deduplication migration that retains the newest row by updated_at,
-- then created_at, then id.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM offer_letters
    GROUP BY LOWER(candidate_email)
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot enforce one current offer per candidate: duplicate candidate_email rows exist. Review and approve deduplication before retrying.';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS offer_letters_candidate_email_current_key
  ON offer_letters (LOWER(candidate_email));
