-- Hotfix for databases where crawl_runs was created from an earlier schema v2
-- draft with source_id NOT NULL. Safe to run repeatedly.

BEGIN;

ALTER TABLE public.crawl_runs
  ALTER COLUMN source_id DROP NOT NULL;

COMMIT;

-- Expected result: is_nullable = YES
SELECT column_name, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'crawl_runs'
  AND column_name = 'source_id';
