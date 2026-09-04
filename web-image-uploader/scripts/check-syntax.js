/* 全量语法检查：对 src 下所有 JS 执行 node --check，并校验 manifest.json */
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const jsFiles = [];
function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p);
    else if (ent.isFile() && ent.name.endsWith('.js')) jsFiles.push(p);
  }
}
walk(path.join(root, 'src'));

let bad = 0;
for (const f of jsFiles) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
    console.log('  ✓ ' + path.relative(root, f));
  } catch (e) {
    bad++;
    console.error('  ✗ ' + path.relative(root, f));
    console.error(String(e.stderr || e.message).split('\n').slice(0, 6).join('\n'));
  }
}

try {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const refs = [];
  const add = (list) => { for (const f of list || []) refs.push(path.join(root, f)); };
  add([manifest.action.default_popup, manifest.options_page, manifest.background.service_worker]);
  add(Object.values(manifest.icons || {}));
  add(manifest.web_accessible_resources.flatMap((w) => w.resources));
  for (const r of refs) {
    if (!fs.existsSync(r)) { bad++; console.error('  ✗ manifest 引用缺失: ' + r); }
  }
  console.log('  ✓ manifest.json 合法（' + manifest.name + ' v' + manifest.version + '）');
} catch (e) {
  bad++;
  console.error('  ✗ manifest.json 解析失败: ' + e.message);
}

console.log(bad ? '\n检查失败：' + bad + ' 处问题' : '\n语法检查全部通过（' + jsFiles.length + ' 个 JS 文件）');
process.exit(bad ? 1 : 0);
