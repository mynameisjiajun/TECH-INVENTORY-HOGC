/**
 * Run this once to register bot commands with Telegram.
 * Usage: TELEGRAM_BOT_TOKEN=your_token node scripts/setup-telegram-commands.js
 */
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error("Set TELEGRAM_BOT_TOKEN env var first");
  process.exit(1);
}

const commands = [
  { command: "loans", description: "View your active & pending loans" },
  { command: "returns", description: "Items you need to return" },
  { command: "overdue", description: "Overdue items needing attention" },
  { command: "status", description: "Check a specific loan (e.g. /status 5)" },
  { command: "history", description: "Your recent loan history" },
  { command: "help", description: "Show all commands" },
];

fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setMyCommands`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ commands }),
})
  .then((r) => r.json())
  .then((data) => {
    if (data.ok) console.log("✅ Bot commands registered successfully!");
    else console.error("❌ Failed:", data);
  })
  .catch(console.error);
