// WebGL2 上下文判据：把"句柄在、能力不在"这种形态识别出来。
//
// 真实故障形态不是 getContext 返回 null，而是返回一个句柄、但 getContextAttributes()
// 为 null（无 GPU / 软件光栅被禁用 / headless 预览环境）。Three 的 WebGLRenderer
// 构造器会直接读 attributes.alpha，于是抛 TypeError 而不是走可恢复的失败路径。

export type WebglFailure = 'no-context' | 'threw' | 'context-lost' | 'no-attributes';
export type WebglCapability = { readonly supported: true } | { readonly supported: false; readonly reason: WebglFailure };
// 判定只需要这两条，收窄成结构类型，检查台与单元测试就不必伪造整个 WebGL2 接口。
type ContextProbe = Pick<WebGL2RenderingContext, 'isContextLost' | 'getContextAttributes'>;

const probeAttributes: WebGLContextAttributes = { antialias: true, alpha: true, powerPreference: 'high-performance' };

// 探针会真的分配一个 GL context，而浏览器对同时存活的 context 数量有限制。
// 成功结论在整个页面生命周期内有效；失败结论不缓存，否则用户开启硬件加速后就再也测不到。
let proven = false;

/**
 * 判断一个已创建的上下文能否交给 Three。
 * 同时供预检和真实 canvas 使用：预检挡住环境级缺失，真实 canvas 挡住配额耗尽。
 */
export function webglFailure(context: ContextProbe): WebglFailure | null {
  // 已丢失的上下文不响应任何调用，Three 会在第一次编译着色器时炸。
  if (context.isContextLost()) return 'context-lost';
  // attributes 为 null 是"句柄在、能力不在"的特征形态，必须当作不可用。
  return context.getContextAttributes() === null ? 'no-attributes' : null;
}

/** 清空成功缓存。仅供检查台等测试入口使用，产品代码不要调用。 */
export function clearWebglProbe() { proven = false; }

/**
 * 在独立 canvas 上探测环境是否具备 WebGL2 能力，仅用于失败归因。
 *
 * 不要拿它当放行条件：虚拟化 / 软件光栅环境下，脱离文档的临时画布与真实 DOM 画布
 * 可能给出不同结果，用一次假阴性否决真实画布会把本来能渲染的展柜判死。
 *
 * 也不复用目标 canvas：一个 canvas 一旦成功 getContext，后续无论传什么 attribs 都返回
 * 同一个上下文对象，污染目标画布会让重试失去意义。
 */
export function probeWebgl2(): WebglCapability {
  if (proven) return { supported: true };
  if (typeof document === 'undefined') return { supported: false, reason: 'no-context' };
  let context: WebGL2RenderingContext | null;
  try { context = document.createElement('canvas').getContext('webgl2', probeAttributes); }
  catch { return { supported: false, reason: 'threw' }; }
  if (context === null) return { supported: false, reason: 'no-context' };
  const failure = webglFailure(context);
  releaseProbe(context);
  if (failure !== null) return { supported: false, reason: failure };
  proven = true;
  return { supported: true };
}

// loseContext 是异步生效的，但必须主动发起，否则每次探测都会白占一个配额。
function releaseProbe(context: WebGL2RenderingContext) {
  try { context.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* 释放失败不影响探测结论 */ }
}
