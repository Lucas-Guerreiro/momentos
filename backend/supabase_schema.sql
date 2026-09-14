-- ==============================================================================
-- MOMENTOS • Schema de Autenticação & Gestão de Licenças com Device Binding
-- ==============================================================================

-- 1. Tabela de Perfis de Usuários
CREATE TABLE IF NOT EXISTS public.perfis (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_user_id UUID UNIQUE,
    email TEXT UNIQUE NOT NULL,
    nome TEXT,
    role TEXT DEFAULT 'user', -- 'admin' para gestor, 'user' para clientes
    senha_hash TEXT, -- Para autenticação local / direta
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Tabela de Licenças e Vínculo de Aparelho (Device Binding)
CREATE TABLE IF NOT EXISTS public.licencas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chave TEXT UNIQUE NOT NULL,
    tipo_plano TEXT NOT NULL DEFAULT 'mensal', -- 'mensal', 'trimestral', 'anual', 'vitalicia', 'teste_7d'
    dias_validade INTEGER DEFAULT 30,
    status TEXT DEFAULT 'disponivel', -- 'disponivel', 'ativa', 'expirada', 'bloqueada'
    usuario_id UUID REFERENCES public.perfis(id) ON DELETE SET NULL,
    usuario_email TEXT,
    device_id TEXT, -- Hash único do aparelho ativado
    device_info TEXT, -- Nome do dispositivo (ex: "Chrome / Windows")
    data_ativacao TIMESTAMPTZ,
    data_expiracao TIMESTAMPTZ,
    max_dispositivos INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Habilitar Row Level Security (RLS) com políticas de leitura/escrita
ALTER TABLE public.perfis ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.licencas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Acesso publico perfis" ON public.perfis;
CREATE POLICY "Acesso publico perfis" ON public.perfis FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Acesso publico licencas" ON public.licencas;
CREATE POLICY "Acesso publico licencas" ON public.licencas FOR ALL USING (true) WITH CHECK (true);

-- Cadastrar Gestor Master inicial (admin@momentos.com / senha padrão: admin123)
INSERT INTO public.perfis (email, nome, role, senha_hash)
VALUES ('admin@momentos.com', 'Gestor Master', 'admin', 'admin123')
ON CONFLICT (email) DO UPDATE SET role = 'admin';

-- Inserir Licença Inicial de Demonstração / Teste
INSERT INTO public.licencas (chave, tipo_plano, dias_validade, status)
VALUES ('MOMENTOS-VIP-2026', 'mensal', 30, 'disponivel')
ON CONFLICT (chave) DO NOTHING;
