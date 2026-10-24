-- 持链接分享不代表同意被发现；既有和新建展馆均默认不收录。
ALTER TABLE museums ADD COLUMN discovery_listed boolean NOT NULL DEFAULT false;
