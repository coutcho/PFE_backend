import express from 'express';
import pkg from 'pg';
import jwt from 'jsonwebtoken';
import pool from './db.js'

const router = express.Router();




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

const isAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access required' });
  }
  next();
};

// Property Analytics
router.get('/properties/total', authenticateToken, isAdmin, async (req, res) => {
  try {
    const result = await pool.query('SELECT COUNT(*) FROM properties');
    res.json({ totalProperties: parseInt(result.rows[0].count, 10) || 0 });
  } catch (err) {
    console.error('Error fetching total properties:', err.stack);
    res.status(500).json({ error: 'Failed to fetch total properties', details: err.message });
  }
});

router.get('/properties/by-type', authenticateToken, isAdmin, async (req, res) => {
  try {
    const result = await pool.query('SELECT type, COUNT(*) as count FROM properties GROUP BY type');
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching properties by type:', err.stack);
    res.status(500).json({ error: 'Failed to fetch properties by type', details: err.message });
  }
});

router.get('/properties/by-status', authenticateToken, isAdmin, async (req, res) => {
  try {
    const result = await pool.query('SELECT status, COUNT(*) as count FROM properties GROUP BY status');
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching properties by status:', err.stack);
    res.status(500).json({ error: 'Failed to fetch properties by status', details: err.message });
  }
});

