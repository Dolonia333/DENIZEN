-- ============================================================
-- Secure Bridge Schema for OpenClaw Agent
-- Run this once against your Supabase instance (SQL Editor or psql)
-- ============================================================

-- ============================================================
-- 1. documents — structured data storage
-- ============================================================
CREATE TABLE IF NOT EXISTS public.documents (
    id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    agent_id    TEXT NOT NULL DEFAULT 'default',
    title       TEXT,
    category    TEXT,
    data        JSONB NOT NULL DEFAULT '{}'::jsonb,
    tags        TEXT[] DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_documents_agent_id   ON public.documents(agent_id);
CREATE INDEX IF NOT EXISTS idx_documents_category   ON public.documents(category);
CREATE INDEX IF NOT EXISTS idx_documents_created_at ON public.documents(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_tags       ON public.documents USING GIN(tags);

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "documents_select" ON public.documents FOR SELECT USING (true);
CREATE POLICY "documents_insert" ON public.documents FOR INSERT WITH CHECK (true);
CREATE POLICY "documents_update" ON public.documents FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "documents_delete" ON public.documents FOR DELETE USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.documents TO anon;

-- ============================================================
-- 2. key_value — simple key-value storage
-- ============================================================
CREATE TABLE IF NOT EXISTS public.key_value (
    key         TEXT NOT NULL,
    agent_id    TEXT NOT NULL DEFAULT 'default',
    value       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (key, agent_id)
);

ALTER TABLE public.key_value ENABLE ROW LEVEL SECURITY;

CREATE POLICY "kv_select" ON public.key_value FOR SELECT USING (true);
CREATE POLICY "kv_insert" ON public.key_value FOR INSERT WITH CHECK (true);
CREATE POLICY "kv_update" ON public.key_value FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "kv_delete" ON public.key_value FOR DELETE USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.key_value TO anon;

-- ============================================================
-- 3. logs — append-only agent activity log
-- ============================================================
CREATE TABLE IF NOT EXISTS public.logs (
    id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    agent_id    TEXT NOT NULL DEFAULT 'default',
    level       TEXT NOT NULL DEFAULT 'info'
                CHECK (level IN ('debug', 'info', 'warn', 'error')),
    event       TEXT NOT NULL,
    detail      JSONB DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_logs_agent_id   ON public.logs(agent_id);
CREATE INDEX IF NOT EXISTS idx_logs_level      ON public.logs(level);
CREATE INDEX IF NOT EXISTS idx_logs_created_at ON public.logs(created_at DESC);

ALTER TABLE public.logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "logs_select" ON public.logs FOR SELECT USING (true);
CREATE POLICY "logs_insert" ON public.logs FOR INSERT WITH CHECK (true);
-- Logs are append-only: no UPDATE or DELETE via anon role.

GRANT SELECT, INSERT ON public.logs TO anon;

-- ============================================================
-- 4. Auto-update trigger for updated_at columns
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_documents_updated_at
    BEFORE UPDATE ON public.documents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_kv_updated_at
    BEFORE UPDATE ON public.key_value
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
