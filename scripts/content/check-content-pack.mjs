#!/usr/bin/env node
/**
 * 内容包校验器（E 主责 · 零依赖）
 *
 * 用途：检查内容包 JSON 是否符合 docs/12-内容包模板.md 的字段约定，
 *      并拦住三类最容易在赶工中犯的错：
 *        1. 补造精确年份（把"记不清哪年"写成 1985）
 *        2. AI 草稿没有来源片段标识（等于无法核对事实边界）
 *        3. 缺失项留空不写（"缺失"必须显式列出）
 *
 * 用法：
 *   node scripts/content/check-content-pack.mjs <文件.json> [更多文件...]
 *   node scripts/content/check-content-pack.mjs --dir tests/fixtures/content-pack/ok
 *
 * 退出码：0 = 全部通过（可能有警告）；1 = 至少一个文件有错误；2 = 用法错误
 *
 * 回归样例：node --test tests/content/check-content-pack.test.mjs
 *   ok/ 必须 0 错误；bad/ 每个文件只改一个字段，必须只报对应的那一条。
 *
 * 设计取舍：
 *   - 零依赖，不引 zod/ajv。工程还没起，脚本要能今晚就跑。
 *   - 只校验"结构与禁止项"，不校验文笔、不判断故事真假——那需要人。
 *   - fixture（_fixture: true）照常校验，但额外警告"不得用于演示"。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';

// v0.6 三类保留；v0.7 §1.1 允许在类别里注明样例 / 独立新输入 / 照片票据，真实支持范围以实测为准
const CATEGORIES = ['立体重点', '简单立体', '照片或票据', '支持范围内的旧物',
  '独立新输入', '完整样例', '样例', '故障测试'];
const VISIBILITIES = ['可公开', '仅限家人', '不可公开'];
// v0.7 §2 模板：分享范围只有两档。"持链接分享"是 §1.4 的许可范围，不是 shareScope
const SHARE_SCOPES = ['私有草稿', '用户明确发布后持链接访问'];
const CAPTION_MAX = 120;               // src/contracts/primitives.ts captionSchema
// PROJECT_PLAN §6：任务至少区分排队、执行中、成功和失败
const GENERATION_RESULTS = ['排队', '执行中', '成功', '失败'];
const EXACT_YEAR = /^\d{4}$/;          // 纯 4 位数字 = 补造的精确年份
const YEAR_WITH_QUALIFIER = /约|可能|记不清|大概|左右|前后|年代|世纪/;
// src/contracts/museum.ts：rawStory / transcript 都不得超过 12000 字，超了填不进系统
const NARRATIVE_MAX = 12_000;
// src/contracts/ai.ts 的 sourceSegmentsSchema：每段文字上限、片段总数上限、合计长度上限
const SEGMENT_TEXT_MAX = 6_000;
const SEGMENT_COUNT_MAX = 40;
const SEGMENT_TOTAL_MAX = 12_000;
// src/contracts/primitives.ts：sourceIdSchema 是 textSchema(1, 80)，片段 ID 也受 trim 后 1–80 字限制
const SEGMENT_ID_MAX = 80;

const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;
const isArray = Array.isArray;
const isPlainObject = (v) => v !== null && typeof v === 'object' && !isArray(v);

/**
 * 把值的中文类型名说出来，用于报错。
 *
 * 必须显式区分类型，不能靠 String(v) 判断"有没有填"：
 * String(false) = "false"、String(0) = "0"、String(['成功']) = "成功"，
 * 这些非法值一旦被字符串化，就会伪装成"非空"，从而零错误通过。
 */
function typeName(v) {
  if (v === undefined) return '缺失';
  if (v === null) return 'null';
  if (isArray(v)) return '数组';
  if (typeof v === 'boolean') return '布尔值';
  if (typeof v === 'number') return '数字';
  if (typeof v === 'string') return '字符串';
  if (typeof v === 'object') return '对象';
  return typeof v;
}

