'use strict';
// Compare versions like 0.19.12.0 or 1.2.0-beta. Numbers compare as numbers.
function parts(v) {
  const [main, pre] = String(v).trim().replace(/^v/i, '').split('-', 2);
  return { nums: main.split('.').map((n) => parseInt(n, 10) || 0), pre: pre || '' };
}
function compare(a, b) {
  const A = parts(a), B = parts(b);
  const len = Math.max(A.nums.length, B.nums.length);
  for (let i = 0; i < len; i++) {
    const d = (A.nums[i] || 0) - (B.nums[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  if (A.pre === B.pre) return 0;
  if (!A.pre) return 1; // 1.0 > 1.0-beta
  if (!B.pre) return -1;
  return A.pre > B.pre ? 1 : -1;
}
function isValid(v) {
  return /^v?\d+(\.\d+){0,4}(-[0-9A-Za-z.]+)?$/.test(String(v).trim());
}
module.exports = { compare, isValid };
