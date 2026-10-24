'use client';

import type { RegionBucket, RegionCity } from '../../contracts/discovery';
import styles from './discover.module.css';

/**
 * 城市分布列表。与地图共用同一份 `RegionBucket[]`：即便地图没有 key 或加载失败，
 * 读者看到的数字也来自同一条聚合路径，不会出现"地图一套数、列表另一套数"。
 */
export function CityBars({ buckets, selected, onSelect }: {
  buckets: readonly RegionBucket[];
  selected: RegionCity | null;
  onSelect(city: RegionCity | null): void;
}) {
  const peak = buckets.reduce((max, bucket) => Math.max(max, bucket.museumCount), 0);
  return (
    <ul className={styles.bars}>
      {buckets.map((bucket) => (
        <li key={bucket.city}>
          <button
            type="button"
            className={styles.barRow}
            data-selected={bucket.city === selected}
            aria-pressed={bucket.city === selected}
            onClick={() => onSelect(bucket.city === selected ? null : bucket.city)}
          >
            <span className={styles.barCity}>{bucket.city}</span>
            <span className={styles.barTrack} aria-hidden="true">
              <span
                className={styles.barFill}
                style={{ width: peak === 0 ? '0%' : `${Math.round((bucket.museumCount / peak) * 100)}%` }}
              />
            </span>
            <span className={styles.barValue}>
              {bucket.museumCount} 馆 · {bucket.viewCount} 次
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
