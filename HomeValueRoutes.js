// HomeValueRoutes.js
import express from "express";
import multer from "multer";
import pool from "./db.js";
import supabase from "./supabase.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

/**
 * Helper: Upload image to Supabase storage
 */
async function uploadToSupabase(file) {
  const fileName = `${Date.now()}-${file.originalname}`;
  const { error } = await supabase.storage
    .from("property_images")
    .upload(fileName, file.buffer, { contentType: file.mimetype });

  if (error) throw error;

  // Generate public URL
  const { data } = supabase.storage
    .from("property_images")
    .getPublicUrl(fileName);
  return data.publicUrl;
}

/**
 * ====================
 * Routes
 * ====================
 */

// ✅ Get all users & experts (must come BEFORE /:id)
router.get("/user-and-expert", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM users WHERE role IN ('user', 'expert')"
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching users/experts:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ Validate a home value (must come BEFORE /:id)
router.put("/:id/validate", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      "UPDATE home_values SET validated = true WHERE id = $1 RETURNING *",
      [id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error validating home value:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ Get all home values
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM home_values ORDER BY id DESC"
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching home values:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ Create a new home value with images
router.post("/", upload.array("images", 5), async (req, res) => {
  try {
    const { title, description, price, user_id } = req.body;

    // Upload images to Supabase
    const imageUrls = [];
    for (const file of req.files) {
      const url = await uploadToSupabase(file);
      imageUrls.push(url);
    }

    const result = await pool.query(
      `INSERT INTO home_values (title, description, price, user_id, images_path)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [title, description, price, user_id, imageUrls]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Error creating home value:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ Update home value
router.put("/:id", upload.array("images", 5), async (req, res) => {
  const { id } = req.params;
  const { title, description, price } = req.body;

  try {
    let imageUrls = [];

    // Upload new images if provided
    if (req.files.length > 0) {
      for (const file of req.files) {
        const url = await uploadToSupabase(file);
        imageUrls.push(url);
      }
    }

    const result = await pool.query(
      `UPDATE home_values
       SET title = $1, description = $2, price = $3, images_path = $4
       WHERE id = $5 RETURNING *`,
      [title, description, price, imageUrls, id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error updating home value:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ Delete home value
router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query("DELETE FROM home_values WHERE id = $1", [id]);
    res.json({ message: "Home value deleted" });
  } catch (err) {
    console.error("Error deleting home value:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ❗️ Generic route must come LAST
router.get("/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query("SELECT * FROM home_values WHERE id = $1", [
      id,
    ]);
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error fetching home value:", err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
