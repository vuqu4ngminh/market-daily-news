-- Hotfix for databases where delivery_channels was created without a code.
-- It preserves all existing channel rows and is safe to run repeatedly.

BEGIN;

ALTER TABLE public.delivery_channels
  ADD COLUMN IF NOT EXISTS code text;

WITH default_candidate AS (
  SELECT id
  FROM public.delivery_channels
  WHERE channel_type = 'telegram'
  ORDER BY is_active DESC, created_at ASC
  LIMIT 1
)
UPDATE public.delivery_channels
SET code = 'telegram_default'
WHERE id = (SELECT id FROM default_candidate)
  AND code IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.delivery_channels
    WHERE code = 'telegram_default'
  );

UPDATE public.delivery_channels
SET code = 'legacy_' || replace(id::text, '-', '')
WHERE code IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS delivery_channels_code_key
  ON public.delivery_channels (code);

ALTER TABLE public.delivery_channels
  ALTER COLUMN code SET NOT NULL;

INSERT INTO public.delivery_channels (code, name, channel_type, is_active)
VALUES ('telegram_default', 'Telegram mặc định', 'telegram', true)
ON CONFLICT (code) DO UPDATE SET is_active = true;

COMMIT;

SELECT id, code, name, channel_type, is_active
FROM public.delivery_channels
ORDER BY created_at;
