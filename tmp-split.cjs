// 手动测试 split 和 allInlineCount
const model = '1882*1 1513*1 731*2';
const parts = model.split(/[、,，;；\s]+/).map(s => s.trim()).filter(Boolean);
console.log('parts:', parts);
const allInlineCount = parts.length > 0 && parts.every(part => {
  const nums = [...part.matchAll(/(\d+(?:\.\d+)?)/g)].map(m => Number(m[1])).filter(n => Number.isFinite(n) && n > 0);
  console.log('  part:', part, 'nums:', nums, 'len:', nums.length);
  return nums.length === 2;
});
console.log('allInlineCount:', allInlineCount);
