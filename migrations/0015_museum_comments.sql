ALTER TABLE direction1_write_receipts ADD COLUMN result_id uuid;
CREATE TABLE museum_comment_settings (
  museum_id uuid PRIMARY KEY REFERENCES museums(id),
  mode text NOT NULL DEFAULT 'open' CHECK (mode IN ('open','closed')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0)
);
CREATE TABLE museum_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  museum_id uuid NOT NULL REFERENCES museums(id),
  author_id uuid NOT NULL REFERENCES public_profiles(user_id),
  root_id uuid,
  reply_to_id uuid,
  body text,
  status text NOT NULL DEFAULT 'visible' CHECK (status IN ('visible','hidden','deleted','hidden_deleted')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (id,museum_id),
  FOREIGN KEY(root_id,museum_id) REFERENCES museum_comments(id,museum_id),
  FOREIGN KEY(reply_to_id,museum_id) REFERENCES museum_comments(id,museum_id),
  CHECK ((root_id IS NULL) = (reply_to_id IS NULL)),
  CHECK (id IS DISTINCT FROM root_id AND id IS DISTINCT FROM reply_to_id),
  CHECK ((status IN ('deleted','hidden_deleted') AND body IS NULL)
    OR (status IN ('visible','hidden') AND length(btrim(body)) BETWEEN 1 AND 2000 AND body IS NOT NULL))
);
CREATE INDEX museum_comment_threads ON museum_comments(museum_id,created_at,id);
CREATE TABLE museum_comment_bans (
  museum_id uuid NOT NULL REFERENCES museums(id),
  user_id uuid NOT NULL REFERENCES team_members(id),
  created_by uuid NOT NULL REFERENCES team_members(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(museum_id,user_id)
);
CREATE FUNCTION guard_comment_thread() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    IF (NEW.id,NEW.museum_id,NEW.author_id,NEW.root_id,NEW.reply_to_id,NEW.created_at)
      IS DISTINCT FROM (OLD.id,OLD.museum_id,OLD.author_id,OLD.root_id,OLD.reply_to_id,OLD.created_at) THEN
      RAISE EXCEPTION 'Comment identity and thread are fixed' USING ERRCODE='23514';
    END IF;
    IF NEW.body IS DISTINCT FROM OLD.body AND NOT (NEW.body IS NULL AND NEW.status IN ('deleted','hidden_deleted')) THEN
      RAISE EXCEPTION 'Comments cannot be edited or restored' USING ERRCODE='23514';
    END IF;
    IF OLD.status IN ('deleted','hidden_deleted') AND NEW.status NOT IN ('deleted','hidden_deleted') THEN
      RAISE EXCEPTION 'Deleted comment content cannot be restored' USING ERRCODE='23514';
    END IF;
  END IF;
  IF NEW.root_id IS NOT NULL THEN
    IF NOT EXISTS(SELECT 1 FROM museum_comments root WHERE root.id=NEW.root_id AND root.museum_id=NEW.museum_id AND root.root_id IS NULL)
      OR NOT EXISTS(SELECT 1 FROM museum_comments target WHERE target.id=NEW.reply_to_id AND target.museum_id=NEW.museum_id
        AND (target.id=NEW.root_id OR target.root_id=NEW.root_id)) THEN
      RAISE EXCEPTION 'Reply must belong to its museum root thread' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER museum_comment_thread BEFORE INSERT OR UPDATE ON museum_comments
  FOR EACH ROW EXECUTE FUNCTION guard_comment_thread();
