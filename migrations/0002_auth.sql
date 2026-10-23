CREATE TABLE team_sessions (
  id uuid PRIMARY KEY,
  member_id uuid NOT NULL REFERENCES team_members(id),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX team_sessions_member ON team_sessions(member_id);
CREATE TABLE login_attempts (
  username text PRIMARY KEY,
  attempts integer NOT NULL CHECK (attempts > 0),
  window_started_at timestamptz NOT NULL
);
