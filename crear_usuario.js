const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const args = process.argv.slice(2);
const roleIndex = args.findIndex((a) => a === "--role");
let role = "admin";
if (roleIndex !== -1 && args[roleIndex + 1]) {
  role = String(args.splice(roleIndex, 2)[1]).trim().toLowerCase();
}
if (!["admin", "readonly"].includes(role)) {
  console.error("Rol inválido. Usa --role admin o --role readonly");
  process.exit(1);
}

const [usernameArg, passwordArg, ...displayNameParts] = args;
const username = String(usernameArg || "").trim();
const password = String(passwordArg || "");
const displayName = String(displayNameParts.join(" ") || username).trim();

if (!username || !password) {
  console.error("Uso: node crear_usuario.js <username> <password> [display name] [--role admin|readonly]");
  process.exit(1);
}

const resolveDatabaseUrl = () => {
  const envUrl = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;
  if (envUrl) {
    return envUrl;
  }

  return null;
};

const DATABASE_URL = resolveDatabaseUrl();

if (!DATABASE_URL) {
  console.error("Falta DATABASE_URL o NEON_DATABASE_URL en el entorno.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

const hashPassword = (plainPassword, salt) =>
  new Promise((resolve, reject) => {
    crypto.scrypt(plainPassword, salt, 64, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(Buffer.from(derivedKey).toString("hex"));
    });
  });

const main = async () => {
  const salt = crypto.randomBytes(16).toString("hex");
  const passwordHash = await hashPassword(password, salt);

  const result = await pool.query(
    `INSERT INTO users (
       username,
       display_name,
       password_hash,
       password_salt,
       password_algorithm,
       is_active,
       role
     ) VALUES ($1, $2, $3, $4, 'scrypt', TRUE, $5)
     ON CONFLICT (username) DO UPDATE SET
       display_name = EXCLUDED.display_name,
       password_hash = EXCLUDED.password_hash,
       password_salt = EXCLUDED.password_salt,
       password_algorithm = EXCLUDED.password_algorithm,
       is_active = TRUE,
       role = EXCLUDED.role,
       updated_at = NOW()
     RETURNING id_user, username, display_name, role`,
    [username, displayName, passwordHash, salt, role]
  );

  console.log("Usuario listo:", result.rows[0]);
};

main()
  .catch((error) => {
    console.error("No se pudo crear el usuario:", error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());