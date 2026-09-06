// CSV serialization for the sheet-view exports. Mirrors the download shape of
// downloadEventIcs in ./ics.ts.

// Quote a field only when it would otherwise break the row: embedded quotes are
// doubled per RFC 4180. A leading/trailing space is harmless, so it's left be.
function escapeField(value: string): string {
  return /["\r\n,]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsv(headers: string[], rows: string[][]): string {
  return [headers, ...rows].map((row) => row.map(escapeField).join(",")).join("\r\n");
}

export function downloadCsv(filename: string, headers: string[], rows: string[][]): void {
  // The BOM is what makes Excel read the file as UTF-8 rather than the local
  // codepage, which otherwise mangles names and curly quotes from essays.
  const blob = new Blob(["\uFEFF", toCsv(headers, rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Turns a label into a filename-safe slug for export names.
export function csvSlug(value: string): string {
  return value.trim().toLowerCase().replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}
