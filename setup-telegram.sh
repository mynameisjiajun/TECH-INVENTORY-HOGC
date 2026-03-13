#!/usr/bin/env bash

# This script points the Telegram Bot to your Vercel project's webhook.
# Make sure your project is deployed to Vercel first!

BOT_TOKEN="8419011122:AAFffxhRrEjx7gRUFR56AX6-fOF9SqaAu8k"
VERCEL_DOMAIN="https://tech-inventory-hogc.vercel.app"
WEBHOOK_URL="${VERCEL_DOMAIN}/api/telegram/webhook"

echo "Setting Telegram Webhook to: $WEBHOOK_URL"

curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook" \
     -H "Content-Type: application/json" \
     -d "{\"url\": \"${WEBHOOK_URL}\"}"

echo -e "\n\nDone! If it says \"Webhook was set\", your bot is ready."
