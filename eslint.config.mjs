import { FlatCompat } from '@eslint/eslintrc';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const compat=new FlatCompat({baseDirectory:path.dirname(fileURLToPath(import.meta.url))});
export default [
  { ignores:['.next/**','.next-*/**','node_modules/**','tmp/**','next-env.d.ts'] },
  ...compat.extends('next/core-web-vitals','next/typescript'),
  { rules:{ '@typescript-eslint/no-unused-vars':['error',{argsIgnorePattern:'^_',varsIgnorePattern:'^_'}] } },
];
