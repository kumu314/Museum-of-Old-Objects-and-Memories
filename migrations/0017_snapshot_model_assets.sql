-- Generated files use the same immutable, same-museum membership as photos/audio.
ALTER TABLE model_assets ADD CONSTRAINT model_assets_id_museum UNIQUE (id, museum_id);
CREATE TABLE snapshot_model_assets (
  snapshot_id uuid NOT NULL,
  museum_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  PRIMARY KEY (snapshot_id, asset_id),
  FOREIGN KEY (snapshot_id, museum_id) REFERENCES published_snapshots(id, museum_id),
  FOREIGN KEY (asset_id, museum_id) REFERENCES model_assets(id, museum_id)
);
CREATE TRIGGER immutable_snapshot_model_assets BEFORE INSERT OR UPDATE OR DELETE ON snapshot_model_assets
  FOR EACH ROW EXECUTE FUNCTION guard_snapshot_assets();
