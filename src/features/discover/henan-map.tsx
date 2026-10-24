'use client';

import { useEffect, useRef, useState } from 'react';
import type { RegionBucket, RegionCity } from '../../contracts/discovery';
import { cityPoint, isRegionCity } from './regions';
import styles from './discover.module.css';

/**
 * 地图 key 由服务端页面读环境变量后作为 prop 传入：客户端模块不读 process.env。
 * 未配置时整块地图降级为提示文案，页面其余部分照常工作。
 */
type LatLngCtor = new (latitude: number, longitude: number) => unknown;

type MarkerGeometry = {
  id: string;
  styleId: string;
  position: unknown;
  properties?: Record<string, string>;
};

type MarkerLayer = {
  setGeometries(geometries: MarkerGeometry[]): void;
  on(event: 'click', handler: (event: { geometry?: { id?: string } }) => void): void;
};

type MapInstance = { destroy?: () => void };

type Namespace = {
  Map: new (container: HTMLElement, options: { center: unknown; zoom: number; minZoom?: number; maxZoom?: number }) => MapInstance;
  LatLng: LatLngCtor;
  MarkerStyle: new (options: { width: number; height: number; src: string; anchor?: { x: number; y: number } }) => unknown;
  MultiMarker: new (options: { map: unknown; styles: Record<string, unknown>; geometries: MarkerGeometry[] }) => MarkerLayer;
};

declare global {
  interface Window { TMap?: unknown }
}

let sdkCache: { key: string; promise: Promise<Namespace> } | null = null;

function loadSdk(key: string): Promise<Namespace> {
  if (sdkCache !== null && sdkCache.key === key) return sdkCache.promise;
  const promise = new Promise<Namespace>((resolve, reject) => {
    const registered = window.TMap as Namespace | undefined;
    if (registered !== undefined) { resolve(registered); return; }
    const script = document.createElement('script');
    script.src = `https://map.qq.com/api/gljs?v=1.exp&key=${encodeURIComponent(key)}`;
    script.async = true;
    script.onload = () => {
      const namespace = window.TMap as Namespace | undefined;
      if (namespace === undefined) reject(new Error('地图脚本已加载，但没有注册 TMap'));
      else resolve(namespace);
    };
    script.onerror = () => reject(new Error('地图脚本加载失败'));
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    // 失败不缓存：换网络或补上域名白名单后，重新挂载应该还能再试一次。
    sdkCache = null;
    throw error;
  });
  sdkCache = { key, promise };
  return promise;
}

// 标记图标用内联 SVG，避免引用任何外部图片资源。
function dot(fill: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="11" fill="${fill}" fill-opacity="0.9" stroke="#2b1f16" stroke-width="2"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function geometriesFor(
  LatLng: LatLngCtor,
  buckets: readonly RegionBucket[],
  selected: RegionCity | null,
): MarkerGeometry[] {
  return buckets
    .filter((bucket) => bucket.museumCount > 0)
    .map((bucket) => {
      const point = cityPoint(bucket.city);
      return {
        id: bucket.city,
        styleId: bucket.city === selected ? 'active' : 'default',
        // 腾讯地图的 LatLng 是「纬度在前」，写反了地图会跑到海上去。
        position: new LatLng(point.latitude, point.longitude),
        properties: { city: bucket.city, label: `${bucket.city} · ${bucket.museumCount} 座馆` },
      };
    });
}

export function HenanMap({ mapKey, buckets, selected, onSelect }: {
  mapKey: string;
  buckets: readonly RegionBucket[];
  selected: RegionCity | null;
  onSelect(city: RegionCity | null): void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const layerRef = useRef<MarkerLayer | null>(null);
  const latlngRef = useRef<LatLngCtor | null>(null);
  const onSelectRef = useRef(onSelect);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');

  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);

  // 地图只建一次；规模数据与选中态由下面的 effect 推给标记图层。
  useEffect(() => {
    const element = host.current;
    if (element === null) return;
    let disposed = false;
    let instance: MapInstance | null = null;

    loadSdk(mapKey).then((sdk) => {
      if (disposed) return;
      instance = new sdk.Map(element, {
        center: new sdk.LatLng(34.1, 113.6),
        zoom: 6,
        minZoom: 5,
        maxZoom: 10,
      });
      const layer = new sdk.MultiMarker({
        map: instance,
        styles: {
          default: new sdk.MarkerStyle({ width: 16, height: 16, src: dot('#c9a227'), anchor: { x: 8, y: 8 } }),
          active: new sdk.MarkerStyle({ width: 24, height: 24, src: dot('#f2e8da'), anchor: { x: 12, y: 12 } }),
        },
        geometries: [],
      });
      layer.on('click', (event) => {
        const city = event.geometry?.id;
        if (city !== undefined && isRegionCity(city)) onSelectRef.current(city);
      });
      latlngRef.current = sdk.LatLng;
      layerRef.current = layer;
      setStatus('ready');
    }).catch(() => { if (!disposed) setStatus('failed'); });

    return () => {
      disposed = true;
      layerRef.current = null;
      latlngRef.current = null;
      instance?.destroy?.();
    };
  }, [mapKey]);

  useEffect(() => {
    const layer = layerRef.current;
    const LatLng = latlngRef.current;
    if (layer === null || LatLng === null) return;
    layer.setGeometries(geometriesFor(LatLng, buckets, selected));
  }, [buckets, selected, status]);

  if (mapKey.length === 0) {
    return (
      <div className={styles.mapFallback}>
        <p>地图未启用：服务端没有读到 <code>NEXT_PUBLIC_TMAP_KEY</code>。</p>
        <p>底图与行政边界必须由合规地图服务提供，本页不自绘省界。配置腾讯位置服务的 key 后，这里会显示河南 18 个城市的馆数分布；未配置时右侧城市列表可用，数据与地图走的是同一条聚合路径。</p>
      </div>
    );
  }

  if (status === 'failed') {
    return (
      <div className={styles.mapFallback}>
        <p>地图加载失败：腾讯地图脚本未能初始化，常见原因是 key 的域名白名单未包含当前地址。</p>
        <p>右侧城市分布仍然可读，数据口径与地图完全一致。</p>
      </div>
    );
  }

  return <div ref={host} className={styles.mapHost} role="img" aria-label="河南省各城市收录展馆数量分布" />;
}
