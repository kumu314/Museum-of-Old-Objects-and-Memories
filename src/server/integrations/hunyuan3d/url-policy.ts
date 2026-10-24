import dns from 'node:dns';
import net from 'node:net';
import { Hunyuan3DError } from './errors';

/**
 * 供应商返回的结果文件地址属于不可信输入：上游响应可能被伪造，历史结果也可能被
 * 污染。因此下载目标在发出任何请求前必须满足：仅 HTTPS、仅腾讯 COS 结果域名、
 * 不携带凭据与非默认端口，且主机解析出的全部地址都在公网范围内。
 *
 * 剩余风险：fetch 建立连接时会再次解析 DNS，理论上存在针对已允许域名的 DNS
 * rebinding 窗口；COS 域名的权威解析由腾讯控制，且重定向保持禁用，每一跳都
 * 无法绕过本策略。
 */

export type HunyuanResultUrlPolicy = (url: URL) => Promise<void> | void;

function rejectUrl(message: string): never {
  throw new Hunyuan3DError('RESULT_URL_REJECTED', message);
}

/** 官方结果示例的地域端点，以及 COS 新旧域名下的存储桶端点。 */
function isTencentCosResultHost(hostname: string): boolean {
  const labels = hostname.toLowerCase().split('.');
  if (labels.length !== 4 && labels.length !== 5) return false;
  const tail = labels.slice(-4);
  const [cos, region, cloud, tld] = tail;
  const knownDomain = (cloud === 'myqcloud' && tld === 'com') || (cloud === 'tencentcos' && tld === 'cn');
  if (cos !== 'cos' || !knownDomain) return false;
  if (region === undefined || !/^[a-z][a-z0-9-]*$/.test(region)) return false;
  const bucket = labels.slice(0, -4).join('.');
  return bucket === '' || /^[a-z0-9][a-z0-9-]*-\d+$/.test(bucket);
}

function isRejectedIPv4Bytes(bytes: readonly number[]): boolean {
  const [a, b, c] = bytes;
  if (a === undefined || b === undefined || c === undefined) return true;
  if (a === 0) return true; // 0.0.0.0/8 本网络与未指定地址
  if (a === 10) return true; // RFC1918 私网
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 共享地址段
  if (a === 127) return true; // 环回
  if (a === 169 && b === 254) return true; // 链路本地，含 169.254.169.254 云元数据
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918 私网
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // 协议保留段与 TEST-NET-1
  if (a === 192 && b === 168) return true; // RFC1918 私网
  if (a === 198 && (b === 18 || b === 19)) return true; // 基准测试段
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // 组播、保留段与广播
  return false;
}

function parseIPv4(value: string): number[] | undefined {
  const parts = value.split('.');
  if (parts.length !== 4) return undefined;
  const bytes = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : NaN));
  if (bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) return undefined;
  return bytes;
}

function parseIPv6(value: string): number[] | undefined {
  let text = value;
  let embedded: number[] | undefined;
  const v4Match = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(value);
  if (v4Match) {
    const v4Text = v4Match[1];
    if (v4Text === undefined) return undefined;
    const parsed = parseIPv4(v4Text);
    if (parsed === undefined) return undefined;
    embedded = parsed;
    text = value.slice(0, value.length - v4Text.length);
    if (!text.endsWith(':')) return undefined;
    text = text.slice(0, -1);
    if (text === ':') text = '::';
  }
  if ((text.match(/::/g) ?? []).length > 1) return undefined;
  const [headText, tailText] = text.includes('::') ? text.split('::') : [text, ''];
  const parseGroups = (part: string): number[] | undefined => {
    if (part === '') return [];
    const values: number[] = [];
    for (const group of part.split(':')) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return undefined;
      values.push(Number.parseInt(group, 16));
    }
    return values;
  };
  const head = parseGroups(headText ?? '');
  const tail = parseGroups(tailText ?? '');
  if (head === undefined || tail === undefined) return undefined;
  const fixedCount = head.length + tail.length + (embedded === undefined ? 0 : 2);
  if (fixedCount > 8) return undefined;
  if (!text.includes('::') && fixedCount !== 8) return undefined;
  const groups = [...head, ...Array<number>(8 - fixedCount).fill(0), ...tail];
  if (embedded !== undefined) {
    groups.push(((embedded[0] ?? 0) << 8) | (embedded[1] ?? 0));
    groups.push(((embedded[2] ?? 0) << 8) | (embedded[3] ?? 0));
  }
  return groups;
}

function isRejectedIPv6Groups(groups: number[]): boolean {
  const first = groups[0] ?? 0;
  const second = groups[1] ?? 0;
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    // IPv4-mapped IPv6：按内嵌的 IPv4 地址判断。
    const high = groups[6] ?? 0;
    const low = groups[7] ?? 0;
    return isRejectedIPv4Bytes([(high >> 8) & 0xff, high & 0xff, (low >> 8) & 0xff, low & 0xff]);
  }
  if (first >= 0xff00) return true; // 组播
  if (first >= 0xfe80 && first <= 0xfebf) return true; // 链路本地
  if (first >= 0xfc00 && first <= 0xfdff) return true; // 唯一本地地址
  if (first >= 0x2000 && first <= 0x3fff) {
    if (first === 0x2001) {
      if (second === 0x0db8) return true; // 文档专用段
      if (second < 0x0200) return true; // Teredo 等 IANA 特殊用途注册段
    }
    if (first === 0x2002) return true; // 6to4 内嵌 IPv4
    if (first === 0x3ffe) return true; // 已废弃的 6bone 段
    return false;
  }
  return true; // 2000::/3 之外的其余段均视为非公网
}

/** 任一非公网或未知格式的地址都按拒绝处理，未知格式不放宽。 */
export function isRejectedIpAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    const bytes = parseIPv4(address);
    return bytes === undefined || isRejectedIPv4Bytes(bytes);
  }
  if (net.isIPv6(address)) {
    const groups = parseIPv6(address);
    return groups === undefined || isRejectedIPv6Groups(groups);
  }
  return true;
}

/** 主机为字面量 IP 时直接判断，否则要求 DNS 解析结果全部为公网地址。 */
export async function assertPubliclyRoutable(hostname: string): Promise<void> {
  const host = hostname.replace(/^\[/, '').replace(/\]$/, '');
  if (net.isIP(host) !== 0) {
    if (isRejectedIpAddress(host)) rejectUrl('GLB 下载地址指向不允许的网络地址。');
    return;
  }
  let addresses;
  try {
    addresses = await dns.promises.lookup(host, { all: true, verbatim: true });
  } catch {
    rejectUrl('GLB 下载地址的主机无法解析。');
  }
  if (addresses.length === 0 || addresses.some((entry) => isRejectedIpAddress(entry.address))) {
    rejectUrl('GLB 下载地址指向不允许的网络地址。');
  }
}

/** 生产默认下载策略：结果 URL 必须命中供应商 COS 来源且解析到公网。 */
export function assertProviderResultUrl(url: URL): Promise<void> {
  if (url.protocol !== 'https:') rejectUrl('GLB 下载地址必须使用 HTTPS。');
  if (url.username !== '' || url.password !== '') rejectUrl('GLB 下载地址不能包含凭据。');
  if (url.port !== '' && url.port !== '443') rejectUrl('GLB 下载地址端口无效。');
  if (!isTencentCosResultHost(url.hostname)) rejectUrl('GLB 下载地址不在允许的供应商来源内。');
  return assertPubliclyRoutable(url.hostname);
}
