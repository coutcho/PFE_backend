import express from 'express';
import pkg from 'pg';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import path from 'path';
import pool from './db.js'

const router = express.Router();

// Multer configuration for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'public/uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed'), false);
    }
    cb(null, true);
  },
}).array('images', 10);

// Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'Authentication required' });

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ message: 'Invalid or expired token' });
    req.user = user;
    next();
  });
};

// POST /api/inquiries - Create an inquiry and add the message to the messages table
router.post('/', authenticateToken, async (req, res) => {
  const {
    property_id,
    agent_id,
    full_name,
    email,
    phone,
    message,
    tour_date,
    tour_time,
    avec_vtc,
  } = req.body;
  const user_id = req.user.id;
  const status = 'pending';

  try {
    await pool.query('BEGIN');

    const inquiryResult = await pool.query(
      `INSERT INTO inquiries (property_id, user_id, agent_id, full_name, email, phone, message, tour_date, tour_time, avec_vtc, created_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), $11)
       RETURNING *`,
      [
        property_id,
        user_id,
        agent_id || null,
        full_name,
        email,
        phone || null,
        message,
        tour_date || null,
        tour_time || null,
        avec_vtc || false,
        status,
      ]
    );

    const newInquiry = inquiryResult.rows[0];

    const messageResult = await pool.query(
      `INSERT INTO messages (inquiry_id, sender_id, message, created_at)
       VALUES ($1, $2, $3, NOW())
       RETURNING *`,
      [newInquiry.id, user_id, message]
    );

    console.log('Inserted inquiry:', newInquiry);
    console.log('Inserted initial message:', messageResult.rows[0]);

    await pool.query('COMMIT');

    res.status(201).json(newInquiry);
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error('Error saving inquiry:', err);
    if (err.code === '23503') {
      return res.status(400).json({ error: 'Invalid property_id, user_id, or agent_id' });
    }
    res.status(500).json({ error: err.message });
  }
});

