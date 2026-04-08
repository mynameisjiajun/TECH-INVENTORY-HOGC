"use client";

import {
  RiArrowLeftLine,
  RiArrowRightLine,
  RiCalendarLine,
} from "react-icons/ri";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MOBILE_DAY_NAMES = ["M", "T", "W", "T", "F", "S", "S"];

const FILTER_OPTIONS = [
  { value: "my", getLabel: (isMobile) => (isMobile ? "Mine" : "My Loans") },
  { value: "all", getLabel: () => "All" },
  { value: "tech", getLabel: (isMobile) => (isMobile ? "📦" : "📦 Tech") },
  {
    value: "laptop",
    getLabel: (isMobile) => (isMobile ? "💻" : "💻 Laptop"),
  },
];

const MOBILE_MAX_VISIBLE_LANES = 3;
const DESKTOP_MAX_VISIBLE_LANES = 4;

function getMaxVisibleLanes(isMobile) {
  return isMobile ? MOBILE_MAX_VISIBLE_LANES : DESKTOP_MAX_VISIBLE_LANES;
}

function getCalendarRowMetrics(isMobile, visibleLaneCount, hasOverflow) {
  const topOffset = isMobile ? 24 : 28;
  const barGap = isMobile ? 22 : 24;
  const barHeight = isMobile ? 18 : 20;
  const overflowHeight = hasOverflow ? (isMobile ? 18 : 20) : 0;
  const bottomPadding = isMobile ? 14 : 18;
  const minCellHeight = isMobile ? 72 : 90;
  const stackedBarHeight =
    visibleLaneCount > 0 ? (visibleLaneCount - 1) * barGap + barHeight : 0;
  const contentHeight =
    topOffset + stackedBarHeight + (hasOverflow ? overflowHeight + 10 : 0);
  const rowHeight = Math.max(minCellHeight, contentHeight + bottomPadding);

  return {
    topOffset,
    barGap,
    barHeight,
    bottomPadding,
    minCellHeight,
    rowHeight,
  };
}

function assignWeekBarLanes(weekBars) {
  const laneEndColumns = [];

  return [...weekBars]
    .sort((left, right) => {
      if (left.startCol !== right.startCol) {
        return left.startCol - right.startCol;
      }
      if (left.endCol !== right.endCol) {
        return left.endCol - right.endCol;
      }
      if (left.isOwn !== right.isOwn) {
        return left.isOwn ? -1 : 1;
      }
      if (left.isOverdue !== right.isOverdue) {
        return left.isOverdue ? -1 : 1;
      }
      return String(left.label || left.loan?.purpose || "").localeCompare(
        String(right.label || right.loan?.purpose || ""),
      );
    })
    .map((bar) => {
      let laneIndex = laneEndColumns.findIndex(
        (endColumn) => bar.startCol > endColumn,
      );

      if (laneIndex === -1) {
        laneIndex = laneEndColumns.length;
      }

      laneEndColumns[laneIndex] = bar.endCol;

      return { ...bar, laneIndex };
    });
}

