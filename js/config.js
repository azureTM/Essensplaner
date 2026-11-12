// Zugangsdaten für Supabase (siehe ANLEITUNG.md, Schritt 4).
// Bleiben beide Felder leer, läuft die App im lokalen Testmodus mit Beispielgerichten.
// Hier gehört nur der öffentliche Schlüssel hin ("Publishable key" oder "anon").
// Niemals den geheimen Schlüssel ("Secret key" oder "service_role") eintragen.
window.APP_CONFIG = {
  supabaseUrl: 'https://mfndnjxqxvytdwzvruzm.supabase.co',
  supabaseKey: 'sb_publishable_oV9lYE4b_fYLOay_yGeJRg_5KEyfDS-',
  // false: Neue Gruppen lassen sich nicht mehr erstellen, nur noch beitreten.
  // Die eigentliche Sperre liegt in Supabase (siehe ANLEITUNG.md), das hier blendet nur den Button aus.
  allowNewGroups: false,
};
