// 直接测试 lengthItem 判断和 specToMm
const row = { name: '100mm铝合金踢脚线', model: '2050', quantity: 2, unit: 'mm' };
const lengthItem = /免拉手|灯带|挂衣杆|踢脚线/.test(row.name) && !/角码|封口|连接|堵头/.test(row.name);
console.log('lengthItem:', lengthItem);

// 测试 specToMm
function specToMm(s) {
  if (!s) return null;
  const parts = String(s).split(/[、,，;；]/).map(p => p.trim()).filter(Boolean);
  if (!parts.length) return null;
  let total = 0;
  for (const part of parts) {
    const nums = [...part.matchAll(/(\d+(?:\.\d+)?)/g)].map(m => Number(m[1])).filter(n => Number.isFinite(n) && n > 0);
    if (nums.length === 0) return null;
    if (nums.length === 1) total += nums[0];
    else if (nums.length === 2) total += nums[0] * nums[1];
    else total += Math.max(...nums);
  }
  return total;
}
console.log('specToMm(2050):', specToMm('2050'));