// POST /api/inquiries/:id/messages - Send a message with optional images
router.post('/:id/messages', authenticateToken, upload, async (req, res) => {
  const { id } = req.params; // inquiry_id
  const { message } = req.body; // Text message from FormData
  const sender_id = req.user.id;
  const images = req.files ? req.files.map(file => `/uploads/${file.filename}`) : [];

  // Allow empty message if images are present
  if (!message && images.length === 0) {
    return res.status(400).json({ error: 'Message or images required' });
  }

  try {
    // Check if inquiry exists and user is authorized
    const inquiryResult = await pool.query(
      'SELECT user_id, agent_id FROM inquiries WHERE id = $1',
      [id]
    );
    if (inquiryResult.rows.length === 0) {
      return res.status(404).json({ error: 'Inquiry not found' });
    }
    const inquiry = inquiryResult.rows[0];
    if (inquiry.user_id !== sender_id && inquiry.agent_id !== sender_id) {
      return res.status(403).json({ error: 'Unauthorized to send message' });
    }

    // Insert message with images
    const messageResult = await pool.query(
      `INSERT INTO messages (inquiry_id, sender_id, message, images, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING *`,
      [id, sender_id, message || '', JSON.stringify(images)]
    );

    // Update inquiry status to 'in_progress' if agent responds
    if (inquiry.agent_id === sender_id) {
      await pool.query(
        'UPDATE inquiries SET status = $1 WHERE id = $2',
        ['in_progress', id]
      );
    }

    console.log('Inserted message:', messageResult.rows[0]);
    res.status(201).json(messageResult.rows[0]);
  } catch (err) {
    console.error('Error sending message:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/inquiries/:id/messages - Fetch messages for an inquiry
router.get('/:id/messages', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const user_id = req.user.id;

  try {
    const inquiryResult = await pool.query(
      'SELECT user_id, agent_id FROM inquiries WHERE id = $1',
      [id]
    );
    if (inquiryResult.rows.length === 0) {
      return res.status(404).json({ error: 'Inquiry not found' });
    }
    const inquiry = inquiryResult.rows[0];
    if (inquiry.user_id !== user_id && inquiry.agent_id !== user_id) {
      return res.status(403).json({ error: 'Unauthorized to view messages' });
    }

    const result = await pool.query(
      `SELECT 
        m.id, 
        m.inquiry_id, 
        m.sender_id, 
        m.message, 
        m.images,
        m.created_at, 
        m.is_read,
        CASE 
          WHEN m.sender_id = $1 THEN 'self'
          WHEN m.sender_id = i.agent_id THEN 'agent'
          WHEN m.sender_id = i.user_id THEN 'user'
          ELSE 'other'
        END AS message_type
       FROM messages m
       JOIN inquiries i ON m.inquiry_id = i.id
       WHERE m.inquiry_id = $2 
       ORDER BY m.created_at ASC`,
      [user_id, id]
    );

    await pool.query(
      `UPDATE messages 
       SET is_read = true 
       WHERE inquiry_id = $1 
       AND sender_id != $2 
       AND is_read = false`,
      [id, user_id]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching messages:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/inquiries/:id - Fetch inquiry details
router.get('/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const user_id = req.user.id;

  try {
    const result = await pool.query(
      'SELECT * FROM inquiries WHERE id = $1',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Inquiry not found' });
    }
    const inquiry = result.rows[0];
    if (inquiry.user_id !== user_id && inquiry.agent_id !== user_id) {
      return res.status(403).json({ error: 'Unauthorized to view inquiry' });
    }
    res.json(inquiry);
  } catch (err) {
    console.error('Error fetching inquiry:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/inquiries/:id - Delete an inquiry and its messages
router.delete('/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const user_id = req.user.id;

  try {
    const inquiryResult = await pool.query(
      'SELECT user_id, agent_id FROM inquiries WHERE id = $1',
      [id]
    );
    if (inquiryResult.rows.length === 0) {
      return res.status(404).json({ error: 'Inquiry not found' });
    }
    const inquiry = inquiryResult.rows[0];
    if (inquiry.user_id !== user_id && inquiry.agent_id !== user_id) {
      return res.status(403).json({ error: 'Unauthorized to delete inquiry' });
    }

    await pool.query('DELETE FROM messages WHERE inquiry_id = $1', [id]);

    const deleteResult = await pool.query(
      'DELETE FROM inquiries WHERE id = $1 RETURNING *',
      [id]
    );

    console.log('Deleted inquiry:', deleteResult.rows[0]);
    res.status(200).json({ message: 'Inquiry and associated messages deleted successfully' });
  } catch (err) {
    console.error('Error deleting inquiry:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/inquiries/user/inquiries - Fetch user's inquiries (as user or agent)
router.get('/user/inquiries', authenticateToken, async (req, res) => {
  const user_id = req.user.id;

  try {
    const result = await pool.query(
      `SELECT i.*, 
              p.title AS property_title, 
              u.fullname AS agent_name,
              CASE
                WHEN i.user_id = $1 THEN 'user'
                WHEN i.agent_id = $1 THEN 'agent'
              END AS role
       FROM inquiries i
       LEFT JOIN properties p ON i.property_id = p.id
       LEFT JOIN users u ON i.agent_id = u.id
       WHERE i.user_id = $1 OR i.agent_id = $1
       ORDER BY i.created_at DESC`,
      [user_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching user inquiries:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/inquiries/user/unread-count - Fetch unread message count
router.get('/user/unread-count', authenticateToken, async (req, res) => {
  const user_id = req.user.id;

  try {
    const result = await pool.query(
      `SELECT COUNT(*) AS unread_count
       FROM messages m
       JOIN inquiries i ON m.inquiry_id = i.id
       WHERE m.is_read = false
       AND m.sender_id != $1
       AND (i.user_id = $1 OR i.agent_id = $1)`,
      [user_id]
    );

    const unreadCount = parseInt(result.rows[0].unread_count, 10);
    res.json({ unreadCount });
  } catch (err) {
    console.error('Error fetching unread count:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;