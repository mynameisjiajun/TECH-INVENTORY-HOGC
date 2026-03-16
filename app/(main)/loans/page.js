'use client';
import { useAuth } from '@/lib/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useToast } from '@/lib/context/ToastContext';
import Navbar from '@/components/Navbar';
import CartPanel from '@/components/CartPanel';
import { RiTimeLine, RiCheckLine, RiCloseLine, RiArrowGoBackLine, RiSearchLine, RiFilterLine, RiCameraLine } from 'react-icons/ri';

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
  const toast = useToast();
  
  const [returnModalLoan, setReturnModalLoan] = useState(null);
  const [returnPhoto, setReturnPhoto] = useState(null);
  const [returnLoading, setReturnLoading] = useState(false);

  const handlePhotoChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    // Compress image before upload using canvas
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
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        setReturnPhoto(dataUrl);
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
        body: JSON.stringify({ imageBase64: returnPhoto })
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(data.message);
        setLoans(loans.map(l => l.id === returnModalLoan.id ? { ...l, status: 'returned', return_photo_url: data.photo_url } : l));
        setReturnModalLoan(null);
        setReturnPhoto(null);
      } else {
        toast.error(data.error);
      }
    } catch (err) {
      toast.error('Network error — failed to submit return');
    } finally {
      setReturnLoading(false);
    }
  };

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
        const res = await fetch(`/api/loans?${params}`, { cache: 'no-store' });
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

            {loan.status === 'approved' && loan.loan_type === 'temporary' && (
              <div style={{ marginTop: 16 }}>
                <button
                  className="btn btn-sm"
                  onClick={() => setReturnModalLoan(loan)}
                  style={{
                    background: 'rgba(59,130,246,0.1)',
                    color: '#3b82f6',
                    border: '1px solid rgba(59,130,246,0.3)',
                    fontWeight: 600
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
          </div>
        ))}
      </div>

      {/* Return Modal */}
      {returnModalLoan && (
        <div className="modal-overlay" onClick={() => !returnLoading && setReturnModalLoan(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 450 }}>
            <div className="modal-header">
              <h2>Return Loan #{returnModalLoan.id}</h2>
              <button className="btn-close" onClick={() => !returnLoading && setReturnModalLoan(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 16 }}>
                Please upload a clear photo showing all items have been returned to their proper storage location.
              </p>
              
              <div style={{ background: 'var(--bg-secondary)', border: '1px dashed var(--border)', borderRadius: 12, padding: 20, textAlign: 'center', marginBottom: 16 }}>
                {returnPhoto ? (
                  <div style={{ position: 'relative', display: 'inline-block' }}>
                    <img src={returnPhoto} alt="Return proof" style={{ maxWidth: '100%', maxHeight: 250, borderRadius: 8 }} />
                    <button 
                      onClick={() => setReturnPhoto(null)}
                      style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.6)', color: 'white', border: 'none', borderRadius: '50%', width: 28, height: 28, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >✕</button>
                  </div>
                ) : (
                  <>
                    <RiCameraLine size={32} style={{ color: 'var(--text-muted)', marginBottom: 12 }} />
                    <br />
                    <label className="btn btn-outline" style={{ cursor: 'pointer' }}>
                      Take / Upload Photo
                      <input 
                        type="file" 
                        accept="image/*" 
                        capture="environment" 
                        style={{ display: 'none' }} 
                        onChange={handlePhotoChange} 
                      />
                    </label>
                  </>
                )}
              </div>
            </div>
            <div className="modal-footer" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button 
                className="btn btn-outline" 
                onClick={() => setReturnModalLoan(null)}
                disabled={returnLoading}
              >
                Cancel
              </button>
              <button 
                className="btn btn-primary" 
                onClick={submitReturn}
                disabled={!returnPhoto || returnLoading}
              >
                {returnLoading ? 'Uploading...' : 'Submit Return'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
