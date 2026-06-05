const crypto = require("crypto");
const path = require("path");
const { Pool } = require("pg");

// Intenta cargar .env desde la misma carpeta del script
try {
  const fs = require("fs");
  const envPath = path.join(__dirname, ".env");
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, "utf8")
      .split("\n")
      .forEach((line) => {
        const [key, ...rest] = line.split("=");
        const k = String(key || "").trim();
        if (k && !k.startsWith("#")) {
          process.env[k] = process.env[k] ?? rest.join("=").trim();
        }
      });
  }
} catch (_) {}

const DATABASE_URL = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;
if (!DATABASE_URL) {
  console.error("Falta DATABASE_URL o NEON_DATABASE_URL en el entorno.");
  process.exit(1);
}

const USERNAME = "default";
const PASSWORD = "defaultpw";
const DISPLAY_NAME = "Consulta";
const ROLE = "readonly";

const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

const hashPassword = (plainPassword, salt) =>
  new Promise((resolve, reject) => {
    crypto.scrypt(plainPassword, salt, 64, (err, key) => {
      if (err) reject(err);
      else resolve(Buffer.from(key).toString("hex"));
    });
  });

const main = async () => {
  const salt = crypto.randomBytes(16).toString("hex");
  const passwordHash = await hashPassword(PASSWORD, salt);

  const result = await pool.query(
    `INSERT INTO users (username, display_name, password_hash, password_salt, password_algorithm, is_active, role)
     VALUES ($1, $2, $3, $4, 'scrypt', TRUE, $5)
     ON CONFLICT (username) DO UPDATE SET
       display_name = EXCLUDED.display_name,
       password_hash = EXCLUDED.password_hash,
       password_salt = EXCLUDED.password_salt,
       password_algorithm = EXCLUDED.password_algorithm,
       is_active = TRUE,
       role = EXCLUDED.role,
       updated_at = NOW()
     RETURNING id_user, username, display_name, role`,
    [USERNAME, DISPLAY_NAME, passwordHash, salt, ROLE]
  );

  console.log("Usuario listo:", result.rows[0]);
};

main()
  .catch((err) => {
    console.error("No se pudo crear el usuario:", err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
