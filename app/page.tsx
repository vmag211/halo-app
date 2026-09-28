import { redirect } from 'next/navigation';

export default function Home() {
  redirect('/onboarding?entry=1');
}
