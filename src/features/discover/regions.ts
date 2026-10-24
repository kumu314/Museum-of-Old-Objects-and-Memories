import { henanCities, type RegionBucket, type RegionCity } from '../../contracts/discovery';

export type CityPoint = {
  readonly city: RegionCity;
  readonly longitude: number;
  readonly latitude: number;
};

/**
 * 城市中心点的近似坐标，只用于在省级视图里定位气泡。
 *
 * 这不是行政区划边界数据，也不是精确地理坐标：误差在市级尺度内，用于"哪个市有多少馆"
 * 的示意足够，但不得用于测距、导航或任何需要精确位置的场合。地图底图与合规边界由
 * 腾讯地图提供（见 docs/DIRECTION_2_CONTRACT_PROPOSAL.md §9），本文件不绘制省界。
 */
export const cityPoints: readonly CityPoint[] = [
  { city: '郑州', longitude: 113.631, latitude: 34.753 },
  { city: '开封', longitude: 114.307, latitude: 34.797 },
  { city: '洛阳', longitude: 112.454, latitude: 34.619 },
  { city: '平顶山', longitude: 113.192, latitude: 33.766 },
  { city: '安阳', longitude: 114.393, latitude: 36.098 },
  { city: '鹤壁', longitude: 114.295, latitude: 35.748 },
  { city: '新乡', longitude: 113.926, latitude: 35.303 },
  { city: '焦作', longitude: 113.242, latitude: 35.215 },
  { city: '濮阳', longitude: 115.029, latitude: 35.762 },
  { city: '许昌', longitude: 113.852, latitude: 34.035 },
  { city: '漯河', longitude: 114.017, latitude: 33.581 },
  { city: '三门峡', longitude: 111.2, latitude: 34.773 },
  { city: '南阳', longitude: 112.528, latitude: 32.99 },
  { city: '商丘', longitude: 115.656, latitude: 34.415 },
  { city: '信阳', longitude: 114.092, latitude: 32.147 },
  { city: '周口', longitude: 114.697, latitude: 33.626 },
  { city: '驻马店', longitude: 114.022, latitude: 32.98 },
  { city: '济源', longitude: 112.602, latitude: 35.067 },
];

const points = new Map(cityPoints.map((point) => [point.city, point]));

export function cityPoint(city: RegionCity): CityPoint {
  const point = points.get(city);
  if (point === undefined) throw new Error(`缺少城市中心点：${city}`);
  return point;
}

export function isRegionCity(value: string): value is RegionCity {
  return (henanCities as readonly string[]).includes(value);
}

export type DistributionInput = {
  readonly regionCity: RegionCity | null;
  readonly viewCount: number;
};

export type Distribution = {
  /** 18 个城市按固定顺序输出，没有馆的也要出现，避免地图与列表每次重排。 */
  readonly cities: readonly RegionBucket[];
  /** 未选择城市，不参与地图聚合；单列出来是为了不让总数对不上。 */
  readonly unplacedMuseums: number;
};

/**
 * 按城市聚合。地区为 NULL 的馆不进城市桶（不猜测、不按 IP 推断），只计入 unplacedMuseums。
 */
export function distributeByCity(entries: readonly DistributionInput[]): Distribution {
  const counts = new Map<RegionCity, { museumCount: number; viewCount: number }>();
  for (const city of henanCities) counts.set(city, { museumCount: 0, viewCount: 0 });
  let unplacedMuseums = 0;
  for (const entry of entries) {
    if (entry.regionCity === null) { unplacedMuseums += 1; continue; }
    const bucket = counts.get(entry.regionCity);
    if (bucket === undefined) continue;
    bucket.museumCount += 1;
    bucket.viewCount += entry.viewCount;
  }
  return {
    cities: henanCities.map((city) => ({
      city,
      museumCount: counts.get(city)?.museumCount ?? 0,
      viewCount: counts.get(city)?.viewCount ?? 0,
    })),
    unplacedMuseums,
  };
}
