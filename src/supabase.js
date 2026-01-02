import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('ERROR: Missing Supabase environment variables');
  console.error('Required: SUPABASE_URL and SUPABASE_ANON_KEY');
  console.error('Get these from: https://supabase.com/dashboard -> Project Settings -> API');
  process.exit(1);
}

if (!supabaseServiceKey) {
  console.warn('WARNING: SUPABASE_SERVICE_ROLE_KEY not set. Storage operations may fail.');
  console.warn('Get it from: https://supabase.com/dashboard -> Project Settings -> API -> service_role key');
}

// Use service role key for server-side operations (bypasses RLS)
// This is safe because we validate the user's JWT in authMiddleware first
export const supabase = createClient(supabaseUrl, supabaseServiceKey || supabaseAnonKey);

// Middleware to verify JWT token from Authorization header
export async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(401).json({ error: 'Authentication failed' });
  }
}
