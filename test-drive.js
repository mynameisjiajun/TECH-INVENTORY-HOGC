const { google } = require("googleapis");
const { Readable } = require("stream");
const fs = require('fs');

// Load environment variables from .env.local
const envFile = fs.readFileSync('.env.local', 'utf-8');
for (const line of envFile.split('\n')) {
  if (line.trim() && !line.startsWith('#')) {
    const splitIndex = line.indexOf('=');
    if (splitIndex > 0) {
      const key = line.slice(0, splitIndex).trim();
      let value = line.slice(splitIndex + 1).trim();
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }
}

async function testDrive() {
  console.log("Authorizing with Google Drive...");
  try {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
      },
      scopes: ["https://www.googleapis.com/auth/drive.file"],
    });
    
    const client = await auth.getClient();
    const drive = google.drive({ version: "v3", auth: client });

    console.log("Uploading a 1x1 test image...");
    
    // A tiny 1x1 png image
    const buffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    
    const fileMetadata = { name: 'Test_Upload.png' };
    
    if (process.env.GOOGLE_DRIVE_FOLDER_ID) {
      const match = process.env.GOOGLE_DRIVE_FOLDER_ID.match(/folders\/([a-zA-Z0-9_-]+)/);
      const folderId = match ? match[1] : process.env.GOOGLE_DRIVE_FOLDER_ID;
      console.log(`Using Folder ID: ${folderId}`);
      fileMetadata.parents = [folderId];
    } else {
      console.log("No GOOGLE_DRIVE_FOLDER_ID found. Uploading to service account root drive.");
    }
    
    const media = {
      mimeType: 'image/png',
      body: Readable.from(buffer)
    };

    const file = await drive.files.create({
      resource: fileMetadata,
      media: media,
      fields: 'id, webViewLink',
      supportsAllDrives: true,
    });
    
    console.log("✅ Uploaded successfully!");
    console.log("🔗 File Link:", file.data.webViewLink);
    
  } catch (err) {
    console.error("❌ Error uploading to Drive:", err.message);
  }
}

testDrive();
