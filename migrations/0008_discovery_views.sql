-- 方向二 · 累计浏览榜与地区分布（只做累计、只到城市一级）。
--
-- 三条边界写在这里，而不是留给应用层自觉：
-- 1. region_city 白名单：城市名必须是河南省 18 个城市之一，拒绝自由文本。
--    改城市名单必须同时改本文件与 src/contracts/discovery.ts 的 henanCities，
--    两者由 tests/contracts/region-whitelist.test.ts 对齐。
-- 2. 浏览事件只存「谁看过哪座馆」：不存 IP、UA、Referer、设备指纹。
--    地区由馆主自己选到城市，系统不按任何线索推断位置。
-- 3. 事件表不去重：刷新、预加载、自动化的处理方式仍属未决，
--    未决前如实记录每一次成功读取，且不得对外宣称已防刷或统计独立访客。
ALTER TABLE museums ADD COLUMN region_city text
  CHECK (region_city IS NULL OR region_city IN (
    '郑州', '开封', '洛阳', '平顶山', '安阳', '鹤壁', '新乡', '焦作', '濮阳',
    '许昌', '漯河', '三门峡', '南阳', '商丘', '信阳', '周口', '驻马店', '济源'
  ));

-- 一馆一次浏览一行。viewer_id 记录的是当时登录的账号，用于在聚合时排除馆主自查。
-- 不设 viewer 去重索引：首版明确不做去重，加了唯一约束就等于宣称已去重。
CREATE TABLE museum_view_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  museum_id uuid NOT NULL REFERENCES museums(id),
  viewer_id uuid NOT NULL REFERENCES team_members(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX museum_view_events_museum ON museum_view_events(museum_id);
