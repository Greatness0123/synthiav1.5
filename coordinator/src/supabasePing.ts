/**
 * 3-day keepalive ping to prevent free tier pause.
 */

import { createClient } from '@supabase/supabase-js';

export function setupSupabasePing(url: string, key: string) {
  const supabase = createClient(url, key);

  const ping = async () => {
    try {
      const { data, error } = await supabase.from('sessions').select('id').limit(1);
      if (error) throw error;
      console.log('Supabase keepalive ping successful');
    } catch (err) {
      console.error('Supabase keepalive ping failed:', err);
    }
  };

  // 3 days in ms
  setInterval(ping, 259200000);

  // Also run once on startup
  ping();
}
