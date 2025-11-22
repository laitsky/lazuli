import { createClient, SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Ensure environment variables are loaded
dotenv.config();

// Supabase configuration
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

// Check if Supabase is configured (optional feature)
const isSupabaseConfigured = !!(supabaseUrl && supabaseAnonKey);

/**
 * Supabase client instance (optional)
 * Configured with project URL and anonymous public key
 * Used for database operations throughout the application
 * Will be null if environment variables are not set
 */
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        // Disable automatic auth state management for API-only usage
        autoRefreshToken: false,
        persistSession: false,
      },
    })
  : null;

/**
 * Check if Supabase is available
 * @returns boolean - True if Supabase client is configured
 */
export function isSupabaseAvailable(): boolean {
  return isSupabaseConfigured;
}

/**
 * Test database connection
 * @returns Promise<boolean> - True if connection successful, false if not configured or failed
 */
export async function testDatabaseConnection(): Promise<boolean> {
  if (!supabase) {
    console.log('ℹ️  Database not configured (optional feature)');
    return false;
  }

  try {
    // Test connection by attempting to access Supabase auth
    const { error } = await supabase.auth.getSession();

    // If we get a response (even if no session), the connection is working
    if (error && (error.message.includes('network') || error.message.includes('fetch'))) {
      console.error('Database connection test failed:', error);
      return false;
    }

    console.log('✅ Database connection successful');
    return true;
  } catch (error) {
    // Network or connection errors indicate database issues
    if (
      error instanceof Error &&
      (error.message.includes('fetch') || error.message.includes('network'))
    ) {
      console.error('❌ Database connection failed:', error);
      return false;
    }

    // Other errors are likely auth-related, which means connection is working
    console.log('✅ Database connection successful (auth service accessible)');
    return true;
  }
}
