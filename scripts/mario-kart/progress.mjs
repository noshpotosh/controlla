export function browserProgressStore(indexedDB = globalThis.indexedDB) {
  async function transaction(mode, action) {
    if (!indexedDB) throw new Error('Browser storage is unavailable. Use Download state instead.');
    const db = await new Promise((resolve, reject) => {
      let blocked = false;
      const request = indexedDB.open('controlla-double-dash', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('progress');
      request.onsuccess = () => {
        if (blocked) request.result.close();
        else resolve(request.result);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => {
        blocked = true;
        reject(new Error('Close other Double Dash tabs and try again.'));
      };
    });
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('progress', mode);
        const request = action(tx.objectStore('progress'));
        tx.oncomplete = () => resolve(request.result);
        tx.onabort = () => reject(tx.error || request.error || new Error('Progress storage failed.'));
        tx.onerror = () => reject(tx.error || request.error);
      });
    } finally { db.close(); }
  }
  return {
    read: key => transaction('readonly', store => store.get(key)),
    write: (key, value) => transaction('readwrite', store => store.put(value, key)),
  };
}

export async function saveProgress(adapter, store, key) {
  if (!adapter?.loaded || typeof adapter.saveStateFile !== 'function') throw new Error('Start Double Dash before saving progress.');
  const result = await adapter.saveStateFile();
  const bytes = result?.bytes && new Uint8Array(result.bytes);
  if (!result?.saved || !bytes?.byteLength) throw new Error(result?.error || 'The emulator could not save progress.');
  const record = { bytes, savedAt: Date.now() };
  await store.write(key, record);
  return record;
}

export async function resumeProgress(adapter, store, key) {
  if (!adapter?.loaded || typeof adapter.loadStateFile !== 'function') throw new Error('Start Double Dash before resuming progress.');
  const record = await store.read(key);
  if (!record?.bytes?.byteLength) throw new Error('No progress saved for this game and core build in this browser.');
  const result = await adapter.loadStateFile(new Uint8Array(record.bytes));
  if (!result?.loaded) throw new Error(result?.error || 'The emulator could not resume progress.');
  return record;
}

export function installProgressControls({ getAdapter, key, setStatus }) {
  const store = browserProgressStore();
  // Diagnostic-only transfer lets exact checkpoint comparisons cross core hashes.
  if (new URLSearchParams(location.search).get('checkpointfiles') === '1') {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.sav,.bin'; input.hidden = true;
    document.body.append(input);
    const comparisonCore = new URLSearchParams(location.search).get('checkpointsource');
    if (comparisonCore) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'file-button';
      button.textContent = 'Resume comparison checkpoint';
      document.querySelector('.topbar-actions').append(button);
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          const record = await resumeComparisonProgress(getAdapter(), store, key, comparisonCore);
          setStatus(`Resumed comparison checkpoint from ${new Date(record.savedAt).toLocaleString()}.`);
        } catch (error) { setStatus(error.message, 'error'); }
        finally { button.disabled = false; }
      });
    }
    for (const label of ['Export checkpoint', 'Export saved checkpoint', 'Import checkpoint']) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'file-button'; button.textContent = label;
      document.querySelector('.topbar-actions').append(button);
      button.addEventListener('click', async () => {
        if (label === 'Import checkpoint') { input.value = ''; input.click(); return; }
        button.disabled = true;
        try {
          let result;
          if (label === 'Export saved checkpoint') {
            const bytes = await readSavedProgressBytes(store, key);
            result = { saved: true, bytes };
          } else {
            const adapter = getAdapter();
            if (!adapter?.loaded) throw new Error('Start Double Dash before exporting progress.');
            result = await adapter.saveStateFile();
          }
          if (!result?.saved || !result.bytes?.byteLength) throw new Error(result?.error || 'Could not export progress.');
          const url = URL.createObjectURL(new Blob([new Uint8Array(result.bytes)]));
          const link = document.createElement('a');
          link.href = url; link.download = 'double-dash-checkpoint.sav'; link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          setStatus('Local checkpoint download requested.');
        } catch (error) { setStatus(error.message, 'error'); }
        finally { button.disabled = false; }
      });
    }
    input.addEventListener('change', async () => {
      const file = input.files?.[0]; if (!file) return;
      try {
        await loadProgressFile(getAdapter(), new Uint8Array(await file.arrayBuffer()));
        setStatus('Imported local checkpoint.');
      } catch (error) { setStatus(error.message, 'error'); }
    });
  }
  const buttons = [];
  for (const [label, operation, verb] of [
    ['Save progress', saveProgress, 'Saved'],
    ['Resume progress', resumeProgress, 'Resumed'],
  ]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'file-button';
    button.textContent = label;
    buttons.push(button);
    document.querySelector('.topbar-actions').append(button);
    button.addEventListener('click', async () => {
      buttons.forEach(item => { item.disabled = true; });
      setStatus(`${label}…`);
      try {
        const record = await operation(getAdapter(), store, key);
        setStatus(`${verb} progress from ${new Date(record.savedAt).toLocaleString()}.`);
      } catch (error) { setStatus(error.message, 'error'); }
      finally { buttons.forEach(item => { item.disabled = false; }); }
    });
  }
}

/** Explicit local checkpoint import; native loader decides compatibility. */
export async function loadProgressFile(adapter, bytes) {
  if (!adapter?.loaded || typeof adapter.loadStateFile !== 'function')
    throw new Error('Start Double Dash before importing progress.');
  if (!(bytes instanceof Uint8Array) || !bytes.byteLength)
    throw new Error('Choose a nonempty progress file.');
  const result = await adapter.loadStateFile(bytes);
  if (!result?.loaded) throw new Error(result?.error || 'The game could not load this progress file.');
}

export async function readSavedProgressBytes(store, key) {
  const record = await store.read(key);
  if (!record?.bytes?.byteLength) throw new Error('No saved checkpoint for this game and core build.');
  return new Uint8Array(record.bytes);
}

export async function resumeComparisonProgress(adapter, store, currentKey, sourceCore) {
  if (!/^[0-9a-f]{64}$/.test(sourceCore || '')) throw new Error('Choose an exact comparison core hash.');
  const game = currentKey.split(':')[0];
  if (!/^[A-Z0-9]{6}$/.test(game)) throw new Error('Invalid comparison game.');
  return resumeProgress(adapter, store, `${game}:${sourceCore}`);
}
