'use client';

import { useMemo, useState } from 'react';
import type { RegionCity } from '../../contracts/discovery';
import { CityBars } from './city-bars';
import { demoMuseums } from './demo-fixtures';
import { HenanMap } from './henan-map';
import { filterEntries, toLeaderboard, type BoardFilter } from './leaderboard';
import { distributeByCity } from './regions';
import styles from './discover.module.css';

export function DiscoverBoard({ mapKey }: { mapKey: string }) {
  const [filter, setFilter] = useState<BoardFilter>({ kind: 'all' });
  const hasMapKey = mapKey.length > 0;

  const board = useMemo(() => toLeaderboard(demoMuseums), []);
  const distribution = useMemo(
    () => distributeByCity(demoMuseums.map((museum) => ({ regionCity: museum.regionCity, viewCount: museum.viewCount }))),
    [],
  );
  const visible = useMemo(() => filterEntries(board.entries, filter), [board, filter]);
  const selectedCity: RegionCity | null = filter.kind === 'city' ? filter.city : null;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>河南 · 城市记忆</p>
        <h1 className={styles.title}>记忆地图与累计浏览榜</h1>
        <p className={styles.lede}>
          按城市查看收录的展馆，以及各馆的累计浏览次数。地区只到城市一级，不涉及地址与实时位置；
          浏览次数是次数，不是人数。
        </p>
      </header>

      <p className={styles.demoBanner} role="note">
        <strong>DEMO</strong>　本页全部为演示数据：既不是真实用户，也不是真实浏览量或真实生成结果。
        数字只用来核对界面与接口口径，不得引用为热度、口碑或社会证明。
      </p>

      <div className={styles.grid}>
        <section className={styles.panel} aria-labelledby="map-heading">
          <div className={styles.panelHead}>
            <h2 className={styles.panelTitle} id="map-heading">河南各市收录</h2>
            <p className={styles.panelNote}>{hasMapKey ? '点击地图或下方城市筛选榜单' : '地图未启用 · 列表可用'}</p>
          </div>
          <HenanMap
            mapKey={mapKey}
            buckets={distribution.cities}
            selected={selectedCity}
            onSelect={(city) => setFilter(city === null ? { kind: 'all' } : { kind: 'city', city })}
          />
          <CityBars
            buckets={distribution.cities}
            selected={selectedCity}
            onSelect={(city) => setFilter(city === null ? { kind: 'all' } : { kind: 'city', city })}
          />
        </section>

        <section className={styles.panel} aria-labelledby="board-heading">
          <div className={styles.panelHead}>
            <h2 className={styles.panelTitle} id="board-heading">累计浏览榜</h2>
            <p className={styles.panelNote}>共 {board.totalMuseums} 座馆 · 仅累计榜</p>
          </div>

          <div className={styles.filters}>
            <button
              type="button"
              className={styles.filter}
              data-active={filter.kind === 'all'}
              onClick={() => setFilter({ kind: 'all' })}
            >
              全部
            </button>
            {distribution.unplacedMuseums > 0 ? (
              <button
                type="button"
                className={styles.filter}
                data-active={filter.kind === 'unplaced'}
                onClick={() => setFilter({ kind: 'unplaced' })}
              >
                未标注城市 {distribution.unplacedMuseums}
              </button>
            ) : null}
            {selectedCity === null ? null : (
              <button
                type="button"
                className={styles.filter}
                data-active
                onClick={() => setFilter({ kind: 'all' })}
              >
                {selectedCity} · 取消筛选
              </button>
            )}
          </div>

          {visible.length === 0 ? (
            <p className={styles.empty}>这个筛选下还没有展馆。</p>
          ) : (
            <ol className={styles.board}>
              {visible.map((entry) => (
                <li className={styles.row} key={entry.museumId}>
                  <span className={styles.rank}>{entry.rank}</span>
                  <div>
                    <p className={styles.rowTitle}>{entry.title}</p>
                    <p className={styles.rowMeta}>
                      {entry.regionCity ?? '未标注城市'} · DEMO
                    </p>
                  </div>
                  <span className={styles.count}>
                    {entry.viewCount}
                    <small>次</small>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <footer className={styles.footer}>
        <p>
          口径：浏览次数只统计成功读取到展馆内容的访问，排除馆主自己的查看。刷新、预加载与自动化流量的处理方式
          仍待产品决定，当前未做去重，也不声称防刷或独立访客统计。
        </p>
        <p>
          地区由用户显式选择到城市一级，未选择的不参与地图聚合，系统不按 IP 或任何线索推断位置。
          同一座馆只会出现在一个城市。
        </p>
      </footer>
    </main>
  );
}
