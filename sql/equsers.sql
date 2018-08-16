BEGIN;

CREATE TABLE IF NOT EXISTS public.equsers (
    email text NOT NULL,
    prefix text DEFAULT '',
    jwt_uuid text DEFAULT '',
    whitelabels integer[] DEFAULT '{}',
    customers integer[] DEFAULT '{}',
    atom jsonb DEFAULT '{}'::jsonb,
    locus jsonb DEFAULT '{}'::jsonb,
    info jsonb DEFAULT '{}'::jsonb,
    otp jsonb DEFAULT '{}'::jsonb,
    active bit DEFAULT '1'::bit,
    PRIMARY KEY(email)
);

COMMIT;
