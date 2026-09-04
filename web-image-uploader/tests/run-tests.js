/* 单元测试（Node，无外部依赖）：加载共享纯函数模块（它们挂载到 globalThis.PGX）
 * 运行：npm test 或 node tests/run-tests.js */
'use strict';
const path = require('path');
const assert = require('assert');

const SRC = (p) => path.join(__dirname, '..', 'src', p);
// 依序加载（模块把 API 挂到 globalThis.PGX）
for (const f of ['shared/constants.js', 'shared/utils.js', 'shared/srcset.js',
  'shared/urls.js', 'shared/scoring.js', 'shared/validators.js']) {
  require(SRC(f));
}
const PGX = globalThis.PGX;
const C = PGX.C, U = PGX.U, Srcset = PGX.Srcset, Urls = PGX.Urls,
  Scoring = PGX.Scoring, V = PGX.Validators;

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.error('  ✗ ' + name + '\n    ' + (e && e.message)); }
}

console.log('PGX unit tests');
console.log('— srcset —');
t('parse 普通 1x/2x', () => {
  const r = Srcset.parseSrcset('a.jpg 1x, b.jpg 2x, c.jpg 3x');
  assert.strictEqual(r.length, 3);
  assert.strictEqual(r[0].kind, 'x');
  assert.strictEqual(r[0].value, 1);
  assert.strictEqual(r[2].value, 3);
});
t('parse w 描述符', () => {
  const r = Srcset.parseSrcset('sm.jpg 480w, md.jpg 1024w, lg.jpg 2048w');
  assert.strictEqual(r[2].width, 2048);
  assert.strictEqual(r[1].kind, 'w');
});
t('parse 忽略 data: 与空段', () => {
  const r = Srcset.parseSrcset('data:image/png;base64,xx, b.jpg 2x ,');
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].url, 'b.jpg');
});
t('pickLargest w 描述符选最大宽度', () => {
  const r = Srcset.parseSrcset('a.jpg 100w, b.jpg 800w, c.jpg 400w');
  assert.strictEqual(Srcset.pickLargest(r).url, 'b.jpg');
});
t('pickLargest x 描述符选最高密度', () => {
  const r = Srcset.parseSrcset('a.png 1x, b.png 2x, c.png 3x');
  assert.strictEqual(Srcset.pickLargest(r).url, 'c.png');
});

console.log('— utils —');
t('isValidHttpUrl 拒绝 data/blob/超长', () => {
  assert.ok(!U.isValidHttpUrl('data:image/png;base64,xxx'));
  assert.ok(!U.isValidHttpUrl('ftp://a.com/x.png'));
  assert.ok(!U.isValidHttpUrl('http://a.com/' + 'x'.repeat(2100)));
  assert.ok(U.isValidHttpUrl('https://cdn.example.com/a/b.png?v=1'));
});
t('urlKey 忽略顺序/hash/尾斜杠', () => {
  assert.strictEqual(U.urlKey('https://a.com/x.png?a=1&b=2#h'), U.urlKey('https://a.com/x.png?b=2&a=1'));
  assert.strictEqual(U.urlKey('https://a.com/x.png'), U.urlKey('https://a.com/x.png/'));
});
t('sanitizeFileName', () => {
  assert.strictEqual(U.sanitizeFileName('a/b\\c<d>:e?.png', ''), 'cde.png');
  assert.strictEqual(U.sanitizeFileName('', 'jpg'), 'image.jpg');
  assert.ok(U.sanitizeFileName('../../evil name.png', '').includes('evil name.png'));
});
t('extFromUrl / mimeFromExt', () => {
  assert.strictEqual(U.extFromUrl('https://a.com/photo.JPG?x=1'), 'jpg');
  assert.strictEqual(U.extFromUrl('https://a.com/noext'), '');
  assert.strictEqual(U.mimeFromExt('webp'), 'image/webp');
});
t('backoffMs 范围', () => {
  for (let i = 0; i < 8; i++) {
    const v = U.backoffMs(i, 1500);
    assert.ok(v >= 750 && v <= 1500 * Math.pow(2, Math.min(i, 6)) * 1.5, 'out of range ' + v);
  }
});
t('renderAlbumTemplate', () => {
  const out = U.renderAlbumTemplate('网页图片-{domain}-{date}', 'https://www.example.com/abc', '2026-09-03');
  assert.ok(out.includes('www.example.com'));
  assert.ok(out.includes('2026-09-03'));
});
t('sniffImageMime', () => {
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]).buffer;
  assert.strictEqual(U.sniffImageMime(jpg, 'image/jpeg'), 'image/jpeg');
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 1, 1, 1]).buffer;
  assert.strictEqual(U.sniffImageMime(png, ''), 'image/png');
  const html = new TextEncoder().encode('<!DOCTYPE html><html></html>').buffer;
  assert.strictEqual(U.sniffImageMime(html, 'text/html'), '');
  const gif = new TextEncoder().encode('GIF89a123456789012').buffer;
  assert.strictEqual(U.sniffImageMime(gif, ''), 'image/gif');
  const webp = new TextEncoder().encode('RIFF1234WEBPVP8 ').buffer;
  assert.strictEqual(U.sniffImageMime(webp, ''), 'image/webp');
});
t('bufToBase64/base64ToBytes 往返', () => {
  const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
  const b64 = U.bufToBase64(bytes.buffer);
  const back = U.base64ToBytes(b64);
  assert.deepStrictEqual([...back], [...bytes]);
});

