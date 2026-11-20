// Where the leaderboard keeps everyone's scores.
//
// binUrl: a free JSON store that needs no account. It works today, but it is a small public
// service: anyone who finds the address can change it, and it may not be kept forever.
//
// For a sturdier leaderboard, clear binUrl and fill in a Supabase project's URL and its public
// "anon" key instead. tools/leaderboard.sql creates the table that needs.
//
// With all three empty the leaderboard keeps scores on this device only.
window.SCOREGAME_CONFIG = {
  binUrl: "https://extendsclass.com/api/json-storage/bin/bededeb",
  supabaseUrl: "",
  supabaseKey: "",
};
