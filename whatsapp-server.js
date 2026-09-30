require('dotenv').config();

const express = require('express');

const app = express();
const port = Number(process.env.PORT || 8787);
const graphVersion = process.env.WHATSAPP_GRAPH_VERSION || 'v21.0';
const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', process.env.FRONTEND_ORIGIN || '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});
app.use(express.json({ limit: '12mb' }));

app.get('/api/whatsapp/health', (req, res) => {
    res.json({ configured: Boolean(accessToken && phoneNumberId) });
});

app.post('/api/whatsapp/send', async (req, res) => {
    if (!accessToken || !phoneNumberId) {
        return res.status(503).json({ error: 'WhatsApp Cloud API is not configured on the server.' });
    }

    const { phone, message, fileName, pdfBase64 } = req.body || {};
    if (!phone || !message || !fileName || !pdfBase64) {
        return res.status(400).json({ error: 'phone, message, fileName, and pdfBase64 are required.' });
    }

    try {
        const graphUrl = `https://graph.facebook.com/${graphVersion}/${phoneNumberId}`;
        const pdfBuffer = Buffer.from(pdfBase64.replace(/^data:application\/pdf;base64,/, ''), 'base64');
        const form = new FormData();
        form.append('messaging_product', 'whatsapp');
        form.append('type', 'application/pdf');
        form.append('file', new Blob([pdfBuffer], { type: 'application/pdf' }), fileName);

        const uploadResponse = await fetch(`${graphUrl}/media`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}` },
            body: form
        });
        const uploadResult = await uploadResponse.json();
        if (!uploadResponse.ok || !uploadResult.id) {
            return res.status(502).json({ error: uploadResult.error?.message || 'WhatsApp media upload failed.' });
        }

        const sendResponse = await fetch(`${graphUrl}/messages`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                to: String(phone),
                type: 'document',
                document: { id: uploadResult.id, caption: message, filename: fileName }
            })
        });
        const sendResult = await sendResponse.json();
        if (!sendResponse.ok) {
            return res.status(502).json({ error: sendResult.error?.message || 'WhatsApp message failed.' });
        }

        res.json({ sent: true, messageId: sendResult.messages?.[0]?.id || null });
    } catch (error) {
        console.error('WhatsApp API error:', error);
        res.status(500).json({ error: 'Unable to contact WhatsApp Cloud API.' });
    }
});

app.listen(port, () => {
    console.log(`WhatsApp sender listening on http://localhost:${port}`);
});