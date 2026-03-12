"use client";
import { useAuth } from "@/lib/AuthContext";
import { useCart } from "@/lib/CartContext";
import { useRouter } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import Navbar from "@/components/Navbar";
import CartPanel from "@/components/CartPanel";
import { TypeBadge } from "@/lib/typeColors";
import {
  RiSearchLine,
  RiAddLine,
  RiRefreshLine,
  RiBookmarkLine,
} from "react-icons/ri";

export default function InventoryPage() {
  const { user, loading } = useAuth();
  const { addItem, updateQuantity } = useCart();
  const router = useRouter();
  const [tab, setTab] = useState("storage");
  const [items, setItems] = useState([]);
  const [filters, setFilters] = useState({ types: [], brands: [] });
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [brandFilter, setBrandFilter] = useState("");
  const [fetching, setFetching] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [templates, setTemplates] = useState([]);
  const [overdueCount, setOverdueCount] = useState(0);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  const fetchItems = useCallback(async () => {
    if (!user) return;
    setFetching(true);
    setError("");
    try {
      const params = new URLSearchParams({
        tab,
        search,
        type: typeFilter,
        brand: brandFilter,
      });
      const res = await fetch(`/api/items?${params}`);
      if (res.ok) {
        const data = await res.json();
        setItems(data.items);
        if (data.filters) setFilters(data.filters);
        setOffline(!!data.offline);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Failed to load inventory (${res.status})`);
      }
    } catch (err) {
      setError("Network error — could not load inventory");
    } finally {
      setFetching(false);
    }
  }, [user, tab, search, typeFilter, brandFilter]);

  useEffect(() => {
    const timer = setTimeout(fetchItems, 300);
    return () => clearTimeout(timer);
  }, [fetchItems]);

  useEffect(() => {
    if (!user) return;
    fetch("/api/admin/templates")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setTemplates(d.templates);
      })
      .catch(() => {});
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.overdueCount) setOverdueCount(d.overdueCount);
      })
      .catch(() => {});
  }, [user]);

  const handleTemplateRequest = useCallback(
    (template) => {
      let added = 0;
      template.items.forEach((ti) => {
        const match = items.find((i) => i.id === ti.item_id);
        if (match && match.current > 0) {
          addItem(match); // adds with qty 1
          const qty = Math.min(ti.quantity, match.current);
          if (qty > 1) updateQuantity(match.id, qty);
          added++;
        }
      });
      if (added === 0)
        setError("None of the template items are currently in stock");
    },
    [items, addItem, updateQuantity],
  );

  const handleRefresh = useCallback(async () => {
    setSyncing(true);
    setError("");
    try {
      const syncRes = await fetch("/api/items/sync", { method: "POST" });
      if (!syncRes.ok) {
        const data = await syncRes.json().catch(() => ({}));
        setError(data.error || "Sync failed");
      }
    } catch {
      setError("Network error — could not sync from Google Sheets");
    } finally {
      setSyncing(false);
    }
    await fetchItems();
  }, [fetchItems]);

  if (loading || !user)
    return (
      <div className="loading-spinner">
        <div className="spinner" />
      </div>
    );

  const tabs = [
    { id: "presets", label: "Presets" },
    { id: "storage", label: "Storage Spare" },
    { id: "deployed", label: "Deployed" },
    { id: "total_quantity", label: "Total Quantity" },
    { id: "total_breakdown", label: "Qty Breakdown" },
    { id: "low_stock", label: "Low in Stock" },
  ];

  return (
    <>
      <Navbar />
      <CartPanel />
      <div className="page-container">
        <div
          className="page-header"
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
          }}
        >
          <div>
            <h1>Inventory</h1>
            <p>Browse and manage tech equipment</p>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button
              className="btn btn-sm btn-outline"
              onClick={handleRefresh}
              disabled={syncing}
              title="Sync from Google Sheets"
            >
              <RiRefreshLine
                style={{
                  fontSize: 16,
                  animation: syncing ? "spin 1s linear infinite" : "none",
                }}
              />{" "}
              {syncing ? "Syncing..." : "Refresh"}
            </button>
          </div>
        </div>

        {/* Overdue banner */}
        {overdueCount > 0 && (
          <div
            style={{
              padding: "12px 16px",
              background: "rgba(239,68,68,0.1)",
              border: "1px solid rgba(239,68,68,0.3)",
              borderRadius: 12,
              marginBottom: 16,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <span style={{ color: "var(--error)", fontWeight: 700 }}>
              🚨 You have {overdueCount} overdue loan
              {overdueCount > 1 ? "s" : ""}! Please return items as soon as
              possible.
            </span>
            <button
              className="btn btn-sm"
              style={{
                borderColor: "var(--error)",
                color: "var(--error)",
                background: "none",
                flexShrink: 0,
              }}
              onClick={() => router.push("/loans")}
            >
              View Loans
            </button>
          </div>
        )}

        {/* Tabs */}
        <div className="tabs">
          {tabs.map((t) => (
            <button
              key={t.id}
              className={`tab ${tab === t.id ? "active" : ""}`}
              onClick={() => {
                setTab(t.id);
                setSearch("");
                setTypeFilter("");
                setBrandFilter("");
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Search & Filters */}
        {(tab === "storage" || tab === "deployed") && (
          <div className="search-bar">
            <div className="search-input-wrap">
              <RiSearchLine className="search-icon" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search items, brands, types..."
              />
            </div>
            {(tab === "storage" || tab === "deployed") && (
              <>
                <select
                  className="filter-select"
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                >
                  <option value="">All Types</option>
                  {filters.types.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <select
                  className="filter-select"
                  value={brandFilter}
                  onChange={(e) => setBrandFilter(e.target.value)}
                >
                  <option value="">All Brands</option>
                  {filters.brands.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>
        )}

        {error && (
          <div
            style={{
              padding: "10px 16px",
              background: "rgba(239,68,68,0.1)",
              border: "1px solid rgba(239,68,68,0.3)",
              borderRadius: 8,
              marginBottom: 16,
              fontSize: 13,
              color: "var(--error)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span>{error}</span>
            <button
              onClick={() => setError("")}
              style={{
                background: "none",
                border: "none",
                color: "var(--error)",
                cursor: "pointer",
                fontSize: 16,
                padding: "0 4px",
              }}
            >
              ✕
            </button>
          </div>
        )}

        {offline && items.length > 0 && (
          <div
            style={{
              padding: "8px 14px",
              background: "rgba(245,158,11,0.1)",
              border: "1px solid rgba(245,158,11,0.3)",
              borderRadius: 8,
              marginBottom: 16,
              fontSize: 12,
              color: "var(--warning)",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            📡 Showing cached data — you&apos;re offline
          </div>
        )}

        {fetching ? (
          <div className="loading-spinner">
            <div className="spinner" />
          </div>
        ) : (
          <>
            {/* Presets Grid */}
            {tab === "presets" && (
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
                gap: "16px",
                marginTop: "16px",
              }}>
                {templates.length === 0 ? (
                  <div className="empty-state" style={{ gridColumn: "1 / -1" }}>
                    <h3>No presets found</h3>
                    <p>Admins can create presets in the Admin -{'>'} Templates page to allow requesting a group of items quickly.</p>
                  </div>
                ) : (
                  templates.map((t) => (
                    <div
                      key={t.id}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "space-between",
                        padding: "16px",
                        background: "var(--bg-card)",
                        border: "1px solid var(--border)",
                        borderRadius: "12px",
                        boxShadow: "0 2px 8px rgba(0,0,0,0.04)"
                      }}
                    >
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                          <span className={`badge \${t.loan_type === 'permanent' ? 'badge-permanent' : 'badge-temporary'}`}>
                            {t.loan_type === 'permanent' ? '📌 Permanent' : '⏱️ Temporary'}
                          </span>
                          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{t.name}</h3>
                        </div>
                        {t.description && (
                          <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 12 }}>
                            {t.description}
                          </p>
                        )}
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
                          {t.items.map((item) => (
                            <span key={item.item_id} className="loan-item-chip">
                              {item.item_name} × {item.quantity}
                            </span>
                          ))}
                        </div>
                      </div>
                      <button
                        className="btn btn-primary"
                        style={{ width: "100%", justifyContent: "center" }}
                        onClick={() => handleTemplateRequest(t)}
                      >
                        <RiAddLine /> Add Preset to Cart
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Storage Spare Table */}
            {tab === "storage" && (
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Type</th>
                      <th>Brand</th>
                      <th>Model</th>
                      <th>Total</th>
                      <th>Available</th>
                      <th>Loaned</th>
                      <th>Location</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => {
                      const loaned = item.quantity_spare - item.current;
                      return (
                        <tr key={item.id}>
                          <td style={{ fontWeight: 500 }}>{item.item}</td>
                          <td>
                            <TypeBadge type={item.type} />
                          </td>
                          <td>{item.brand}</td>
                          <td>{item.model}</td>
                          <td>{item.quantity_spare}</td>
                          <td>
                            <span
                              style={{
                                fontWeight: 600,
                                color:
                                  item.current <= 2
                                    ? "var(--error)"
                                    : item.current <= 5
                                      ? "var(--warning)"
                                      : "var(--success)",
                              }}
                            >
                              {item.current}
                            </span>
                          </td>
                          <td>
                            {loaned > 0 ? (
                              <span style={{ color: "var(--warning)" }}>
                                {loaned}
                              </span>
                            ) : (
                              "0"
                            )}
                          </td>
                          <td
                            style={{
                              fontSize: 12,
                              color: "var(--text-secondary)",
                            }}
                          >
                            {item.location}
                          </td>
                          <td>
                            {item.status && (
                              <span className="badge badge-success">
                                {item.status}
                              </span>
                            )}
                          </td>
                          <td>
                            {item.current > 0 && (
                              <button
                                className="btn btn-sm btn-primary"
                                onClick={() => addItem(item)}
                                title="Add to cart"
                              >
                                <RiAddLine /> Borrow
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {items.length === 0 && (
                  <div className="empty-state">
                    <h3>No items found</h3>
                    <p>Try adjusting your search or filters</p>
                  </div>
                )}
              </div>
            )}

            {/* Deployed Table */}
            {tab === "deployed" && (
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Type</th>
                      <th>Brand</th>
                      <th>Model</th>
                      <th>Qty</th>
                      <th>Location</th>
                      <th>Allocation</th>
                      <th>Status</th>
                      <th>Remarks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr key={item.id}>
                        <td style={{ fontWeight: 500 }}>{item.item}</td>
                        <td>
                          <TypeBadge type={item.type} />
                        </td>
                        <td>{item.brand}</td>
                        <td>{item.model}</td>
                        <td>{item.quantity}</td>
                        <td>{item.location}</td>
                        <td>{item.allocation}</td>
                        <td>
                          {item.status && (
                            <span className="badge badge-success">
                              {item.status}
                            </span>
                          )}
                        </td>
                        <td
                          style={{
                            fontSize: 12,
                            color: "var(--text-secondary)",
                          }}
                        >
                          {item.remarks}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {items.length === 0 && (
                  <div className="empty-state">
                    <h3>No deployed items</h3>
                    <p>Items from approved permanent loans will appear here</p>
                  </div>
                )}
              </div>
            )}

            {/* Total Quantity */}
            {tab === "total_quantity" && (
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Type / Category</th>
                      <th>Total Spare</th>
                      <th>Currently Available</th>
                      <th>Loaned Out</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, i) => (
                      <tr key={`${item.type}-${i}`}>
                        <td style={{ fontWeight: 600 }}>{item.type}</td>
                        <td>{item.total_spare}</td>
                        <td
                          style={{ color: "var(--success)", fontWeight: 600 }}
                        >
                          {item.total_current}
                        </td>
                        <td
                          style={{
                            color:
                              item.total_loaned > 0
                                ? "var(--warning)"
                                : "var(--text-muted)",
                          }}
                        >
                          {item.total_loaned}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Total Breakdown */}
            {tab === "total_breakdown" && (
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Type</th>
                      <th>Brand</th>
                      <th>Model</th>
                      <th>Total</th>
                      <th>Available</th>
                      <th>Loaned</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, i) => (
                      <tr key={`${item.item}-${item.type}-${item.brand}-${i}`}>
                        <td style={{ fontWeight: 500 }}>{item.item}</td>
                        <td>
                          <TypeBadge type={item.type} />
                        </td>
                        <td>{item.brand}</td>
                        <td>{item.model}</td>
                        <td>{item.quantity_spare}</td>
                        <td
                          style={{ color: "var(--success)", fontWeight: 600 }}
                        >
                          {item.current}
                        </td>
                        <td
                          style={{
                            color:
                              item.loaned_out > 0
                                ? "var(--warning)"
                                : "var(--text-muted)",
                          }}
                        >
                          {item.loaned_out}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Low in Stock */}
            {tab === "low_stock" && (
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>⚠️ Item</th>
                      <th>Type</th>
                      <th>Brand</th>
                      <th>Total</th>
                      <th>Available</th>
                      <th>Location</th>
                      <th>Remarks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, i) => (
                      <tr key={`${item.id}-${i}`}>
                        <td style={{ fontWeight: 500 }}>{item.item}</td>
                        <td>
                          <TypeBadge type={item.type} />
                        </td>
                        <td>{item.brand}</td>
                        <td>{item.quantity_spare}</td>
                        <td>
                          <span
                            style={{
                              fontWeight: 700,
                              color:
                                item.current === 0
                                  ? "var(--error)"
                                  : "var(--warning)",
                            }}
                          >
                            {item.current} {item.current === 0 ? "(OUT!)" : ""}
                          </span>
                        </td>
                        <td>{item.location}</td>
                        <td
                          style={{ fontSize: 12, color: "var(--text-muted)" }}
                        >
                          {item.remarks}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {items.length === 0 && (
                  <div className="empty-state">
                    <div className="empty-icon">✅</div>
                    <h3>All stocked up!</h3>
                    <p>No items are currently low in stock</p>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
