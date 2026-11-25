import React, { useState } from 'react';
import { api, useApi } from './api.js';
import { Status } from './status.jsx';

export function Settlement({ path, canRefund = false }) {
  const [revision, refresh] = useState(0);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [state, setState] = useState({});
  const result = useApi(path, revision);
  const account = result.data?.account;
  async function submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const [whole, fraction = ''] = data.get('amount').split('.');
    const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    setState({ busy: true });
    try {
      await api(path, { method: 'POST', body: JSON.stringify({ kind: data.get('kind') || 'payment', amount, requestKey: key, reason: data.get('reason')?.trim() || undefined }) });
      setKey(crypto.randomUUID());
      form.reset();
      refresh((n) => n + 1);
      setState({ message: 'Simulated transaction recorded.' });
    } catch (error) {
      setState({ error: error.message });
    }
  }
  const money = (value) => new Intl.NumberFormat(undefined, { style: 'currency', currency: account.currency }).format(value / 100);
  return <section className="ops-section">
    <h3>Invoice balance and settlement</h3><Status {...result} />
    {account && <>
      <p>{account.number} · Outstanding {money(account.balance)} · Net paid {money(account.paid)}</p>
      <details><summary>How the balance was calculated</summary>
        <dl>
          <dt>Issued invoice total</dt><dd>{money(account.issuedTotal)}</dd>
          {account.issuedBreakdown && <>
            <dt>Room charges</dt><dd>{money(account.issuedBreakdown.room)}</dd>
            <dt>Other charges</dt><dd>{money(account.issuedBreakdown.fees)}</dd>
            <dt>Discounts</dt><dd>{money(account.issuedBreakdown.discounts)}</dd>
            <dt>Tax</dt><dd>{money(account.issuedBreakdown.tax)}</dd>
            <dt>Deposits at issue</dt><dd>{money(account.issuedBreakdown.deposits)}</dd>
            <dt>Payments at issue</dt><dd>{money(account.issuedBreakdown.payments)}</dd>
            <dt>Refunds at issue</dt><dd>{money(account.issuedBreakdown.refunds)}</dd>
          </>}
          <dt>Net paid at issue</dt><dd>{money(account.issuedPaid)}</dd>
          <dt>Balance at issue</dt><dd>{money(account.originalBalance)}</dd>
          <dt>Later credits</dt><dd>{money(account.credits)}</dd>
        </dl>
      </details>
      {account.transactions.length > 0 && <ul>{account.transactions.map((item) => <li key={item._id}>{item.kind} · {money(item.amount)}{item.reason && ' · ' + item.reason} · {new Date(item.createdAt).toLocaleString()}</li>)}</ul>}
      {(account.balance > 0 || (canRefund && account.paid > 0)) && <form className="ops-form" onSubmit={submit}>
        {canRefund && <label>Transaction<select name="kind" defaultValue={account.balance > 0 ? 'payment' : 'refund'}>
          {account.balance > 0 && <><option value="payment">Payment</option><option value="credit">Credit adjustment</option></>}
          {account.paid > 0 && <option value="refund">Refund</option>}
        </select></label>}
        <label>Amount ({account.currency})<input name="amount" inputMode="decimal" required pattern="[0-9]{1,7}(\.[0-9]{1,2})?" /></label>
        {canRefund && <label>Reason (required for a credit)<input name="reason" maxLength="300" /></label>}
        <button disabled={state.busy}>Record simulated transaction</button>
      </form>}
      {state.error && <p className="error" role="alert">{state.error}</p>}
      {state.message && <p role="status">{state.message}</p>}
    </>}
  </section>;
}
