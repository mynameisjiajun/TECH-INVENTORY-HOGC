import { google } from "googleapis";
import { Readable } from "stream";

let _driveClient = null;

async function getDrive() {
  if (_driveClient) return _driveClient;
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    },
    scopes: ["https://www.googleapis.com/auth/drive.file"],
  });
  const client = await auth.getClient();
  _driveClient = google.drive({ version: "v3", auth: client });
  return _driveClient;
}

export async function uploadFileToDrive(base64Data, fileName, mimeType) {
  const drive = await getDrive();
  
  // Remove data URI prefix if present
  const base64Str = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
  const buffer = Buffer.from(base64Str, 'base64');
  
  const fileMetadata = {
    name: fileName,
  };

  const envFolder = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (envFolder) {
    // Extract ID if a full URL was provided
    const match = envFolder.match(/folders\/([a-zA-Z0-9_-]+)/);
    const folderId = match ? match[1] : envFolder;
    fileMetadata.parents = [folderId];
  }
  
  const media = {
    mimeType: mimeType,
    body: Readable.from(buffer)
  };

  try {
    const file = await drive.files.create({
      resource: fileMetadata,
      media: media,
      fields: 'id, webViewLink, webContentLink',
      supportsAllDrives: true,
    });

    // Make the file publicly viewable so admins can see the proof of return
    await drive.permissions.create({
      fileId: file.data.id,
      requestBody: {
        role: 'reader',
        type: 'anyone',
      },
    });

    return file.data.webViewLink;
  } catch (err) {
    console.error("Failed to upload to Google Drive:", err);
    throw err;
  }
}
