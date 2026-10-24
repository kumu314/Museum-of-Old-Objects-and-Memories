-- Self-service mode (方案 B): accounts are end users who register themselves,
-- not pre-provisioned team members. Ownership columns already reference this table.
ALTER TABLE team_members RENAME TO users;
ALTER TABLE team_sessions RENAME TO user_sessions;
ALTER TABLE user_sessions RENAME COLUMN member_id TO user_id;
ALTER INDEX team_sessions_member RENAME TO user_sessions_member;
