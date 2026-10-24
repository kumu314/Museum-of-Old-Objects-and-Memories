-- 登录与注册共用一张节流表，但两组计数器必须彼此独立。
--
-- 早先的实现把用途编码进键本身（'register:' || username），而用户名允许包含冒号，
-- 于是账号 "register:alice" 的登录键与账号 "alice" 的注册键是同一个字符串：
-- 反复注册 alice 十次后，register:alice 的持有者即使密码正确也会被拒绝登录五分钟。
-- 把用途放回独立的列，让数据库主键保证两组计数器不可能相撞，
-- 不再依赖"用户名里不会有冒号"这种字符集假设。

ALTER TABLE login_attempts ADD COLUMN scope text NOT NULL DEFAULT 'login'
  CHECK (scope IN ('login', 'register'));

COMMENT ON COLUMN login_attempts.scope IS
  '节流用途：login 登录、register 注册。两组计数器互相独立，避免一方被用来锁死另一方。';

-- 旧主键只有 username，两种用途会争同一行；换成复合主键。
ALTER TABLE login_attempts DROP CONSTRAINT login_attempts_pkey;
ALTER TABLE login_attempts ADD PRIMARY KEY (scope, username);