console.log('— urls —');
t('sizeHintFromUrl 参数与文件名', () => {
  assert.strictEqual(Urls.sizeHintFromUrl('https://a.com/i.jpg?w=800&h=600').width, 800);
  assert.strictEqual(Urls.sizeHintFromUrl('https://a.com/i.jpg?w=800&h=600').height, 600);
  const f = Urls.sizeHintFromUrl('https://a.com/photos/name_1920x1080.png');
  assert.strictEqual(f.width, 1920);
  assert.strictEqual(f.source, 'filename');
  const sz = Urls.sizeHintFromUrl('https://lh3.googleusercontent.com/abc=s800-c');
  assert.strictEqual(sz.width, 0); // s800 不在 w/h/sz 正则里 -> 0（重写规则另行处理）
});
t('isLikelyThumbUrl 关键词', () => {
  assert.ok(Urls.isLikelyThumbUrl('https://a.com/thumb/x.jpg'));
  assert.ok(Urls.isLikelyThumbUrl('https://a.com/avatar.jpg'));
  assert.ok(Urls.isLikelyThumbUrl('https://img.com/photo_thumbnail_1.png'));
  assert.ok(!Urls.isLikelyThumbUrl('https://a.com/original/full.jpg'));
});
t('rewriteVariants googleusercontent 尺寸段', () => {
  const vs = Urls.rewriteVariants('https://lh3.googleusercontent.com/photo=s1600-c');
  assert.ok(vs.some((v) => v.includes('/photo=s0')), JSON.stringify(vs));
});
t('rewriteVariants 去 thumb 路径段', () => {
  const vs = Urls.rewriteVariants('https://cdn.example.com/gallery/thumbnails/img01.jpg');
  assert.ok(vs.some((v) => v.includes('/gallery/img01.jpg')), JSON.stringify(vs));
});
t('rewriteVariants 去尺寸参数', () => {
  const vs = Urls.rewriteVariants('https://cdn.example.com/img/photo.jpg?w=400&h=300&q=80');
  assert.ok(vs.some((v) => !v.includes('w=400') && !v.includes('h=300')), JSON.stringify(vs));
});
t('dedupeCandidates 去重', () => {
  const d = Urls.dedupeCandidates(['https://a.com/x.png?a=1', 'https://a.com/x.png?a=1#f', 'https://a.com/x.png?b=2']);
  assert.strictEqual(d.length, 2);
});
t('buildCandidates 疑似缩略图生成重写候选', () => {
  const { candidates, likelyThumb } = Urls.buildCandidates('https://cdn.com/thumbnails/pic.jpg', ['https://cdn.com/thumbnails/pic.jpg']);
  assert.ok(likelyThumb);
  assert.ok(candidates.some((cd) => cd.source === 'rewrite'), '应包含重写出的更大候选');
});
t('classifyDecor 头像/图标/广告/小图识别', () => {
  assert.ok(Urls.classifyDecor('https://a.com/avatar/user1.png', null).isAvatar);
  assert.ok(Urls.classifyDecor('https://a.com/icons/logo.svg', null).isIcon);
  assert.ok(Urls.classifyDecor('https://ads.google.com/banner.png', null).isAd);
  assert.ok(Urls.classifyDecor('https://a.com/doubleclick/banner.jpg', null).urlDecor);
  // 小尺寸命中装饰
  const small = Urls.classifyDecor('https://a.com/img/photo.png', { width: 48, height: 48 });
  assert.ok(small.decor);
  // 大图非装饰
  const big = Urls.classifyDecor('https://a.com/gallery/photo.jpg', { width: 2000, height: 1200 });
  assert.ok(!big.decor);
  // 普通路径无命中
  assert.ok(!Urls.isLikelyDecorUrl('https://a.com/photos/scenery/winter.jpg'));
});

