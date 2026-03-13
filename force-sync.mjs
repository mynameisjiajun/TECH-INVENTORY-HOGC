import { syncUsersToSheet } from "./lib/db.js";
syncUsersToSheet().then(() => console.log("Done")).catch(e => console.error("Error", e));
