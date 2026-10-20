import { createClient} from '@supabase/supabase-js'
import { lazyClient } from './lazyClient.js'

// Create a single supabase client for interacting with your database. It is
// built on first use, not at import, so `next build` needs no secrets.
export const supabase = lazyClient(() => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    if (!supabaseUrl || !supabaseAnonKey) {
        console.error("Missing Supabase environment variables. Check your .env.local file.")
    }

    return createClient(supabaseUrl, supabaseAnonKey)
})
