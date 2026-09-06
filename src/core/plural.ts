/** "1 meter" / "3 meters" - user-facing copy shouldn't read like a log line. */
export function plural(count: number, singular: string, pluralForm?: string): string {
  return `${count} ${count === 1 ? singular : (pluralForm ?? singular + 's')}`;
}
