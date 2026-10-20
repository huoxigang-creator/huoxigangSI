// 一次性算法验证：与 lib/quote-import.ts 的 mergeQuoteImportRows/specLastMm 核心逻辑一致
const specLastMm = (m) => { const a = m.match(/\d+(?:\.\d+)?/g); if (!a || !a.length) return null; const v = Number(a[a.length - 1]); return Number.isFinite(v) ? v : null; };

const allRows = [
  { name: 'L型免拉手', model: '58.0*25.0*1392.0', unit: '根', quantity: 1 },
  { name: 'L型免拉手', model: '58.0×25.0×1480.0', unit: '根', quantity: 1 },
  { name: 'C型免拉手', model: '73.0*25.0*700.0', unit: '根', quantity: 1 },
  { name: '索菲亚挂衣杆', model: '369.0', unit: 'mm', quantity: 2 },
  { name: '索菲亚挂衣杆', model: '549.0', unit: 'mm', quantity: 1 },
  { name: '普通灯带', model: '5000', unit: '个', quantity: 3 },
  { name: '普通灯带', model: '3000', unit: '个', quantity: 2 },
];

// —— 复制 mergeQuoteImportRows 核心逻辑 ——
const groups = new Map();
for (const row of allRows) {
  const key = row.name.trim() || '（未命名）';
  let group = groups.get(key);
  if (!group) { group = { row: { ...row }, models: new Set(row.model ? [row.model] : []), units: new Set(row.unit.trim() ? [row.unit.trim()] : []), lengthMm: 0, missingSpec: 0 }; groups.set(key, group); }
  else {
    group.row.quantity = (group.row.quantity ?? 0) + (row.quantity ?? 0);
    if (row.model) group.models.add(row.model);
    if (row.unit.trim()) group.units.add(row.unit.trim());
  }
  if (/免拉手|灯带/.test(row.name)) { const mm = specLastMm(row.model); if (mm !== null) group.lengthMm += (row.quantity ?? 0) * mm; else group.missingSpec++; }
}
const rows = [], notices = [];
for (const group of groups.values()) {
  const row = group.row, models = [...group.models], units = [...group.units];
  const isHandle = /免拉手/.test(row.name), isLed = /灯带/.test(row.name);
  const specText = models.join('、');
  row.model = specText.length > 90 ? specText.slice(0, 90) + '…等' + models.length + '种规格' : specText;
  if (isHandle || isLed) {
    const divisor = isHandle ? 1000 : 1;
    row.unit = isHandle ? '米' : '毫米';
    row.quantity = Number((group.lengthMm / divisor).toFixed(3));
    if (group.missingSpec === 0) notices.push(`「${row.name}」已按规格${isHandle ? '最后数字（毫米）折算为 ' + row.quantity + ' 米（共 ' + group.lengthMm + ' 毫米）' : '长度汇总为 ' + row.quantity + ' 毫米'}。`);
    else notices.push(`「${row.name}」有 ${group.missingSpec} 行规格缺少长度数字，未计入${isHandle ? '米' : '毫米'}汇总，请核对。`);
  } else {
    row.unit = units[0] ?? '';
    if (units.length > 1) notices.push(`「${row.name}」原单位不一致（${units.join('、')}），已合并数量并保留单位「${row.unit}」，请核对。`);
  }
  rows.push(row);
}
// —— 断言 ——
const expect = (cond, msg) => { if (!cond) { console.error('FAIL: ' + msg); process.exitCode = 1; } else console.log('OK: ' + msg); };
const byName = Object.fromEntries(rows.map(r => [r.name, r]));
expect(specLastMm('58.0*25.0*1392.0') === 1392, 'specLastMm 1392');
expect(specLastMm('58.0×25.0×1480.0') === 1480, 'specLastMm 1480');
expect(specLastMm('5000') === 5000, 'specLastMm 5000');
expect(specLastMm('') === null, 'specLastMm empty');
expect(rows.length === 4, '合并后共 4 行（L型免拉手/C型免拉手/索菲亚挂衣杆/普通灯带）');
expect(byName['L型免拉手'].quantity === 2.872 && byName['L型免拉手'].unit === '米', 'L型免拉手 2.872 米');
expect(byName['L型免拉手'].model === '58.0*25.0*1392.0、58.0×25.0×1480.0', 'L型免拉手规格汇总');
expect(byName['C型免拉手'].quantity === 0.7 && byName['C型免拉手'].unit === '米', 'C型免拉手 0.7 米');
expect(byName['索菲亚挂衣杆'].quantity === 3 && byName['索菲亚挂衣杆'].model === '369.0、549.0', '索菲亚挂衣杆数量合计 3、规格汇总');
expect(byName['普通灯带'].quantity === 21000 && byName['普通灯带'].unit === '毫米', '普通灯带 21000 毫米（3×5000+2×3000）');
console.log('notices:'); notices.forEach(n => console.log(' - ' + n));