export default function LoanCalendar({
  isMobile,
  calendarMonth,
  typeFilter,
  onTypeFilterChange,
  prevMonth,
  nextMonth,
  goToday,
  calendarData,
  isToday,
  barColor,
  onSelectLoan,
  legendItems,
  filterOptions = FILTER_OPTIONS,
}) {
  return (
    <div className="gantt-container">
      <div
        className="gantt-header"
        style={isMobile ? { flexDirection: "column", gap: 8 } : undefined}
      >
        <h3
          className="gantt-title"
          style={isMobile ? { fontSize: 14 } : undefined}
        >
          <RiCalendarLine style={{ verticalAlign: "middle" }} />{" "}
          {isMobile
            ? `${MONTH_NAMES[calendarMonth.getMonth()].slice(0, 3)} ${calendarMonth.getFullYear()}`
            : `Loan Calendar — ${MONTH_NAMES[calendarMonth.getMonth()]} ${calendarMonth.getFullYear()}`}
        </h3>
        <div
          className="gantt-toolbar"
          style={{
            display: "flex",
            gap: isMobile ? 4 : 8,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <div
            className="gantt-filter-group"
            style={{
              display: "flex",
              background: "rgba(255,255,255,0.05)",
              borderRadius: 8,
              padding: 2,
              gap: 2,
            }}
          >
            {filterOptions.map(({ value, getLabel }) => (
              <button
                key={value}
                className="gantt-filter-btn"
                onClick={() => onTypeFilterChange(value)}
                style={{
                  padding: isMobile ? "4px 8px" : "4px 12px",
                  fontSize: isMobile ? 10 : 11,
                  fontWeight: 600,
                  border: "none",
                  borderRadius: 6,
                  cursor: "pointer",
                  background:
                    typeFilter === value ? "var(--accent)" : "transparent",
                  color:
                    typeFilter === value ? "white" : "var(--text-secondary)",
                  transition: "all 0.15s",
                }}
              >
                {getLabel(isMobile)}
              </button>
            ))}
          </div>
          <div className="gantt-nav-group">
            <button className="btn btn-sm btn-outline" onClick={prevMonth}>
              <RiArrowLeftLine />
            </button>
            <button
              className="btn btn-sm btn-outline gantt-today-btn"
              onClick={goToday}
              style={
                isMobile ? { fontSize: 10, padding: "4px 8px" } : undefined
              }
            >
              Today
            </button>
            <button className="btn btn-sm btn-outline" onClick={nextMonth}>
              <RiArrowRightLine />
            </button>
          </div>
        </div>
      </div>

      <div
        className="gantt-scroll-area"
        style={{ overflowX: isMobile ? "hidden" : "auto" }}
      >
        <div
          className="gantt-grid-shell"
          style={{ minWidth: isMobile ? "unset" : 700 }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(7, 1fr)",
              borderBottom: "1px solid var(--border)",
            }}
          >
            {(isMobile ? MOBILE_DAY_NAMES : DAY_NAMES).map((day, index) => (
              <div
                key={index}
                style={{
                  padding: isMobile ? "6px 2px" : "8px 4px",
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--text-secondary)",
                  textAlign: "center",
                }}
              >
                {day}
              </div>
            ))}
          </div>

          {calendarData.weeks.map((week, weekIndex) => {
            const weekBars = assignWeekBarLanes(
              calendarData.loanBars.filter((bar) => bar.week === weekIndex),
            );
            const maxVisibleLanes = getMaxVisibleLanes(isMobile);
            const hiddenBars = weekBars.filter(
              (bar) => bar.laneIndex >= maxVisibleLanes,
            );
            const visibleBars = weekBars.filter(
              (bar) => bar.laneIndex < maxVisibleLanes,
            );
            const visibleLaneCount = Math.min(
              maxVisibleLanes,
              weekBars.reduce(
                (highestLane, bar) => Math.max(highestLane, bar.laneIndex + 1),
                0,
              ),
            );
            const { topOffset, barGap, barHeight, minCellHeight, rowHeight } =
              getCalendarRowMetrics(
                isMobile,
                visibleLaneCount,
                hiddenBars.length > 0,
              );
            const cellHeight = Math.max(minCellHeight, rowHeight);
            const hiddenSummary = hiddenBars
              .map(
                (bar) =>
                  bar.label || bar.loan?.purpose || `Loan #${bar.loanId}`,
              )
              .slice(0, 8)
              .join("\n");

            return (
              <div
                key={weekIndex}
                style={{ position: "relative", minHeight: rowHeight }}
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(7, 1fr)",
                    borderBottom: "1px solid var(--border)",
                    minHeight: cellHeight,
                  }}
                >
                  {week.map((cell, cellIndex) => (
                    <div
                      key={cellIndex}
                      style={{
                        padding: isMobile ? "3px 2px" : "6px 8px",
                        minHeight: cellHeight,
                        borderRight:
                          cellIndex < 6
                            ? "1px solid rgba(255,255,255,0.03)"
                            : "none",
                        background:
                          cell && isToday(cell)
                            ? "rgba(99,102,241,0.06)"
                            : "transparent",
                      }}
                    >
                      {cell && (
                        <div
                          style={{
                            fontSize: isMobile ? 11 : 12,
                            fontWeight: isToday(cell) ? 700 : 400,
                            color: isToday(cell)
                              ? "var(--accent)"
                              : "var(--text-muted)",
                            textAlign: "right",
                          }}
                        >
                          {isToday(cell) ? (
                            <span
                              style={{
                                background: "var(--accent)",
                                color: "white",
                                borderRadius: "50%",
                                width: isMobile ? 20 : 24,
                                height: isMobile ? 20 : 24,
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: isMobile ? 10 : 12,
                              }}
                            >
                              {cell.day}
                            </span>
                          ) : (
                            cell.day
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {visibleBars.map((bar, barIndex) => {
                  const colors = barColor(bar);
                  const leftPct = (bar.startCol / 7) * 100;
                  const widthPct = ((bar.endCol - bar.startCol + 1) / 7) * 100;
                  const compactLabel =
                    widthPct < 18 && isMobile && bar.label
                      ? bar.label.slice(0, 6)
                      : bar.label || bar.loan.purpose;

                  return (
                    <div
                      key={`${bar.loanId}-${weekIndex}-${barIndex}`}
                      onClick={() => onSelectLoan(bar.loan)}
                      style={{
                        position: "absolute",
                        top: topOffset + bar.laneIndex * barGap,
                        left: `calc(${leftPct}% + ${isMobile ? 2 : 4}px)`,
                        width: `calc(${widthPct}% - ${isMobile ? 4 : 8}px)`,
                        height: barHeight,
                        background: colors.bg,
                        borderLeft: `${isMobile ? 2 : 3}px solid ${colors.border}`,
                        borderRadius: isMobile ? 3 : 4,
                        display: "flex",
                        alignItems: "center",
                        padding: isMobile ? "0 3px" : "0 6px",
                        fontSize: isMobile ? 9 : 10,
                        fontWeight: 600,
                        color: colors.color,
                        overflow: "hidden",
                        whiteSpace: "nowrap",
                        textOverflow: "ellipsis",
                        cursor: "pointer",
                        zIndex: 2,
                      }}
                      title={`${bar.label || "Loan"} — Click for details`}
                    >
                      {bar.isOverdue ? "🚨 " : ""}
                      {compactLabel}
                    </div>
                  );
                })}

                {hiddenBars.length > 0 && (
                  <div
                    title={hiddenSummary || `${hiddenBars.length} more loans`}
                    style={{
                      position: "absolute",
                      top: topOffset + visibleLaneCount * barGap,
                      left: isMobile ? 4 : 8,
                      right: isMobile ? 4 : 8,
                      height: isMobile ? 16 : 18,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: 999,
                      border: "1px dashed rgba(148,163,184,0.35)",
                      background: "rgba(15,23,42,0.55)",
                      color: "var(--text-muted)",
                      fontSize: isMobile ? 9 : 10,
                      fontWeight: 600,
                      letterSpacing: 0.2,
                      zIndex: 1,
                      pointerEvents: "none",
                    }}
                  >
                    +{hiddenBars.length} more
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          gap: 16,
          padding: "12px 0",
          flexWrap: "wrap",
          fontSize: 11,
          color: "var(--text-secondary)",
        }}
      >
        {legendItems.map((item) => (
          <span
            key={item.label}
            style={{ display: "flex", alignItems: "center", gap: 4 }}
          >
            <span
              style={{
                width: 12,
                height: 12,
                borderRadius: 3,
                background: item.background,
                borderLeft: `3px solid ${item.border}`,
              }}
            />{" "}
            {item.label}
          </span>
        ))}
      </div>
    </div>
  );
}
