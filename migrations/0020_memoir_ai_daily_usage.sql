-- Retain only per-account daily counts when a memoir and its private content are deleted.
CREATE TABLE memoir_ai_daily_usage (
  owner_id uuid NOT NULL REFERENCES team_members(id),
  usage_date date NOT NULL,
  call_count integer NOT NULL CHECK (call_count > 0),
  PRIMARY KEY(owner_id,usage_date)
);
INSERT INTO memoir_ai_daily_usage(owner_id,usage_date,call_count)
SELECT m.owner_id,(a.created_at AT TIME ZONE 'UTC')::date,count(*)::integer
FROM memoir_ai_operations a JOIN memoirs m ON m.id=a.memoir_id
GROUP BY m.owner_id,(a.created_at AT TIME ZONE 'UTC')::date;