router.get('/properties/by-location', authenticateToken, isAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        CASE 
          WHEN LOWER(location) LIKE '%adrar%' THEN 'Adrar'
          WHEN LOWER(location) LIKE '%chlef%' THEN 'Chlef'
          WHEN LOWER(location) LIKE '%laghouat%' THEN 'Laghouat'
          WHEN LOWER(location) LIKE '%oum el bouaghi%' THEN 'Oum El Bouaghi'
          WHEN LOWER(location) LIKE '%batna%' THEN 'Batna'
          WHEN LOWER(location) LIKE '%béjaïa%' THEN 'Béjaïa'
          WHEN LOWER(location) LIKE '%biskra%' THEN 'Biskra'
          WHEN LOWER(location) LIKE '%béchar%' THEN 'Béchar'
          WHEN LOWER(location) LIKE '%blida%' THEN 'Blida'
          WHEN LOWER(location) LIKE '%algiers%' THEN 'Algiers'
          ELSE 'Others'
        END AS location,
        COUNT(*) as count 
      FROM properties 
      GROUP BY 
        CASE 
          WHEN LOWER(location) LIKE '%adrar%' THEN 'Adrar'
          WHEN LOWER(location) LIKE '%chlef%' THEN 'Chlef'
          WHEN LOWER(location) LIKE '%laghouat%' THEN 'Laghouat'
          WHEN LOWER(location) LIKE '%oum el bouaghi%' THEN 'Oum El Bouaghi'
          WHEN LOWER(location) LIKE '%batna%' THEN 'Batna'
          WHEN LOWER(location) LIKE '%béjaïa%' THEN 'Béjaïa'
          WHEN LOWER(location) LIKE '%biskra%' THEN 'Biskra'
          WHEN LOWER(location) LIKE '%béchar%' THEN 'Béchar'
          WHEN LOWER(location) LIKE '%blida%' THEN 'Blida'
          WHEN LOWER(location) LIKE '%algiers%' THEN 'Algiers'
          ELSE 'Others'
        END
    `);
    console.log('Properties by location raw data:', result.rows);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching properties by location:', err.stack);
    res.status(500).json({ error: 'Failed to fetch properties by location', details: err.message });
  }
});

router.get('/properties/average-price', authenticateToken, isAdmin, async (req, res) => {
  try {
    const result = await pool.query('SELECT AVG(price) as averageprice FROM properties');
    res.json({ averagePrice: parseFloat(result.rows[0].averageprice) || 0 });
  } catch (err) {
    console.error('Error fetching average price:', err.stack);
    res.status(500).json({ error: 'Failed to fetch average price', details: err.message });
  }
});

router.get('/properties/price-trends', authenticateToken, isAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DATE_TRUNC('month', created_at) as month, AVG(price) as averageprice
      FROM properties
      GROUP BY month
      ORDER BY month
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching price trends:', err.stack);
    res.status(500).json({ error: 'Failed to fetch price trends', details: err.message });
  }
});

router.get('/properties/new-over-time', authenticateToken, isAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DATE_TRUNC('month', created_at) as month, COUNT(*) as count
      FROM properties
      GROUP BY month
      ORDER BY month
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching new properties over time:', err.stack);
    res.status(500).json({ error: 'Failed to fetch new properties over time', details: err.message });
  }
});

router.get('/properties/per-agent', authenticateToken, isAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.fullname as agentname, COUNT(p.id) as propertycount
      FROM users u
      LEFT JOIN properties p ON u.id = p.user_id
      WHERE u.role = 'agent'
      GROUP BY u.fullname
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching properties per agent:', err.stack);
    res.status(500).json({ error: 'Failed to fetch properties per agent', details: err.message });
  }
});

// User Analytics
router.get('/users/total', authenticateToken, isAdmin, async (req, res) => {
  try {
    const result = await pool.query("SELECT COUNT(*) FROM users WHERE role = 'user'");
    res.json({ totalUsers: parseInt(result.rows[0].count, 10) || 0 });
  } catch (err) {
    console.error('Error fetching total users:', err.stack);
    res.status(500).json({ error: 'Failed to fetch total users', details: err.message });
  }
});

router.get('/users/by-role', authenticateToken, isAdmin, async (req, res) => {
  try {
    const result = await pool.query('SELECT role, COUNT(*) as count FROM users GROUP BY role');
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching users by role:', err.stack);
    res.status(500).json({ error: 'Failed to fetch users by role', details: err.message });
  }
});

router.get('/users/new-over-time', authenticateToken, isAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DATE_TRUNC('month', join_date) as month, COUNT(*) as count
      FROM users
      GROUP BY month
      ORDER BY month
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching new users over time:', err.stack);
    res.status(500).json({ error: 'Failed to fetch new users over time', details: err.message });
  }
});

// Inquiry Analytics
router.get('/inquiries/total', authenticateToken, isAdmin, async (req, res) => {
  try {
    const result = await pool.query('SELECT COUNT(*) FROM inquiries');
    res.json({ totalInquiries: parseInt(result.rows[0].count, 10) || 0 });
  } catch (err) {
    console.error('Error fetching total inquiries:', err.stack);
    res.status(500).json({ error: 'Failed to fetch total inquiries', details: err.message });
  }
});

router.get('/inquiries/over-time', authenticateToken, isAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DATE_TRUNC('month', created_at) as month, COUNT(*) as count
      FROM inquiries
      GROUP BY month
      ORDER BY month
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching inquiries over time:', err.stack);
    res.status(500).json({ error: 'Failed to fetch inquiries over time', details: err.message });
  }
});

router.get('/inquiries/per-property', authenticateToken, isAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT property_id, COUNT(*) as count
      FROM inquiries
      GROUP BY property_id
      ORDER BY count DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching inquiries per property:', err.stack);
    res.status(500).json({ error: 'Failed to fetch inquiries per property', details: err.message });
  }
});

router.get('/inquiries/per-agent', authenticateToken, isAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT agent_id, COUNT(*) as count
      FROM inquiries
      WHERE agent_id IS NOT NULL
      GROUP BY agent_id
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching inquiries per agent:', err.stack);
    res.status(500).json({ error: 'Failed to fetch inquiries per agent', details: err.message });
  }
});



// Home Values Expert Stats
router.get('/home-values/expert-stats', authenticateToken, isAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
          u.id AS expert_id,
          u.fullname AS expert_name,
          COUNT(hv.id) AS request_count
       FROM 
          users u
       LEFT JOIN 
          home_values hv ON u.id = hv.expert_id
       WHERE 
          u.role = 'expert'
       GROUP BY 
          u.id, u.fullname
       ORDER BY 
          request_count DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching expert stats:', err.stack);
    res.status(500).json({ error: 'Failed to fetch expert stats', details: err.message });
  }
});



// GET /api/properties/most-favorited
router.get('/most-favorited', authenticateToken, isAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.*, COUNT(f.property_id) AS favorite_count
       FROM properties p
       LEFT JOIN favorites f ON p.id = f.property_id
       GROUP BY p.id
       ORDER BY favorite_count DESC
       LIMIT 2`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching most favorited properties:', err.stack);
    res.status(500).json({ error: 'Failed to fetch most favorited properties', details: err.message });
  }
});




