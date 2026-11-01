# Globale arbejdsregler

Gælder i alle projekter. Projektets egen CLAUDE.md og udtrykkelige instruktioner i opgaven har forrang.

## Effektiv arbejdsproces

1. **Forberedelse:** Før større opgaver: giv en kort plan, og identificér de sandsynligt relevante filer, tests og dokumentation. Læs uafhængige filer samlet. Tilpas forberedelsen til opgavens størrelse; små opgaver kræver ingen plan.
2. **Målrettet søgning:** Undersøg selv projektets struktur, afhængigheder og dokumentation i stedet for at spørge. Søg målrettet, og læs flere filer, når nye fund gør dem relevante, frem for at indlæse hele projektet på forhånd.
3. **Sammenhængende ændringer:** Brug den mindst omfattende arbejdsgang, der stadig giver et pålideligt resultat. Genbrug kontekst og analyser, du allerede har, i stedet for at starte forfra. Genlæs kun kode, når den er ændret, konteksten er utilstrækkelig, eller en konkret påstand skal kontrolleres.
4. **Relevante kontroller:** Kontrollér, at ændringen faktisk virker, med de kontroller, der kan afsløre fejl i netop den. Ved fejlretning: reproducér fejlen før rettelsen, når det er praktisk. Overhold projektets krævede kontroller.
5. **Proportionel testning:** Kør ikke hele testsuiten efter hver lille redigering, og gentag ikke kontroller uden grund. Når en kontrol fejler: find årsagen, ret den, og genkør de berørte kontroller. Udvid testningen, når nye ændringer, fund eller projektkrav giver en konkret grund.
6. **Ærlige påstande:** Underbyg påstande om eksisterende funktioner med aktuel kode eller observeret adfærd, gerne med fil og linje. Skeln mellem *implementeret* (koden findes), *testet* (tests består) og *verificeret* (observeret virke i praksis). Skjul aldrig fejl, manglende tests eller usikkerhed.
7. **Selvstændig gennemførelse:** Gennemfør tydelige, autoriserede opgaver til ende uden unødvendige spørgsmål. Stop og spørg før destruktive handlinger, væsentlige arkitekturændringer eller beslutninger uden for den aftalte ramme. Afslut med en kort oversigt over ændringer, udførte kontroller og udeståender; undgå lange statusrapporter undervejs.

## Git og parallelle sessioner

- Tjek branch og `git status` før større ændringer, og arbejd på den aftalte branch.
- Ændringer, du ikke selv har lavet, kan tilhøre andre udviklere eller AI-agenter: overskriv, nulstil eller commit dem ikke. Stage kun dine egne filer.
- Hent seneste ændringer før push, og løs konflikter ved at flette, ikke ved at overskrive.
- Kræver udtrykkelig godkendelse: `reset --hard`, `clean`, kassering af andres ændringer, force-push, omskrivning af delt historik, sletning af branches samt merge eller push til hovedbranchen.
