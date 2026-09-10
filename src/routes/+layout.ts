// The app is entirely client-side realtime — no server rendering to gain.
// Turning SSR off keeps browser APIs (localStorage, WebAudio, Supabase auth)
// simple to reason about.
export const ssr = false;
export const prerender = false;
