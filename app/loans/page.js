'use client';
import { useAuth } from '@/lib/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import Navbar from '@/components/Navbar';
import CartPanel from '@/components/CartPanel';
import { RiTimeLine, RiCheckLine, RiCloseLine, RiArrowGoBackLine, RiSearchLine, RiFilterLine } from 'react-icons/ri';

export default function LoansPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [loans, setLoans] = useState([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;
    const fetchLoans = async () => {
      setFetching(true);
      setError('');
      try {
        const params = new URLSearchParams({ status: statusFilter, search, date_from: dateFrom, date_to: dateTo });
        const res = await fetch(`/api/loans?${params}`);
        if (res.ok) {
          const data = await res.json();
          setLoans(data.loans);
        } else {
          const data = await res.json().catch(() => ({}));
          setError(data.error || `Failed to load loans (${res.status})`);
        }
      } catch (err) {
        setError('Network error — could not load your loans');
      } finally {
        setFetching(false);
      }
    };
    fetchLoans();
  }, [user, statusFilter, search, dateFrom, dateTo]);

  if (loading || !user) return <div className="loading-spinner"><div className="spinner" /></div>;

  const statusBadge = (status) => {
    const map = {
      pending: { cls: 'badge-warning', icon: <RiTimeLine />, text: 'Pending' },
      approved: { cls: 'badge-success', icon: <RiCheckLine />, text: 'Approved' },
      rejected: { cls: 'badge-error', icon: <RiCloseLine />, text: 'Rejected' },
      returned: { cls: 'badge-info', icon: <RiArrowGoBackLine />, text: 'Returned' },
    };
    const s = map[status] || { cls: '', text: status };
    return <span className={`badge ${s.cls}`}>{s.icon} {s.text}</span>;
  };

  const typeBadge = (type) => (
    <span className={`badge ${type === 'permanent' ? 'badge-permanent' : 'badge-temporary'}`}>
      {type === 'permanent' ? '📌 Permanent' : '⏱️ Temporary'}
    </span>
  );

  return (
    <>
      <Navbar />
      <CartPanel />
      <div className="page-container">
        <div className="page-header">
          <h1>My Loans</h1>
          <p>Track your loan requests and history</p>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 24, alignItems: 'center' }}>
          <div className="search-input-wrap" style={{ flex: '1 1 200px' }}>
            <RiSearchLine className="search-icon" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by item or purpose..."
            />
          </div>
          <select className="filter-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="returned">Returned</option>
          </select>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <RiFilterLine style={{ color: 'var(--text-muted)', fontSize: 14 }} />
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              title="Start date from"
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', color: 'var(--text-primary)', fontSize: 13 }} />
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>to</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              title="Start date to"
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', color: 'var(--text-primary)', fontSize: 13 }} />
          </div>
          {(search || dateFrom || dateTo || statusFilter) && (
            <button className="btn btn-sm btn-outline" onClick={() => { setSearch(''); setDateFrom(''); setDateTo(''); setStatusFilter(''); }}>
              Clear
            </button>
          )}
        </div>

        {error && (
          <div style={{ padding: '10px 16px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, marginBottom: 16, fontSize: 13, color: 'var(--error)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>{error}</span>
            <button onClick={() => setError('')} style={{ background: 'none', border: 'none', color: 'var(--error)', cursor: 'pointer', fontSize: 16, padding: '0 4px' }}>✕</button>
          </div>
        )}

        {fetching ? (
          <div className="loading-spinner"><div className="spinner" /></div>
        ) : loans.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📋</div>
            <h3>No loans yet</h3>
            <p>Browse the inventory to borrow equipment</p>
          </div>
        ) : loans.map(loan => (
          <div key={loan.id} className="loan-card">
            <div className="loan-card-header">
              <div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                  {typeBadge(loan.loan_type)}
                  {statusBadge(loan.status)}
                </div>
                <p style={{ fontSize: 14, fontWeight: 500 }}>Request #{loan.id}</p>
              </div>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {new Date(loan.created_at).toLocaleDateString()}
              </span>
            </div>

            <div className="loan-card-items">
              {loan.items.map(item => (
                <span key={item.id} className="loan-item-chip">
                  {item.item} × {item.quantity}
                </span>
              ))}
            </div>

            <div className="loan-card-meta">
              <span>📝 {loan.purpose}</span>
              {loan.department && <span>🏢 {loan.department}</span>}
              <span>📅 {loan.start_date}{loan.end_date ? ` → ${loan.end_date}` : ' → Ongoing'}</span>
            </div>

            {loan.admin_notes && (
              <div style={{ marginTop: 8, padding: 10, background: 'rgba(99,102,241,0.05)', borderRadius: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
                <strong>Admin notes:</strong> {loan.admin_notes}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
