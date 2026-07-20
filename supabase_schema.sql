-- Run this in Supabase SQL Editor

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL DEFAULT 'agent_a',
  started_at TIMESTAMPTZ DEFAULT now(),
  ended_at TIMESTAMPTZ,
  body_type TEXT,
  total_heartbeats INT DEFAULT 0,
  memory_count INT DEFAULT 0,
  estimated_size_bytes BIGINT DEFAULT 0,
  rehydration_summary TEXT
);

CREATE TABLE memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id TEXT UNIQUE,
  agent_id TEXT NOT NULL DEFAULT 'agent_a',
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  heartbeat INT NOT NULL,
  day_cycle INT DEFAULT 1,
  light_state TEXT CHECK (light_state IN ('day','night')),
  tier INT CHECK (tier IN (1,2,3)) NOT NULL,
  frame_url TEXT,
  visual_description TEXT,
  audio_state TEXT,
  joint_state_summary TEXT,
  self_questions JSONB,
  thought TEXT NOT NULL,
  action_taken JSONB,
  outcome TEXT,
  reward_signal FLOAT,
  goal_at_time TEXT,
  injected BOOLEAN DEFAULT false,
  embedding vector(384),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE skills (
  name TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL DEFAULT 'agent_a',
  body_type TEXT NOT NULL,
  learned_at_heartbeat INT,
  learned_in_session TEXT,
  attempts_before_success INT,
  confidence FLOAT DEFAULT 1.0,
  description TEXT
);

CREATE TABLE motor_programs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  agent_id TEXT NOT NULL DEFAULT 'agent_a',
  body_type TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('primitive','learned')),
  created_at TIMESTAMPTZ DEFAULT now(),
  session_learned TEXT,
  heartbeat_learned INT,
  success_count INT DEFAULT 0,
  attempt_count INT DEFAULT 0,
  program JSONB NOT NULL,
  UNIQUE(name, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_memories_agent_tier_hb ON memories (agent_id, tier, heartbeat);
CREATE INDEX IF NOT EXISTS idx_memories_session_id ON memories (session_id);

-- Only create IVFFlat index if there are enough rows (skip on fresh DB)
-- CREATE INDEX IF NOT EXISTS idx_memories_embedding ON memories USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE OR REPLACE FUNCTION match_memories(
  query_embedding vector(384),
  match_agent_id text,
  match_count int DEFAULT 5
)
RETURNS TABLE (
  id uuid, memory_id text, heartbeat int, tier int,
  visual_description text, audio_state text,
  thought text, action_taken jsonb, outcome text,
  reward_signal float, goal_at_time text, light_state text
)
LANGUAGE sql STABLE
AS $$
  SELECT id, memory_id, heartbeat, tier,
         visual_description, audio_state,
         thought, action_taken, outcome,
         reward_signal, goal_at_time, light_state
  FROM memories
  WHERE agent_id = match_agent_id
    AND tier IN (1, 2)
    AND embedding IS NOT NULL
  ORDER BY embedding <-> query_embedding
  LIMIT match_count;
$$;

-- RLS: Enable and add permissive policies for service role
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE motor_programs ENABLE ROW LEVEL SECURITY;

-- Allow all operations for service role (bypass RLS)
CREATE POLICY "Service role full access on sessions" ON sessions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on memories" ON memories FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on skills" ON skills FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on motor_programs" ON motor_programs FOR ALL USING (true) WITH CHECK (true);

-- Allow public access so the frontend anon key can fetch/export and write
CREATE POLICY "Public full access on sessions" ON sessions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public full access on memories" ON memories FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public full access on skills" ON skills FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public full access on motor_programs" ON motor_programs FOR ALL USING (true) WITH CHECK (true);
