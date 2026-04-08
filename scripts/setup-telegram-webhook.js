/**
 * Inspect or register the Telegram bot webhook.
 *
 * Usage:
 *   node scripts/setup-telegram-webhook.js --check
 *   node scripts/setup-telegram-webhook.js --setup
 *
 * Environment variables:
 *   TELEGRAM_BOT_TOKEN              Required
 *   NEXT_PUBLIC_APP_URL             Used as base URL when TELEGRAM_WEBHOOK_URL is not set
 *   TELEGRAM_WEBHOOK_URL            Optional full webhook URL override
 *   TELEGRAM_WEBHOOK_SECRET         Optional webhook secret token
 */

const fs = require("fs");
const path = require("path");

function parseArgs(argv) {
  const flags = new Set(argv.slice(2));
  return {
    checkOnly: flags.has("--check") || !flags.has("--setup"),
    shouldSetup: flags.has("--setup"),
  };
}

function loadEnvFile(filePath, target) {
  if (!fs.existsSync(filePath)) return;

  const contents = fs.readFileSync(filePath, "utf8");
  for (const rawLine of contents.split(/\r?\n/)) {
    if (!rawLine || /^\s*#/.test(rawLine)) continue;

    const separatorIndex = rawLine.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = rawLine.slice(0, separatorIndex).trim();
    let value = rawLine.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in target)) {
      target[key] = value;
    }
  }
}

function loadEnv() {
  const env = { ...process.env };
  const root = process.cwd();

  loadEnvFile(path.join(root, ".env"), env);
  loadEnvFile(path.join(root, ".env.local"), env);

  return env;
}

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function getConfig() {
  const env = loadEnv();
  const botToken = env.TELEGRAM_BOT_TOKEN;
  const appUrl = trimTrailingSlash(env.NEXT_PUBLIC_APP_URL);
  const webhookUrl = trimTrailingSlash(env.TELEGRAM_WEBHOOK_URL)
    || (appUrl ? `${appUrl}/api/telegram/webhook` : "");

  if (!botToken) {
    throw new Error("TELEGRAM_BOT_TOKEN is required in the environment or .env.local");
  }

  if (!webhookUrl) {
    throw new Error(
      "Set NEXT_PUBLIC_APP_URL or TELEGRAM_WEBHOOK_URL before checking the Telegram webhook",
    );
  }

  return {
    botToken,
    appUrl,
    webhookUrl,
    webhookSecret: env.TELEGRAM_WEBHOOK_SECRET || "",
  };
}

async function telegramApi(botToken, method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {}),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data.ok) {
    throw new Error(data.description || `Telegram API ${method} failed`);
  }

  return data.result;
}

async function probeWebhook(url, secret) {
  const getResponse = await fetch(url, {
    method: "GET",
    redirect: "manual",
  }).catch((error) => ({ status: 0, error: error.message }));

  const postHeaders = { "Content-Type": "application/json" };
  if (secret) {
    postHeaders["x-telegram-bot-api-secret-token"] = secret;
  }

  const postResponse = await fetch(url, {
    method: "POST",
    headers: postHeaders,
    body: JSON.stringify({
      message: {
        chat: { id: 0 },
        from: { username: "webhook_probe" },
        text: "/start",
      },
    }),
    redirect: "manual",
  }).catch((error) => ({ status: 0, error: error.message }));

  let postBody = "";
  if (typeof postResponse.text === "function") {
    postBody = await postResponse.text().catch(() => "");
  }

  return {
    getStatus: getResponse.status || 0,
    getError: getResponse.error || null,
    postStatus: postResponse.status || 0,
    postError: postResponse.error || null,
    postBody,
  };
}

function isHealthyProbe(probe) {
  const acceptableGetStatuses = new Set([200, 401, 405]);
  const acceptablePostStatuses = new Set([200, 401]);

  return (
    acceptableGetStatuses.has(probe.getStatus) &&
    acceptablePostStatuses.has(probe.postStatus)
  );
}

function summarizeWebhookInfo(label, info) {
  console.log(`${label}:`);
  console.log(`  url: ${info.url || "(not set)"}`);
  console.log(`  pending updates: ${info.pending_update_count || 0}`);
  console.log(`  last error: ${info.last_error_message || "none"}`);
}

async function main() {
  const { checkOnly, shouldSetup } = parseArgs(process.argv);
  const config = getConfig();
  const currentInfo = await telegramApi(config.botToken, "getWebhookInfo");
  const expectedProbe = await probeWebhook(config.webhookUrl, config.webhookSecret);

  console.log(`Expected webhook URL: ${config.webhookUrl}`);
  if (config.appUrl) {
    console.log(`App URL: ${config.appUrl}`);
  }
  summarizeWebhookInfo("Current Telegram webhook", currentInfo);
  console.log("Target probe:");
  console.log(`  GET status: ${expectedProbe.getStatus}${expectedProbe.getError ? ` (${expectedProbe.getError})` : ""}`);
  console.log(`  POST status: ${expectedProbe.postStatus}${expectedProbe.postError ? ` (${expectedProbe.postError})` : ""}`);
  if (expectedProbe.postStatus >= 400 && expectedProbe.postBody) {
    console.log(`  POST body: ${expectedProbe.postBody}`);
  }

  if (checkOnly && !shouldSetup) {
    if (currentInfo.url !== config.webhookUrl) {
      console.log("\nWebhook mismatch detected.");
    }
    if (!isHealthyProbe(expectedProbe)) {
      console.log("\nTarget webhook is not healthy. Deploy the latest app first or override TELEGRAM_WEBHOOK_URL.");
      process.exitCode = 1;
    }
    return;
  }

  if (!isHealthyProbe(expectedProbe)) {
    throw new Error(
      "Refusing to set Telegram webhook because the target URL is not healthy. Deploy the latest app first or set TELEGRAM_WEBHOOK_URL to a working deployment.",
    );
  }

  const payload = { url: config.webhookUrl, allowed_updates: ["message"] };
  if (config.webhookSecret) {
    payload.secret_token = config.webhookSecret;
  }

  await telegramApi(config.botToken, "setWebhook", payload);
  const updatedInfo = await telegramApi(config.botToken, "getWebhookInfo");

  console.log("\nWebhook updated successfully.");
  summarizeWebhookInfo("Updated Telegram webhook", updatedInfo);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});