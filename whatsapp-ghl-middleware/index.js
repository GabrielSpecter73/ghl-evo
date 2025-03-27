// WhatsApp Evolution API to GoHighLevel Middleware
// index.js file for Replit

const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const app = express();
require('dotenv').config();

// Configuração global de CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  next();
});

// Middleware de logging para todas as requisições
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Middlewares para parsear o corpo das requisições
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Environment variables (set these in Replit Secrets)
const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL;
const EVOLUTION_API_INSTANCE = process.env.EVOLUTION_API_INSTANCE;
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY;
const GHL_WEBHOOK_URL = process.env.GHL_WEBHOOK_URL;
const GHL_API_KEY = process.env.GHL_API_KEY;
const WHATSAPP_NUMBER = process.env.WHATSAPP_NUMBER;

// Simple health check endpoint
app.get('/', (req, res) => {
  res.status(200).send('WhatsApp-GHL Middleware is running!');
});

// OAuth authentication endpoints
app.get('/auth', (req, res) => {
  console.log('Received OAuth authentication request:', req.query);
  
  // Extract the redirect URI and state from the query parameters
  const redirectUri = req.query.redirect_uri || req.query.redirect_url;
  const state = req.query.state || '';
  
  // For MVP, automatically redirect back with a code
  if (redirectUri) {
    const authCode = 'temporary_auth_code_' + Date.now();
    const redirectUrl = `${redirectUri}?code=${authCode}&state=${state}`;
    console.log('Redirecting to:', redirectUrl);
    res.redirect(redirectUrl);
  } else {
    res.status(400).send('Missing redirect URI');
  }
});

// Modifique o endpoint de callback para aceitar todos os métodos
app.all('/auth/callback', (req, res) => {
  console.log('Received OAuth callback:', {
    method: req.method,
    query: req.query,
    body: req.body
  });
  
  // Para MVP, apenas retorna sucesso
  if (req.method === 'GET') {
    res.send(`
      <html>
        <body>
          <h1>Authentication Successful</h1>
          <p>You can now close this window and return to GoHighLevel.</p>
          <script>
            setTimeout(() => {
              window.close();
            }, 3000);
          </script>
        </body>
      </html>
    `);
  } else {
    res.json({
      success: true,
      message: 'OAuth callback successful',
      timestamp: new Date().toISOString()
    });
  }
});

// Add token endpoint for OAuth
app.post('/oauth/token', (req, res) => {
  console.log('Received token request:', req.body);
  
  // For MVP, always return a successful token response
  res.json({
    access_token: 'mvp_access_token_' + Date.now(),
    token_type: 'Bearer',
    expires_in: 3600,
    refresh_token: 'mvp_refresh_token_' + Date.now()
  });
});

// Rota única para /test que lida com todos os métodos HTTP
app.all('/test', (req, res) => {
  console.log(`${req.method} /test request received`);
  
  // Configure CORS headers
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  // Handle OPTIONS request for CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Para todos os outros métodos, retorne uma resposta de sucesso
  res.json({
    success: true,
    message: `API connection successful (${req.method})`,
    timestamp: new Date().toISOString()
  });
});

