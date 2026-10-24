-- Online memoir data is deletable. Never copy its prose into sealed museum snapshots.
CREATE TABLE memoirs (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES team_members(id),
  museum_id uuid REFERENCES museums(id),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  source_version integer NOT NULL DEFAULT 1 CHECK (source_version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX memoir_owner_list ON memoirs(owner_id,id);
CREATE TABLE memoir_deletions (
  memoir_id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES team_members(id),
  deleted_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION validate_memoir_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND (NEW.owner_id<>OLD.owner_id OR NEW.id<>OLD.id) THEN
    RAISE EXCEPTION 'Memoir ownership is immutable' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM memoir_deletions WHERE memoir_id=NEW.id) OR
    (NEW.museum_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.museum_id IS DISTINCT FROM OLD.museum_id) AND NOT EXISTS(
      SELECT 1 FROM museums WHERE id=NEW.museum_id AND created_by=NEW.owner_id AND deleted_at IS NULL)) THEN
    RAISE EXCEPTION 'Unavailable memoir or museum' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER memoir_owner BEFORE INSERT OR UPDATE ON memoirs FOR EACH ROW EXECUTE FUNCTION validate_memoir_owner();
CREATE TABLE memoir_sessions (
  id uuid PRIMARY KEY,
  memoir_id uuid NOT NULL REFERENCES memoirs(id) ON DELETE CASCADE,
  topic_id uuid NOT NULL UNIQUE,
  topic_key text NOT NULL CHECK (topic_key IN ('childhood','school','work','legacy')),
  topic_title text NOT NULL CHECK (length(btrim(topic_title)) BETWEEN 1 AND 80),
  disposition text NOT NULL DEFAULT 'open' CHECK (disposition IN ('open','skipped','refused','completed')),
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','paused','completed')),
  current_question_id uuid,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (memoir_id,id), UNIQUE (memoir_id,topic_key),
  CHECK ((state='active' AND disposition='open' AND current_question_id IS NOT NULL)
    OR (state='paused' AND disposition='open') OR (state='completed' AND current_question_id IS NULL AND disposition<>'open'))
);
CREATE UNIQUE INDEX memoir_one_active_session ON memoir_sessions(memoir_id) WHERE state='active';
CREATE TABLE memoir_questions (
  id uuid PRIMARY KEY,
  memoir_id uuid NOT NULL,
  session_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('opening','followup')),
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 300),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (memoir_id,session_id) REFERENCES memoir_sessions(memoir_id,id) ON DELETE CASCADE,
  UNIQUE (memoir_id,id), UNIQUE (memoir_id,session_id,id)
);
ALTER TABLE memoir_sessions ADD CONSTRAINT memoir_current_question
  FOREIGN KEY (memoir_id,id,current_question_id) REFERENCES memoir_questions(memoir_id,session_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE memoir_answers (
  id uuid PRIMARY KEY,
  memoir_id uuid NOT NULL REFERENCES memoirs(id) ON DELETE CASCADE,
  session_id uuid,
  question_id uuid,
  kind text NOT NULL CHECK (kind IN ('interview','user_supplement')),
  UNIQUE (memoir_id,id), UNIQUE (question_id),
  FOREIGN KEY (memoir_id,session_id,question_id) REFERENCES memoir_questions(memoir_id,session_id,id) ON DELETE CASCADE,
  CHECK ((kind='interview' AND session_id IS NOT NULL AND question_id IS NOT NULL)
    OR (kind='user_supplement' AND session_id IS NULL AND question_id IS NULL))
);
CREATE TABLE memoir_answer_revisions (
  id uuid PRIMARY KEY,
  memoir_id uuid NOT NULL,
  answer_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 6000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (memoir_id,answer_id) REFERENCES memoir_answers(memoir_id,id) ON DELETE CASCADE,
  UNIQUE (memoir_id,id), UNIQUE (answer_id,revision)
);
CREATE TABLE memoir_question_sources (
  memoir_id uuid NOT NULL,
  question_id uuid NOT NULL,
  answer_revision_id uuid NOT NULL,
  PRIMARY KEY (question_id,answer_revision_id),
  FOREIGN KEY (memoir_id,question_id) REFERENCES memoir_questions(memoir_id,id) ON DELETE CASCADE,
  FOREIGN KEY (memoir_id,answer_revision_id) REFERENCES memoir_answer_revisions(memoir_id,id) ON DELETE CASCADE
);
CREATE TABLE memoir_chapters (
  id uuid PRIMARY KEY,
  memoir_id uuid NOT NULL REFERENCES memoirs(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  current_revision_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (memoir_id,id)
);
CREATE TABLE memoir_chapter_contents (
  id uuid PRIMARY KEY,
  memoir_id uuid NOT NULL,
  chapter_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('draft','revision')),
  source_version integer NOT NULL CHECK (source_version > 0),
  version integer CHECK (version > 0),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  generation text CHECK (generation IN ('fixture','provider')),
  ai_operation_id uuid,
  derived_from_draft_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (memoir_id,chapter_id) REFERENCES memoir_chapters(memoir_id,id) ON DELETE CASCADE,
  UNIQUE (memoir_id,id), UNIQUE (memoir_id,chapter_id,id), UNIQUE (chapter_id,version),
  FOREIGN KEY (memoir_id,chapter_id,derived_from_draft_id) REFERENCES memoir_chapter_contents(memoir_id,chapter_id,id),
  CHECK ((kind='revision' AND version IS NOT NULL AND generation IS NULL AND ai_operation_id IS NULL)
    OR (kind='draft' AND version IS NULL AND derived_from_draft_id IS NULL
      AND ((generation='fixture' AND ai_operation_id IS NULL) OR (generation='provider' AND ai_operation_id IS NOT NULL))))
);
ALTER TABLE memoir_chapters ADD CONSTRAINT memoir_current_revision
  FOREIGN KEY (memoir_id,id,current_revision_id) REFERENCES memoir_chapter_contents(memoir_id,chapter_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE memoir_paragraphs (
  memoir_id uuid NOT NULL,
  content_id uuid NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 0 AND 39),
  paragraph_id uuid NOT NULL,
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 1000),
  PRIMARY KEY (content_id,ordinal), UNIQUE (content_id,paragraph_id), UNIQUE (memoir_id,content_id,ordinal),
  FOREIGN KEY (memoir_id,content_id) REFERENCES memoir_chapter_contents(memoir_id,id) ON DELETE CASCADE
);
CREATE TABLE memoir_paragraph_sources (
  memoir_id uuid NOT NULL,
  content_id uuid NOT NULL,
  ordinal integer NOT NULL,
  answer_revision_id uuid NOT NULL,
  start_offset integer NOT NULL CHECK (start_offset >= 0),
  end_offset integer NOT NULL CHECK (end_offset > start_offset AND end_offset <= 6000),
  PRIMARY KEY (content_id,ordinal,answer_revision_id,start_offset,end_offset),
  FOREIGN KEY (memoir_id,content_id,ordinal) REFERENCES memoir_paragraphs(memoir_id,content_id,ordinal) ON DELETE CASCADE,
  FOREIGN KEY (memoir_id,answer_revision_id) REFERENCES memoir_answer_revisions(memoir_id,id) ON DELETE CASCADE
);
CREATE FUNCTION validate_memoir_source_range() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM memoir_answer_revisions WHERE id=NEW.answer_revision_id AND memoir_id=NEW.memoir_id AND length(body)>=NEW.end_offset) THEN
    RAISE EXCEPTION 'Invalid memoir source range' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER memoir_source_range BEFORE INSERT ON memoir_paragraph_sources FOR EACH ROW EXECUTE FUNCTION validate_memoir_source_range();
