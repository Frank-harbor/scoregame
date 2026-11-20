// Leaderboard storage. Leave both empty and the leaderboard keeps scores on this device only.
// Fill them in with a Supabase project's URL and its public "anon" key to share one leaderboard
// with everyone who plays. tools/leaderboard.sql creates the table it needs.
window.SCOREGAME_CONFIG = {
  supabaseUrl: "",
  supabaseKey: "",
};
