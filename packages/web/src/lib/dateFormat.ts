/**
 * `Date#toLocaleDateString(locale, options)` builds a fresh `Intl.DateTimeFormat` on every call,
 * which dominates render time on list screens. This builds one lazily and reuses it, with the same
 * output (including "Invalid Date" instead of a RangeError for unparseable dates).
 */
export function dateFormatter(locale: string | string[], options: Intl.DateTimeFormatOptions) {
  let formatter: Intl.DateTimeFormat | undefined;
  return (date: Date): string =>
    Number.isNaN(date.getTime()) ? "Invalid Date" : (formatter ??= new Intl.DateTimeFormat(locale, options)).format(date);
}