CREATE TABLE memoir_confirmations (
  id uuid PRIMARY KEY,
  memoir_id uuid NOT NULL,
  chapter_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  source_version integer NOT NULL CHECK (source_version > 0),
  confirmed_by uuid NOT NULL REFERENCES team_members(id),
  confirmed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (memoir_id,chapter_id,revision_id) REFERENCES memoir_chapter_contents(memoir_id,chapter_id,id) ON DELETE CASCADE,
  UNIQUE (revision_id,source_version), UNIQUE (memoir_id,chapter_id,id)
);
CREATE TABLE memoir_publications (
  id uuid PRIMARY KEY,
  memoir_id uuid NOT NULL,
  chapter_id uuid NOT NULL,
  confirmed_revision_id uuid NOT NULL,
  confirmation_id uuid NOT NULL,
  consent_version integer NOT NULL CHECK (consent_version > 0),
  privacy_acknowledged_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  granted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz,
  public_data jsonb NOT NULL CHECK (jsonb_typeof(public_data)='object'),
  FOREIGN KEY (memoir_id,chapter_id,confirmation_id) REFERENCES memoir_confirmations(memoir_id,chapter_id,id) ON DELETE CASCADE,
  FOREIGN KEY (memoir_id,chapter_id,confirmed_revision_id) REFERENCES memoir_chapter_contents(memoir_id,chapter_id,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX memoir_one_publication ON memoir_publications(chapter_id) WHERE revoked_at IS NULL;
CREATE FUNCTION reject_memoir_history_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Memoir history is append-only; deleting a memoir remains allowed' USING ERRCODE='23514';
END;
$$;
DO $$ DECLARE relation text; BEGIN
  FOREACH relation IN ARRAY ARRAY['memoir_answers','memoir_answer_revisions','memoir_questions','memoir_question_sources',
    'memoir_chapter_contents','memoir_paragraphs','memoir_paragraph_sources','memoir_confirmations'] LOOP
    EXECUTE format('CREATE TRIGGER memoir_history_immutable BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION reject_memoir_history_update()',relation);
  END LOOP;
END; $$;
CREATE FUNCTION protect_memoir_publication() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW)-'revoked_at') IS DISTINCT FROM (to_jsonb(OLD)-'revoked_at') OR
    (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
    RAISE EXCEPTION 'Published memoir text is immutable; revoke or delete instead' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER memoir_publication_immutable BEFORE UPDATE ON memoir_publications FOR EACH ROW EXECUTE FUNCTION protect_memoir_publication();
