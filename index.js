require('dotenv').config();
const express = require('express');
const basicAuth = require('express-basic-auth');
const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

const authUser = process.env.AUTH_USER || 'admin';
const authPass = process.env.AUTH_PASS || 'admin123';

// Password protection middleware
app.use(basicAuth({
  users: { [authUser]: authPass },
  challenge: true,
  realm: 'Google Indexing Tool'
}));

// Explicitly block direct web access to sensitive files
app.use((req, res, next) => {
  const blockedFiles = [
    'service_account.json',
    '.env',
    '.env.example',
    'package.json',
    'package-lock.json',
    '.htaccess',
    '.gitignore'
  ];
  const requestedFile = path.basename(req.path).toLowerCase();
  if (blockedFiles.includes(requestedFile)) {
    return res.status(403).send('Forbidden: Access to this file is blocked.');
  }
  next();
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Verify service_account.json
const keyPath = path.join(__dirname, 'service_account.json');
let jwtClient = null;

if (fs.existsSync(keyPath)) {
  try {
    const key = require(keyPath);
    jwtClient = new google.auth.JWT({
      email: key.client_email,
      key: key.private_key,
      scopes: ['https://www.googleapis.com/auth/indexing']
    });
  } catch (err) {
    console.error('Failed to parse service_account.json:', err.message);
  }
} else {
  console.warn('Warning: service_account.json not found in the root directory.');
}

// Endpoint to publish single URL update/delete notification
app.post('/api/notify', async (req, res) => {
  const { url, type } = req.body;

  if (!jwtClient) {
    return res.status(500).json({
      success: false,
      error: 'service_account.json is missing or invalid on the server.'
    });
  }

  if (!url || !type) {
    return res.status(400).json({
      success: false,
      error: 'Missing required parameters: url and type (URL_UPDATED or URL_DELETED)'
    });
  }

  try {
    const indexing = google.indexing({
      version: 'v3',
      auth: jwtClient
    });

    const response = await indexing.urlNotifications.publish({
      requestBody: {
        url: url.trim(),
        type: type // 'URL_UPDATED' or 'URL_DELETED'
      }
    });

    return res.json({
      success: true,
      data: response.data
    });
  } catch (error) {
    console.error(`Error notifying URL [${url}]:`, error.message);
    const errorMessage = error.response?.data?.error?.message || error.message;
    return res.status(error.response?.status || 500).json({
      success: false,
      error: errorMessage,
      data: error.response?.data
    });
  }
});

// Endpoint to get URL notification metadata/status (optional check)
app.get('/api/status', async (req, res) => {
  const { url } = req.query;

  if (!jwtClient) {
    return res.status(500).json({ success: false, error: 'service_account.json not configured' });
  }

  if (!url) {
    return res.status(400).json({ success: false, error: 'Query parameter "url" is required' });
  }

  try {
    const indexing = google.indexing({ version: 'v3', auth: jwtClient });
    const response = await indexing.urlNotifications.getMetadata({ url: url.toString() });
    return res.json({ success: true, data: response.data });
  } catch (error) {
    const errorMessage = error.response?.data?.error?.message || error.message;
    return res.status(error.response?.status || 500).json({ success: false, error: errorMessage });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});