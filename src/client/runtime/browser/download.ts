/** Downloads are a browser adapter operation, independent of report assembly. */
export function downloadSummary(summary: unknown, room?: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(summary, null, 2)], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = `controlla-${room ?? 'session'}.json`;
  try {
    a.click();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
