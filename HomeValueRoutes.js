// backend/index.js
import express from "express";
import cors from "cors";
import pg from "pg";
import multer from "multer";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// PostgreSQL pool
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Middlewares
app.use(express.json());
app.use(cors());

// Multer memory storage (not saving locally)
const storage = multer.memoryStorage();
const upload = multer({ storage }).array("images", 10);

// Helper to upload to Supabase
const uploadToSupabase = async (file) => {
  const fileName = `${Date.now()}-${file.originalname}`;
  const { error } = await supabase.storage
    .from("property_images") // bucket name
    .upload(fileName, file.buffer, {
      contentType: file.mimetype,
    });

  if (error) throw error;

  const { data } = supabase.storage
    .from("property_images")
    .getPublicUrl(fileName);

  return data.publicUrl;
};

// ROUTES

// Create new home value (listing)
app.post("/api/home-values", upload, async (req, res) => {
  try {
    const { address } = req.body;
    const userId = req.user?.id || null; // adjust if using auth middleware

    const images = [];
    if (req.files) {
      for (const file of req.files) {
        const url = await uploadToSupabase(file);
        images.push(url);
      }
    }

    const result = await pool.query(
      `INSERT INTO home_values (address, images, user_id, expert_id, created_at)
       VALUES ($1, $2, $3, NULL, NOW()) RETURNING *`,
      [address, JSON.stringify(images), userId]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error inserting home value:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Get all home values
app.get("/api/home-values", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM home_values ORDER BY created_at DESC"
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching home values:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Update existing home value
app.put("/api/home-values/:id", upload, async (req, res) => {
  try {
    const { id } = req.params;
    const { address, existingImages } = req.body;

    let images = JSON.parse(existingImages || "[]");

    if (req.files) {
      for (const file of req.files) {
        const url = await uploadToSupabase(file);
        images.push(url);
      }
    }

    const result = await pool.query(
      `UPDATE home_values
       SET address = $1, images = $2
       WHERE id = $3
       RETURNING *`,
      [address, JSON.stringify(images), id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error updating home value:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Other routes (keep your existing ones)
app.get("/api/user-and-expert", async (req, res) => {
  // example: fetch users + experts
  try {
    const result = await pool.query(
      "SELECT * FROM users WHERE role IN ('user','expert')"
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching users/experts:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.put("/api/home-values/:id/validate", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `UPDATE home_values SET validated = true WHERE id = $1 RETURNING *`,
      [id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error validating home value:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
