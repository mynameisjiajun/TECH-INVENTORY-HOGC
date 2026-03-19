'use client';
import { useAuth } from '@/lib/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useToast } from '@/lib/context/ToastContext';
import { useCart } from '@/lib/context/CartContext';
import Navbar from '@/components/Navbar';
import CartPanel from '@/components/CartPanel';
import { supabaseClient } from '@/lib/db/supabaseClient';
import {
  RiTimeLine, RiCheckLine, RiCloseLine, RiArrowGoBackLine,
  RiSearchLine, RiFilterLine, RiCameraLine, RiAlertLine,
  RiCalendarLine, RiShoppingBag3Line, RiRefreshLine,
} from 'react-icons/ri';

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
  const [borrowAgainLoading, setBorrowAgainLoading] = useState({});
  const toast = useToast();
  const { addItem, setIsOpen } = useCart();
  const channelRef = useRef(null);

  const [returnModalLoan, setReturnModalLoan] = useState(null);
  const [returnPhoto, setReturnPhoto] = useState(null);
  const [returnRemarks, setReturnRemarks] = useState('');
  const [returnLoading, setReturnLoading] = useState(false);

  const handlePhotoChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 1200;
        const MAX_HEIGHT = 1200;
        let width = img.width;
        let height = img.height;
        if (width > height) {
          if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; }
        } else {
          if (height > MAX_HEIGHT) { width *= MAX_HEIGHT / height; height = MAX_HEIGHT; }
        }
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        setReturnPhoto(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  };

  const submitReturn = async () => {
    if (!returnPhoto || !returnModalLoan) {
      toast.error('Please upload a photo as proof of return');
      return;
    }
    setReturnLoading(true);
    try {
      const res = await fetch(`/api/loans/${returnModalLoan.id}/return`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: returnPhoto, remarks: returnRemarks.trim() || null }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(data.message);
        setLoans(prev => prev.map(l =>
          l.id === returnModalLoan.id
            ? { ...l, status: 'returned', return_photo_url: data.photo_url }
            : l
        ));
        setReturnModalLoan(null);
        setReturnPhoto(null);
        setReturnRemarks('');
      } else {
        toast.error(data.error);
      }
    } catch {
      toast.error('Network error — failed to submit return');
    } finally {
      setReturnLoading(false);
    }
  };

  const handleBorrowAgain = async (loan) => {
    setBorrowAgainLoading((p) => ({ ...p, [loan.id]: true }));
    try {
      const res = await fetch('/api/items?tab=storage');
      const data = await res.json();
      const storageItems = data.items || [];
      let added = 0;
      for (const loanItem of loan.items) {
        const si = loanItem.sheet_row
          ? storageItems.find((s) => s.sheet_row === loanItem.sheet_row)
          : storageItems.find((s) => s.id === loanItem.item_id);
        if (si && si.current > 0) {
          addItem({ id: si.id, item: si.item, type: si.type, brand: si.brand, current: si.current });
          added++;
        }
      }
      if (added > 0) {
        setIsOpen(true);
        toast.success(`${added} item(s) added to cart`);
      } else {
        toast.error('No items are currently available in stock');
      }
    } catch {
      toast.error('Could not load items — please try again');
    } finally {
      setBorrowAgainLoading((p) => ({ ...p, [loan.id]: false }));
    }
  };

  const fetchLoans = useCallback(async () => {
    if (!user) return;
    setFetching(true);
    setError('');
    try {
      const params = new URLSearchParams({ status: statusFilter, search, date_from: dateFrom, date_to: dateTo });
      const res = await fetch(`/api/loans?${params}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setLoans(data.loans);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Failed to load loans (${res.status})`);
      }
    } catch {
      setError('Network error — could not load your loans');
    } finally {
      setFetching(false);
    }
  }, [user, statusFilter, search, dateFrom, dateTo]);

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [user, loading, router]);

  useEffect(() => {
    fetchLoans();
  }, [fetchLoans]);

  // Realtime: re-fetch when any of this user's loans change status
  useEffect(() => {
    if (!user) return;
    if (channelRef.current) supabaseClient.removeChannel(channelRef.current);

    let channel;
    try {
      channel = supabaseClient
        .channel(`loans-user-${user.id}`)
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'loan_requests',
          filter: `user_id=eq.${user.id}`,
        }, () => { fetchLoans(); })
        .subscribe((_status, err) => {
          if (err) console.warn('Realtime unavailable, using polling fallback:', err.message);
        });
      channelRef.current = channel;
    } catch (err) {
      console.warn('Realtime not available on this device, using polling fallback:', err.message);
    }
    return () => {
      if (channel) supabaseClient.removeChannel(channel);
      channelRef.current = null;
    };
  }, [user, fetchLoans]);

  if (loading || !user) return <div className="loading-spinner"><div className="spinner" /></div>;

  const today = new Date().toISOString().split('T')[0];

  const isOverdue = (loan) =>
    loan.status === 'approved' && loan.loan_type === 'temporary' && loan.end_date && loan.end_date < today;

  const isDueSoon = (loan) => {
    if (loan.status !== 'approved' || loan.loan_type !== 'temporary' || !loan.end_date) return false;
    const diff = (new Date(loan.end_date) - new Date(today)) / (1000 * 60 * 60 * 24);
    return diff >= 0 && diff <= 2;
  };

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

  // Stats summary
  const counts = loans.reduce((acc, l) => {
    acc[l.status] = (acc[l.status] || 0) + 1;
    return acc;
  }, {});
  const overdueCount = loans.filter(isOverdue).length;

  return (
    <>
      <Navbar />
      <CartPanel />
      <div className="page-container">
        <div className="page-header">
          <div>
            <h1>My Loans</h1>
            <p>Track your loan requests and history</p>
          </div>
        </div>

        {/* Stats strip */}
        {loans.length > 0 && (
          <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
            {counts.pending > 0 && (
              <div style={{ padding: '8px 14px', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 10, fontSize: 13, color: 'var(--warning)', fontWeight: 500 }}>
                <RiTimeLine style={{ verticalAlign: 'middle', marginRight: 4 }} />
                {counts.pending} Pending
              </div>
            )}
            {counts.approved > 0 && (
              <div style={{ padding: '8px 14px', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: 10, fontSize: 13, color: 'var(--success)', fontWeight: 500 }}>
                <RiCheckLine style={{ verticalAlign: 'middle', marginRight: 4 }} />
                {counts.approved} Active
              </div>
            )}
            {overdueCount > 0 && (
              <div style={{ padding: '8px 14px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 10, fontSize: 13, color: 'var(--error)', fontWeight: 600 }}>
                <RiAlertLine style={{ verticalAlign: 'middle', marginRight: 4 }} />
                {overdueCount} Overdue
              </div>
            )}
            {counts.returned > 0 && (
              <div style={{ padding: '8px 14px', background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 10, fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500 }}>
                <RiArrowGoBackLine style={{ verticalAlign: 'middle', marginRight: 4 }} />
                {counts.returned} Returned
              </div>
            )}
          </div>
        )}

        {/* Filters */}
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
            <div className="empty-icon"><RiShoppingBag3Line /></div>
            <h3>No loans yet</h3>
            <p>Browse the inventory to borrow equipment</p>
            <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => router.push('/inventory')}>
              Browse Inventory
            </button>
          </div>
        ) : (
          loans.map(loan => {
            const overdue = isOverdue(loan);
            const dueSoon = !overdue && isDueSoon(loan);
            return (
              <div
                key={loan.id}
                className="loan-card"
                style={overdue ? { borderColor: 'rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.03)' } : dueSoon ? { borderColor: 'rgba(245,158,11,0.4)' } : {}}
              >
                {overdue && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: 'rgba(239,68,68,0.12)', borderRadius: '8px 8px 0 0', marginBottom: 4, fontSize: 12, color: 'var(--error)', fontWeight: 600, marginTop: -4, marginLeft: -4, marginRight: -4 }}>
                    <RiAlertLine /> OVERDUE — Please return items or contact an admin
                  </div>
                )}
                {dueSoon && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: 'rgba(245,158,11,0.1)', borderRadius: '8px 8px 0 0', marginBottom: 4, fontSize: 12, color: 'var(--warning)', fontWeight: 600, marginTop: -4, marginLeft: -4, marginRight: -4 }}>
                    <RiCalendarLine /> Due soon — return by {loan.end_date}
                  </div>
                )}

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

                {loan.status === 'approved' && loan.loan_type === 'temporary' && (
                  <div style={{ marginTop: 16 }}>
                    <button
                      className="btn btn-sm"
                      onClick={() => setReturnModalLoan(loan)}
                      style={{
                        background: overdue ? 'rgba(239,68,68,0.1)' : 'rgba(59,130,246,0.1)',
                        color: overdue ? 'var(--error)' : '#3b82f6',
                        border: `1px solid ${overdue ? 'rgba(239,68,68,0.3)' : 'rgba(59,130,246,0.3)'}`,
                        fontWeight: 600,
                      }}
                    >
                      <RiCameraLine style={{ marginRight: 6 }} /> Return Items
                    </button>
                  </div>
                )}
                {loan.status === 'returned' && loan.return_photo_url && (
                  <div style={{ marginTop: 12, fontSize: 13 }}>
                    <a href={loan.return_photo_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <RiCameraLine /> View Return Photo
                    </a>
                  </div>
                )}
                {(loan.status === 'returned' || loan.status === 'rejected') && (
                  <div style={{ marginTop: 12 }}>
                    <button
                      className="btn btn-sm btn-outline"
                      onClick={() => handleBorrowAgain(loan)}
                      disabled={borrowAgainLoading[loan.id]}
                      style={{ fontSize: 12, color: 'var(--accent)', borderColor: 'rgba(99,102,241,0.4)' }}
                    >
                      {borrowAgainLoading[loan.id]
                        ? <><span className="btn-spinner" /> Loading…</>
                        : <><RiRefreshLine style={{ marginRight: 4 }} />Borrow Again</>}
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Return Modal */}
      {returnModalLoan && (
        <div className="modal-overlay" onClick={() => !returnLoading && (setReturnModalLoan(null), setReturnPhoto(null), setReturnRemarks(''))}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <div className="modal-header">
              <div>
                <h2 style={{ marginBottom: 2 }}>Return Loan #{returnModalLoan.id}</h2>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 400 }}>
                  {returnModalLoan.items.map(i => `${i.item} ×${i.quantity}`).join(' · ')}
                </div>
              </div>
              <button className="btn-close" onClick={() => !returnLoading && (setReturnModalLoan(null), setReturnPhoto(null), setReturnRemarks(''))}>✕</button>
            </div>

            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Photo upload */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Proof of Return <span style={{ color: 'var(--error)' }}>*</span>
                </div>
                <div style={{ background: 'var(--bg-secondary)', border: '1px dashed var(--border)', borderRadius: 10, padding: returnPhoto ? 8 : 18, textAlign: 'center' }}>
                  {returnPhoto ? (
                    <div style={{ position: 'relative', display: 'inline-block' }}>
                      <img src={returnPhoto} alt="Return proof" style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 8, display: 'block' }} />
                      <button
                        onClick={() => setReturnPhoto(null)}
                        className="btn-close"
                        style={{ position: 'absolute', top: 6, right: 6 }}
                      >✕</button>
                    </div>
                  ) : (
                    <>
                      <RiCameraLine size={28} style={{ color: 'var(--text-muted)', marginBottom: 8 }} />
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
                        Photo showing items in storage
                      </div>
                      <label className="btn btn-outline btn-sm" style={{ cursor: 'pointer' }}>
                        Take / Upload Photo
                        <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={handlePhotoChange} />
                      </label>
                    </>
                  )}
                </div>
              </div>

              {/* Remarks */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Condition Remarks <span style={{ color: 'var(--text-muted)', fontWeight: 400, textTransform: 'none' }}>(optional)</span>
                </div>
                <textarea
                  value={returnRemarks}
                  onChange={e => setReturnRemarks(e.target.value)}
                  placeholder="Report any damage, faults, or missing parts…"
                  maxLength={500}
                  rows={3}
                  style={{
                    width: '100%', padding: '10px 12px', background: 'var(--bg-secondary)',
                    border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)',
                    fontSize: 13, resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box',
                    outline: 'none',
                  }}
                />
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => { setReturnModalLoan(null); setReturnPhoto(null); setReturnRemarks(''); }} disabled={returnLoading}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={submitReturn} disabled={!returnPhoto || returnLoading}>
                {returnLoading ? <><span className="btn-spinner" /> Uploading…</> : 'Submit Return'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
