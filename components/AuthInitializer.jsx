"use client";

import { useEffect } from 'react';
import { signInAnonymously } from '../lib/auth';

export default function AuthInitializer() {
  useEffect(() => {
    // This fires once automatically when the component mounts
    async function initAuth() {
      await signInAnonymously();
    }
    
    initAuth();
  }, []);

  return null; // Renders absolutely nothing to the screen
}