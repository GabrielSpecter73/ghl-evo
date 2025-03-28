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
    
    // Log todos os campos para depuração
    console.log('Request body fields:', Object.keys(req.body));
    
    // Extrai os campos, aceitando 'to' ou 'phone' para o número
    const { message, mediaUrl, type } = req.body;
    const to = req.body.to || req.body.phone; // Aceitar qualquer um dos campos

    console.log('Destination number:', to);

    // Validação de entrada aprimorada
    if (!to) {
      console.log('Missing required field: to/phone');
      return res.status(400).send({ 
        status: 'error', 
        message: 'Missing required field: to/phone' 
      });
    }

    if (!message && !mediaUrl) {
      console.log('Missing both message and mediaUrl');
      return res.status(400).send({ 
        status: 'error', 
        message: 'Missing required fields: either message or mediaUrl must be provided' 
      });
    }

    // Format phone number for WhatsApp (remove + and ensure proper format)
    let formattedNumber = to;
    if (formattedNumber.startsWith('+')) {
      formattedNumber = formattedNumber.substring(1);
    }

    // Remove any non-digit characters
    formattedNumber = formattedNumber.replace(/\D/g, '');
    console.log('Formatted number:', formattedNumber);

    // Create request for Evolution API
    const requestData = {
      number: `${formattedNumber}@s.whatsapp.net`,
      options: {
        delay: 1200,
        presence: 'composing'
      }
    };

    console.log('Preparing Evolution API request data:', JSON.stringify(requestData));

    let response;

    // Se o tipo de mídia for texto
    if (mediaUrl) {
      // Código para enviar mídia (ajuste o formato da URL também)
      const mediaApiUrl = `${EVOLUTION_API_URL}/message/sendMedia/${EVOLUTION_API_INSTANCE}`;
      console.log('URL para enviar mídia:', mediaApiUrl);

      requestData.caption = message || '';
      
      response = await axios.post(
        mediaApiUrl,
        requestData,
        { headers: { 'apikey': EVOLUTION_API_KEY } }
      );
    } else {
      // Código para enviar texto
      const textApiUrl = `${EVOLUTION_API_URL}/message/sendText/${EVOLUTION_API_INSTANCE}`;
      console.log('URL para enviar texto:', textApiUrl);
      
      // Modificar o formato do requestData para alinhar com a documentação
      const textRequestData = {
        number: requestData.number,
        text: message,
        delay: requestData.options?.delay || 1000
      };
      
      console.log('Enviando mensagem de texto:', JSON.stringify(textRequestData));
      
      response = await axios.post(
        textApiUrl,
        textRequestData,
        { headers: { 'apikey': EVOLUTION_API_KEY } }
      );
    }

    console.log('Evolution API response:', JSON.stringify(response.data));

    // Retornar uma resposta formatada de acordo com o que o GHL espera
    res.status(200).send({ 
      status: 'success',
      message_id: response.data?.key?.id || 'unknown',
      messageId: response.data?.key?.id || 'unknown', // Adicione isso para compatibilidade
      id: response.data?.key?.id || 'unknown', // Adicione isso para compatibilidade
      type: 'whatsapp', // Adicione o tipo da mensagem
      data: response.data
    });
  } catch (error) {
    console.error('Error sending WhatsApp message:', error);
    console.error('Error details:', error.response?.data || error.message);
    
    res.status(500).send({ 
      status: 'error', 
      message: error.message,
      details: error.response?.data
    });
  }
});

// Endpoint para receber webhooks do GoHighLevel
app.post('/webhook/ghl', async (req, res) => {
  try {
    console.log('Received webhook from GoHighLevel:', JSON.stringify(req.body));
    
    // Aqui você pode processar diferentes tipos de eventos
    // Exemplo de estrutura básica para processar eventos
    const eventData = req.body;
    
    // Identificar o tipo de evento (se disponível na estrutura de dados)
    const eventType = eventData.type || eventData.eventType || 'unknown';
    
    console.log(`Processing GHL webhook event type: ${eventType}`);
    
    // Processar diferentes tipos de eventos
    switch(eventType) {
      case 'ContactCreate':
      case 'ContactUpdate':
      case 'ContactTagUpdate':
        // Lógica específica para eventos de contato
        console.log('Contact event received:', eventData);
        break;
        
      // Adicionar outros casos conforme necessário
      
      default:
        console.log('Unhandled event type:', eventType);
        break;
    }
    
    // Sempre responda ao webhook rapidamente
    res.status(200).send({ status: 'success' });
  } catch (error) {
    console.error('Error processing GHL webhook:', error);
    res.status(500).send({ status: 'error', message: error.message });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`WhatsApp-GHL Middleware running on port ${PORT}`);
});
