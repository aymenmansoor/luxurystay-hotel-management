import React, { useEffect, useState } from 'react';
import { api, useApi } from './api.js';
import { Status } from './status.jsx';

export function MediaEditor({ branch, roomTypes }) {
  const [revision, refresh] = useState(0);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [state, setState] = useState({});
  const path = '/staff/properties/' + branch._id + '/media';
  const result = useApi(path, revision);
  useEffect(() => {
    if (!file) {
      setPreview('');
      return;
    }
    const object = URL.createObjectURL(file);
    setPreview(object);
    return () => URL.revokeObjectURL(object);
  }, [file]);

  async function run(operation) {
    setState({ busy: true });
    try {
      await operation();
      refresh((value) => value + 1);
      setState({ message: 'Changes saved.' });
    } catch (error) {
      setState({ error: error.message });
    }
  }
  function upload(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = Object.fromEntries(new FormData(form));
    delete fields.file;
    if (!fields.roomType) delete fields.roomType;
    void run(async () => {
      const response = await fetch('/api' + path + '?' + new URLSearchParams(fields), {
        method: 'POST', headers: { 'Content-Type': file.type }, body: file
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? 'Image upload failed.');
      form.reset();
      setFile(null);
    });
  }

  return <details><summary>Property photographs</summary>
    <p>Only upload photographs you own or have permission to publish. Include the source and usage rights.</p>
    <form className="inventory-form" onSubmit={upload}>
      <label>Image<input type="file" name="file" accept="image/jpeg,image/png,image/webp" required
        onChange={(event) => setFile(event.target.files[0] ?? null)} /></label>
      <label>Show in<select name="roomType"><option value="">Hotel gallery</option>
        {roomTypes.map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}
      </select></label>
      <label>Alt text<input name="alt" minLength="3" maxLength="180" required /></label>
      <label>Source<input name="source" minLength="3" maxLength="240" required /></label>
      <label>Usage rights<input name="rights" minLength="3" maxLength="240" required /></label>
      <label>Display order<input name="order" type="number" min="0" max="1000" defaultValue="100" required /></label>
      {preview && <img className="hotel-photo" src={preview} alt="Upload preview" />}
      <button disabled={!file || state.busy}>Publish photograph</button>
    </form>
    <Status {...result} />
    {state.error && <p className="error" role="alert">{state.error}</p>}
    {state.message && <p role="status">{state.message}</p>}
    {result.data?.media.length === 0 && <p>No uploaded photographs.</p>}
    <div className="grid">{result.data?.media.map((item) => <article className="card" key={item.id}>
      <img className="hotel-photo" src={item.url} alt={item.alt} loading="lazy" />
      <form onSubmit={(event) => {
        event.preventDefault();
        const values = Object.fromEntries(new FormData(event.currentTarget));
        void run(() => api(path + '/' + item.id, { method: 'PUT', body: JSON.stringify(values) }));
      }}>
        <label>Alt text<input name="alt" defaultValue={item.alt} minLength="3" maxLength="180" required /></label>
        <label>Source<input name="source" defaultValue={item.source} minLength="3" maxLength="240" required /></label>
        <label>Rights<input name="rights" defaultValue={item.rights} minLength="3" maxLength="240" required /></label>
        <label>Display order<input name="order" type="number" min="0" max="1000" defaultValue={item.order} required /></label>
        <button disabled={state.busy}>Update image details</button>
        <button type="button" className="plain destructive" disabled={state.busy} onClick={() => {
          if (window.confirm('Remove this photograph from the public gallery?')) {
            void run(() => api(path + '/' + item.id, { method: 'DELETE' }));
          }
        }}>Remove photograph</button>
      </form>
    </article>)}</div>
  </details>;
}
