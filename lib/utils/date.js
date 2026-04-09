export function formatDateInTimeZone(date = new Date(), timeZone = "Asia/Singapore") {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  return `${year}-${month}-${day}`;
}

export function getTodaySingaporeDateString() {
  return formatDateInTimeZone(new Date(), "Asia/Singapore");
}

export function getSingaporeDateOffsetString(daysOffset) {
  const date = new Date();
  date.setDate(date.getDate() + daysOffset);
  return formatDateInTimeZone(date, "Asia/Singapore");
}