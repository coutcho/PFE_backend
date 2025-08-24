import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import pkg from 'pg';
import pool from './db.js'

const router = express.Router();


// Middleware to verify JWT token and admin role
const authenticateAdmin = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'Authentication required' });

  jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key', (err, user) => {
    if (err) return res.status(403).json({ message: 'Invalid or expired token' });
    if (user.role !== 'admin') return res.status(403).json({ message: 'Admin access required' });
    req.user = user;
    next();
  });
};

// Middleware to verify JWT token for any authenticated user
const authenticateUser = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'Authentication required' });

  jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key', (err, user) => {
    if (err) return res.status(403).json({ message: 'Invalid or expired token' });
    req.user = user;
    next();
  });
};

// Validate role is one of the allowed values
const validateRole = (role) => {
  const allowedRoles = ['admin', 'expert', 'agent'];
  return allowedRoles.includes(role);
};

// Get all users (admin only)
router.get('/', authenticateAdmin, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, fullname AS name, email, role, phone, join_date AS joinDate FROM users');
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching users:', err);
    res.status(500).json({ message: 'Failed to fetch users', error: err.message });
  }
});

// Get all agents (requires authentication)
router.get('/agents', authenticateUser, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, fullname AS name, email, phone FROM users WHERE role = $1',
      ['agent']
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching agents:', err);
    res.status(500).json({ message: 'Failed to fetch agents', error: err.message });
  }
});

// Get a specific agent by ID (publicly accessible)
router.get('/agents/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      'SELECT id, fullname AS name, email, phone FROM users WHERE id = $1 AND role = $2',
      [id, 'agent']
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Agent not found' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching agent:', err);
    res.status(500).json({ message: 'Failed to fetch agent', error: err.message });
  }
});

// Get current user info (requires authentication)
router.get('/me', authenticateUser, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, email, fullname, role, phone FROM users WHERE id = $1',
      [req.user.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching user info:', err);
    res.status(500).json({ error: err.message });
  }
});

// Update current user info (requires authentication)
router.put('/me', authenticateUser, async (req, res) => {
  const { fullName, email, phone, password } = req.body;
  
  try {
    // Check if email is already used by another user
    if (email) {
      const existingEmail = await pool.query(
        'SELECT * FROM users WHERE email = $1 AND id != $2',
        [email, req.user.id]
      );
      if (existingEmail.rows.length > 0) {
        return res.status(400).json({ message: 'Email address already in use by another user' });
      }
    }
    
    // Build the update query
    let query = 'UPDATE users SET ';
    const values = [];
    const updateFields = [];
    
    if (fullName) {
      values.push(fullName);
      updateFields.push(`fullname = $${values.length}`);
    }
    
    if (email) {
      values.push(email);
      updateFields.push(`email = $${values.length}`);
    }
    
    if (phone) {
      values.push(phone);
      updateFields.push(`phone = $${values.length}`);
    }
    
    if (password && password.trim() !== '') {
      const hashedPassword = await bcrypt.hash(password, 10);
      values.push(hashedPassword);
      updateFields.push(`pass = $${values.length}`);
    }
    
    if (updateFields.length === 0) {
      const result = await pool.query(
        'SELECT id, fullname, email, role, phone FROM users WHERE id = $1',
        [req.user.id]
      );
      return res.json(result.rows[0]);
    }
    
    query += updateFields.join(', ');
    query += ' WHERE id = $' + (values.length + 1);
    query += ' RETURNING id, fullname, email, role, phone';
    
    values.push(req.user.id);
    
    const result = await pool.query(query, values);
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating user:', err);
    if (err.code === '23505') {
      if (err.constraint === 'users_email_key') {
        return res.status(400).json({ message: 'Email address already in use' });
      }
    }
    res.status(500).json({ message: 'Failed to update user', error: err.message });
  }
});

// Add a new user (admin only)
router.post('/', authenticateAdmin, async (req, res) => {
  const { name, email, role, phone, joinDate, password } = req.body;
  
  try {
    if (!validateRole(role)) {
      return res.status(400).json({ message: 'Invalid role. Must be admin, expert, or agent' });
    }
    
    const existingUser = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ message: 'Email address already in use' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const result = await pool.query(
      'INSERT INTO users (fullname, email, pass, role, phone, join_date) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, fullname AS name, email, role, phone, join_date AS joinDate',
      [name, email, hashedPassword, role, phone, joinDate]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error adding user:', err);
    if (err.code === '23505') {
      if (err.constraint === 'users_email_key') {
        return res.status(400).json({ message: 'Email address already in use' });
      }
    }
    res.status(500).json({ message: 'Failed to add user', error: err.message });
  }
});

// Update a user (admin only)
router.put('/:id', authenticateAdmin, async (req, res) => {
  const { id } = req.params;
  const { name, email, role, phone, joinDate, password } = req.body;
  
  try {
    if (role && !validateRole(role)) {
      return res.status(400).json({ message: 'Invalid role. Must be admin, expert, or agent' });
    }
    
    const userExists = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    if (userExists.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    if (email) {
      const existingEmail = await pool.query('SELECT * FROM users WHERE email = $1 AND id != $2', [email, id]);
      if (existingEmail.rows.length > 0) {
        return res.status(400).json({ message: 'Email address already in use by another user' });
      }
    }
    
    let query = 'UPDATE users SET ';
    const values = [];
    const updateFields = [];
    
    if (name) {
      values.push(name);
      updateFields.push(`fullname = $${values.length}`);
    }
    
    if (email) {
      values.push(email);
      updateFields.push(`email = $${values.length}`);
    }
    
    if (role) {
      values.push(role);
      updateFields.push(`role = $${values.length}`);
    }
    
    if (phone) {
      values.push(phone);
      updateFields.push(`phone = $${values.length}`);
    }
    
    if (joinDate) {
      values.push(joinDate);
      updateFields.push(`join_date = $${values.length}`);
    }
    
    if (password && password.trim() !== '') {
      const hashedPassword = await bcrypt.hash(password, 10);
      values.push(hashedPassword);
      updateFields.push(`pass = $${values.length}`);
    }
    
    if (updateFields.length === 0) {
      const result = await pool.query(
        'SELECT id, fullname AS name, email, role, phone, join_date AS joinDate FROM users WHERE id = $1',
        [id]
      );
      return res.json(result.rows[0]);
    }
    
    query += updateFields.join(', ');
    query += ' WHERE id = $' + (values.length + 1);
    query += ' RETURNING id, fullname AS name, email, role, phone, join_date AS joinDate';
    
    values.push(id);
    
    const result = await pool.query(query, values);
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating user:', err);
    if (err.code === '23505') {
      if (err.constraint === 'users_email_key') {
        return res.status(400).json({ message: 'Email address already in use' });
      }
    }
    res.status(500).json({ message: 'Failed to update user', error: err.message });
  }
});

// Delete a user (admin only)
router.delete('/:id', authenticateAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM users WHERE id = $1 RETURNING id', [id]);
    if (result.rowCount === 0) return res.status(404).json({ message: 'User not found' });
    res.status(204).send();
  } catch (err) {
    console.error('Error deleting user:', err);
    res.status(500).json({ message: 'Failed to delete user', error: err.message });
  }
});

export default router;