export function taperRadius(t) {
  if (t <= 0 || t >= 1) return 0;
  return Math.min(1, t / 0.14, (1 - t) / 0.14);
}
export function strokeOpacity(stroke, serverTime) {
  const expiresAt = stroke.expiresAt ?? ((stroke.createdAt ?? serverTime) + 10000);
  const remaining = Math.max(0, Math.min(1, (expiresAt - serverTime) / 3000));
  return remaining * remaining * (3 - 2 * remaining);
}
