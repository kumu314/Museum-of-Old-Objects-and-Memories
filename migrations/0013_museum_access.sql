ALTER TABLE museums
  ADD COLUMN access_mode text NOT NULL DEFAULT 'private',
  ADD COLUMN access_epoch uuid;

-- Existing valid links stay link-only. No legacy museum enters discovery.
UPDATE museums SET
  access_mode = CASE WHEN share_enabled AND deleted_at IS NULL THEN 'link_only' ELSE 'private' END,
  access_epoch = CASE WHEN share_enabled AND deleted_at IS NULL THEN gen_random_uuid() ELSE NULL END,
  share_token_hash = CASE WHEN share_enabled AND deleted_at IS NULL THEN share_token_hash ELSE NULL END,
  share_enabled = share_enabled AND deleted_at IS NULL;

ALTER TABLE museums
  ADD CONSTRAINT museum_access_mode CHECK (access_mode IN ('private', 'link_only', 'discoverable')),
  ADD CONSTRAINT museum_access_state CHECK (
    (access_mode = 'private' AND access_epoch IS NULL AND share_token_hash IS NULL)
    OR (access_mode <> 'private' AND access_epoch IS NOT NULL AND share_token_hash IS NOT NULL
      AND current_snapshot_id IS NOT NULL AND deleted_at IS NULL)
  ),
  ADD CONSTRAINT museum_share_projection CHECK (share_enabled = (access_mode <> 'private'));

-- Keep the old column as a read projection for existing consumers. All new
-- writers change access_mode; obsolete writers must fail rather than reopen.
CREATE FUNCTION project_museum_share_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.share_enabled IS DISTINCT FROM OLD.share_enabled
      AND NEW.access_mode IS NOT DISTINCT FROM OLD.access_mode THEN
      RAISE EXCEPTION 'share_enabled is a projection; update access_mode' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.share_enabled AND NEW.access_mode = 'private' THEN
    RAISE EXCEPTION 'share_enabled cannot open access' USING ERRCODE = '23514';
  END IF;
  NEW.share_enabled := NEW.access_mode <> 'private';
  RETURN NEW;
END;
$$;
CREATE TRIGGER museum_share_projection
  BEFORE INSERT OR UPDATE ON museums
  FOR EACH ROW EXECUTE FUNCTION project_museum_share_state();
