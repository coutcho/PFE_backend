import express from "express";
import pkg from "pg";
import cors from "cors";
import bcrypt from "bcryptjs";
import { createHash } from "crypto";
import nodemailer from "nodemailer";
import jwt from "jsonwebtoken";
import passport from "passport";
import session from "express-session";
import FacebookStrategy from "passport-facebook";
import GoogleStrategy from "passport-google-oauth20";
import propertiesRoutes from "./propertiesRoutes.js";
import usersRoutes from "./usersRoutes.js";
import inquiriesRoutes from "./inquiriesRoutes.js";
import homeValuesRoutes from "./HomeValueRoutes.js";
import analyticsRoutes from "./analyticsRoutes.js";
import dotenv from "dotenv";
import pool from "./db.js";
dotenv.config();

const app = express();
const port = 3001;

app.use(
  cors({
    origin: "https://manzilkom.netlify.app", // Match your frontend's origin (Vite default)
    credentials: true,
  })
);
app.use(express.json());
app.use(express.static("public")); // Serve static files from public/ (includes uploads/)
app.use(
  session({
    secret: process.env.SESSION_SECRET, // Replace with a strong secret
    resave: false,
    saveUninitialized: false,
  })
);
app.use(passport.initialize());
app.use(passport.session());

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "rayanos.adjinatos@gmail.com",
    pass: "gpsi tcoy ojkc tlze",
  },
});

// Passport serialization
passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await pool.query("SELECT * FROM users WHERE id = $1", [id]);
    done(null, user.rows[0]);
  } catch (err) {
    done(err);
  }
});

// Facebook Strategy
passport.use(
  new FacebookStrategy(
    {
      clientID: "1376129730264892",
      clientSecret: "110e3a97476f4b94f317276a86388508",
      callbackURL: "http://localhost:3001/auth/facebook/callback",
      profileFields: ["id", "displayName", "emails"],
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails[0].value;
        let user = await pool.query("SELECT * FROM users WHERE email = $1", [
          email,
        ]);

        if (user.rows.length === 0) {
          user = await pool.query(
            "INSERT INTO users (fullname, email, role) VALUES ($1, $2, $3) RETURNING *",
            [profile.displayName, email, "user"]
          );
        }
        done(null, user.rows[0]);
      } catch (err) {
        done(err);
      }
    }
  )
);

// Google Strategy
passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: "http://localhost:3001/auth/google/callback",
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails[0].value;
        let user = await pool.query("SELECT * FROM users WHERE email = $1", [
          email,
        ]);

        if (user.rows.length === 0) {
          user = await pool.query(
            "INSERT INTO users (fullname, email, role) VALUES ($1, $2, $3) RETURNING *",
            [profile.displayName, email, "user"]
          );
        }
        done(null, user.rows[0]);
      } catch (err) {
        done(err);
      }
    }
  )
);

// Password check function
const checkPasswordWithHIBP = async (password) => {
  try {
    const hash = createHash("sha1")
      .update(password)
      .digest("hex")
      .toUpperCase();
    const prefix = hash.slice(0, 5);
    const suffix = hash.slice(5);

    const response = await fetch(
      `https://api.pwnedpasswords.com/range/${prefix}`,
      {
        headers: { "Add-Padding": "true" },
      }
    );
    const text = await response.text();

    const lines = text.split("\n");
    for (const line of lines) {
      const [hashSuffix, count] = line.split(":");
      if (hashSuffix === suffix) {
        return parseInt(count, 10) > 0;
      }
    }
    return false;
  } catch (error) {
    console.error("Error checking password with HIBP:", error);
    return false;
  }
};

// Sign-up endpoint
app.post("/api/signup", async (req, res) => {
  const { nom, prenom, email, pass } = req.body;

  if (!nom || !email || !pass) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  if (pass.length < 8) {
    return res
      .status(400)
      .json({ message: "Le mot de passe doit contenir au moins 8 caractères" });
  }
  if (pass.toLowerCase().startsWith("12345678")) {
    return res.status(400).json({
      message:
        "Ce mot de passe est trop courant. Veuillez en choisir un plus sécurisé.",
    });
  }
  const isPwned = await checkPasswordWithHIBP(pass);
  if (isPwned) {
    return res.status(400).json({
      message:
        "Ce mot de passe est trop courant. Veuillez en choisir un plus sécurisé.",
    });
  }

  try {
    const existingUser = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      [email]
    );
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ message: "Email already in use" });
    }

    const hashedPassword = await bcrypt.hash(pass, 10);

    const newUser = await pool.query(
      "INSERT INTO users (fullname, email, pass) VALUES ($1, $2, $3) RETURNING *",
      [`${nom} ${prenom}`, email, hashedPassword]
    );

    res.status(201).json({
      success: true,
      message: "Compte créé avec succès ! Bienvenue à bord !",
      user: {
        id: newUser.rows[0].id,
        fullname: newUser.rows[0].fullname,
        email: newUser.rows[0].email,
      },
    });
  } catch (error) {
    console.error("Error during sign-up:", error);
    res.status(500).json({ message: "Server error, please try again later" });
  }
});

