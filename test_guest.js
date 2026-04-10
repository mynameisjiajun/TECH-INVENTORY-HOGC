const res = await fetch("http://localhost:3000/api/guest/requests", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    guest_name: "Test Guest",
    telegram_handle: "",
    department: "Tech",
    purpose: "Event",
    remarks: "",
    start_date: "2026-04-10",
    end_date: "2026-04-12",
    laptop_groups: [],
    tech_items: [{"item_id": 1, "quantity": 1}]
  })
});
console.log(res.status, await res.text());
