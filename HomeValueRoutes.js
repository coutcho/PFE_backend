import express from "express";
import jwt from "jsonwebtoken";
import multer from "multer";
import pool from "./db.js";
import supabase from "./supabaseClient.js";

const router = express.Router();

// Multer: store files in memory instead of disk
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB per file
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files are allowed"), false);
    }
    cb(null, true);
  },
}).array("images", 10);

// Middleware for JWT auth
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (!token)
    return res.status(401).json({ message: "Authentication required" });

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err)
      return res.status(403).json({ message: "Invalid or expired token" });
    req.user = user;
    next();
  });
};

// Upload helper: push file to Supabase
const uploadToSupabase = async (file) => {
  const fileName = `${Date.now()}-${file.originalname}`;
  const { error } = await supabase.storage
    .from("property_images") // 👈 name of your bucket
    .upload(fileName, file.buffer, {
      contentType: file.mimetype,
    });

  if (error) throw error;

  const { data } = supabase.storage
    .from("property_images")
    .getPublicUrl(fileName);
  return data.publicUrl;
};

// ---------------- ROUTES ---------------- //

// CREATE new home value request
router.post("/", authenticateToken, upload, async (req, res) => {
  const { address } = req.body;
  const userId = req.user.id;

  if (!address) {
    return res.status(400).json({ message: "Address is required" });
  }

  try {
    const images = [];
    for (const file of req.files || []) {
      const url = await uploadToSupabase(file);
      images.push(url);
    }

    const result = await pool.query(
      "INSERT INTO home_values (address, images, user_id, expert_id, created_at) VALUES ($1, $2, $3, NULL, NOW()) RETURNING *",
      [address, JSON.stringify(images), userId]
    );

    res.status(200).json({
      message: "Home value request submitted successfully",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Error processing home value:", error);
    res
      .status(500)
      .json({
        message: "Failed to process home value request",
        error: error.message,
      });
  }
});

// SEND a message (with optional images)
router.post("/:id/messages", authenticateToken, upload, async (req, res) => {
  const { id } = req.params;
  const { message } = req.body;
  const userId = req.user.id;
  const userRole = req.user.role;

  const images = [];
  for (const file of req.files || []) {
    const url = await uploadToSupabase(file);
    images.push(url);
  }

  if (!message && images.length === 0) {
    return res.status(400).json({ message: "Message or images required" });
  }

  try {
    const homeValueCheck = await pool.query(
      "SELECT user_id, expert_id FROM home_values WHERE id = $1",
      [id]
    );
    if (homeValueCheck.rowCount === 0) {
      return res.status(404).json({ message: "Home value request not found" });
    }
    const { user_id, expert_id } = homeValueCheck.rows[0];

    if (userId !== user_id && userRole !== "expert") {
      return res.status(403).json({ message: "Access denied" });
    }
    if (userRole === "expert" && expert_id !== null && expert_id !== userId) {
      return res
        .status(403)
        .json({ message: "Request assigned to another expert" });
    }

    const result = await pool.query(
      "INSERT INTO messages (home_value_id, sender_id, message, images, created_at, is_read) VALUES ($1, $2, $3, $4, NOW(), FALSE) RETURNING *",
      [id, userId, message || "", JSON.stringify(images)]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Error sending home value message:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// GET all home value requests (admin/expert)
router.get("/", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM home_values ORDER BY created_at DESC"
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching home values:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// GET single home value request
router.get("/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query("SELECT * FROM home_values WHERE id = $1", [
      id,
    ]);
    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Home value request not found" });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error fetching home value:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// UPDATE home value request (e.g. add more images)
router.put("/:id", authenticateToken, upload, async (req, res) => {
  const { id } = req.params;
  const { address } = req.body;
  const userId = req.user.id;

  try {
    const homeValueCheck = await pool.query(
      "SELECT * FROM home_values WHERE id = $1",
      [id]
    );
    if (homeValueCheck.rowCount === 0) {
      return res.status(404).json({ message: "Home value request not found" });
    }

    const homeValue = homeValueCheck.rows[0];
    if (homeValue.user_id !== userId) {
      return res
        .status(403)
        .json({ message: "You can only update your own requests" });
    }

    // Upload new images
    const newImages = [];
    for (const file of req.files || []) {
      const url = await uploadToSupabase(file);
      newImages.push(url);
    }

    // Keep old images + add new ones
    const existingImages = homeValue.images || [];
    const updatedImages = [...existingImages, ...newImages];

    const result = await pool.query(
      "UPDATE home_values SET address = $1, images = $2 WHERE id = $3 RETURNING *",
      [address || homeValue.address, JSON.stringify(updatedImages), id]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error updating home value:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// DELETE home value request
router.delete("/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  try {
    const homeValueCheck = await pool.query(
      "SELECT * FROM home_values WHERE id = $1",
      [id]
    );
    if (homeValueCheck.rowCount === 0) {
      return res.status(404).json({ message: "Home value request not found" });
    }

    const homeValue = homeValueCheck.rows[0];
    if (homeValue.user_id !== userId) {
      return res
        .status(403)
        .json({ message: "You can only delete your own requests" });
    }

    await pool.query("DELETE FROM home_values WHERE id = $1", [id]);
    res.json({ message: "Home value request deleted successfully" });
  } catch (error) {
    console.error("Error deleting home value:", error);
    res.status(500).json({ message: "Server error" });
  }
});

export default router;
