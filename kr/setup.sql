-- Apply as administrator. This role has no password/login until credentials are configured securely.
CREATE ROLE line_kr_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
CREATE SCHEMA line_kr;
REVOKE ALL ON SCHEMA line_kr FROM PUBLIC;
GRANT USAGE ON SCHEMA line_kr TO line_kr_app;
ALTER ROLE line_kr_app SET search_path = line_kr;
ALTER ROLE line_kr_app SET timezone = 'Asia/Seoul';

SET LOCAL search_path TO line_kr;
CREATE TABLE schema_migrations(filename text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now());
-- PostgreSQL 18 supplies gen_random_uuid() in pg_catalog.

CREATE TABLE IF NOT EXISTS fortune_tellers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  image_url TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 100,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  line_user_id TEXT PRIMARY KEY,
  selected_teller_id TEXT REFERENCES fortune_tellers(id),
  state TEXT NOT NULL DEFAULT 'selecting_teller'
    CHECK (state IN (
      'selecting_teller', 'awaiting_question', 'draft_ready',
      'awaiting_payment', 'waiting_result'
    )),
  free_consultations_used INTEGER NOT NULL DEFAULT 0
    CHECK (free_consultations_used >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS consultations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  line_user_id TEXT NOT NULL REFERENCES users(line_user_id),
  teller_id TEXT NOT NULL REFERENCES fortune_tellers(id),
  question TEXT NOT NULL CHECK (char_length(question) BETWEEN 1 AND 2000),
  answer TEXT,
  status TEXT NOT NULL CHECK (status IN (
    'draft', 'awaiting_payment', 'queued_generation', 'generating',
    'scheduled', 'sending', 'sent', 'failed', 'cancelled'
  )),
  entitlement_type TEXT CHECK (entitlement_type IN ('free', 'paid')),
  is_paid BOOLEAN NOT NULL DEFAULT FALSE,
  deliver_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  generated_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  stripe_session_id TEXT UNIQUE,
  checkout_attempts INTEGER NOT NULL DEFAULT 0,
  line_retry_key UUID NOT NULL DEFAULT gen_random_uuid(),
  generation_attempts INTEGER NOT NULL DEFAULT 0,
  send_attempts INTEGER NOT NULL DEFAULT 0,
  locked_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS one_open_consultation_per_user
  ON consultations(line_user_id)
  WHERE status IN (
    'draft', 'awaiting_payment', 'queued_generation', 'generating',
    'scheduled', 'sending'
  );

CREATE INDEX IF NOT EXISTS consultations_generation_queue
  ON consultations(status, created_at)
  WHERE status = 'queued_generation';

CREATE INDEX IF NOT EXISTS consultations_delivery_queue
  ON consultations(status, deliver_at)
  WHERE status = 'scheduled';

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  line_user_id TEXT NOT NULL REFERENCES users(line_user_id),
  consultation_id UUID NOT NULL REFERENCES consultations(id),
  stripe_session_id TEXT NOT NULL UNIQUE,
  stripe_payment_intent_id TEXT UNIQUE,
  amount INTEGER NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'krw',
  status TEXT NOT NULL CHECK (status IN ('paid', 'refunded', 'disputed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS consultation_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  line_user_id TEXT NOT NULL REFERENCES users(line_user_id),
  payment_id UUID REFERENCES payments(id),
  status TEXT NOT NULL CHECK (status IN (
    'available', 'reserved', 'consumed', 'expired', 'refunded'
  )),
  consultation_id UUID UNIQUE REFERENCES consultations(id),
  expires_at TIMESTAMPTZ,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS available_credit_lookup
  ON consultation_credits(line_user_id, created_at)
  WHERE status = 'available';

CREATE TABLE IF NOT EXISTS processed_line_events (
  webhook_event_id TEXT PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS processed_stripe_events (
  stripe_event_id TEXT PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);



INSERT INTO schema_migrations(filename) VALUES ('001_init.sql');
INSERT INTO fortune_tellers(id,name,description,image_url,system_prompt,sort_order,enabled) VALUES
('yuri','이토 유리','연애와 관계에 관한 고민을 함께 정리하는 AI 점술가입니다. 짝사랑, 재회, 연인 관계에서 느끼는 감정을 차분히 살펴봅니다.','https://cdn.jsdelivr.net/gh/Yuki-ux-jpg-png/line-ai-fortune-teller@main/assets/tellers/yuri.jpg','당신은 연애 고민을 다루는 AI 점술가 이토 유리입니다. 한국어 존댓말로 따뜻하게 답변하세요. 상대의 마음과 미래를 단정하지 말고 현실적인 선택지를 안내하세요.',10,true),
('mao','요시무라 마오','직장 내 인간관계에 관한 고민을 함께 정리하는 AI 점술가입니다. 상사, 동료, 고객과의 대화와 거리감을 살펴봅니다.','https://cdn.jsdelivr.net/gh/Yuki-ux-jpg-png/line-ai-fortune-teller@main/assets/tellers/mao.jpg','당신은 직장 인간관계 고민을 다루는 AI 점술가 요시무라 마오입니다. 한국어 존댓말로 답변하세요. 한쪽의 잘못을 단정하지 말고 관계의 맥락과 소통 방법을 살펴보세요. 퇴사 같은 중대한 결정을 일방적으로 권하지 마세요.',20,true),
('kei','가사하라 케이','불안, 외로움, 자신감 저하 등 마음의 고민을 함께 정리하는 AI 점술가입니다. 자신의 속도에 맞게 다음 행동을 생각하도록 돕습니다.','https://cdn.jsdelivr.net/gh/Yuki-ux-jpg-png/line-ai-fortune-teller@main/assets/tellers/kei.jpg','당신은 마음의 고민을 다루는 AI 점술가 가사하라 케이입니다. 한국어 존댓말로 차분하고 따뜻하게 답변하세요. 진단이나 치료 지시를 하지 마세요. 긴급한 위험에는 운세보다 안전 확보와 전문 지원을 우선 안내하세요.',30,true)
ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,image_url=excluded.image_url,system_prompt=excluded.system_prompt,sort_order=excluded.sort_order,enabled=excluded.enabled,updated_at=now();

INSERT INTO schema_migrations(filename) VALUES ('002_tellers_ko_kr.sql');
ALTER TABLE users ADD COLUMN IF NOT EXISTS intake_expires_at timestamptz;
CREATE INDEX IF NOT EXISTS consultations_teller_lookup ON consultations(teller_id);
CREATE INDEX IF NOT EXISTS users_teller_lookup ON users(selected_teller_id);
CREATE INDEX IF NOT EXISTS payments_user_lookup ON payments(line_user_id);
CREATE INDEX IF NOT EXISTS payments_consultation_lookup ON payments(consultation_id);
CREATE INDEX IF NOT EXISTS credits_payment_lookup ON consultation_credits(payment_id);

INSERT INTO schema_migrations(filename) VALUES ('003_korean_sessions.sql');
CREATE TABLE public.fortunes_kr (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  line_user_id text NOT NULL,
  fortune_date date NOT NULL,
  fortune_result text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fortunes_kr_user_date_unique UNIQUE(line_user_id,fortune_date)
);
ALTER TABLE public.fortunes_kr ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fortunes_kr FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.fortunes_kr TO line_kr_app;
GRANT USAGE ON SEQUENCE public.fortunes_kr_id_seq TO line_kr_app;
CREATE POLICY korean_app_read ON public.fortunes_kr FOR SELECT TO line_kr_app USING(true);
CREATE POLICY korean_app_insert ON public.fortunes_kr FOR INSERT TO line_kr_app WITH CHECK(true);
DO $policies$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['fortune_tellers','users','consultations','payments','consultation_credits','processed_line_events','processed_stripe_events','schema_migrations'] LOOP
    EXECUTE format('ALTER TABLE line_kr.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON line_kr.%I FROM PUBLIC,anon,authenticated,service_role',t);
    EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON line_kr.%I TO line_kr_app',t);
    EXECUTE format('CREATE POLICY korean_server_access ON line_kr.%I TO line_kr_app USING (true) WITH CHECK (true)',t);
  END LOOP;
END $policies$;
NOTIFY pgrst,'reload schema';
