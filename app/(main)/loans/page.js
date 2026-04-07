'use client';
import { useAuth } from '@/lib/context/AuthContext';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { useEffect, useState, useCallback, useRef } from 'react';
import imageCompression from 'browser-image-compression';
import { useToast } from '@/lib/context/ToastContext';
import { useCart } from '@/lib/context/CartContext';
import Navbar from '@/components/Navbar';
import CartPanel from '@/components/CartPanel';
import { supabaseClient } from '@/lib/db/supabaseClient';
import {
  RiTimeLine, RiCheckLine, RiCloseLine, RiArrowGoBackLine,
  RiSearchLine, RiFilterLine, RiCameraLine, RiAlertLine,
  RiCalendarLine, RiShoppingBag3Line, RiRefreshLine, RiEdit2Line,
  RiMacbookLine, RiArchiveLine,
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
  const [cancelLoading, setCancelLoading] = useState({});
  const toast = useToast();
  const { addItem, addLaptopItem, setIsOpen, setItems, setModifyingLoan } = useCart();
  const channelRef = useRef(null);

  const [returnModalLoan, setReturnModalLoan] = useState(null);
  const [returnPhoto, setReturnPhoto] = useState(null);
  const [returnRemarks, setReturnRemarks] = useState('');
  const [returnLoading, setReturnLoading] = useState(false);

  const handlePhotoChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const options = { maxSizeMB: 0.2, maxWidthOrHeight: 1200, useWebWorker: true };
      const compressedFile = await imageCompression(file, options);
      const reader = new FileReader();
      reader.onload = (event) => setReturnPhoto(event.target.result);
      reader.readAsDataURL(compressedFile);
    } catch {
      toast.error('Failed to process the photo.');
    }
  };

  const submitReturn = async () => {
    if (!returnPhoto || !returnModalLoan) {
      toast.error('Please upload a photo as proof of return');
      return;
    }
    setReturnLoading(true);
    try {
      const isLaptop = returnModalLoan._loanKind === 'laptop';
      const endpoint = isLaptop
        ? `/api/laptop-loans/${returnModalLoan.id}/return`
        : `/api/loans/${returnModalLoan.id}/return`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      let res;
      try {
        res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageBase64: returnPhoto, remarks: returnRemarks.trim() || null }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
      if (res.status === 401) {
        toast.error('Session expired — please refresh the page');
        setReturnLoading(false);
        return;
      }
      const data = await res.json();
      if (res.ok) {
        toast.success(data.message || 'Return submitted');
        setLoans(prev => prev.map(l =>
          l.id === returnModalLoan.id && l._loanKind === returnModalLoan._loanKind
            ? { ...l, status: 'returned', return_photo_url: data.photo_url }
            : l
        ));
        setReturnModalLoan(null);
        setReturnPhoto(null);
        setReturnRemarks('');
      } else {
        toast.error(data.error || 'Failed to submit return');
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        toast.error('Request timed out — please check your connection and try again');
      } else {
        toast.error('Network error — failed to submit return');
      }
    } finally {
      setReturnLoading(false);
    }
  };

  const handleCancelLoan = async (loan) => {
    if (!confirm('Cancel this loan request? This cannot be undone.')) return;
    setCancelLoading((p) => ({ ...p, [loan.id]: true }));
    try {
      const endpoint = loan._loanKind === 'laptop'
        ? `/api/laptop-loans/${loan.id}`
        : `/api/loans/${loan.id}`;
      const res = await fetch(endpoint, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok) {
        toast.success('Loan request cancelled.');
        fetchLoans();
      } else {
        toast.error(data.error || 'Could not cancel loan');
      }
    } catch {
      toast.error('Network error — could not cancel loan');
    } finally {
      setCancelLoading((p) => ({ ...p, [loan.id]: false }));
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

  const handleBorrowAgainLaptop = async (loan) => {
    setBorrowAgainLoading((p) => ({ ...p, [loan.id]: true }));
    try {
      const res = await fetch('/api/laptops');
      const data = await res.json();
      const allLaptops = (data.tiers || []).flatMap((t) => t.laptops || []);
      let added = 0;
      let skipped = 0;
      for (const item of loan.laptops || []) {
        const laptop = allLaptops.find((l) => l.id === item.laptop_id);
        if (!laptop) { skipped++; continue; }
        if (laptop.availability === "perm_loaned" || laptop.availability === "temp_loaned" || laptop.availability === "blocked") {
          skipped++;
          continue;
        }
        addLaptopItem(laptop, '', '', 'temporary');
        added++;
      }
      if (added > 0) {
        setIsOpen(true);
        if (skipped > 0) toast.success(`${added} laptop(s) added to cart (${skipped} currently unavailable)`);
        else toast.success(`${added} laptop(s) added to cart`);
      } else {
        toast.error('No laptops from this loan are currently available');
      }
    } catch {
      toast.error('Could not load laptops — please try again');
    } finally {
      setBorrowAgainLoading((p) => ({ ...p, [loan.id]: false }));
    }
  };

  const handleModifyLaptopLoan = async (loan) => {
    setBorrowAgainLoading((p) => ({ ...p, [loan.id]: true }));
    try {
      const res = await fetch('/api/laptops');
      const data = await res.json();
      const allLaptops = (data.tiers || []).flatMap((t) => t.laptops || []);
      const cartItems = [];
      let missing = 0;

      for (const item of loan.laptops || []) {
        const laptop = allLaptops.find((l) => l.id === item.laptop_id);
        if (laptop) {
          cartItems.push({
            id: laptop.id,
            name: laptop.name,
            screen_size: laptop.screen_size,
            cpu: laptop.cpu,
            loan_type: loan.loan_type,
            start_date: loan.start_date || '',
            end_date: loan.end_date || '',
            _cartType: 'laptop',
          });
        } else {
          missing++;
        }
      }

      setModifyingLoan({ ...loan, _loanKind: 'laptop' });
      setItems(cartItems);
      setIsOpen(true);
      if (missing > 0) toast.error(`${missing} laptop(s) could not be loaded for modification.`);
    } catch {
      toast.error('Could not load laptops — please try again');
    } finally {
      setBorrowAgainLoading((p) => ({ ...p, [loan.id]: false }));
    }
  };

  const handleModifyLoan = async (loan) => {
    setBorrowAgainLoading((p) => ({ ...p, [loan.id]: true }));
    try {
      const res = await fetch('/api/items?tab=storage');
      const data = await res.json();
      const storageItems = data.items || [];
      const newCart = [];
      let missing = 0;

      for (const loanItem of loan.items) {
        const si = loanItem.sheet_row
          ? storageItems.find((s) => s.sheet_row === loanItem.sheet_row)
          : storageItems.find((s) => s.id === loanItem.item_id);

        if (si) {
          const isApproved = loan.status === 'approved';
          const maxAllowed = isApproved ? si.current + loanItem.quantity : si.current;
          if (maxAllowed >= loanItem.quantity) {
            newCart.push({
              id: si.id, item: si.item, type: si.type, brand: si.brand,
              current: si.current, quantity: loanItem.quantity, max: maxAllowed,
              _cartType: 'tech',
            });
          } else {
            missing++;
          }
        } else {
          missing++;
        }
      }

      setModifyingLoan(loan);
      setItems(newCart);
      setIsOpen(true);
      if (missing > 0) toast.error(`${missing} item(s) could not be loaded for modification.`);
    } catch {
      toast.error('Could not load inventory for modification — please try again');
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

      const [techRes, laptopRes] = await Promise.all([
        fetch(`/api/loans?${params}`, { cache: 'no-store' }),
        fetch(`/api/laptop-loans?view=my${statusFilter ? `&status=${statusFilter}` : ''}`, { cache: 'no-store' }),
      ]);

      const techData = techRes.ok ? await techRes.json() : { loans: [] };
      const laptopData = laptopRes.ok ? await laptopRes.json() : { loans: [] };

      const techLoans = (techData.loans || []).map(l => ({ ...l, _loanKind: 'tech' }));

      // Normalize laptop loans: map laptops array to common `items` shape
      let laptopLoans = (laptopData.loans || []).map(l => ({
        ...l,
        _loanKind: 'laptop',
        items: (l.laptops || []).map(item => ({
          id: item.id,
          item: item.laptops?.name || 'Unknown laptop',
          item_id: item.laptop_id,
          quantity: 1,
        })),
      }));

      // Client-side filter laptop loans by search and date range (API doesn't support these)
      if (search) {
        const q = search.toLowerCase();
        laptopLoans = laptopLoans.filter(l =>
          l.purpose?.toLowerCase().includes(q) ||
          l.items.some(i => i.item.toLowerCase().includes(q))
        );
      }
      if (dateFrom) laptopLoans = laptopLoans.filter(l => l.start_date >= dateFrom);
      if (dateTo) laptopLoans = laptopLoans.filter(l => l.start_date <= dateTo);

      const allLoans = [...techLoans, ...laptopLoans]
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      setLoans(allLoans);

      if (!techRes.ok) {
        const d = await techRes.json().catch(() => ({}));
        setError(d.error || `Failed to load loans (${techRes.status})`);
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

  const kindBadge = (loanKind) => (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 5,
      background: loanKind === 'laptop' ? 'rgba(99,102,241,0.12)' : 'rgba(100,116,139,0.12)',
      color: loanKind === 'laptop' ? 'var(--accent)' : 'var(--text-secondary)',
      border: `1px solid ${loanKind === 'laptop' ? 'rgba(99,102,241,0.3)' : 'rgba(100,116,139,0.2)'}`,
      textTransform: 'uppercase', letterSpacing: 0.5,
    }}>
      {loanKind === 'laptop' ? <RiMacbookLine /> : <RiArchiveLine />}
      {loanKind === 'laptop' ? 'Laptop Loan' : 'Tech Loan'}
    </span>
  );

  // Group consecutive loans that were submitted within 2 minutes of each other (same checkout session)
  const buildBundles = (loanList) => {
    const bundles = [];
    let currentBundle = null;
    for (const loan of loanList) {
      const loanTime = new Date(loan.created_at).getTime();
      if (currentBundle) {
        const firstTime = new Date(currentBundle.loans[0].created_at).getTime();
        if (firstTime - loanTime <= 2 * 60 * 1000) {
          currentBundle.loans.push(loan);
          continue;
        }
      }
      currentBundle = { key: loan.id + loan._loanKind, loans: [loan] };
      bundles.push(currentBundle);
    }
    return bundles;
  };

  // Stats
  const counts = loans.reduce((acc, l) => {
    acc[l.status] = (acc[l.status] || 0) + 1;
    return acc;
  }, {});
  const overdueCount = loans.filter(isOverdue).length;

  const bundles = buildBundles(loans);

  const renderLoanCard = (loan) => {
    const overdue = isOverdue(loan);
    const dueSoon = !overdue && isDueSoon(loan);
    const isLaptop = loan._loanKind === 'laptop';

    return (
      <div
        key={`${loan._loanKind}-${loan.id}`}
        className="loan-card"
        style={overdue ? { borderColor: 'rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.03)' } : dueSoon ? { borderColor: 'rgba(245,158,11,0.4)' } : {}}
      >
        {overdue && (
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, padding: '6px 10px', background: 'rgba(239,68,68,0.12)', borderRadius: 8, marginBottom: 8, fontSize: 12, color: 'var(--error)', fontWeight: 600 }}>
            <RiAlertLine style={{ flexShrink: 0 }} /> <span>OVERDUE — Please return items or contact an admin</span>
          </div>
        )}
        {dueSoon && (
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, padding: '6px 10px', background: 'rgba(245,158,11,0.1)', borderRadius: 8, marginBottom: 8, fontSize: 12, color: 'var(--warning)', fontWeight: 600 }}>
            <RiCalendarLine style={{ flexShrink: 0 }} /> <span>Due soon — return by {loan.end_date}</span>
          </div>
        )}

        <div className="loan-card-header">
          <div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6, alignItems: 'center' }}>
              {kindBadge(loan._loanKind)}
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
              {isLaptop ? <RiMacbookLine style={{ verticalAlign: 'middle', marginRight: 3, fontSize: 12 }} /> : null}
              {item.item}{!isLaptop ? ` × ${item.quantity}` : ''}
            </span>
          ))}
        </div>

        <div className="loan-card-meta">
          {loan.purpose && <span>📝 {loan.purpose}</span>}
          {loan.department && <span>🏢 {loan.department}</span>}
          <span>📅 {loan.start_date}{loan.end_date ? ` → ${loan.end_date}` : ' → Ongoing'}</span>
        </div>

        {loan.admin_notes && (
          <div style={{ marginTop: 8, padding: 10, background: 'rgba(99,102,241,0.05)', borderRadius: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
            <strong>Admin notes:</strong> {loan.admin_notes}
          </div>
        )}

        {(loan.status === 'approved' || loan.status === 'pending') && (
          <div style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {loan.status === 'approved' && (
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
                <RiCameraLine style={{ marginRight: 6 }} /> Return
              </button>
            )}
            <button
              className="btn btn-sm"
              onClick={() => isLaptop ? handleModifyLaptopLoan(loan) : handleModifyLoan(loan)}
              disabled={borrowAgainLoading[loan.id]}
              style={{ background: 'rgba(245,158,11,0.1)', color: '#d97706', border: '1px solid rgba(245,158,11,0.3)', fontWeight: 600 }}
            >
              {borrowAgainLoading[loan.id]
                ? <span className="btn-spinner" />
                : <><RiEdit2Line style={{ marginRight: 6 }} />Modify</>}
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

        {loan.status === 'pending' && (
          <div style={{ marginTop: 12 }}>
            <button
              className="btn btn-sm"
              onClick={() => handleCancelLoan(loan)}
              disabled={cancelLoading[loan.id]}
              style={{ fontSize: 12, color: 'var(--error)', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', fontWeight: 600 }}
            >
              {cancelLoading[loan.id]
                ? <><span className="btn-spinner" /> Cancelling…</>
                : <>✕ Cancel Request</>}
            </button>
          </div>
        )}

        {(loan.status === 'returned' || loan.status === 'rejected') && (
          <div style={{ marginTop: 12 }}>
            <button
              className="btn btn-sm btn-outline"
              onClick={() => isLaptop ? handleBorrowAgainLaptop(loan) : handleBorrowAgain(loan)}
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
  };

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
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 24, alignItems: 'center' }}>
          <div className="search-input-wrap" style={{ flex: '1 1 180px', minWidth: 0 }}>
            <RiSearchLine className="search-icon" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by item or purpose..."
            />
          </div>
          <select className="filter-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ flexShrink: 0, fontSize: 16, padding: '7px 36px 7px 10px', width: 'auto' }}>
            <option value="">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="returned">Returned</option>
          </select>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <RiFilterLine style={{ color: 'var(--text-muted)', fontSize: 14 }} />
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              title="From date"
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 8px', color: 'var(--text-primary)', fontSize: 16, width: 130 }} />
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>–</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              title="To date"
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 8px', color: 'var(--text-primary)', fontSize: 16, width: 130 }} />
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
          bundles.map(bundle => {
            if (bundle.loans.length === 1) {
              return renderLoanCard(bundle.loans[0]);
            }
            // Bundle: multiple loans submitted in the same session
            const bundleDate = new Date(bundle.loans[0].created_at).toLocaleDateString();
            const sharedPurpose = bundle.loans.every(l => l.purpose === bundle.loans[0].purpose)
              ? bundle.loans[0].purpose
              : null;
            return (
              <div key={bundle.key} style={{
                border: '1px solid rgba(99,102,241,0.25)',
                borderRadius: 14,
                marginBottom: 16,
                overflow: 'hidden',
                background: 'rgba(99,102,241,0.03)',
              }}>
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '10px 16px',
                  background: 'rgba(99,102,241,0.07)',
                  borderBottom: '1px solid rgba(99,102,241,0.15)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>
                      Loan Bundle
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {bundle.loans.length} requests · {bundleDate}
                    </span>
                  </div>
                  {sharedPurpose && (
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      📝 {sharedPurpose}
                    </span>
                  )}
                </div>
                <div style={{ padding: '12px 12px 4px' }}>
                  {bundle.loans.map(loan => (
                    <div key={`${loan._loanKind}-${loan.id}`} style={{ marginBottom: 8 }}>
                      {renderLoanCard(loan)}
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Return Modal */}
      {returnModalLoan && (
        <div className="modal-overlay" onClick={() => !returnLoading && (setReturnModalLoan(null), setReturnPhoto(null), setReturnRemarks(''))}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <div className="modal-header">
              <div>
                <h2 style={{ marginBottom: 2 }}>Return {returnModalLoan._loanKind === 'laptop' ? 'Laptop Loan' : 'Loan'} #{returnModalLoan.id}</h2>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 400 }}>
                  {returnModalLoan.items.map(i => `${i.item}${returnModalLoan._loanKind !== 'laptop' ? ` ×${i.quantity}` : ''}`).join(' · ')}
                </div>
              </div>
              <button className="btn-close" onClick={() => !returnLoading && (setReturnModalLoan(null), setReturnPhoto(null), setReturnRemarks(''))}>✕</button>
            </div>

            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Proof of Return <span style={{ color: 'var(--error)' }}>*</span>
                </div>
                <div style={{ background: 'var(--bg-secondary)', border: '1px dashed var(--border)', borderRadius: 10, padding: returnPhoto ? 8 : 18, textAlign: 'center' }}>
                  {returnPhoto ? (
                    <div style={{ position: 'relative', display: 'inline-block' }}>
                      <Image
                        src={returnPhoto}
                        alt="Return proof"
                        width={1200}
                        height={1200}
                        unoptimized
                        style={{ maxWidth: '100%', maxHeight: 200, width: 'auto', height: 'auto', borderRadius: 8, display: 'block' }}
                      />
                      <button onClick={() => setReturnPhoto(null)} className="btn-close" style={{ position: 'absolute', top: 6, right: 6 }}>✕</button>
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
                    fontSize: 13, resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none',
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
