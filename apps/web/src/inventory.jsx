import React, { useState } from 'react';
import { api, useApi } from './api.js';
import { MediaEditor } from './media.jsx';
import { Status } from './status.jsx';

const base = '/staff/inventory/branches';
const currencies = ['AED', 'GBP', 'USD', 'EUR', 'PKR'];
const entries = (text) => [...new Set(text.split(',').map((item) => item.trim()).filter(Boolean))];

const branchFields = [
  { name: 'name', label: 'Hotel name' }, { name: 'slug', label: 'URL identifier', pattern: '[a-z0-9]+(-[a-z0-9]+)*' },
  { name: 'city', label: 'City' }, { name: 'address', label: 'Address', optional: true },
  { name: 'description', label: 'Description', multiline: true, optional: true },
  { name: 'facilities', label: 'Facilities (comma separated)', optional: true },
  { name: 'contactEmail', label: 'Contact email', type: 'email', optional: true },
  { name: 'phone', label: 'Phone', type: 'tel', optional: true },
  { name: 'timeZone', label: 'IANA time zone', placeholder: 'Europe/London' },
  { name: 'currency', label: 'Currency', options: currencies.map((code) => [code, code]) }
];
const typeFields = [
  { name: 'name', label: 'Category name' }, { name: 'slug', label: 'URL identifier', pattern: '[a-z0-9]+(-[a-z0-9]+)*' },
  { name: 'capacity', label: 'Guest capacity', type: 'number', min: 1, max: 50 },
  { name: 'nightlyRate', label: 'Nightly price', type: 'number', min: 0, max: 1000000, step: '0.01' },
  { name: 'bed', label: 'Bed configuration', optional: true },
  { name: 'size', label: 'Size (m²)', type: 'number', min: 1, max: 3000, optional: true },
  { name: 'description', label: 'Description', multiline: true, optional: true },
  { name: 'amenities', label: 'Amenities (comma separated)', optional: true }
];
const physicalFields = [
  { name: 'number', label: 'Room number' }, { name: 'floor', label: 'Floor', type: 'number', min: -10, max: 250 }
];

