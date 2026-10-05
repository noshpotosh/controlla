// Use the local four-controller candidate for development. serve.mjs verifies
// its compiled binary and loader against the build manifest before serving it.
process.env.DOUBLE_DASH_RUNTIME ||= 'rebuilt';
await import('./serve.mjs');
