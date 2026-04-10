const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
    const { data: user } = await supabase.from('users').select('*').eq('role', 'admin').limit(1).single();
    console.log("Admin user:", user.telegram_handle);
    const payload = {
        guest_name: "Test Guest",
        telegram_handle: user.telegram_handle, // Will trigger user match!
        purpose: "Guest checkout test",
        department: "Test",
        start_date: "2026-04-10",
        end_date: "2026-04-15",
        tech_items: [{ item_id: 1, quantity: 1 }]
    };
    const res = await fetch('http://localhost:3000/api/guest/requests', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload)
    });
    const text = await res.text();
    console.log("Response:", text);
    // Now check the loan table!
    const resObj = JSON.parse(text);
    if (resObj.tech_loan_id) {
        const { data: loan } = await supabase.from('loan_requests').select('*').eq('id', resObj.tech_loan_id).single();
        console.log("Loan status is:", loan.status);
    }
})();
