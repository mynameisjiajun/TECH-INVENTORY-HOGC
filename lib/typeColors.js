// Color mapping for equipment type badges
// Uses a hash-based approach so new types automatically get a consistent color

const TYPE_COLORS = {
  Cables: {
    bg: "rgba(59, 130, 246, 0.15)",
    color: "#60a5fa",
    border: "rgba(59, 130, 246, 0.3)",
  },
  "Broadcast/Wireless": {
    bg: "rgba(168, 85, 247, 0.15)",
    color: "#c084fc",
    border: "rgba(168, 85, 247, 0.3)",
  },
  "USB Hubs/Accessories": {
    bg: "rgba(236, 72, 153, 0.15)",
    color: "#f472b6",
    border: "rgba(236, 72, 153, 0.3)",
  },
  "TOOLS!": {
    bg: "rgba(245, 158, 11, 0.15)",
    color: "#fbbf24",
    border: "rgba(245, 158, 11, 0.3)",
  },
  Power: {
    bg: "rgba(34, 197, 94, 0.15)",
    color: "#4ade80",
    border: "rgba(34, 197, 94, 0.3)",
  },
  "Monitors/Displays": {
    bg: "rgba(14, 165, 233, 0.15)",
    color: "#38bdf8",
    border: "rgba(14, 165, 233, 0.3)",
  },
  Audio: {
    bg: "rgba(249, 115, 22, 0.15)",
    color: "#fb923c",
    border: "rgba(249, 115, 22, 0.3)",
  },
  Camera: {
    bg: "rgba(139, 92, 246, 0.15)",
    color: "#a78bfa",
    border: "rgba(139, 92, 246, 0.3)",
  },
  Networking: {
    bg: "rgba(6, 182, 212, 0.15)",
    color: "#22d3ee",
    border: "rgba(6, 182, 212, 0.3)",
  },
  Storage: {
    bg: "rgba(161, 161, 170, 0.15)",
    color: "#a1a1aa",
    border: "rgba(161, 161, 170, 0.3)",
  },
  Adapters: {
    bg: "rgba(251, 146, 60, 0.15)",
    color: "#fb923c",
    border: "rgba(251, 146, 60, 0.3)",
  },
  Peripherals: {
    bg: "rgba(52, 211, 153, 0.15)",
    color: "#34d399",
    border: "rgba(52, 211, 153, 0.3)",
  },
  "Mounts/Stands": {
    bg: "rgba(244, 114, 182, 0.15)",
    color: "#f472b6",
    border: "rgba(244, 114, 182, 0.3)",
  },
  Projection: {
    bg: "rgba(99, 102, 241, 0.15)",
    color: "#818cf8",
    border: "rgba(99, 102, 241, 0.3)",
  },
  Lighting: {
    bg: "rgba(250, 204, 21, 0.15)",
    color: "#facc15",
    border: "rgba(250, 204, 21, 0.3)",
  },
};

// Fallback palette for types not in the map
const FALLBACK_PALETTE = [
  {
    bg: "rgba(239, 68, 68, 0.15)",
    color: "#f87171",
    border: "rgba(239, 68, 68, 0.3)",
  },
  {
    bg: "rgba(16, 185, 129, 0.15)",
    color: "#34d399",
    border: "rgba(16, 185, 129, 0.3)",
  },
  {
    bg: "rgba(217, 70, 239, 0.15)",
    color: "#e879f9",
    border: "rgba(217, 70, 239, 0.3)",
  },
  {
    bg: "rgba(20, 184, 166, 0.15)",
    color: "#2dd4bf",
    border: "rgba(20, 184, 166, 0.3)",
  },
  {
    bg: "rgba(244, 63, 94, 0.15)",
    color: "#fb7185",
    border: "rgba(244, 63, 94, 0.3)",
  },
];

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function getTypeColor(type) {
  if (!type || type === "-")
    return {
      bg: "rgba(161, 161, 170, 0.1)",
      color: "#71717a",
      border: "rgba(161, 161, 170, 0.2)",
    };
  if (TYPE_COLORS[type]) return TYPE_COLORS[type];
  const idx = hashString(type) % FALLBACK_PALETTE.length;
  return FALLBACK_PALETTE[idx];
}

export function TypeBadge({ type }) {
  const colors = getTypeColor(type);
  return (
    <span
      className="type-badge"
      style={{
        display: "inline-block",
        padding: "3px 10px",
        borderRadius: 20,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.02em",
        background: colors.bg,
        color: colors.color,
        border: `1px solid ${colors.border}`,
        whiteSpace: "nowrap",
      }}
    >
      {type}
    </span>
  );
}
