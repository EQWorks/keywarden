BEGIN;

CREATE TABLE IF NOT EXISTS public.equsers (
    email TEXT NOT NULL,
    prefix TEXT NOT NULL,
    jwt_uuid TEXT,
    client JSONB DEFAULT '{}'::JSONB,
    atom JSONB DEFAULT '{}'::JSONB,
    locus JSONB DEFAULT '{}'::JSONB,
    info JSONB DEFAULT '{}'::JSONB,
    otp JSONB DEFAULT '{}'::JSONB,
    active BIT(1) DEFAULT B'1'::BIT(1),
    access JSONB,
    access_expired_at TIMESTAMPTZ,
    PRIMARY KEY(email)
);

COMMIT;