/** 校验一个内容包对象，返回 { errors, warnings } */
export function checkPack(pack) {
  const errors = [];
  const warnings = [];
  const E = (m) => errors.push(m);
  const W = (m) => warnings.push(m);

  if (pack === null || typeof pack !== 'object' || isArray(pack)) {
    E('根节点必须是 JSON 对象');
    return { errors, warnings };
  }

  if (pack._fixture === true) {
    W('这是 fixture（_fixture: true），不得当作真实产出用于演示或提交材料');
  }

  // ── 标识与分类 ──
  if (!/^EX-\d{2,}$/.test(String(pack.id ?? ''))) {
    E(`id 必须形如 EX-01，当前为 ${JSON.stringify(pack.id)}`);
  }
  if (!isNonEmptyString(pack.name)) E('name 不能为空（用物主自己的叫法，不要起雅名）');
  if (!CATEGORIES.includes(pack.category)) {
    E(`category 必须是 ${CATEGORIES.join(' / ')} 之一，当前为 ${JSON.stringify(pack.category)}`);
  }

  // ── 约略年代：禁止补造精确年份 ──
  const era = pack.era;
  if (!isNonEmptyString(era)) {
    E('era 不能为空（允许"八十年代末""不记得哪年，小时候"这类原话）');
  } else if (EXACT_YEAR.test(era.trim())) {
    E(`era 是纯 4 位年份「${era}」——禁止补造精确年份，请改回物主原话或加"约/可能/记不清"`);
  } else if (!YEAR_WITH_QUALIFIER.test(era)) {
    W(`era「${era}」不含"约/可能/记不清"等限定词，确认是否为物主原话`);
  }

  // ── 事实层 ──
  const facts = pack.facts;
  if (facts === null || typeof facts !== 'object' || isArray(facts)) {
    E('facts 必须是对象');
  } else {
    const nar = facts.originalNarrative;
    if (!isNonEmptyString(nar)) {
      E('facts.originalNarrative 不能为空（物主原话，逐字记录，不改写）');
    } else if (nar.trim().length < 10) {
      W('facts.originalNarrative 短于 10 字，确认是否真的只有这些');
    }
    if (isNonEmptyString(nar) && Array.from(nar).length > NARRATIVE_MAX) {
      E(`facts.originalNarrative 有 ${Array.from(nar).length} 字，工程契约上限 ${NARRATIVE_MAX} 字（src/contracts/museum.ts）`);
    }

    // 录音整理文本（v0.7 起与原始讲述并列保存，对应工程契约 transcript）。
    //
    // 注意：文本与 originalNarrative 一字不差是**合法**的。
    // 两者是两条独立来源，分别存在 facts.originalNarrative 与 facts.transcript 两个字段里，
    // 由 sourceSegments[].source（rawStory / transcript）区分归属；
    // 工程侧 sourceSegmentsFromText 也是按字段逐个切段，不比较文本是否相同。
    // 因此这里只查类型与长度，不查两者内容差异。
    //
    // 空字符串同样合法：src/contracts/museum.ts 里是 z.string()（无 .min()），只限制不超过 12000 字。
    // 「没有录音」应写 null，不要写 ""——两者应用都接受，但 null 的语义更明确。
    if (facts.transcript != null) {
      if (typeof facts.transcript !== 'string') {
        E(`facts.transcript 必须是字符串（当前是 ${typeName(facts.transcript)}；没有录音就整项设 null）`);
      } else if (Array.from(facts.transcript).length > NARRATIVE_MAX) {
        E(`facts.transcript 有 ${Array.from(facts.transcript).length} 字，工程契约上限 ${NARRATIVE_MAX} 字（src/contracts/museum.ts）`);
      }
    }

    const src = facts.narrativeSource;
    if (src === null || typeof src !== 'object' || isArray(src)) {
      E('facts.narrativeSource 必须是对象（谁 / 何时 / 渠道）');
    } else {
      for (const k of ['who', 'when', 'channel']) {
        if (!isNonEmptyString(src[k])) E(`facts.narrativeSource.${k} 不能为空`);
      }
    }

    const segs = facts.sourceSegments;
    if (!isArray(segs) || segs.length === 0) {
      E('facts.sourceSegments 至少要有一条（展签每句都要能指回原始讲述）');
    } else {
      if (segs.length > SEGMENT_COUNT_MAX) {
        E(`facts.sourceSegments 有 ${segs.length} 段，工程契约上限 ${SEGMENT_COUNT_MAX} 段（src/contracts/ai.ts sourceSegmentsSchema）`);
      }
      const seen = new Set();
      let totalChars = 0;
      segs.forEach((s, i) => {
        if (!isNonEmptyString(s?.id)) {
          E(`facts.sourceSegments[${i}].id 不能为空`);
        } else {
          // 与工程契约一致：sourceIdSchema 先 trim，再计数和去重
          const id = s.id.trim();
          const idLength = Array.from(id).length;
          if (idLength > SEGMENT_ID_MAX) {
            E(`facts.sourceSegments[${i}].id 有 ${idLength} 字，工程契约上限 ${SEGMENT_ID_MAX} 字（src/contracts/primitives.ts）`);
          }
          // 长度超限不影响去重：过长 ID 仍要参与重复判断，否则会漏报一组重复 ID
          if (seen.has(id)) E(`facts.sourceSegments[${i}].id 重复：${id}`);
          else seen.add(id);
        }
        if (!isNonEmptyString(s?.text)) {
          E(`facts.sourceSegments[${i}].text 不能为空`);
        } else {
          // 与工程契约一致：textSchema 是 trim 后计数，单段上限 6000
          const textLength = Array.from(s.text.trim()).length;
          if (textLength > SEGMENT_TEXT_MAX) {
            E(`facts.sourceSegments[${i}].text 有 ${textLength} 字，工程契约单段上限 ${SEGMENT_TEXT_MAX} 字（src/contracts/ai.ts）`);
          }
          totalChars += textLength;
        }
        // 与工程契约对齐：每条片段要标明出自原始讲述还是录音转写
        if (s?.source == null || s.source === '') {
          W(`facts.sourceSegments[${i}].source 未填（原始讲述写 rawStory，录音转写写 transcript）`);
        } else if (!['rawStory', 'transcript'].includes(s.source)) {
          E(`facts.sourceSegments[${i}].source = ${JSON.stringify(s.source)} 不在允许值内（rawStory / transcript）`);
        }
      });
      // 合计长度上限。校验器放过、应用存不下的内容包，就是这一类缺口。
      if (totalChars > SEGMENT_TOTAL_MAX) {
        E(`facts.sourceSegments 合计 ${totalChars} 字，工程契约上限 ${SEGMENT_TOTAL_MAX} 字（src/contracts/ai.ts）`);
      }
    }

    if (!isArray(facts.photos) || facts.photos.length === 0) {
      E('facts.photos 至少要有一张（原图不裁剪、不压缩、不转格式）');
    } else {
      facts.photos.forEach((p, i) => {
        if (!isNonEmptyString(p?.file)) E(`facts.photos[${i}].file 不能为空`);
      });
    }

    if (facts.audio != null) {
      if (!isNonEmptyString(facts.audio.file)) E('facts.audio.file 不能为空（没有原声就整项设 null）');
      if (!isNonEmptyString(facts.audio.licenseScope)) E('facts.audio.licenseScope 不能为空');
    }

    if (!isArray(facts.knownDoubts)) {
      W('facts.knownDoubts 建议写成数组（物主说"记不清""可能是"的地方必须保留，没有就写 []）');
    }
  }

  // ── 整理层：AI 草稿必须有来源 ──
  const cur = pack.curation;
  if (cur === null || typeof cur !== 'object' || isArray(cur)) {
    E('curation 必须是对象');
  } else {
    if (!isNonEmptyString(cur.currentLabel)) {
      E('curation.currentLabel 不能为空（待确认的最终展签文本）');
    } else {
      // 与工程契约一致：src/contracts/primitives.ts 的 textSchema 是 z.string().trim() 之后再计数。
      // 不先 trim 就会把「120 字正文 + 一个换行」误判成 121 字而拒绝——那是合法内容。
      const labelLength = Array.from(cur.currentLabel.trim()).length;
      if (labelLength > CAPTION_MAX) {
        E(`curation.currentLabel 去除首尾空白后有 ${labelLength} 字，工程契约 caption 上限 ${CAPTION_MAX} 字（src/contracts/primitives.ts）`);
      }
    }

    if (cur.aiDraft != null) {
      const d = cur.aiDraft;
      if (!isNonEmptyString(d.text)) E('curation.aiDraft.text 不能为空（不用 AI 就整项设 null）');
      if (!isArray(d.sourceSegmentIds) || d.sourceSegmentIds.length === 0) {
        E('curation.aiDraft.sourceSegmentIds 不能为空——AI 草稿没有来源标识就无法核对事实边界');
      } else {
        const factIds = new Set(
          (isArray(facts?.sourceSegments) ? facts.sourceSegments : [])
            .map((s) => s?.id)
            .filter(isNonEmptyString)
            .map((id) => id.trim()),
        );
        d.sourceSegmentIds.forEach((id, i) => {
          if (!isNonEmptyString(id) || !factIds.has(id.trim())) {
            E(`curation.aiDraft.sourceSegmentIds[${i}] = ${JSON.stringify(id)} 在 facts.sourceSegments 里找不到`);
          }
        });
      }
      if (!isNonEmptyString(d.model)) W('curation.aiDraft.model 未填（记下用的哪个模型，便于复盘）');
      if (!isNonEmptyString(d.generatedAt)) W('curation.aiDraft.generatedAt 未填');
    }

    if (!isArray(cur.humanEdits)) {
      W('curation.humanEdits 建议写成数组，没有就写 []');
    }
    if (!isArray(cur.questions)) {
      W('curation.questions 建议写成数组（最多两个待问物主的问题）');
    } else if (cur.questions.length > 2) {
      E(`curation.questions 有 ${cur.questions.length} 条，开发书 §6 限制最多两个`);
    }
  }

  // ── 确认层 ──
  const cf = pack.confirmation;
  if (cf === null || typeof cf !== 'object' || isArray(cf)) {
    E('confirmation 必须是对象');
  } else {
    for (const k of ['version', 'confirmedBy', 'confirmedAt', 'channel', 'scope']) {
      if (!isNonEmptyString(cf[k])) E(`confirmation.${k} 不能为空`);
    }
    // v0.7 起用 shareScope 表达分享范围（默认私有草稿，用户明确发布才算公开）。
    // visibility 是 v0.6 旧字段，仍接受但提示迁移。
    if (cf.shareScope != null) {
      if (!SHARE_SCOPES.includes(cf.shareScope)) {
        E(`confirmation.shareScope 必须是 ${SHARE_SCOPES.join(' / ')} 之一，当前为 ${JSON.stringify(cf.shareScope)}`);
      }
    } else if (cf.visibility != null) {
      if (!VISIBILITIES.includes(cf.visibility)) {
        E(`confirmation.visibility 必须是 ${VISIBILITIES.join(' / ')} 之一，当前为 ${JSON.stringify(cf.visibility)}`);
      } else {
        W(`confirmation.visibility 是 v0.6 旧字段，v0.7 改用 shareScope（${SHARE_SCOPES.join(' / ')}），建议迁移`);
      }
    } else {
      E('confirmation 缺少 shareScope（v0.7）或 visibility（v0.6），分享范围必须显式记录');
    }
  }

  // ── 模型生成记录（v0.7 §1.5；方案 B 的核心证据） ──
  const gen = pack.generation;
  if (gen != null) {
    if (!isPlainObject(gen)) {
      E(`generation 必须是对象或 null（当前是 ${typeName(gen)}；没有生成记录就写 null，不要留空对象）`);
    } else {
      // 先判类型再判取值。顺序不能反：一旦先用 String() 判断"是否为空"，
      // false / 0 / ["成功"] 都会被洗成非空字符串，非法值就静默通过了。
      for (const k of ['input', 'task']) {
        const v = gen[k];
        if (v == null) {
          E(`generation.${k} 不能为空——模型生成记录要能对上输入、任务与状态`);
        } else if (isPlainObject(v)) {
          if (Object.keys(v).length === 0) E(`generation.${k} 不能是空对象——至少写清实际内容`);
        } else if (!isNonEmptyString(v)) {
          E(`generation.${k} 必须是非空字符串或对象（当前是 ${typeName(v)}）——${k === 'input' ? '写照片资产 ID、文件哈希及来源版本' : '写任务标识、服务与模型版本、提交与完成时间'}`);
        }
      }

      const st = gen.status;
      if (st == null) {
        E('generation.status 不能为空——排队 / 执行中 / 成功 / 失败必须显式记录');
      } else if (!isPlainObject(st)) {
        E(`generation.status 必须是对象（当前是 ${typeName(st)}），要写 result / durationMs / costNote`);
      } else {
        for (const k of ['result', 'durationMs', 'costNote']) {
          if (!isNonEmptyString(st[k])) {
            E(`generation.status.${k} 必须是非空字符串（当前是 ${typeName(st[k])}；真实耗时、费用与结果如实记录，未知就写"未知"）`);
          }
        }
        if (isNonEmptyString(st.result) && !GENERATION_RESULTS.includes(st.result)) {
          E(`generation.status.result 必须是 ${GENERATION_RESULTS.join(' / ')} 之一（PROJECT_PLAN §6 要求至少区分这四态），当前为 ${JSON.stringify(st.result)}`);
        }
        // 排队、执行中、失败本来就没有输出，不能逼人编一个假资产
        if (st.result === '成功' && !isNonEmptyString(gen.output)) {
          E('generation.status.result 为「成功」时 generation.output 不能为空——成功就得写清资产 ID 与版本、格式、字节数、预算检查和预览结果');
        } else if (gen.output != null && !isNonEmptyString(gen.output)) {
          E(`generation.output 必须是非空字符串或 null（当前是 ${typeName(gen.output)}）`);
        }
      }
    }
  }

  // ── 许可 ──
  if (!isArray(pack.licenses) || pack.licenses.length === 0) {
    E('licenses 至少要有一条（每个文件单独记来源与许可）');
  } else {
    pack.licenses.forEach((l, i) => {
      for (const k of ['file', 'source', 'licenseScope', 'authorizedBy']) {
        if (!isNonEmptyString(l?.[k])) E(`licenses[${i}].${k} 不能为空`);
      }
    });
  }

  // ── 缺失项：必须显式列出 ──
  if (!isArray(pack.missing)) {
    E('missing 必须是数组——内容缺失时明确列出，不许留空（真的不缺就写 []）');
  }

  return { errors, warnings };
}

