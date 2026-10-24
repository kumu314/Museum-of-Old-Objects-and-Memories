-- 生成模型入柜：展品记录当前采纳的模型资产（私有）。
-- 公开参观页在快照支持模型前仍使用照片；此列只影响工作台展柜渲染。
ALTER TABLE exhibits ADD COLUMN generated_model_asset_id uuid REFERENCES model_assets(id);
