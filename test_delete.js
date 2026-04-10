const res = await fetch("http://localhost:3000/api/admin", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ action: "delete", loan_id: "g_9999" })
});
console.log(res.status, await res.text());