console.log('— scoring —');
t('pickBest 像素更大者胜出', () => {
  const r = Scoring.pickBest([
    { url: 'https://a.com/small.jpg', dims: { width: 400, height: 300, source: 'url' } },
    { url: 'https://a.com/big.jpg', dims: { width: 3840, height: 2160, source: 'url' } }
  ], { minSide: 1600 });
  assert.strictEqual(r.url, 'https://a.com/big.jpg');
  assert.strictEqual(r.isLikelyOriginal, true);
});
t('pickBest 缩略图词罚分（尺寸未知时避开 thumb 词 URL）', () => {
  const r = Scoring.pickBest([
    { url: 'https://a.com/thumb/photo.jpg' },
    { url: 'https://a.com/photo.jpg' }
  ], { minSide: 1600 });
  assert.strictEqual(r.url, 'https://a.com/photo.jpg');
  assert.ok(r.isLikelyThumb === false);
});
t('pickBest 低于阈值给 warning', () => {
  const r = Scoring.pickBest([{ url: 'https://a.com/s.png', dims: { width: 800, height: 600, source: 'url' } }], { minSide: 1600 });
  assert.ok(r.warning);
  assert.strictEqual(r.isLikelyOriginal, false);
});
t('pickBest 空候选安全', () => {
  const r = Scoring.pickBest([], {});
  assert.strictEqual(r.url, '');
});

console.log('— validators —');
t('sanitizeSettings 钳制与默认', () => {
  const s = V.sanitizeSettings({ maxConcurrent: 99, retries: -2, minSide: 0, albumMode: 'bad' });
  assert.strictEqual(s.maxConcurrent, C.TASK.MAX_CONCURRENCY);
  assert.strictEqual(s.retries, 0);
  assert.strictEqual(s.minSide, 200);
  assert.strictEqual(s.albumMode, 'none');
  assert.strictEqual(V.sanitizeSettings({ autoAlbumName: '  我的相册  ' }).autoAlbumName, '我的相册');
  assert.strictEqual(V.sanitizeSettings({ autoAlbumName: 123 }).autoAlbumName, '');
  const d = V.sanitizeSettings(undefined);
  assert.strictEqual(d.maxConcurrent, C.TASK.DEFAULT_CONCURRENCY);
  assert.strictEqual(d.auth.method, 'webauth');
});
t('sanitizeUploadItems 过滤非法 URL 与限额', () => {
  const items = [
    { url: 'https://a.com/1.png', fileName: '1.png' },
    { url: 'data:image/png;base64,xx' },
    { url: 'not-a-url' },
    { url: 'https://a.com/2.jpg', width: 100 }
  ];
  const out = V.sanitizeUploadItems(items, 2);
  assert.ok(out);
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[0].url, 'https://a.com/1.png');
  assert.ok(!V.sanitizeUploadItems([], 10));
});
t('sanitizeAuthPayload', () => {
  const a = V.sanitizeAuthPayload({ clientId: ' x.apps.googleusercontent.com ', method: 'webauth', useMock: true });
  assert.strictEqual(a.clientId, 'x.apps.googleusercontent.com');
  assert.ok(a.useMock);
});
t('sanitizeSettings billing', () => {
  // baseUrl 规范化：无协议补 https、去尾斜杠；quoteEnabled 布尔化；loginMode 白名单
  const s = V.sanitizeSettings({ billing: { baseUrl: 'api.example.com//', quoteEnabled: 1, loginMode: 'foo' } });
  assert.strictEqual(s.billing.baseUrl, 'https://api.example.com');
  assert.ok(!s.billing.quoteEnabled);
  assert.strictEqual(s.billing.loginMode, 'dev'); // 非法值回退默认
  const s2 = V.sanitizeSettings({ billing: { baseUrl: '  http://localhost:8787/  ', quoteEnabled: 0 } });
  assert.strictEqual(s2.billing.baseUrl, 'http://localhost:8787');
  assert.ok(!s2.billing.quoteEnabled);
});

console.log('\n结果：' + passed + ' 通过, ' + failed + ' 失败');
process.exit(failed ? 1 : 0);
