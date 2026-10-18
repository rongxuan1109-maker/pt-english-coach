-- 英文教練 資料表（單人使用，全部開 RLS 只有本人可讀寫）
create extension if not exists pgcrypto;

create table if not exists profile (
  user_id uuid primary key references auth.users(id) on delete cascade,
  cefr text not null default 'A1',
  vocab_est int not null default 0,
  level_adjust int not null default 0,
  stage int not null default 1,
  week int not null default 1,
  sprint_start date,
  daily_new_words int not null default 12,
  model text not null default 'claude-opus-5-5',
  tts_rate numeric not null default 0.9,
  error_summary text not null default '',
  assessed boolean not null default false,
  last_vocab_test date,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists assessments (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,              -- vocab / reading / writing / weekly_vocab / task
  score numeric,
  vocab_est int,
  cefr text,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists lessons (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  lesson_date date not null,
  stage int not null,
  week int not null,
  topic text not null,
  content jsonb not null default '{}'::jsonb,   -- 四段生成內容
  progress jsonb not null default '{}'::jsonb,  -- {review:true,input:true,drill:false,output:false, ...}
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, lesson_date)
);

create table if not exists cards (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('word','sentence')),
  en text not null,
  zh text not null default '',
  context text not null default '',
  source text not null default '',
  interval_days numeric not null default 0,
  ease numeric not null default 2.5,
  reps int not null default 0,
  lapses int not null default 0,
  due_at date not null default current_date,
  last_review timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists cards_due_idx on cards (user_id, due_at);

create table if not exists reviews (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id bigint references cards(id) on delete cascade,
  correct boolean not null,
  grade int,
  created_at timestamptz not null default now()
);

create table if not exists errors (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  pattern text not null,
  said text not null default '',
  correct text not null default '',
  lesson_id bigint,
  created_at timestamptz not null default now()
);

create table if not exists curriculum (
  id serial primary key,
  stage int not null,
  week int not null,
  topic_zh text not null,
  topic_en text not null,
  patterns text not null default '',
  unlock_vocab int not null default 0,
  is_buffer boolean not null default false,
  unique (stage, week)
);

create table if not exists api_log (
  id bigserial primary key,
  user_id uuid,
  action text,
  model text,
  input_tokens int default 0,
  output_tokens int default 0,
  cache_read int default 0,
  cache_write int default 0,
  ms int default 0,
  ok boolean default true,
  created_at timestamptz not null default now()
);

-- 第二階段預留
create table if not exists conversations (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  scene text not null default '',
  messages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create table if not exists custom_scenes (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  content text not null,
  stage int not null default 1,
  created_at timestamptz not null default now()
);

-- updated_at 自動更新
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists profile_updated on profile;
create trigger profile_updated before update on profile for each row execute function set_updated_at();

-- RLS：只有本人
do $$ declare t text; begin
  foreach t in array array['profile','assessments','lessons','cards','reviews','errors','api_log','conversations','custom_scenes'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists own_rows on %I', t);
    execute format('create policy own_rows on %I for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id)', t);
  end loop;
end $$;
alter table curriculum enable row level security;
drop policy if exists curriculum_rw on curriculum;
create policy curriculum_rw on curriculum for all to authenticated using (true) with check (true);

grant usage on schema public to authenticated;
grant all on all tables in schema public to authenticated;
grant all on all sequences in schema public to authenticated;
revoke all on all tables in schema public from anon;

-- 課綱預建
insert into curriculum (stage, week, topic_zh, topic_en, patterns, unlock_vocab, is_buffer) values
 (1,1,'打招呼與自我介紹','Greetings & introducing yourself','I am… / I''m from… / Are you…? / Nice to meet you',0,false),
 (1,2,'數字、時間、價錢','Numbers, time & prices','What time is it? / How much is it? / How many…?',0,false),
 (1,3,'吃飯點餐','Ordering food','I''d like… / Can I have…? / Do you have…?',0,false),
 (1,4,'緩衝週：只複習','Buffer week: review only','',0,true),
 (1,5,'問路與交通','Asking for directions & transport','Where is…? / How do I get to…? / Turn left / Go straight',0,false),
 (1,6,'購物與住宿','Shopping & hotels','Can I…? / It''s too expensive. / I want… / Do you have a room?',0,false),
 (1,7,'日常聊天','Everyday small talk','I like… / I usually… / And you? / What do you do?',0,false),
 (1,8,'緩衝週：只複習','Buffer week: review only','',0,true),
 (2,9,'時事（簡化短新聞）','Simple news & current events','I think… / I agree / I don''t agree / because…',800,false),
 (2,10,'興趣嗜好','Hobbies & free time','I love… / I''m into… / How often…? / on weekends',800,false),
 (2,11,'工作簡介','Talking about your job','I work as… / I help people… / My clinic…',800,false),
 (2,12,'緩衝週：只複習','Buffer week: review only','',800,true),
 (3,13,'身體部位與不舒服','Body parts & feeling unwell','Where does it hurt? / My … hurts / It feels…',1200,false),
 (3,14,'問診','Taking a history','When did it start? / How long…? / Does it get worse when…?',1200,false),
 (3,15,'疼痛評估','Pain assessment','On a scale of 0 to 10 / Is it sharp or dull? / Point to where…',1200,false),
 (3,16,'緩衝週：只複習','Buffer week: review only','',1200,true),
 (3,17,'姿勢與動作分析','Posture & movement','Can you bend forward? / Your shoulder is… / Try to keep…',1200,false),
 (3,18,'運動處方','Exercise prescription','Do this 10 times / twice a day / Hold for 5 seconds / Stop if it hurts',1200,false),
 (3,19,'衛教','Patient education','This helps… / Try to avoid… / Ice for 15 minutes / It''s normal to feel…',1200,false),
 (3,20,'緩衝週：只複習','Buffer week: review only','',1200,true)
on conflict (stage, week) do nothing;