function Editor({ fields, initial, locked = [], button, onSubmit }) {
  const [state, setState] = useState({});
  async function save(event) {
    event.preventDefault();
    const form = event.currentTarget;
    setState({ busy: true });
    try {
      const values = Object.fromEntries(new FormData(form));
      for (const key of locked) values[key] = initial[key];
      await onSubmit(values);
      if (!initial._id) form.reset();
      setState({ saved: true });
    } catch (error) {
      setState({ error: error.message });
    }
  }
  return <form className="inventory-form" onSubmit={save}>
    {fields.map(({ name, label, multiline, options, optional, ...props }) => {
      const raw = initial[name];
      const value = Array.isArray(raw) ? raw.join(', ') : raw ?? '';
      const control = { name, defaultValue: value, required: !optional, disabled: locked.includes(name), ...props };
      return <label key={name} className={multiline ? 'wide-control' : undefined}>{label}{multiline
        ? <textarea {...control} rows={3} maxLength={2500} />
        : options ? <select {...control}><option value="">Choose {label.toLowerCase()}</option>
          {options.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
        : <input {...control} />}</label>;
    })}
    <button disabled={state.busy}>{state.busy ? 'Saving…' : button}</button>
    {state.saved && <p role="status">Saved.</p>}
    {state.error && <p className="error" role="alert">{state.error}</p>}
  </form>;
}

function submit(path, values, update = false) {
  return api(path, { method: update ? 'PUT' : 'POST', body: JSON.stringify(values) });
}

function BranchEditor({ branch, onChange }) {
  return <Editor fields={branchFields} key={branch?._id ?? 'new'} initial={branch ?? {}} locked={branch ? ['slug', 'currency'] : []}
    button={branch ? 'Save hotel' : 'Add hotel'} onSubmit={async (values) => {
      values.facilities = entries(values.facilities);
      if (!values.contactEmail) delete values.contactEmail;
      const { branch: saved } = await submit(branch ? base + '/' + branch._id : base, values, Boolean(branch));
      onChange(saved._id);
    }} />;
}

export function Inventory({ branch, canCreateBranch, rooms, onChange }) {
  const [typeId, setTypeId] = useState('');
  const [roomId, setRoomId] = useState('');
  const [revision, setRevision] = useState(0);
  const branchPath = branch && base + '/' + branch._id;
  const types = useApi(branchPath && branchPath + '/room-types', revision);
  const roomTypes = types.data?.roomTypes ?? [];
  const roomType = roomTypes.find((type) => type._id === typeId);
  const selectedRoom = rooms.data?.rooms.find((room) => room._id === roomId);
  return <section className="inventory-edit">
    <h2>Manage inventory</h2>
    {canCreateBranch && <details><summary>Add a hotel</summary><BranchEditor onChange={onChange} /></details>}
    {branch && <>
      <details><summary>Edit hotel details</summary><BranchEditor branch={branch} onChange={onChange} /></details>
      <details><summary>Add or edit room categories</summary>
        <Status {...types} />
        {types.data && <>
          <label>Category to edit<select value={typeId} onChange={(event) => setTypeId(event.target.value)}>
            <option value="">New category</option>{roomTypes.map((type) => <option key={type._id} value={type._id}>{type.name}</option>)}
          </select></label>
          <Editor key={typeId} fields={typeFields.map((field) => field.name === 'nightlyRate' ? { ...field, label: 'Nightly price (' + branch.currency + ')' } : field)}
            initial={roomType ? { ...roomType, nightlyRate: roomType.nightlyRate / 100 } : {}} locked={roomType ? ['slug'] : []}
            button={roomType ? 'Save category' : 'Add category'} onSubmit={async (values) => {
              const input = { ...values, capacity: Number(values.capacity), nightlyRate: Math.round(Number(values.nightlyRate) * 100),
                amenities: entries(values.amenities), size: values.size ? Number(values.size) : null };
              await submit(branchPath + '/room-types' + (roomType ? '/' + roomType._id : ''), input, Boolean(roomType));
              setRevision((previous) => previous + 1);
              onChange(branch._id);
            }} />
        </>}
      </details>
      <details><summary>Add or edit physical rooms</summary>
        <Status {...types} />
        {types.data && (roomTypes.length ? <>
          <label>Room to edit<select value={roomId} onChange={(event) => setRoomId(event.target.value)}>
            <option value="">New room</option>{rooms.data?.rooms.map((room) => <option key={room._id} value={room._id}>{room.number}</option>)}
          </select></label>
          <Editor key={roomId} fields={[...physicalFields, { name: 'type', label: 'Category', options: roomTypes.map((type) => [type._id, type.name]) }]}
            initial={selectedRoom ? { ...selectedRoom, type: selectedRoom.type?._id } : {}} button={selectedRoom ? 'Save room' : 'Add room'}
            onSubmit={async (values) => {
              await submit(branchPath + '/rooms' + (selectedRoom ? '/' + selectedRoom._id : ''), { ...values, floor: Number(values.floor) }, Boolean(selectedRoom));
              onChange(branch._id);
            }} />
        </> : <p>Add a room category before adding physical rooms.</p>)}
      </details>
      <MediaEditor branch={branch} roomTypes={roomTypes} />
      <Inquiries path={branchPath + '/inquiries'} />
    </>}
  </section>;
}

function Inquiries({ path }) {
  const [open, setOpen] = useState(false);
  const result = useApi(open ? path : null);
  return <details onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>Guest inquiries</summary>
    {open && <><Status {...result} />{result.data?.inquiries.length === 0 && <p>No inquiries received.</p>}
      {result.data?.inquiries.map((item) => <article className="inquiry" key={item._id}>
        <h3>{item.name}</h3><p><a href={'mailto:' + item.email}>{item.email}</a> · {new Date(item.createdAt).toLocaleDateString()}</p>
        <p>{item.message}</p>
      </article>)}</>}
  </details>;
}
