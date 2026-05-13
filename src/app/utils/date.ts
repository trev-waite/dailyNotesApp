/** Format a JavaScript Date object as a YYYY-MM-DD string. */
export function formatDateString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Return today's date as a YYYY-MM-DD string. */
export function todayString(): string {
  return formatDateString(new Date());
}
