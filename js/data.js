'use strict';
/* Beispieldaten für den Prototyp. Über "Mehr" kannst du alles zurücksetzen. */
const SampleData = (() => {
  const i = (amount, unit, name) => ({ amount, unit, name });
  const dish = (name, tags, minutes, servings, ingredients, recipe) => ({ name, tags, minutes, servings, ingredients, recipe });

  const DISHES = [
    dish('Spaghetti mit Tomatensoße', ['Vegetarisch', 'Nudeln', 'Schnell'], 25, 4,
      [i(500, 'g', 'Spaghetti'), i(800, 'g', 'Tomaten aus der Dose'), i(1, 'Stück', 'Zwiebel'), i(2, 'Zehe', 'Knoblauch'), i(2, 'EL', 'Olivenöl'), i(null, '', 'Salz')],
      'Zwiebel und Knoblauch anbraten, Tomaten zugeben und 15 Minuten köcheln. Nudeln kochen und mischen.'),
    dish('Bolognese', ['Fleisch', 'Nudeln'], 50, 4,
      [i(500, 'g', 'Spaghetti'), i(500, 'g', 'Hackfleisch'), i(800, 'g', 'Tomaten aus der Dose'), i(1, 'Stück', 'Zwiebel'), i(2, 'Stück', 'Karotte'), i(null, '', 'Salz')],
      'Hack anbraten, Gemüse dazu, mit Tomaten 30 Minuten schmoren. Mit Nudeln servieren.'),
    dish('Gemüsecurry mit Reis', ['Vegan', 'Reis'], 35, 4,
      [i(300, 'g', 'Reis'), i(400, 'ml', 'Kokosmilch'), i(1, 'Stück', 'Paprika'), i(2, 'Stück', 'Karotte'), i(1, 'Stück', 'Zucchini'), i(2, 'EL', 'Currypaste')],
      'Gemüse anbraten, Currypaste und Kokosmilch zugeben, 15 Minuten köcheln. Reis dazu.'),
    dish('Hähnchen-Reis-Pfanne', ['Fleisch', 'Reis', 'Schnell'], 30, 4,
      [i(300, 'g', 'Reis'), i(500, 'g', 'Hähnchenbrust'), i(2, 'Stück', 'Paprika'), i(1, 'Stück', 'Zwiebel'), i(3, 'EL', 'Sojasoße')],
      'Reis kochen. Hähnchen und Gemüse anbraten, Reis und Sojasoße unterheben.'),
    dish('Ofenkartoffeln mit Kräuterquark', ['Vegetarisch', 'Kartoffeln'], 50, 4,
      [i(1.5, 'kg', 'Kartoffeln'), i(500, 'g', 'Quark'), i(1, 'Bund', 'Schnittlauch'), i(2, 'EL', 'Olivenöl'), i(null, '', 'Salz')],
      'Kartoffeln halbieren, ölen und 40 Minuten bei 200 °C backen. Quark mit Schnittlauch anrühren.'),
    dish('Linsensuppe', ['Vegan', 'Suppe'], 40, 4,
      [i(300, 'g', 'Linsen'), i(2, 'Stück', 'Karotte'), i(2, 'Stück', 'Kartoffeln'), i(1, 'Stück', 'Zwiebel'), i(1, 'l', 'Gemüsebrühe')],
      'Gemüse anbraten, Linsen und Brühe zugeben, 25 Minuten köcheln und abschmecken.'),
    dish('Tomatensuppe mit Brot', ['Vegetarisch', 'Suppe', 'Schnell'], 20, 2,
      [i(400, 'g', 'Tomaten aus der Dose'), i(1, 'Stück', 'Zwiebel'), i(250, 'ml', 'Gemüsebrühe'), i(1, 'Stück', 'Baguette')],
      'Zwiebel anschwitzen, Tomaten und Brühe zugeben, 10 Minuten kochen und pürieren.'),
    dish('Lachs mit Kartoffeln', ['Fisch', 'Kartoffeln'], 35, 2,
      [i(300, 'g', 'Lachsfilet'), i(600, 'g', 'Kartoffeln'), i(1, 'Stück', 'Zitrone'), i(200, 'g', 'Brokkoli')],
      'Kartoffeln kochen, Brokkoli dämpfen. Lachs von beiden Seiten braten und mit Zitrone servieren.'),
    dish('Fischstäbchen mit Kartoffelsalat', ['Fisch', 'Kartoffeln', 'Schnell'], 30, 4,
      [i(1, 'Packung', 'Fischstäbchen'), i(1, 'kg', 'Kartoffeln'), i(1, 'Stück', 'Zwiebel'), i(250, 'ml', 'Gemüsebrühe'), i(3, 'EL', 'Essig')],
      'Kartoffeln kochen, schneiden und mit warmer Brühe, Essig und Zwiebel mischen. Fischstäbchen braten.'),
    dish('Pfannkuchen', ['Vegetarisch', 'Schnell'], 25, 4,
      [i(300, 'g', 'Mehl'), i(3, 'Stück', 'Eier'), i(500, 'ml', 'Milch'), i(null, '', 'Salz')],
      'Teig verrühren, 10 Minuten ruhen lassen und portionsweise in der Pfanne ausbacken.'),
    dish('Chili con Carne', ['Fleisch', 'Groß'], 70, 6,
      [i(750, 'g', 'Hackfleisch'), i(800, 'g', 'Tomaten aus der Dose'), i(2, 'Dose', 'Kidneybohnen'), i(2, 'Stück', 'Paprika'), i(2, 'Stück', 'Zwiebel')],
      'Hack mit Zwiebeln anbraten, alles zugeben und mindestens 45 Minuten köcheln.'),
    dish('Gemüselasagne', ['Vegetarisch', 'Nudeln', 'Groß', 'Aufwendig'], 80, 6,
      [i(250, 'g', 'Lasagneplatten'), i(2, 'Stück', 'Zucchini'), i(800, 'g', 'Tomaten aus der Dose'), i(300, 'g', 'Käse'), i(500, 'ml', 'Milch')],
      'Gemüse-Tomaten-Soße und Béchamel kochen, schichten und 40 Minuten bei 180 °C backen.'),
    dish('Schweinebraten mit Klößen', ['Fleisch', 'Groß', 'Aufwendig'], 150, 6,
      [i(1.5, 'kg', 'Schweinebraten'), i(1, 'Packung', 'Klöße'), i(2, 'Stück', 'Zwiebel'), i(500, 'ml', 'Gemüsebrühe')],
      'Braten anbraten, mit Zwiebeln und Brühe gut zwei Stunden im Ofen schmoren. Klöße kochen.'),
    dish('Reispfanne mit Ei', ['Vegetarisch', 'Reis', 'Schnell'], 20, 2,
      [i(150, 'g', 'Reis'), i(2, 'Stück', 'Eier'), i(150, 'g', 'Erbsen'), i(2, 'EL', 'Sojasoße')],
      'Reis kochen und abkühlen lassen. Mit Erbsen und Ei braten, mit Sojasoße würzen.'),
    dish('Kartoffel-Lauch-Auflauf', ['Vegetarisch', 'Kartoffeln', 'Groß'], 60, 4,
      [i(1, 'kg', 'Kartoffeln'), i(2, 'Stück', 'Lauch'), i(200, 'g', 'Käse'), i(250, 'ml', 'Sahne')],
      'Kartoffeln und Lauch schichten, Sahne darüber, mit Käse 40 Minuten backen.'),
    dish('Wraps mit Hähnchen', ['Fleisch', 'Schnell'], 25, 4,
      [i(1, 'Packung', 'Wraps'), i(400, 'g', 'Hähnchenbrust'), i(1, 'Stück', 'Salat'), i(2, 'Stück', 'Tomaten'), i(150, 'g', 'Joghurt')],
      'Hähnchen in Streifen braten. Alles mit Salat, Tomaten und Joghurt in die Wraps füllen.'),
    dish('Gnocchi mit Spinat', ['Vegetarisch', 'Schnell'], 15, 2,
      [i(500, 'g', 'Gnocchi'), i(300, 'g', 'Spinat'), i(150, 'ml', 'Sahne'), i(1, 'Zehe', 'Knoblauch')],
      'Gnocchi anbraten, Knoblauch und Spinat zugeben, mit Sahne kurz einkochen.'),
    dish('Bohneneintopf', ['Vegan', 'Suppe', 'Groß'], 45, 6,
      [i(3, 'Dose', 'weiße Bohnen'), i(3, 'Stück', 'Karotte'), i(4, 'Stück', 'Kartoffeln'), i(1.5, 'l', 'Gemüsebrühe')],
      'Gemüse würfeln, in Brühe 25 Minuten kochen, Bohnen zugeben und abschmecken.'),
  ];

  const LIMITS = [
    { tag: 'Fleisch', max: 2 },
    { tag: 'Nudeln', max: 2 },
    { tag: 'Reis', max: 2 },
    { tag: 'Fisch', max: 1 },
    { tag: 'Aufwendig', max: 1 },
  ];

  return { DISHES, LIMITS };
})();
