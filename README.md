# ATHX Epicure Manager (GitHub Pages)

Site statique pour la gestion de la compétition ATHX Epicure.

## Pages incluses

- `index.html` : configuration principale + statut de synchronisation cloud
- `dashboard.html` : redirection vers l'entité TV séparée
- `equipes.html` : gestion des athlètes
- `planning.html` : planning des heats (2 athlètes/heat, départ toutes les 20 min configurable)
- `epreuves.html` : gestion des épreuves
- `scores.html` : saisie des performances et points
- `classement.html` : classement général

## Dashboard TV séparé

- `../tv-dashboard/index.html` : entité dédiée TV
- Ce fichier charge exactement `../tv-screen/athx-epicure-FINAL_18.html`

## Déploiement GitHub Pages

1. Crée un dépôt GitHub et pousse le dossier `athx-epicure-manager`.
2. Dans GitHub : **Settings > Pages**.
3. Source : **Deploy from a branch**.
4. Branche : `main` (ou `master`), dossier `/ (root)`.
5. Ouvre l'URL GitHub Pages générée.

## Persistance cloud (Supabase)

Le site reste statique (GitHub Pages), avec stockage en mode cloud (Supabase).

1. Cree un projet Supabase.
2. Cree la table SQL suivante :

```sql
create table if not exists public.competition_states (
  id text primary key,
  state jsonb not null,
  updated_at timestamptz not null default now()
);
```

3. Vérifie que les policies RLS autorisent lecture/écriture avec la clé publishable.

## Paramètres ATHX

Dans `index.html`, tu peux régler :
- heure du 1er départ,
- intervalle de départ (20 min par défaut),
- nombre d'athlètes par heat (2 par défaut).
