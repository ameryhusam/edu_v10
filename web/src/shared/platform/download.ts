/**
 * The only module allowed to trigger a client-side file download.
 *
 * FE4 confines every direct touch of `document`/`URL`/anchor-click download
 * tricks to `shared/platform` so a feature never has to reach past its API
 * client into the DOM to hand the user a file — it just calls
 * `downloadJson(name, data)` and the browser specifics live in one place.
 */

export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function downloadText(filename: string, content: string, mimeType = 'text/csv;charset=utf-8'): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

