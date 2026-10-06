# BTS Lift

Dansk PWA med det oprindelige BTS-program og Min-Max Phase 2: Peak Physique.
Programmet vælges øverst på forsiden. Uge, vægte, alternativer og afstregninger
gemmes separat. Første besøg for eksisterende brugere beholder BTS og deres uge.
Nye installationer åbner Min-Max.

## Min-Max-programmet

- 12 uger: Upper, Lower, hvile, Push, Pull, hvile.
- Uge 1 er introduktion, uge 7 er deload, uge 8–12 indeholder intensitetsteknikker.
- 396 øvelsesrækker i hovedprogrammet, inklusive separate rækker med høje reps.
- RIR pr. sæt, opvarmningssæt, pauser, tekniknoter og alle øvelsers og alternativers videolinks.
- Supersæt S1 skifter efter hvert sæt. Curl har ingen pause; efter skull crusher er pausen 30–60 sekunder.
- Arms / Delts er et **valgfrit tillæg**, gentaget som samme skabelon hver uge.
  Den leverede `ARMS DAY.pdf` indeholder kun uge 1. Dette er ikke en rekonstruktion
  af en anden officiel 12-ugers version med fem dage. Dead Hang er også valgfri.

Data er overført fra brugerens Phase 2-PDF og kontrolleret mod
`min-max-phase2-program-1.xlsx`. Alle 396 rækker og RIR-mål er sammenholdt.
PDF-tabellerne bestemmer, hvor regnearkets generelle guide er upræcis:
intro/deload betyder ikke samme RIR for alle øvelser. PDF'ens `0` opvarmningssæt
bruges i stedet for arkets `-`. Curl-pausen følger PDF'ens superset i stedet for
arkets angivelse af 30–60 sekunder ved begge øvelser.
Kildedokumenterne indgår ikke i repositoryet. JSON-data har kildeside og arkrække.

## Lokal kørsel

Statisk visning uden backupserver:

```sh
python -m http.server 8787 --bind 127.0.0.1
```

`server.py` er den eksisterende valgfrie backupserver. Den skriver også til
brugerens OneDrive-mappe. GitHub Pages har ikke denne server.

## Data og kompatibilitet

LocalStorage-nøglen `bts-lift-v1` bevares. Skema 2 bruger `activeProgram` og
`programWeeks`. BTS beholder sine oprindelige `wN|dN|eN`-nøgler. Min-Max bruger
præfikset `min-max-phase-2|`. Før migrering gemmes en kopi i
`bts-lift-v1-before-programs`, hvis lagerpladsen tillader det. Migrationen ændrer
ikke eksisterende sæt eller fuldførelsesmarkeringer.

Fil- og skybackup indeholder begge programmer. Gendannelse fletter logs og bevarer
nyere lokale registreringer samt andre programmers historik. Nulstilling gælder
kun det valgte program. Det oprindelige `program.json` er uændret.

Service worker v19 cacher begge programmer og kun appens statiske filer.
Backup-API'er og eksterne svar caches ikke. Efter en udgivelse kan en allerede
åben installation kræve, at man lukker og åbner appen igen online.

## Tests

```sh
node --test tests/program-state.test.cjs
node tests/browser.cjs
```

Browsertesten kræver Playwright og en installeret Chromium-browser. Den starter
sin egen midlertidige server og bruger isolerede browserdata. HTTPS-kald blokeres,
så testlogs aldrig opretter en skybackup. `BROWSER_CHANNEL` kan vælge fx `chrome`,
og `SHOT_DIR` kan angive en eksisterende mappe til skærmbilleder.

Testene dækker programdata, migration, separate logs, alternativer, RIR,
supersæt, sekunder/minutter, gamle og nye backups, nulstilling og offline-brug.
