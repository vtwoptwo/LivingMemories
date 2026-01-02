// Supabase Auth Client Module
const SUPABASE_URL = window.SUPABASE_URL;
const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY;

let supabaseClient = null;

// Initialize Supabase client
function initSupabase() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error('Supabase configuration not found');
    return null;
  }

  if (!supabaseClient) {
    supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return supabaseClient;
}

// Get current session
async function getSession() {
  const client = initSupabase();
  if (!client) return null;

  const { data: { session }, error } = await client.auth.getSession();
  if (error) {
    console.error('Get session error:', error);
    return null;
  }
  return session;
}

// Get current user
async function getCurrentUser() {
  const session = await getSession();
  return session?.user || null;
}

// Get access token for API calls
async function getAccessToken() {
  const session = await getSession();
  return session?.access_token || null;
}

// Sign up with email and password
async function signUp(email, password) {
  const client = initSupabase();
  if (!client) throw new Error('Supabase not initialized');

  const { data, error } = await client.auth.signUp({
    email,
    password,
  });

  if (error) throw error;
  return data;
}

// Sign in with email and password
async function signIn(email, password) {
  const client = initSupabase();
  if (!client) throw new Error('Supabase not initialized');

  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });

  if (error) throw error;
  return data;
}

// Sign out
async function signOut() {
  const client = initSupabase();
  if (!client) throw new Error('Supabase not initialized');

  const { error } = await client.auth.signOut();
  if (error) throw error;
}

// Listen to auth state changes
function onAuthStateChange(callback) {
  const client = initSupabase();
  if (!client) return { data: { subscription: null } };

  return client.auth.onAuthStateChange((event, session) => {
    callback(event, session);
  });
}

// Check if user is authenticated and redirect if not
async function requireAuth(redirectTo = '/login.html') {
  const user = await getCurrentUser();
  if (!user) {
    window.location.href = redirectTo;
    return false;
  }
  return true;
}

// Redirect if already authenticated
async function redirectIfAuthenticated(redirectTo = '/') {
  const user = await getCurrentUser();
  if (user) {
    window.location.href = redirectTo;
    return true;
  }
  return false;
}

// Make authenticated API request
async function authFetch(url, options = {}) {
  const token = await getAccessToken();

  if (!token) {
    throw new Error('Not authenticated');
  }

  const headers = {
    ...options.headers,
    'Authorization': `Bearer ${token}`,
  };

  return fetch(url, { ...options, headers });
}

// Export auth functions
window.Auth = {
  initSupabase,
  getSession,
  getCurrentUser,
  getAccessToken,
  signUp,
  signIn,
  signOut,
  onAuthStateChange,
  requireAuth,
  redirectIfAuthenticated,
  authFetch,
};