// GET /api/most-favorited-home
router.get('/most-favorited-home', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.id, p.title, p.price, p.location, p.type, p.bedrooms, 
              p.bathrooms, p.etage, p.square_footage, p.description, 
              p.features, p.status, p.lat, p.long, 
              p.images_path, p.equipe AS equipped, p.user_id AS agent_id, p.created_at,
              COUNT(f.property_id) AS favorite_count
       FROM properties p
       LEFT JOIN favorites f ON p.id = f.property_id
       GROUP BY p.id
       HAVING COUNT(f.property_id) > 0
       ORDER BY favorite_count DESC
       LIMIT 5`
    );

    const formattedResults = result.rows.map(property => {
      // Normalize images_path
      let images = property.images_path;
      if (typeof property.images_path === 'string') {
        try {
          images = JSON.parse(property.images_path);
        } catch (e) {
          console.error('Error parsing images_path:', e);
          images = [];
        }
      }

      return {
        ...property,
        images_path: images
      };
    });

    res.json(formattedResults);
  } catch (err) {
    console.error('Error fetching most favorited properties for home:', err.stack);
    res.status(500).json({ error: 'Failed to fetch most favorited properties for home', details: err.message });
  }
});


// GET /api/analytics/newest-listings
router.get('/newest-listings', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.id, p.title, p.price, p.location, p.type, p.bedrooms, 
              p.bathrooms, p.etage, p.square_footage, p.description, 
              p.features, p.status, p.lat, p.long, 
              p.images_path, p.equipe AS equipped, p.user_id AS agent_id, p.created_at
       FROM properties p
       ORDER BY p.created_at DESC
       LIMIT 4`
    );
    
    // Format the data to match what the frontend expects
    const formattedResults = result.rows.map(property => {
      // Ensure images_path is correctly parsed if it's a JSON string
      let images = property.images_path;
      if (typeof property.images_path === 'string') {
        try {
          images = JSON.parse(property.images_path);
        } catch (e) {
          console.log('Error parsing images_path:', e);
          images = [];
        }
      }
      
      return {
        ...property,
        images_path: images
      };
    });
    
    res.json(formattedResults);
  } catch (err) {
    console.error('Error fetching newest listings:', err.stack);
    res.status(500).json({ error: 'Failed to fetch newest listings', details: err.message });
  }
});


// GET /api/properties/in-algiers
router.get('/properties/in-algiers', authenticateToken, isAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, title, location, price, lat, long
       FROM properties
       WHERE LOWER(location) LIKE '%algiers%'`
    );
    
    // Filter out any properties that don't have valid coordinates
    const validProperties = result.rows.filter(property => 
      property.lat !== null && property.long !== null
    );
    
    res.json(validProperties);
  } catch (err) {
    console.error('Error fetching Algiers properties:', err.stack);
    res.status(500).json({ error: 'Failed to fetch Algiers properties', details: err.message });
  }
});

// GET /api/properties/pending
router.get('/properties/pending', authenticateToken, isAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        p.id, 
        p.title, 
        p.location, 
        p.price, 
        p.images_path, 
        p.status, 
        p.created_at, 
        u.fullname AS agent_name
      FROM 
        properties p
      LEFT JOIN 
        users u ON p.user_id = u.id
      WHERE 
        p.status = 'Pending'
      ORDER BY 
        p.created_at DESC
    `);

    // Format the response to ensure images_path is an array
    const formattedResults = result.rows.map(property => ({
      id: property.id,
      title: property.title,
      location: property.location,
      price: property.price,
      images_path: typeof property.images_path === 'string' ? JSON.parse(property.images_path) : property.images_path || [],
      status: property.status,
      created_at: property.created_at,
      agent_name: property.agent_name || 'Unknown agent',
    }));

    res.json(formattedResults);
  } catch (err) {
    console.error('Error fetching pending properties:', err.stack);
    res.status(500).json({ error: 'Failed to fetch pending properties', details: err.message });
  }
});


export default router;