// Webhook endpoint to receive messages from Evolution API
app.post('/webhook/whatsapp', async (req, res) => {
  try {
    console.log('Received webhook from Evolution API:', JSON.stringify(req.body));

    // Check if webhook has messages
    const { messages, webhookEvent } = req.body;

    // Only process if it's a messages event and contains messages
    if (webhookEvent !== 'messages' || !messages || messages.length === 0) {
      return res.status(200).send({ status: 'No messages to process' });
    }

    for (const message of messages) {
      // Skip if it's not a text, image, or document message
      if (!message.message?.conversation && 
          !message.message?.extendedTextMessage && 
          !message.message?.imageMessage &&
          !message.message?.documentMessage) {
        continue;
      }

      // Extract the phone number (remove the @s.whatsapp.net part)
      const from = message.key.remoteJid.split('@')[0];

      // Extract the message content
      let body = '';
      if (message.message?.conversation) {
        body = message.message.conversation;
      } else if (message.message?.extendedTextMessage) {
        body = message.message.extendedTextMessage.text;
      } else if (message.message?.imageMessage?.caption) {
        body = message.message.imageMessage.caption;
      } else if (message.message?.documentMessage?.caption) {
        body = message.message.documentMessage.caption;
      }

      // Format data for GoHighLevel
      const ghlData = {
        from: from,
        to: WHATSAPP_NUMBER,
        body: body,
        media: [],
        timestamp: new Date(message.messageTimestamp * 1000).toISOString()
      };

      // If there's media, add it
      if (message.message?.imageMessage || message.message?.documentMessage) {
        const mediaType = message.message?.imageMessage ? 'image' : 'document';
        const mediaId = message.message?.[mediaType + 'Message'].id;

        try {
          // Get media URL from Evolution API
          const mediaResponse = await axios.get(
            `${EVOLUTION_API_URL}/${EVOLUTION_API_INSTANCE}/message/getMedia/${mediaId}`,
            { headers: { 'apikey': EVOLUTION_API_KEY } }
          );

          if (mediaResponse.data && mediaResponse.data.url) {
            ghlData.media.push(mediaResponse.data.url);
          }
        } catch (mediaError) {
          console.error('Error fetching media:', mediaError);
        }
      }

      console.log('Sending to GoHighLevel:', JSON.stringify(ghlData));

      // Forward to GoHighLevel
      try {
        await axios.post(GHL_WEBHOOK_URL, ghlData, {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${GHL_API_KEY}`
          }
        });
        console.log('Successfully forwarded to GoHighLevel');
      } catch (ghlError) {
        console.error('Error sending to GoHighLevel:', ghlError.response?.data || ghlError.message);
      }
    }

    res.status(200).send({ status: 'success' });
  } catch (error) {
    console.error('Error processing WhatsApp message:', error);
    res.status(500).send({ status: 'error', message: error.message });
  }
});

// Endpoint for GoHighLevel to send messages via Evolution API
app.post('/send', async (req, res) => {
  try {
    console.log('Received send request from GoHighLevel:', JSON.stringify(req.body));
    const { to, message, mediaUrl } = req.body;

    if (!to || (!message && !mediaUrl)) {
      return res.status(400).send({ 
        status: 'error', 
        message: 'Missing required fields (to, message, or mediaUrl)' 
      });
    }

    // Format phone number for WhatsApp (remove + and ensure proper format)
    let formattedNumber = to;
    if (formattedNumber.startsWith('+')) {
      formattedNumber = formattedNumber.substring(1);
    }

    // Remove any non-digit characters
    formattedNumber = formattedNumber.replace(/\D/g, '');

    // Create request for Evolution API
    const requestData = {
      number: `${formattedNumber}@s.whatsapp.net`,
      options: {
        delay: 1200,
        presence: 'composing'
      }
    };

    let response;

    // If media URL is provided, send media message
    if (mediaUrl) {
      requestData.mediaUrl = mediaUrl;
      requestData.caption = message || '';

      console.log('Sending media message via Evolution API:', JSON.stringify(requestData));

      response = await axios.post(
        `${EVOLUTION_API_URL}/${EVOLUTION_API_INSTANCE}/message/sendMedia`,
        requestData,
        { headers: { 'apikey': EVOLUTION_API_KEY } }
      );
    } else {
      // Text-only message
      requestData.textMessage = message;

      console.log('Sending text message via Evolution API:', JSON.stringify(requestData));

      response = await axios.post(
        `${EVOLUTION_API_URL}/${EVOLUTION_API_INSTANCE}/message/sendText`,
        requestData,
        { headers: { 'apikey': EVOLUTION_API_KEY } }
      );
    }

    console.log('Evolution API response:', JSON.stringify(response.data));

    res.status(200).send({ 
      status: 'success',
      message_id: response.data?.key?.id || 'unknown',
      data: response.data
    });
  } catch (error) {
    console.error('Error sending WhatsApp message:', error.response?.data || error.message);
    res.status(500).send({ 
      status: 'error', 
      message: error.message,
      details: error.response?.data
    });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`WhatsApp-GHL Middleware running on port ${PORT}`);
});
