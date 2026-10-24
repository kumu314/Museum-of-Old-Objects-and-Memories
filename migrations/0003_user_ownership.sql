-- 方案 B 的个人归属隔离。
--
-- 首版归属规则：一个展馆只属于一个账号，归属字段就是 museums.created_by。
-- 选择复用 created_by 而不是新增 owner_id，是为了不引入两列可能不一致的第二种真相；
-- 本迁移只补索引、加不可变约束，并按创建者区隔已有数据，因此不需要回填、不清库。
-- 迁移后行为变化：每个账号只能看到并可写自己创建的展馆，原有团队账号不再共享全部展馆。

-- 账号来源标记。只用于标识账号由管理员开通还是自助注册，
-- 不参与任何授权判断；读写权限一律只看 museums.created_by。
ALTER TABLE team_members ADD COLUMN role text NOT NULL DEFAULT 'member'
  CHECK (role IN ('member', 'user'));

COMMENT ON COLUMN team_members.role IS
  '账号来源标记（member 管理员/团队开通，user 自助注册）。不参与授权，归属判断只看 museums.created_by。';

COMMENT ON COLUMN museums.created_by IS
  '展馆归属的唯一权威字段。首版无转让与协作者，归属在创建后不可更改。';

-- 归属在创建后锁定。误改会让原归属账号永久失去访问，且无审计线索。
CREATE FUNCTION guard_museum_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'Museum ownership is fixed at creation' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER museum_owner_immutable BEFORE UPDATE ON museums
  FOR EACH ROW EXECUTE FUNCTION guard_museum_owner();

-- 工作台列表按归属过滤并按更新时间倒序，走部分索引避免扫已删除展馆。
CREATE INDEX museums_owner_active ON museums(created_by, updated_at DESC) WHERE deleted_at IS NULL;
