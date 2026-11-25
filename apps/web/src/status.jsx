import React from 'react';

export function Status({ data, error }) {
  if (error) return <p className="error" role="alert">{error}</p>;
  return data ? null : <p role="status">Loading…</p>;
}
