import { supabase } from './supabase';

/**
 * Generates a randomized anonymous handle (e.g. "Raccoon#3048")
 */
function generateAnonymousName() {
  const animals = [
    'Raccoon', 'Panda', 'Falcon', 'Otter', 'Fox', 
    'Koala', 'Lynx', 'Badger', 'Bear', 'Owl', 
    'Bison', 'Hedgehog', 'Hawk', 'Panther', 'Moose', 'Coyote', 'Beaver', 'Wolverine', 'Cougar', 'Eagle', 'Jaguar', 'Lemur', 
    'Mongoose', 'Ocelot', 'Porcupine', 'Raven', 'Seahorse', 'Tortoise', 'Walrus', 'Zebra'
  ];

  const randomAnimal = animals[Math.floor(Math.random() * animals.length)];
  const randomNumber = Math.floor(1000 + Math.random() * 9000); // 1000 to 9999

  return `${randomAnimal}#${randomNumber}`;
}

/**
 * Main initialization function for Anonymous Auth:
 * 1. Checks if a user already has an active session (prevents duplicate sign-ins).
 * 2. Creates a new anonymous session in Supabase if no session exists.
 * 3. Ensures a matching row exists in the 'profiles' table with their unique display name.
 * * @returns {Promise<object|null>} The authenticated Supabase user object, or null on failure.
 */
export async function signInAnonymously() {
  try {
    let user = null;

    // 1. Check if the user already has an existing session in local browser storage
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

    if (sessionError) {
      console.error('Error fetching existing session:', sessionError.message);
    }

    if (sessionData?.session?.user) {
      // Reuse existing authenticated user
      user = sessionData.session.user;
    } else {
      // 2. No session found — create a new anonymous auth session
      const { data: authData, error: authError } = await supabase.auth.signInAnonymously();

      if (authError) {
        console.error('Error signing in anonymously:', authError.message);
        return null;
      }

      user = authData.user;
    }

    // 3. Ensure a matching profile row exists in the 'profiles' database table
    if (user) {
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

      if (profileError) {
        console.error('Error checking profile:', profileError.message);
      }

      // If no profile row exists, create one with their assigned anonymous tag
      if (!profile) {
        const anonymousName = generateAnonymousName();

        const { error: insertError } = await supabase
          .from('profiles')
          .insert([
            {
              id: user.id,
              display_name: anonymousName,
            }
          ]);

        if (insertError) {
          console.error('Error creating profile row:', insertError.message);
        }
      }
    }

    return user;
  } catch (err) {
    console.error('Unexpected error during anonymous authentication:', err);
    return null;
  }
}