// Sign-in endpoint
app.post("/api/signin", async (req, res) => {
  const { email, pass } = req.body;

  if (!email || !pass) {
    return res.status(400).json({ message: "Email and password are required" });
  }

  try {
    const userQuery = await pool.query(
      "SELECT id, fullname, email, pass, role FROM users WHERE email = $1",
      [email]
    );
    const user = userQuery.rows[0];

    if (!user) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const isPasswordValid = await bcrypt.compare(pass, user.pass);
    if (!isPasswordValid) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const role = user.role || "user";
    const token = jwt.sign(
      { id: user.id, email: user.email, role },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    res.status(200).json({
      success: true,
      message: "Connexion réussie ! Bon retour !",
      token,
      user: {
        id: user.id,
        fullname: user.fullname,
        email: user.email,
        role,
      },
    });
  } catch (error) {
    console.error("Error during sign-in:", error);
    res.status(500).json({ message: "Server error, please try again later" });
  }
});

// Facebook Login Routes
app.get(
  "/auth/facebook",
  passport.authenticate("facebook", { scope: ["email"] })
);

app.get(
  "/auth/facebook/callback",
  passport.authenticate("facebook", { session: false }),
  (req, res) => {
    const user = req.user;
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role || "user" },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );
    res.redirect(`http://localhost:5173/auth/callback?token=${token}`);
  }
);

// Google Login Routes
app.get(
  "/auth/google",
  passport.authenticate("google", { scope: ["profile", "email"] })
);

app.get(
  "/auth/google/callback",
  passport.authenticate("google", { session: false }),
  (req, res) => {
    const user = req.user;
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role || "user" },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );
    res.redirect(`http://localhost:5173/auth/callback?token=${token}`);
  }
);

// Forgot Password endpoint
app.post("/api/forgot-password", async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ message: "Email is required" });
  }

  try {
    const userQuery = await pool.query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);
    const user = userQuery.rows[0];

    if (!user) {
      return res
        .status(200)
        .json({ message: "If the email exists, a reset link has been sent." });
    }

    const resetToken = jwt.sign({ id: user.id }, process.env.JWT_SECRET, {
      expiresIn: "1h",
    });

    await pool.query(
      "INSERT INTO reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)",
      [user.id, resetToken, new Date(Date.now() + 3600000)]
    );

    const resetUrl = `http://localhost:5173/reset-password?token=${resetToken}`;
    const mailOptions = {
      from: "rayanos.adjinatos@gmail.com",
      to: email,
      subject: "Password Reset Request",
      text: `Click this link to reset your password: ${resetUrl}\nThis link expires in 1 hour.`,
    };

    await transporter.sendMail(mailOptions);

    res
      .status(200)
      .json({ message: "If the email exists, a reset link has been sent." });
  } catch (error) {
    console.error("Error in forgot-password:", error);
    res.status(500).json({ message: "Server error, please try again later" });
  }
});

// Reset Password endpoint
app.post("/api/reset-password", async (req, res) => {
  const { token, newPassword } = req.body;

  if (!token || !newPassword) {
    return res
      .status(400)
      .json({ message: "Token and new password are required" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const tokenQuery = await pool.query(
      "SELECT * FROM reset_tokens WHERE token = $1 AND expires_at > NOW()",
      [token]
    );
    const resetToken = tokenQuery.rows[0];

    if (!resetToken || resetToken.user_id !== decoded.id) {
      return res
        .status(400)
        .json({ message: "Invalid or expired reset token" });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await pool.query("UPDATE users SET pass = $1 WHERE id = $2", [
      hashedPassword,
      resetToken.user_id,
    ]);

    await pool.query("DELETE FROM reset_tokens WHERE token = $1", [token]);

    res
      .status(200)
      .json({ message: "Password reset successfully! You can now sign in." });
  } catch (error) {
    console.error("Error in reset-password:", error);
    if (error.name === "TokenExpiredError") {
      return res.status(400).json({ message: "Reset token has expired" });
    }
    res.status(500).json({ message: "Server error, please try again later" });
  }
});

// Contact endpoint
app.post("/api/contact", async (req, res) => {
  const { fullName, email, comments } = req.body;

  if (!fullName || !email || !comments) {
    return res.status(400).json({ message: "All fields are required" });
  }

  const mailOptions = {
    from: "rayanos.adjinatos@gmail.com", // Sender (your Gmail)
    replyTo: email, // User's email as reply-to
    to: "rayanos.adjinatos@gmail.com", // Your email to receive messages
    subject: `New Contact Form Submission from ${fullName}`,
    text: `
      Full Name: ${fullName}
      Email: ${email}
      Comments: ${comments}
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    res.status(200).json({ message: "Message sent successfully" });
  } catch (error) {
    console.error("Error sending contact email:", error);
    res.status(500).json({ message: "Failed to send message" });
  }
});

// Mount the routes
app.use("/api/properties", propertiesRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/inquiries", inquiriesRoutes);
app.use("/api/home-values", homeValuesRoutes);
app.use("/api/analytics", analyticsRoutes);
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});

console.log("DB ENV:", {
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
});
