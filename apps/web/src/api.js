import { createContext, useContext, useEffect, useState } from 'react';

export async function api(path, options = {}) {
  const response = await fetch('/api' + path, {
    ...options,
    headers: options.body ? { 'Content-Type': 'application/json', ...options.headers } : options.headers
  });
  if (response.status === 204) return;
  const data = await response.json().catch(() => null);
  if (!response.ok || data === null) {
    throw Object.assign(new Error(data?.error || 'The service is unavailable. Try again.'), { status: response.status });
  }
  return data;
}

export const LiveRevision = createContext(0);

export function useApi(path, revision = 0) {
  const live = useContext(LiveRevision);
  const [result, setResult] = useState({});
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    api(path, { signal: controller.signal })
      .then((data) => setResult({ path, data }))
      .catch((error) => {
        if (!controller.signal.aborted) setResult({ path, error: error.message });
      });
    return () => controller.abort();
  }, [path, revision, live]);
  return result.path === path ? result : {};
}

const dateFormat = /^\d{4}-\d{2}-\d{2}$/;

export function queryDates(params) {
  const checkIn = params.get('checkIn') ?? '';
  const checkOut = params.get('checkOut') ?? '';
  const guests = Number(params.get('guests') || 1);
  if (!(dateFormat.test(checkIn) && dateFormat.test(checkOut) && checkIn < checkOut && Number.isInteger(guests) && guests >= 1 && guests <= 50)) return null;
  return { checkIn, checkOut, guests };
}

export function useAvailability(branch, params, revision = 0) {
  const dates = queryDates(params);
  const offer = params.get('offer');
  const path = branch && dates ? '/availability?' + new URLSearchParams({ branch, ...dates, ...(offer && { offer }) }) : null;
  return { ...useApi(path, revision), requested: Boolean(path) };
}
