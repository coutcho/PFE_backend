import express from 'express';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import pool from './db.js';

const router = express.Router();

// Multer setup for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'public/uploads/'),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = multer({ storage }).array('images', 10);

// Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'Authentication required' });

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ message: 'Invalid or expired token' });
    req.user = user;
    next();
  });
};

// --- Routes ---

// GET /api/properties - Fetch properties with optional filters
router.get('/', async (req, res) => {
  const { type, status, include_sold } = req.query;
  try {
    let query = `
      SELECT id, title, price, location, type, bedrooms, bathrooms, etage,
             square_footage, description, features, status, lat, long,
             images_path, equipe AS equipped, user_id AS agent_id, created_at
      FROM properties
    `;
    const values = [];
    const conditions = [];

    if (type) {
      conditions.push(`type = $${values.length + 1}`);
      values.push(type);
    }

    if (include_sold !== 'true') {
      if (status) {
        conditions.push(`TRIM(LOWER(status)) = $${values.length + 1}`);
        values.push(status.toLowerCase().trim());
      } else {
        conditions.push(`TRIM(LOWER(status)) != $${values.length + 1}`);
        values.push('sold');
      }
    }

    if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');

    const result = await pool.query(query, values);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching properties:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/properties/favorites - Authenticated user's favorites
router.get('/favorites', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await pool.query(`
      SELECT p.id, p.title, p.price, p.location, p.type, p.bedrooms, p.bathrooms, p.etage,
             p.square_footage, p.description, p.features, p.status, p.lat, p.long,
             p.images_path, p.equipe AS equipped, p.user_id AS agent_id, p.created_at
      FROM properties p
      JOIN favorites f ON p.id = f.property_id
      WHERE f.user_id = $1 AND LOWER(p.status) != $2
    `, [userId, 'sold']);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching favorites:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/properties/:id - Single property
router.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ message: 'Invalid property ID' });

  try {
    const result = await pool.query(`
      SELECT id, title, price, location, type, bedrooms, bathrooms, etage,
             square_footage, description, features, status, lat, long,
             images_path, equipe AS equipped, user_id AS agent_id, created_at
      FROM properties WHERE id = $1
    `, [id]);

    if (!result.rows[0]) return res.status(404).json({ message: 'Property not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching property:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/properties - Add property
router.post('/', authenticateToken, upload, async (req, res) => {
  const { title, price, location, type, bedrooms, bathrooms, etage, square_footage, description, features, status, lat, long, equipped, agent_id } = req.body;
  const images_path = req.files?.map(f => `/uploads/${f.filename}`) || [];

  try {
    const parsedFeatures = typeof features === 'string' ? JSON.parse(features) : features;
    const parsedEquipped = equipped === 'true';
    const parsedAgentId = agent_id ? parseInt(agent_id) : null;

    const result = await pool.query(`
      INSERT INTO properties (title, price, location, type, bedrooms, bathrooms, etage, square_footage, description, features, status, lat, long, images_path, equipe, user_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      RETURNING id, title, price, location, type, bedrooms, bathrooms, etage, square_footage, description, features, status, lat, long, images_path, equipe AS equipped, user_id AS agent_id, created_at
    `, [
      title, parseInt(price), location, type, parseInt(bedrooms),
      type === 'villa' && bathrooms ? parseInt(bathrooms) : null,
      type !== 'villa' && etage ? parseInt(etage) : null,
      parseInt(square_footage), description, parsedFeatures, status,
      lat ? parseFloat(lat) : null, long ? parseFloat(long) : null,
      JSON.stringify(images_path), parsedEquipped, parsedAgentId
    ]);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error adding property:', err);
    if (err.code === '23503') return res.status(400).json({ error: 'Invalid agent ID' });
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/properties/:id - Update property
router.put('/:id', authenticateToken, upload, async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ message: 'Invalid property ID' });

  const { title, price, location, type, bedrooms, bathrooms, etage, square_footage, description, features, status, lat, long, images_path, equipped, agent_id } = req.body;

  try {
    // Only update status if that’s the only field
    if (status && Object.keys(req.body).length === 1) {
      if (!['Active','Pending','Sold','For Rent'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
      }
      const statusUpdate = await pool.query('UPDATE properties SET status=$1 WHERE id=$2 RETURNING *', [status, id]);
      if (!statusUpdate.rows[0]) return res.status(404).json({ error: 'Property not found' });
      return res.json({ message: 'Status updated', property: statusUpdate.rows[0] });
    }

    const existingImages = images_path ? JSON.parse(images_path) : [];
    const newImages = req.files?.map(f => `/uploads/${f.filename}`) || [];
    const updatedImages = [...existingImages, ...newImages];

    const parsedFeatures = typeof features === 'string' ? JSON.parse(features) : features;
    const parsedEquipped = equipped === 'true';
    const parsedAgentId = agent_id ? parseInt(agent_id) : null;

    const updateResult = await pool.query(`
      UPDATE properties SET title=$1, price=$2, location=$3, type=$4, bedrooms=$5, bathrooms=$6, etage=$7,
      square_footage=$8, description=$9, features=$10, status=$11, lat=$12, long=$13, images_path=$14, equipe=$15, user_id=$16
      WHERE id=$17 RETURNING *
    `, [
      title, parseInt(price), location, type, parseInt(bedrooms),
      type === 'villa' && bathrooms ? parseInt(bathrooms) : null,
      type !== 'villa' && etage ? parseInt(etage) : null,
      parseInt(square_footage), description, parsedFeatures, status,
      lat ? parseFloat(lat) : null, long ? parseFloat(long) : null,
      JSON.stringify(updatedImages), parsedEquipped, parsedAgentId, id
    ]);

    if (!updateResult.rows[0]) return res.status(404).json({ error: 'Property not found' });
    res.json(updateResult.rows[0]);
  } catch (err) {
    console.error('Error updating property:', err);
    if (err.code === '23503') return res.status(400).json({ error: 'Invalid agent ID' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/properties/:id - Delete property
router.delete('/:id', authenticateToken, async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ message: 'Invalid property ID' });

  try {
    const result = await pool.query('DELETE FROM properties WHERE id=$1 RETURNING *', [id]);
    if (!result.rows[0]) return res.status(404).json({ message: 'Property not found' });
    res.status(204).send();
  } catch (err) {
    console.error('Error deleting property:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/properties/favorites - Add favorite
router.post('/favorites', authenticateToken, async (req, res) => {
  const propertyId = parseInt(req.body.propertyId);
  if (isNaN(propertyId)) return res.status(400).json({ error: 'Invalid property ID' });

  const userId = req.user.id;
  try {
    const check = await pool.query('SELECT COUNT(*) FROM favorites WHERE user_id=$1 AND property_id=$2', [userId, propertyId]);
    if (parseInt(check.rows[0].count) > 0) return res.status(400).json({ error: 'Favorite already exists' });

    await pool.query('INSERT INTO favorites (user_id, property_id) VALUES ($1,$2)', [userId, propertyId]);
    res.status(201).json({ message: 'Favorite added' });
  } catch (err) {
    console.error('Error adding favorite:', err);
    if (err.code === '23503') return res.status(400).json({ error: 'Property not found' });
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/properties/favorites/:propertyId - Remove favorite
router.delete('/favorites/:propertyId', authenticateToken, async (req, res) => {
  const propertyId = parseInt(req.params.propertyId);
  if (isNaN(propertyId)) return res.status(400).json({ error: 'Invalid property ID' });

  const userId = req.user.id;
  try {
    const result = await pool.query('DELETE FROM favorites WHERE user_id=$1 AND property_id=$2', [userId, propertyId]);
    if (result.rowCount === 0) return res.status(404).json({ message: 'Favorite not found' });
    res.json({ message: 'Favorite removed' });
  } catch (err) {
    console.error('Error removing favorite:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
