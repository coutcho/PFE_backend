import express from 'express';
import pkg from 'pg';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
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
  limits: { fileSize: 200 * 1024 * 1024 }, // 10MB limit
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

// POST /api/home-values/ - Create a new home value request with image upload
router.post('/', authenticateToken, upload, async (req, res) => {
  const { address } = req.body;
  const images = req.files ? req.files.map(file => `/uploads/${file.filename}`) : [];
  const userId = req.user.id;

  if (!address) {
    return res.status(400).json({ message: 'Address is required' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO home_values (address, images, user_id, expert_id, created_at) VALUES ($1, $2, $3, NULL, NOW()) RETURNING *',
      [address, JSON.stringify(images), userId]
    );

    const formData = new FormData();
    formData.append('address', address);
    req.files.forEach(file => {
      formData.append('images', fs.createReadStream(file.path), file.originalname);
    });
    const externalEndpoint = 'https://example.com/api/receive-images';
    const externalResponse = await axios.post(externalEndpoint, formData, {
      headers: formData.getHeaders(),
    }).catch(err => {
      console.error('External endpoint error:', err.message);
      return { data: null };
    });

    res.status(200).json({
      message: 'Home value request submitted successfully',
      data: result.rows[0],
      externalResponse: externalResponse.data,
    });
  } catch (error) {
    console.error('Error processing home value:', error);
    res.status(500).json({ message: 'Failed to process home value request', error: error.message });
  }
});

// GET /api/home-values/user-and-expert - Fetch home value requests for users and experts
router.get('/user-and-expert', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const userRole = req.user.role;

  try {
    let query;
    if (userRole === 'expert') {
      query = await pool.query(
        `SELECT hv.*, u.fullname AS user_name
         FROM home_values hv
         LEFT JOIN users u ON hv.user_id = u.id
         WHERE hv.expert_id IS NULL OR hv.expert_id = $1
         ORDER BY hv.created_at DESC`,
        [userId]
      );
    } else {
      query = await pool.query(
        `SELECT hv.*, u.fullname AS user_name
         FROM home_values hv
         LEFT JOIN users u ON hv.user_id = u.id
         WHERE hv.user_id = $1
         ORDER BY hv.created_at DESC`,
        [userId]
      );
    }
    res.json(query.rows);
  } catch (error) {
    console.error('Error fetching home value requests:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/home-values/:id/validate - Validate/claim a home value request
router.post('/:id/validate', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  const userRole = req.user.role;

  if (userRole !== 'expert') {
    return res.status(403).json({ message: 'Access restricted to experts only' });
  }

  try {
    const result = await pool.query(
      'UPDATE home_values SET expert_id = $1 WHERE id = $2 AND expert_id IS NULL RETURNING *',
      [userId, id]
    );
    if (result.rowCount === 0) {
      return res.status(400).json({ message: 'Request already assigned or not found' });
    }
    res.json({ message: 'Request assigned to you', data: result.rows[0] });
  } catch (error) {
    console.error('Error validating home value request:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/home-values/:id - Delete a home value request
router.delete('/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  const userRole = req.user.role;

  try {
    await pool.query('BEGIN');

    const checkRequest = await pool.query(
      'SELECT user_id, expert_id FROM home_values WHERE id = $1',
      [id]
    );
    
    if (checkRequest.rowCount === 0) {
      await pool.query('ROLLBACK');
      return res.status(404).json({ message: 'Home value request not found' });
    }
    
    const request = checkRequest.rows[0];
    
    if (request.user_id !== userId && (userRole !== 'expert' || request.expert_id !== userId)) {
      await pool.query('ROLLBACK');
      return res.status(403).json({ 
        message: 'You do not have permission to delete this request'
      });
    }

    await pool.query('DELETE FROM messages WHERE home_value_id = $1', [id]);

    const result = await pool.query(
      'DELETE FROM home_values WHERE id = $1 RETURNING *',
      [id]
    );

    await pool.query('COMMIT');
    res.status(204).send();
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('Error deleting home value:', error);
    res.status(500).json({ message: 'Server error', details: error.message });
  }
});

// GET /api/home-values/:id/messages - Fetch messages for a home value request
router.get('/:id/messages', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  const userRole = req.user.role;

  try {
    const homeValueCheck = await pool.query(
      'SELECT user_id, expert_id FROM home_values WHERE id = $1',
      [id]
    );
    if (homeValueCheck.rowCount === 0) {
      return res.status(404).json({ message: 'Home value request not found' });
    }
    const { user_id, expert_id } = homeValueCheck.rows[0];
    if (userId !== user_id && userRole !== 'expert') {
      return res.status(403).json({ message: 'Access denied' });
    }
    if (userRole === 'expert' && expert_id !== null && expert_id !== userId) {
      return res.status(403).json({ message: 'Request assigned to another expert' });
    }

    const result = await pool.query(
      `SELECT m.*, 
              CASE WHEN m.sender_id = $2 THEN 'self' ELSE 'other' END AS message_type
       FROM messages m
       WHERE m.home_value_id = $1
       ORDER BY m.created_at ASC`,
      [id, userId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching home value messages:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/home-values/:id/messages - Send a message with optional images
router.post('/:id/messages', authenticateToken, upload, async (req, res) => {
  const { id } = req.params;
  const { message } = req.body;
  const userId = req.user.id;
  const userRole = req.user.role;
  const images = req.files ? req.files.map(file => `/uploads/${file.filename}`) : [];

  // Allow empty message if images are present
  if (!message && images.length === 0) {
    return res.status(400).json({ message: 'Message or images required' });
  }

  try {
    const homeValueCheck = await pool.query(
      'SELECT user_id, expert_id FROM home_values WHERE id = $1',
      [id]
    );
    if (homeValueCheck.rowCount === 0) {
      return res.status(404).json({ message: 'Home value request not found' });
    }
    const { user_id, expert_id } = homeValueCheck.rows[0];
    if (userId !== user_id && userRole !== 'expert') {
      return res.status(403).json({ message: 'Access denied' });
    }
    if (userRole === 'expert' && expert_id !== null && expert_id !== userId) {
      return res.status(403).json({ message: 'Request assigned to another expert' });
    }

    const result = await pool.query(
      'INSERT INTO messages (home_value_id, sender_id, message, images, created_at, is_read) VALUES ($1, $2, $3, $4, NOW(), FALSE) RETURNING *',
      [id, userId, message || '', JSON.stringify(images)]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error sending home value message:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;