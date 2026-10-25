import { createClient} from '@supabase/supabase-js'
import { lazyClient } from './lazyClient.js'
import { GOOGLE_CALLBACK_PATH } from './googleSignin.js'

/**
 * supabase-js's own test for "this URL carries a sign-in" (detectSessionInUrl),
 * with one exception: on the Google link callback the page checks the returned
 * session itself before adopting it (lib/googleSignin.js), so the client must
 * not adopt it first. Everywhere else the default behaviour is unchanged.
 */
export function detectSessionInUrl(url, params) {
    if (url.pathname === GOOGLE_CALLBACK_PATH) return false
    return Boolean(params.access_token || params.error || params.error_description || params.error_code)
}

// Create a single supabase client for interacting with your database. It is
// built on first use, not at import, so `next build` needs no secrets.
export const supabase = lazyClient(() => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    if (!supabaseUrl || !supabaseAnonKey) {
        console.error("Missing Supabase environment variables. Check your .env.local file.")
    }

    return createClient(supabaseUrl, supabaseAnonKey, { auth: { detectSessionInUrl } })
})
