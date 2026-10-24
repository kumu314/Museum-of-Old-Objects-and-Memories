export type LatLngCtor = new (latitude: number, longitude: number) => unknown;

export type MarkerGeometry = {
  id: string;
  styleId: string;
  position: unknown;
  properties?: Record<string, string>;
};

export type MarkerLayer = {
  setGeometries(geometries: MarkerGeometry[]): void;
  on(event: 'click', handler: (event: { geometry?: { id?: string } }) => void): void;
};

export type MapInstance = { destroy?: () => void };

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

export function loadSdk(key: string): Promise<Namespace> {
  if (sdkCache !== null && sdkCache.key === key) return sdkCache.promise;
  const promise = new Promise<Namespace>((resolve, reject) => {
    const registered = window.TMap as Namespace | undefined;
    if (registered !== undefined) { resolve(registered); return; }
    const script = document.createElement('script');
    script.src = `https://map.qq.com/api/gljs?v=1.exp&key=${encodeURIComponent(key)}`;
    script.async = true;
    const fail = (message: string) => {
      window.clearTimeout(timeout);
      script.onload = null;
      script.onerror = null;
      script.remove();
      reject(new Error(message));
    };
    const timeout = window.setTimeout(() => fail('地图脚本加载超时'), 15_000);
    script.onload = () => {
      window.clearTimeout(timeout);
      const namespace = window.TMap as Namespace | undefined;
      if (namespace === undefined) fail('地图脚本已加载，但没有注册 TMap');
      else resolve(namespace);
    };
    script.onerror = () => fail('地图脚本加载失败');
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    // 失败不缓存：换网络或补上域名白名单后，重新挂载应该还能再试一次。
    sdkCache = null;
    throw error;
  });
  sdkCache = { key, promise };
  return promise;
}
