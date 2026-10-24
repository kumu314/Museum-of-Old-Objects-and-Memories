-- 署名直接保存用户名快照，长度应与 team_members.username 一致。
ALTER TABLE contribution_invitations
  DROP CONSTRAINT contribution_invitations_invitee_name_check,
  ADD CONSTRAINT contribution_invitations_invitee_name_check CHECK (length(invitee_name) BETWEEN 1 AND 80);
ALTER TABLE contributions
  DROP CONSTRAINT contributions_author_name_check,
  ADD CONSTRAINT contributions_author_name_check CHECK (length(author_name) BETWEEN 1 AND 80);
