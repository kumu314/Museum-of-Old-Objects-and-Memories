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

const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;
const isArray = Array.isArray;

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

    // 录音整理文本（v0.7 起与原始讲述并列，对应工程契约 transcript）。
    // 两者来源不同，不能混为一栏。
    if (facts.transcript != null) {
      if (!isNonEmptyString(facts.transcript)) {
        E('facts.transcript 若填就必须是非空字符串（没有录音就整项设 null）');
      } else if (isNonEmptyString(nar) && facts.transcript.trim() === nar.trim()) {
        E('facts.transcript 与 originalNarrative 完全相同——录音转写与用户原话是两种来源，不能混为一栏');
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
      const seen = new Set();
      segs.forEach((s, i) => {
        if (!isNonEmptyString(s?.id)) E(`facts.sourceSegments[${i}].id 不能为空`);
        else if (seen.has(s.id)) E(`facts.sourceSegments[${i}].id 重复：${s.id}`);
        else seen.add(s.id);
        if (!isNonEmptyString(s?.text)) E(`facts.sourceSegments[${i}].text 不能为空`);
        // 与工程契约对齐：每条片段要标明出自原始讲述还是录音转写
        if (s?.source == null || s.source === '') {
          W(`facts.sourceSegments[${i}].source 未填（原始讲述写 rawStory，录音转写写 transcript）`);
        } else if (!['rawStory', 'transcript'].includes(s.source)) {
          E(`facts.sourceSegments[${i}].source = ${JSON.stringify(s.source)} 不在允许值内（rawStory / transcript）`);
        }
      });
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
    } else if (Array.from(cur.currentLabel).length > CAPTION_MAX) {
      // 工程契约 caption 上限，超了填不进系统
      E(`curation.currentLabel 有 ${Array.from(cur.currentLabel).length} 字，工程契约 caption 上限 ${CAPTION_MAX} 字（src/contracts/primitives.ts）`);
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
            .filter(isNonEmptyString),
        );
        d.sourceSegmentIds.forEach((id, i) => {
          if (!factIds.has(id)) {
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
    if (gen === null || typeof gen !== 'object' || isArray(gen)) {
      E('generation 必须是对象或 null（没有生成记录就写 null，不要留空对象）');
    } else {
      for (const k of ['input', 'task', 'status']) {
        const v = gen[k];
        const emptyObj = v !== null && typeof v === 'object' && !isArray(v) && Object.keys(v).length === 0;
        if (v == null || (typeof v === 'string' && v.trim() === '') || emptyObj) {
          E(`generation.${k} 不能为空——模型生成记录要能对上输入、任务与状态`);
        }
      }
      const st = gen.status;
      if (st && typeof st === 'object' && !isArray(st)) {
        for (const k of ['result', 'durationMs', 'costNote']) {
          if (!isNonEmptyString(String(st[k] ?? ''))) {
            E(`generation.status.${k} 不能为空（真实耗时、费用与结果如实记录，未知就写"未知"）`);
          }
        }
        if (isNonEmptyString(st.result) && !GENERATION_RESULTS.includes(st.result)) {
          E(`generation.status.result 必须是 ${GENERATION_RESULTS.join(' / ')} 之一（PROJECT_PLAN §6 要求至少区分这四态），当前为 ${JSON.stringify(st.result)}`);
        }
        // 排队、执行中、失败本来就没有输出，不能逼人编一个假资产
        if (st.result === '成功' && !isNonEmptyString(gen.output)) {
          E('generation.status.result 为「成功」时 generation.output 不能为空——成功就得写清资产 ID 与版本、格式、字节数、预算检查和预览结果');
        } else if (gen.output != null && typeof gen.output !== 'string') {
          E('generation.output 必须是字符串（未完成就整项设 null）');
        } else if (typeof gen.output === 'string' && gen.output !== '' && gen.output.trim() === '') {
          E('generation.output 不能只有空白（未完成就整项设 null）');
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
