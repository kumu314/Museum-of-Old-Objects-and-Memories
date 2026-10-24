-- Enrollment is an operator action on synthetic test accounts, never a role or
-- a client flag. Empty by default, including after an upgrade.
CREATE TABLE direction1_demo_accounts (
  user_id uuid PRIMARY KEY REFERENCES team_members(id),
  enrolled_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public_profiles (
  user_id uuid PRIMARY KEY REFERENCES team_members(id),
  nickname text NOT NULL CHECK (length(btrim(nickname)) BETWEEN 1 AND 80),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE account_follows (
  follower_id uuid NOT NULL REFERENCES team_members(id),
  followed_user_id uuid NOT NULL REFERENCES team_members(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followed_user_id),
  CHECK (follower_id <> followed_user_id)
);
CREATE TABLE museum_favorites (
  user_id uuid NOT NULL REFERENCES team_members(id),
  museum_id uuid NOT NULL REFERENCES museums(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, museum_id)
);
CREATE INDEX museum_favorite_counts ON museum_favorites(museum_id);
CREATE FUNCTION reject_self_favorite() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM museums WHERE id=NEW.museum_id AND created_by=NEW.user_id) THEN
    RAISE EXCEPTION 'Cannot favorite own museum' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER no_self_favorite BEFORE INSERT OR UPDATE ON museum_favorites
  FOR EACH ROW EXECUTE FUNCTION reject_self_favorite();
ALTER TABLE museums ADD COLUMN tags jsonb NOT NULL DEFAULT '[]'
  CHECK (jsonb_typeof(tags) = 'array' AND jsonb_array_length(tags) <= 10);
ALTER TABLE published_snapshots ADD COLUMN tags jsonb NOT NULL DEFAULT '[]'
  CHECK (jsonb_typeof(tags) = 'array' AND jsonb_array_length(tags) <= 10);

-- Receipts hold only hashes and identifiers, never bearer tokens or prose.
CREATE TABLE direction1_write_receipts (
  actor_id uuid NOT NULL REFERENCES team_members(id),
  operation_id uuid NOT NULL,
  kind text NOT NULL,
  resource_id uuid NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id, operation_id)
);
