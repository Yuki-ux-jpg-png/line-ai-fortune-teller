import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
test('PostgreSQL migrations and consultation state never touch Japanese public tables',async()=>{
 const db=new PGlite();
 try {
  await db.exec("CREATE TABLE public.users(line_user_id text PRIMARY KEY); INSERT INTO public.users VALUES ('japanese-user'); CREATE TABLE public.consultations(id text PRIMARY KEY); INSERT INTO public.consultations VALUES ('japanese-consultation'); CREATE SCHEMA line_tw; SET search_path TO line_tw; SET timezone TO 'Asia/Taipei';");
  await db.exec(await fs.readFile(new URL('../provision.sql',import.meta.url),'utf8'));
  await db.exec('SET ROLE line_tw_app;');
  for(const file of ['001_init.sql','002_tellers_zh_tw.sql'])await db.exec(await fs.readFile(new URL('../migrations/'+file,import.meta.url),'utf8'));
  await db.exec("INSERT INTO users(line_user_id) VALUES ('taiwan-user'); INSERT INTO consultations(line_user_id,teller_id,question,status) VALUES ('taiwan-user','yuri','我想改善人際關係','draft');");
  await db.exec('RESET ROLE;');
  assert.deepEqual((await db.query('SELECT line_user_id FROM public.users')).rows,[{line_user_id:'japanese-user'}]);
  assert.deepEqual((await db.query('SELECT id FROM public.consultations')).rows,[{id:'japanese-consultation'}]);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM users')).rows[0].n,1);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM consultations')).rows[0].n,1);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM fortune_tellers')).rows[0].n,3);
  await assert.rejects(()=>db.exec("INSERT INTO consultations(line_user_id,teller_id,question,status) VALUES ('taiwan-user','mao','重複諮詢','draft');"));
  assert.equal((await db.query('SHOW timezone')).rows[0].TimeZone,'Asia/Taipei');
  await db.exec('SET ROLE line_tw_app;');
  await assert.rejects(()=>db.query('SELECT * FROM public.users'));
  await assert.rejects(()=>db.query('SELECT * FROM public.consultations'));
  await db.exec('CREATE TABLE line_tw.permission_probe(id int); INSERT INTO permission_probe VALUES (1);');
  assert.equal((await db.query('SELECT id FROM permission_probe')).rows[0].id,1);
  await db.exec('RESET ROLE;');
  await db.exec('DROP TABLE line_tw.users CASCADE;');
  await assert.rejects(()=>db.query('SELECT * FROM users'));
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.users')).rows[0].n,1);
 } finally { await db.close(); }
});
