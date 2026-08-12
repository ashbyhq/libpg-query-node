#!/usr/bin/env node
//
// tsc emits both builds into dist/, but Node decides CJS-vs-ESM from the
// nearest package.json — and this package's root has no "type" field. Drop a
// marker in each output directory so `require` gets CommonJS and `import` gets
// real ESM, matching the conditions in the package's "exports" map.

const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, '..', 'dist');

for (const [dir, type] of [
  ['cjs', 'commonjs'],
  ['esm', 'module'],
]) {
  const target = path.join(distDir, dir);
  if (!fs.existsSync(target)) {
    console.error(`Missing build output: dist/${dir} — did tsc run?`);
    process.exit(1);
  }
  fs.writeFileSync(
    path.join(target, 'package.json'),
    `${JSON.stringify({ type }, null, 2)}\n`
  );
  console.log(`  ✓ dist/${dir}/package.json ("type": "${type}")`);
}
