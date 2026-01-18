const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const PORT = 5000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set. Did you forget to provision a database?');
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function initDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS shipments (
        id SERIAL PRIMARY KEY,
        tracking_number TEXT UNIQUE NOT NULL,
        sender_name TEXT,
        sender_address TEXT,
        recipient_name TEXT,
        recipient_address TEXT,
        recipient_phone TEXT,
        status TEXT DEFAULT 'pending',
        current_location TEXT,
        estimated_delivery TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tracking_updates (
        id SERIAL PRIMARY KEY,
        shipment_id INTEGER REFERENCES shipments(id),
        status TEXT,
        location TEXT,
        description TEXT,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('Database schema ready');
  } catch (err) {
    console.error('Error initializing database:', err.message);
  }
}

initDatabase();

// Utility for generating UPS-style tracking numbers
function generateTrackingNumber() {
    const chars = '1234567890ABCDEFGHIJKLMNPQRSTUVWXYZ';
    let result = 'GL-';
    for (let i = 0; i < 10; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// Mock notification functions - Ready for scaling
async function sendEmailNotification(to, subject, body) {
    console.log(`[EMAIL SIMULATION] To: ${to}, Subject: ${subject}, Body: ${body}`);
    // Future: Integrate SendGrid
}

async function sendWhatsAppUpdate(phone, message) {
    console.log(`[WHATSAPP SIMULATION] To: ${phone}, Message: ${message}`);
    // Future: Integrate Twilio WhatsApp API
}

app.get('/api/maps-key', (req, res) => {
  res.json({ key: process.env.GOOGLE_MAPS_API_KEY });
});

app.get('/api/track/:trackingNumber', async (req, res) => {
  const { trackingNumber } = req.params;
  try {
    const shipmentResult = await pool.query('SELECT * FROM shipments WHERE tracking_number = $1', [trackingNumber]);
    if (shipmentResult.rows.length === 0) return res.status(404).json({ error: 'Shipment not found' });
    
    const shipment = shipmentResult.rows[0];
    const updatesResult = await pool.query('SELECT * FROM tracking_updates WHERE shipment_id = $1 ORDER BY timestamp DESC', [shipment.id]);
    res.json({ shipment, updates: updatesResult.rows });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/shipments', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM shipments ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/shipments', async (req, res) => {
  const { sender_name, sender_address, recipient_name, recipient_address, recipient_phone, estimated_delivery } = req.body;
  const tracking_number = generateTrackingNumber();
  
  try {
    const result = await pool.query(`
      INSERT INTO shipments (tracking_number, sender_name, sender_address, recipient_name, recipient_address, recipient_phone, estimated_delivery, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [tracking_number, sender_name, 'N/A', recipient_name, recipient_address, recipient_phone, estimated_delivery, 'pending']);
    
    const shipment = result.rows[0];
    await pool.query(`INSERT INTO tracking_updates (shipment_id, status, description) VALUES ($1, $2, $3)`, 
        [shipment.id, 'pending', 'Shipment order received and processing.']);

    // Send initial notifications
    if (recipient_phone) {
        sendWhatsAppUpdate(recipient_phone, `Your GlobalLogistics shipment ${tracking_number} has been created! Track here: ${req.get('host')}`);
    }

    res.json(shipment);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/shipments/:id', async (req, res) => {
  const { id } = req.params;
  const { status, current_location, description } = req.body;
  
  try {
    await pool.query(`UPDATE shipments SET status = $1, current_location = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3`, 
        [status, current_location, id]);
    
    await pool.query(`INSERT INTO tracking_updates (shipment_id, status, location, description) VALUES ($1, $2, $3, $4)`, 
        [id, status, current_location, description]);
    
    const shipment = (await pool.query('SELECT * FROM shipments WHERE id = $1', [id])).rows[0];
    if (shipment.recipient_phone) {
        sendWhatsAppUpdate(shipment.recipient_phone, `GlobalLogistics Update: Your package ${shipment.tracking_number} is now ${status}. ${description}`);
    }

    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/alerts/signup', async (req, res) => {
  const { shipmentId, contact } = req.body;
  console.log(`[ALERT SIGNUP] Shipment: ${shipmentId}, Contact: ${contact}`);
  // In a real app, you'd save this to a 'notifications' table
  res.json({ success: true });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
