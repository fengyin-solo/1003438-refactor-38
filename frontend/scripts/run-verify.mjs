#!/usr/bin/env node
// 用 esbuild（vite 的自带依赖）把 TS 校验脚本打成可执行的临时文件再运行，无需额外测试框架。
import { build } from 'esbuild'
import { rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = dirname(fileURLToPath(import.meta.url))
const outfile = join(root, '.verify-build.mjs')

try {
  await build({
    entryPoints: [join(root, 'verify.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile,
    logLevel: 'warning',
  })
  const result = spawnSync(process.execPath, [outfile], { stdio: 'inherit' })
  process.exitCode = result.status ?? 1
} finally {
  rmSync(outfile, { force: true })
}
