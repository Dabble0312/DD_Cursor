// supabase.js — Single source of truth for the Supabase client.
// Load order in every HTML page:
//   1. config.js          ← defines SUPABASE_URL + SUPABASE_ANON_KEY (gitignored)
//   2. supabase CDN        ← window.supabase
//   3. supabase.js (this)  ← creates the client
//   4. page script(s)

const supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
);