/** 递归收集 .json 文件 */
function collectJson(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...collectJson(p));
    else if (name.endsWith('.json')) out.push(p);
  }
  return out;
}

function main(argv) {
  const args = argv.slice(2);
  if (args.length === 0) {
    console.error('用法：node scripts/content/check-content-pack.mjs <文件.json...> | --dir <目录>');
    return 2;
  }

  let files = [];
  if (args[0] === '--dir') {
    if (!args[1]) {
      console.error('--dir 后面要跟目录路径');
      return 2;
    }
    files = collectJson(args[1]);
    if (files.length === 0) {
      console.error(`目录里没有 .json：${args[1]}`);
      return 2;
    }
  } else {
    files = args;
  }

  let totalErrors = 0;
  let totalWarnings = 0;

  for (const f of files) {
    let raw;
    try {
      raw = readFileSync(f, 'utf8');
    } catch (err) {
      console.log(`\n✗ ${basename(f)}`);
      console.log(`  读取失败：${err.message}`);
      totalErrors += 1;
      continue;
    }

    let pack;
    try {
      pack = JSON.parse(raw);
    } catch (err) {
      console.log(`\n✗ ${basename(f)}`);
      console.log(`  JSON 解析失败：${err.message}`);
      totalErrors += 1;
      continue;
    }

    const { errors, warnings } = checkPack(pack);
    totalErrors += errors.length;
    totalWarnings += warnings.length;

    const mark = errors.length === 0 ? '✓' : '✗';
    console.log(`\n${mark} ${basename(f)}  —— 错误 ${errors.length} / 警告 ${warnings.length}`);
    for (const e of errors) console.log(`  [错误] ${e}`);
    for (const w of warnings) console.log(`  [警告] ${w}`);
  }

  console.log(`\n合计：${files.length} 个文件，错误 ${totalErrors}，警告 ${totalWarnings}`);
  if (totalErrors > 0) {
    console.log('结论：不通过。修完再提交，别把未填的内容包当素材用。');
    return 1;
  }
  console.log('结论：结构与禁止项校验通过。注意——本脚本不判断故事真假，那需要人核对。');
  return 0;
}

if (import.meta.main) process.exit(main(process.argv));
