# Essensplan online bringen

Einmalig, insgesamt etwa 20 Minuten. Danach können alle die App auf dem Handy installieren und sehen dieselben Gerichte und Pläne.

## 1. Supabase-Projekt anlegen

1. Auf [supabase.com](https://supabase.com) ein kostenloses Konto anlegen. Die Anmeldung mit GitHub geht am schnellsten.
2. **New project** wählen:
   - Name: `Essensplan`
   - Database Password: ein sicheres Passwort, das du gut aufbewahrst. Die App braucht es nicht.
   - Region: **Central EU (Frankfurt)**
   - **Enable Data API** eingeschaltet lassen, die App braucht sie.
3. Warten, bis das Projekt fertig ist. Das dauert ein bis zwei Minuten.

## 2. Anonyme Anmeldung einschalten

In der App gibt es kein Passwort, nur Gruppencode und Namen. Dafür braucht Supabase die anonyme Anmeldung:

**Authentication** → **Sign In / Providers** → **Allow anonymous sign-ins** einschalten und speichern.

## 3. Tabellen anlegen

1. Links **SQL Editor** öffnen und eine neue Abfrage starten.
2. Den kompletten Inhalt der Datei `supabase/schema.sql` hineinkopieren.
3. Auf **Run** klicken. Am Ende sollte „Success“ erscheinen.

## 4. Zugangsdaten eintragen

Unter **Project Settings** → **API Keys** (die URL steht unter **Data API**) findest du:

- die **Project URL**, z. B. `https://abcdefgh.supabase.co`
- den **Publishable key**, der mit `sb_publishable_` beginnt. Bei älteren Projekten heißt er „anon“.

Beides in `js/config.js` eintragen oder mir schicken. Der Publishable key darf öffentlich in der App stehen, denn die Zugriffsregeln aus Schritt 3 schützen eure Daten.

> Den **Secret key** (früher „service_role“) niemals eintragen oder weitergeben. Er hebelt alle Zugriffsregeln aus.

## 5. Auf GitHub Pages veröffentlichen

1. Auf GitHub ein neues **öffentliches** Repository anlegen, z. B. `essensplan`.
2. Alle Dateien aus diesem Ordner hochladen, entweder per Git oder über **Add file** → **Upload files**. Dort kannst du die Dateien und Ordner einfach hineinziehen. Den Ordner `.claude` brauchst du nicht.
3. Im Repository unter **Settings** → **Pages** bei **Branch** `main` und `/ (root)` wählen und speichern.
4. Nach ein bis zwei Minuten läuft die App unter `https://DEIN-NAME.github.io/essensplan/`.

## 6. Auf dem Handy installieren

1. Die Adresse öffnen, eine Gruppe erstellen und unter **Mehr** → **Gruppe** → **Einladung teilen** den Link an die anderen schicken. Der Link füllt den Gruppencode automatisch aus.
2. Auf den Startbildschirm legen:
   - **Android (Chrome):** Menü (⋮) → **App installieren** bzw. **Zum Startbildschirm hinzufügen**
   - **iPhone (Safari):** Teilen-Symbol → **Zum Home-Bildschirm**

## Gut zu wissen

- **Pause im kostenlosen Plan:** Wird die App etwa eine Woche lang von niemandem geöffnet, pausiert Supabase das Projekt. Im Supabase-Dashboard lässt es sich mit einem Klick wieder starten, die Daten bleiben erhalten.
- **Updates:** Einfach die geänderten Dateien erneut ins Repository hochladen. Die Handys holen sich die neue Version beim nächsten Öffnen mit Internet.
- **Offline:** Die App startet auch ohne Netz und zeigt den letzten Stand. Änderungen werden gespeichert, sobald wieder Verbindung da ist.
- **Gerät gewechselt oder Browserdaten gelöscht:** Einfach mit dem Gruppencode neu beitreten. Die Daten der Gruppe sind dann alle wieder da.
