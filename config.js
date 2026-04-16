// config.js — Supabase connection config.
// THIS FILE IS GITIGNORED. Do not commit credentials to source control.
// Copy config.example.js → config.js and fill in your own values.
//
// Load order: config.js must come BEFORE supabase.js in every HTML page.

const SUPABASE_URL = 'https://rvbsrpcixttfdrhzmqhz.supabase.co';

// Anon key — safe to expose in a browser app (row-level security enforces access),
// but still best kept out of git history.
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ2YnNycGNpeHR0ZmRyaHptcWh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwMDkyMTYsImV4cCI6MjA4OTU4NTIxNn0.GCHzI2PxgMAUP8tdfmg7aq2qpRxRhvxLeXaQpThOaMM';
