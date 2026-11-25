import React, { useState } from 'react';
import { useApi } from './api.js';
import { Status } from './status.jsx';

export function FinanceReport({ branch }) {
  const today = new Date().toISOString().slice(0, 10);
  const [range, setRange] = useState({ from: today.slice(0, 8) + '01', through: today });
  const path = '/staff/properties/' + branch._id + '/finance/reconciliation';
  const query = new URLSearchParams(range).toString();
  const report = useApi(path + '?' + query);
  const money = (minor, currency) => new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(minor / 100);
  return <section className="ops-section" aria-labelledby="finance-heading">
    <h2 id="finance-heading">Invoice reconciliation</h2>
    <p>Invoice balances include settlements through the end of the selected UTC dates. The posting journal covers transactions posted during those dates.</p>
    <form className="ops-form" onSubmit={(event) => {
      event.preventDefault();
      const values = new FormData(event.currentTarget);
      setRange({ from: values.get('from'), through: values.get('through') });
    }}>
      <label>From (UTC)<input name="from" type="date" defaultValue={range.from} required /></label>
      <label>Through (UTC)<input name="through" type="date" defaultValue={range.through} required /></label>
      <button>Run reconciliation</button>
    </form>
    <Status {...report} />
    {report.data && <>
      <div className="actions"><a className="button" href={'/api' + path + '/export?' + query + '&kind=journal'}>Download posting journal CSV</a>
        <a className="button" href={'/api' + path + '/export?' + query + '&kind=exceptions'}>Download accounting exceptions CSV</a></div>
      {report.data.invoices.length === 0 ? <p>No invoices in this window.</p> : <>
        <div className="actions">
          <a className="button" href={'/api' + path + '/export?' + query + '&kind=invoices'}>Download invoices CSV</a>
          <a className="button" href={'/api' + path + '/export?' + query + '&kind=settlements'}>Download settlement ledger CSV</a>
        </div>
        {report.data.totals.map((row) => <article className="card" key={row.currency}>
          <h3>{row.currency} · {row.invoices} invoices</h3>
          <dl><dt>Revenue recognized at invoice issue, excluding tax</dt><dd>{money(row.recognizedRevenue, row.currency)}</dd>
            <dt>Tax at issue</dt><dd>{money(row.taxAtIssue, row.currency)}</dd>
            <dt>Unclassified issued total</dt><dd>{money(row.unclassifiedIssuedTotal, row.currency)}</dd>
            <dt>Issued total</dt><dd>{money(row.issuedTotal, row.currency)}</dd>
            <dt>Net paid at issue</dt><dd>{money(row.issuedPaid, row.currency)}</dd>
            <dt>Later payments / refunds / credits</dt><dd>{[row.payments, row.refunds, row.credits].map((n) => money(n, row.currency)).join(' / ')}</dd>
            <dt>Outstanding / credit owed</dt><dd>{money(row.outstanding, row.currency)} / {money(row.creditOwed, row.currency)}</dd></dl>
          <p>{row.legacy} older invoices lack a stored breakdown. {row.varianceInvoices} have an issue-balance variance.</p>
        </article>)}
        <div className="table-wrap" role="region" aria-label="Scrollable invoice reconciliation" tabIndex={0}>
          <table><caption>Invoices and closing balances</caption><thead><tr><th scope="col">Invoice</th>
            <th scope="col">Reservation</th><th scope="col">At issue</th><th scope="col">Closing balance</th><th scope="col">Issue variance</th><th scope="col">Breakdown source</th></tr></thead>
            <tbody>{report.data.invoices.map((row) => <tr key={row.number}>
              <th scope="row">{row.number}</th><td>{row.reservation}</td><td>{money(row.originalBalance, row.currency)}</td>
              <td>{money(row.balance, row.currency)}</td><td>{money(row.issueVariance, row.currency)}</td><td>{row.breakdownSource}</td>
            </tr>)}</tbody></table>
        </div>
      </>}
    </>}
  </section>;
}
