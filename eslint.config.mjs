import { builtinModules } from 'node:module';
import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
const boundaries = {
  rules: {
    'browser-imports': {
      meta: { type: 'problem', schema: [], messages: { server: '浏览器、公共契约和 3D 模块不能导入服务端实现。', secret: '浏览器模块不能读取服务端环境变量。' } },
      create(context) {
        let browserModule = /\/src\/(features|contracts)\//.test(context.filename) && !context.filename.endsWith('.test.ts');
        const check = (node, source) => {
          if (browserModule && typeof source === 'string' && (builtins.has(source) || /(^|\/)server(\/|$)/.test(source) || ['pg', 'sharp', 'iron-session', 'server-only'].includes(source))) {
            context.report({ node, messageId: 'server' });
          }
        };
        return {
          Program(node) { browserModule ||= node.body.some((statement) => statement.type === 'ExpressionStatement' && statement.directive === 'use client'); },
          ImportDeclaration(node) { check(node, node.source.value); },
          ExportNamedDeclaration(node) { if (node.source) check(node, node.source.value); },
          ExportAllDeclaration(node) { check(node, node.source.value); },
          ImportExpression(node) { if (node.source.type === 'Literal') check(node, node.source.value); },
          CallExpression(node) { if (node.callee.type === 'Identifier' && node.callee.name === 'require') check(node, node.arguments[0]?.value); },
          MemberExpression(node) {
            if (browserModule && node.object.type === 'Identifier' && node.object.name === 'process' && node.property.type === 'Identifier' && node.property.name === 'env') context.report({ node, messageId: 'secret' });
          },
        };
      },
    },
  },
};

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  { files: ['**/*.{ts,tsx}'], plugins: { project: boundaries }, rules: {
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-non-null-assertion': 'error',
    '@typescript-eslint/ban-ts-comment': ['error', { 'ts-ignore': true, 'ts-nocheck': true, 'ts-expect-error': true }],
    'project/browser-imports': 'error',
    'no-restricted-syntax': ['error', { selector: 'TSAsExpression > TSAsExpression', message: '禁止双重类型断言；请校验边界输入。' }],
  } },
  globalIgnores(['.next/**', 'next-env.d.ts', '**/.vite/**', 'src/features/cabinet/assets/model-source/**']),
]);
