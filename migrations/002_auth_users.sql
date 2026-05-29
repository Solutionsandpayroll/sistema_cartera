BEGIN;

CREATE TABLE IF NOT EXISTS users (
    id_user BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    password_algorithm TEXT NOT NULL DEFAULT 'scrypt',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT users_username_not_blank CHECK (length(trim(username)) > 0),
    CONSTRAINT users_password_hash_not_blank CHECK (length(trim(password_hash)) > 0),
    CONSTRAINT users_password_salt_not_blank CHECK (length(trim(password_salt)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active);

COMMIT;