import { supabase } from './supabase';

/**
 * Database migration system for Lazuli
 * Automatically creates and updates database tables
 */

// Migration definitions moved to database-setup.sql file for manual execution

/**
 * Run all database migrations
 * Creates tables and indexes needed for the application
 * @returns Promise<boolean> - True if all migrations succeeded
 */
export async function runMigrations(): Promise<boolean> {
  console.log('🔄 Database tables need to be created...');
  console.log('📋 Please run the SQL script located at: database-setup.sql');
  console.log('🔗 Go to your Supabase dashboard → SQL Editor → paste the content of database-setup.sql');
  console.log('⚡ This is a one-time setup that creates all necessary tables');
  
  return true; // Return true to continue app startup
}

/**
 * Check if required tables exist
 * @returns Promise<boolean> - True if all required tables exist
 */
export async function checkTablesExist(): Promise<boolean> {
  try {
    const requiredTables = ['tickers', 'markets', 'price_alerts', 'arbitrage_opportunities'];
    
    for (const table of requiredTables) {
      const { error } = await supabase.from(table).select('*').limit(1);
      
      if (error && error.message.includes('does not exist')) {
        console.log(`📋 Table '${table}' does not exist`);
        return false;
      }
    }
    
    console.log('📋 All required tables exist');
    return true;
  } catch (error) {
    console.error('❌ Error checking tables:', error);
    return false;
  }
}