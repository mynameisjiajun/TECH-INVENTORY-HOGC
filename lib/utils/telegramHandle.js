export function normalizeTelegramHandle(value) {
  const trimmed = String(value || "").trim().replace(/^@+/, "").toLowerCase();
  if (!trimmed) return null;
  return `@${trimmed}`;
}