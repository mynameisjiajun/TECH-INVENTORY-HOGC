export const LAPTOPS = [
  // Tier 1 — Videos / Travels
  { id: '14-1',  name: '14-1 (M2 Pro)',  specs: '14" · M2 Pro',  condition: 'Excellent', tier: 'tier1' },
  { id: '14-2',  name: '14-2 (M2 Pro)',  specs: '14" · M2 Pro',  condition: 'Excellent', tier: 'tier1' },
  { id: '14-3',  name: '14-3 (M4 Pro)',  specs: '14" · M4 Pro',  condition: 'Excellent', tier: 'tier1' },
  { id: '16-1',  name: '16-1 (Intel)',   specs: '16" · Intel',   condition: 'Good',      tier: 'tier1' },
  { id: '16-2',  name: '16-2 (Intel)',   specs: '16" · Intel',   condition: 'Good',      tier: 'tier1' },
  { id: '16-3',  name: '16-3 (Intel)',   specs: '16" · Intel',   condition: 'Good',      tier: 'tier1' },
  { id: '16-4',  name: '16-4 (M2 Pro)',  specs: '16" · M2 Pro',  condition: 'Excellent', tier: 'tier1' },
  // Tier 2 — Photoshop / Meeting Setups
  { id: '13-1B', name: '13-1B (M4 Pro)', specs: '13" · M4 Pro',  condition: 'Excellent', tier: 'tier2' },
  { id: '13-2G', name: '13-2G (M4 Pro)', specs: '13" · M4 Pro',  condition: 'Excellent', tier: 'tier2' },
  { id: '13-3S', name: '13-3S (M4 Pro)', specs: '13" · M4 Pro',  condition: 'Excellent', tier: 'tier2' },
  { id: '15-1',  name: '15-1 (Intel)',   specs: '15" · Intel',   condition: 'Good',      tier: 'tier2' },
  // Permanently Deployed
  { id: '13-1',  name: '13-1 (Intel)',   specs: '13" · Intel',   condition: 'Good',      tier: 'permanent' },
  { id: '13-2',  name: '13-2 (Intel)',   specs: '13" · Intel',   condition: 'Good',      tier: 'permanent' },
  { id: '15-2',  name: '15-2 (2015)',    specs: '15" · Intel',   condition: 'Fair',      tier: 'permanent' },
]

export const LOANABLE_LAPTOPS = LAPTOPS.filter(l => l.tier !== 'permanent')

export const TIER_LABELS = {
  tier1: 'Tier 1 — Videos / Travels',
  tier2: 'Tier 2 — Photoshop / Meeting Setups',
  permanent: 'Permanently Deployed',
}

const FMT_DATETIME_OPTS = {
  weekday: "short", day: "numeric", month: "short", year: "numeric",
  hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Singapore",
}
const FMT_DATE_OPTS = {
  weekday: "short", day: "numeric", month: "short", year: "numeric",
}

export function fmtDatetime(dt) {
  return new Date(dt).toLocaleString("en-SG", FMT_DATETIME_OPTS)
}

export function fmtDate(d) {
  return new Date(d + "T12:00:00").toLocaleDateString("en-SG", FMT_DATE_OPTS)
}

export function displayPeriod(loan) {
  const s = loan.start_datetime ? fmtDatetime(loan.start_datetime) : fmtDate(loan.start_date)
  const e = loan.end_datetime ? fmtDatetime(loan.end_datetime) : fmtDate(loan.end_date)
  return `${s} → ${e}`
}
