import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import tseslint from 'typescript-eslint';

/**
 * ESLint 10 不用：eslint-config-next 依赖的 eslint-plugin-react / import / jsx-a11y
 * 目前的上界都是 ESLint 9，装 10 会出现 unmet peer。锁定 9.39.5。
 * Next 16 已移除 `next lint`，统一用 `eslint .`。
 */
export default defineConfig([
  globalIgnores(['.next/**', 'node_modules/**', 'coverage/**', '.vitest/**', 'next-env.d.ts']),

  ...nextVitals,

  {
    files: ['**/*.ts', '**/*.tsx'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // AGENTS §3：不得用 any 掩盖问题
      '@typescript-eslint/no-explicit-any': 'error',
      // 这三个是随库互操作噪音最大的规则，留作提醒但不算错
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      // AGENTS §8：不允许吞错、不允许悬空 Promise
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      'no-empty': ['error', { allowEmptyCatch: false }],
    },
  },

  {
    files: ['**/*.mjs', '**/*.cjs'],
    extends: [tseslint.configs.recommended],
  },

  {
    // 调试残留：src 下只允许 warn/error
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },

  {
    // AGENTS §2、§6：客户端模块不得导入数据库、文件系统、服务端会话或密钥模块
    files: ['src/features/**/*.{ts,tsx}', 'src/app/**/*.{ts,tsx}'],
    ignores: ['src/app/api/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@/server/db',
                '@/server/db/*',
                '@/server/auth',
                '@/server/auth/*',
                '@/server/config',
                '@/server/config/*',
                'pg',
                'server-only',
                'node:fs',
                'node:fs/promises',
                'node:path',
              ],
              message:
                '界面与客户端模块不得直接访问数据库、文件系统、会话或密钥；请经路由处理器、server action 或公共契约。',
            },
          ],
        },
      ],
    },
  },
]);
