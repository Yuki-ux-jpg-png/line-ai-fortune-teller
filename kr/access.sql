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
