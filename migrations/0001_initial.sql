CREATE TABLE team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL UNIQUE CHECK (length(username) BETWEEN 1 AND 80),
  password_hash text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  session_version integer NOT NULL DEFAULT 1 CHECK (session_version > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE museums (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid NOT NULL REFERENCES team_members(id),
  share_token_hash text UNIQUE,
  share_enabled boolean NOT NULL DEFAULT false,
  current_snapshot_id uuid,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT share_enabled OR (share_token_hash IS NOT NULL AND current_snapshot_id IS NOT NULL))
);

CREATE TABLE assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  museum_id uuid NOT NULL REFERENCES museums(id),
  original_name text NOT NULL CHECK (length(original_name) BETWEEN 1 AND 255),
  kind text NOT NULL CHECK (kind IN ('image', 'audio')),
  mime text NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp', 'audio/mpeg', 'audio/mp4', 'audio/wav')),
  byte_size integer NOT NULL CHECK (byte_size > 0),
  storage_key text NOT NULL UNIQUE,
  thumbnail_storage_key text UNIQUE,
  width integer,
  height integer,
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  created_by uuid NOT NULL REFERENCES team_members(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, museum_id),
  CHECK ((kind = 'image' AND mime LIKE 'image/%' AND width IS NOT NULL AND height IS NOT NULL AND width BETWEEN 1 AND 8192 AND height BETWEEN 1 AND 8192 AND width::bigint * height <= 32000000)
    OR (kind = 'audio' AND mime LIKE 'audio/%' AND width IS NULL AND height IS NULL AND thumbnail_storage_key IS NULL))
);

CREATE TABLE exhibits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  museum_id uuid NOT NULL REFERENCES museums(id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  era text NOT NULL DEFAULT '年代待考' CHECK (length(era) BETWEEN 1 AND 80),
  slot_index smallint NOT NULL CHECK (slot_index BETWEEN 0 AND 5),
  model_key text NOT NULL CHECK (model_key IN ('camera-01', 'cassette', 'ticket', 'photo-plane')),
  approximation text NOT NULL CHECK (length(approximation) BETWEEN 1 AND 500),
  source_notice text NOT NULL CHECK (length(source_notice) BETWEEN 1 AND 1000),
  raw_story text NOT NULL DEFAULT '' CHECK (length(raw_story) <= 12000),
  transcript text CHECK (length(transcript) <= 12000),
  source_segments jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(source_segments) = 'array'),
  caption text NOT NULL DEFAULT '' CHECK (length(caption) <= 120),
  photo_asset_id uuid,
  audio_asset_id uuid,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  confirmed_version integer,
  confirmed_by uuid REFERENCES team_members(id),
  confirmed_at timestamptz,
  confirmation_note text CHECK (length(confirmation_note) BETWEEN 1 AND 2000),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, museum_id),
  FOREIGN KEY (photo_asset_id, museum_id) REFERENCES assets(id, museum_id),
  FOREIGN KEY (audio_asset_id, museum_id) REFERENCES assets(id, museum_id),
  CHECK (confirmed_version IS NULL OR confirmed_version = version),
  CHECK ((confirmed_version IS NULL AND confirmed_by IS NULL AND confirmed_at IS NULL AND confirmation_note IS NULL)
    OR (confirmed_version IS NOT NULL AND confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL AND confirmation_note IS NOT NULL))
);
CREATE UNIQUE INDEX exhibits_active_slot ON exhibits(museum_id, slot_index) WHERE deleted_at IS NULL;
CREATE INDEX exhibits_museum ON exhibits(museum_id);
CREATE INDEX assets_museum ON assets(museum_id);

CREATE TABLE ai_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  museum_id uuid NOT NULL,
  exhibit_id uuid NOT NULL,
  source_version integer NOT NULL CHECK (source_version > 0),
  output jsonb NOT NULL CHECK (jsonb_typeof(output) = 'object'),
  provider text NOT NULL,
  model text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (exhibit_id, museum_id) REFERENCES exhibits(id, museum_id)
);
CREATE INDEX ai_drafts_exhibit ON ai_drafts(exhibit_id, created_at DESC);

CREATE TABLE published_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  museum_id uuid NOT NULL REFERENCES museums(id),
  museum_version integer NOT NULL CHECK (museum_version > 0),
  public_data jsonb NOT NULL CHECK (jsonb_typeof(public_data) = 'object'),
  sealed boolean NOT NULL DEFAULT false,
  published_by uuid NOT NULL REFERENCES team_members(id),
  published_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, museum_id),
  UNIQUE (museum_id, museum_version)
);

CREATE TABLE snapshot_assets (
  snapshot_id uuid NOT NULL,
  museum_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  PRIMARY KEY (snapshot_id, asset_id),
  FOREIGN KEY (snapshot_id, museum_id) REFERENCES published_snapshots(id, museum_id),
  FOREIGN KEY (asset_id, museum_id) REFERENCES assets(id, museum_id)
);

ALTER TABLE museums ADD CONSTRAINT museums_current_snapshot_same_museum
  FOREIGN KEY (current_snapshot_id, id) REFERENCES published_snapshots(id, museum_id);

-- Only sealing is allowed after insertion. Draft changes must create a new snapshot.
CREATE FUNCTION guard_snapshot_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NOT OLD.sealed AND NEW.sealed AND (to_jsonb(NEW) - 'sealed') = (to_jsonb(OLD) - 'sealed') THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'Published snapshots are immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER immutable_snapshot BEFORE UPDATE OR DELETE ON published_snapshots
  FOR EACH ROW EXECUTE FUNCTION guard_snapshot_mutation();

CREATE FUNCTION guard_snapshot_assets() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE snapshot_sealed boolean;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Snapshot asset membership is immutable' USING ERRCODE = '23514';
  END IF;
  -- Locking the parent serializes membership insertion with sealing.
  SELECT sealed INTO snapshot_sealed FROM published_snapshots WHERE id = NEW.snapshot_id FOR UPDATE;
  IF snapshot_sealed THEN
    RAISE EXCEPTION 'Sealed snapshot assets are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER immutable_snapshot_assets BEFORE INSERT OR UPDATE OR DELETE ON snapshot_assets
  FOR EACH ROW EXECUTE FUNCTION guard_snapshot_assets();

CREATE FUNCTION guard_current_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.current_snapshot_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM published_snapshots WHERE id = NEW.current_snapshot_id AND museum_id = NEW.id AND sealed
  ) THEN
    RAISE EXCEPTION 'Current snapshot must be sealed and belong to this museum' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER current_snapshot_sealed BEFORE INSERT OR UPDATE OF current_snapshot_id ON museums
  FOR EACH ROW EXECUTE FUNCTION guard_current_snapshot();
