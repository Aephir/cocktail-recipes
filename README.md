# Walden's Cocktail Book

A private, web-based cocktail recipe database. Manage your collection of cocktail recipes with ingredients, tools, procedures, ratings, and custom fields. Designed for personal use with admin-only editing.

## Features

- **Recipe Management**: Add, edit, and delete cocktail recipes
- **Ingredients & Tools**: Track ingredients with amounts/units and required tools
- **Garnish Support**: Add garnish text or ingredient-based garnish items separately from recipe ingredients
- **Recipe Linking**: Recipes can reference other recipes as ingredients (e.g., for syrups or infusions)
- **Ratings**: Rate recipes 1-10 and sort by rating
- **Custom Fields**: Add flexible fields like source URLs or notes
- **Search & Filter**: Filter by ingredients/tools, search by name
- **Classification Model**: Category + subtype model including ingredient recipes
- **Bulk Import**: Import multiple recipes via JSON (with AI parsing support)
- **Mobile-Friendly**: Responsive design for phones and tablets
- **Admin-Only Editing**: Private collection with login-based access

## Setup

### Prerequisites
- Docker and Docker Compose
- Portainer (for deployment)

### Deployment
1. Clone this repository
2. In Portainer, create a new stack from Git:
   - Repository URL: `https://github.com/Aephir/cocktail-recipes`
   - Branch: `main`
3. Set environment variables in Portainer using the table below
4. Deploy the stack
5. Access at `http://your-portainer-url:<APP_PUBLISH_PORT>`

### Portainer Stack Environment Variables

Use these in the Portainer "Environment variables" UI when creating from repository.

| Key | Example value | Required | Notes |
| --- | --- | --- | --- |
| `SECRET_KEY` | `openssl rand -hex 32` output | Yes | Flask session signing key. |
| `ADMIN_PASSWORD` | `change-me` | Yes | Password for admin account. |
| `USER_PASSWORD` | `guest-readonly` | No | Password for optional read-only account. |
| `ADMIN_USERNAME` | `admin` | No | Defaults to `admin`. |
| `USER_USERNAME` | `user` | No | Defaults to `user`. |
| `APP_PUBLISH_PORT` | `5000` | No | Host port mapped to container port `5000`. |
| `DATA_HOST_DIR` | `/mnt/storage_1/docker/cocktail_recipes` | Recommended | Host path for persistent DB/uploads. If omitted, compose named volume `cocktail_data` is used. |
| `DATABASE_URL` | `sqlite:////data/cocktails.db` | No | Override DB connection string. Default uses `/data`. |
| `UPLOAD_FOLDER` | `/data/uploads` | No | Upload path inside container. Keep under mounted `/data`. |
| `COOKIE_SECURE` | `true` | No | Set `true` when served over HTTPS. |
| `COOKIE_SAMESITE` | `Lax` | No | Session cookie SameSite policy. |

### Portainer Notes

1. This compose file reads values directly from stack environment variables and does not require a physical `.env` file.
2. `cocktail_net` is configured as an external Docker network so this app can communicate with the MCP container by service name.
3. Ensure `DATA_HOST_DIR` exists and is writable by Docker if you use a host path bind mount.

The app will automatically create the database and seed users on first run.

### Version
Current release: `v0.1.6`

We use releases with standard versioning (vX.Y.Z). There will also be a tag=stable.

#### Use the tag in Portainer
- In the stack settings, set the Git reference to the tag name instead of `main` (e.g., `refs/heads/v0.0.6`, `refs/heads/v0.1.0`, or `refs/heads/stable`)
- Redeploy the stack


### Local Development
```bash
docker-compose up --build
```

## Usage

### Login
- **Admin**: Username `admin`, password from `ADMIN_PASSWORD`
- **User**: Username `user`, password from `USER_PASSWORD` (read-only)

### Adding Recipes
- Click "+ New Recipe" (admin only)
- Fill in name, category/subtype, rating (1-10 for drink recipes), ingredients, tools, procedure, notes
- Ingredients can be regular items or linked to other recipes
- Upload images if desired

### Classification Model

Categories:

- `Cocktail`
- `Highball`
- `Collins`
- `Rickey`
- `Buck`
- `Fizz`
- `Julep`
- `Smash`
- `Cobbler`
- `Swizzle`
- `Sling`
- `Toddy`
- `Punch`
- `Cup`
- `Flip`
- `Nog`
- `Fix`
- `Crusta`
- `Frappé`
- `Shrub`
- `Wassail Bowl`
- `Champerelle`
- `Other`
- `Ingredient`

Subtype rules:

- For category `Cocktail`: `Sour`, `Aromatic`, `Old-Fashioned`, `Improved`, `Daisy`
- For category `Other`: `Sour`, `Aromatic`, `Old-Fashioned`, `Improved`, `Daisy`
- For category `Ingredient`: `Base`, `Modifier`, `Special Flavoring`, `Garnish`, `Other`
- All other categories: no subtype

Single-axis decision (current):

- The app uses one classification axis: `category` plus an optional `subtype`.
- `Cocktail`, `Other`, and `Ingredient` support subtype.
- All other categories are top-level families and intentionally do not support subtype.

### JSON Schema (For Automation / MCP / Bulk Tools)

Machine-readable schema bundle:

- `schema/recipe-api.schema.json`
- `schema/import-upsert.schema.json` (future tool-facing policy envelope for overwrite/merge behavior)

Main definitions inside that file:

- `RecipeCreateInput`
- `RecipeUpdateInput`
- `RecipeRead`
- `BulkImportRequest`
- `BulkImportResponse`
- `CustomFieldDef`

This is the recommended source for building import/export scripts, AI transforms, and future MCP tooling.

Example future import-upsert envelope:

```json
{
  "policy": {
    "match": { "strategy": "name+category", "name_case_sensitive": false, "trim_whitespace": true },
    "on_match": "merge",
    "on_missing": "create",
    "field_merge": {
      "scalar_fields": "replace",
      "tags": "union",
      "ingredients": "replace",
      "tools": "replace",
      "garnishes": "replace",
      "custom_fields": "merge",
      "image": "replace_if_missing"
    }
  },
  "dry_run": true,
  "items": [
    {
      "name": "Classic Daiquiri",
      "category": "Cocktail",
      "subtype": "Sour",
      "score": 8,
      "ingredients": [
        { "amount": 2, "unit": "oz", "ingredient_name": "white rum" },
        { "amount": 1, "unit": "oz", "ingredient_name": "lime juice" },
        { "amount": 0.75, "unit": "oz", "ingredient_name": "simple syrup" }
      ],
      "glassware": "coupe",
      "tools": ["shaker"],
      "garnishes": [],
      "procedure": "Shake with ice and fine strain.",
      "notes": "",
      "custom_fields": {}
    }
  ]
}
```

Note: The current app endpoint `POST /api/bulk-import` still accepts a plain JSON array of recipes. The upsert policy envelope is added now to support future importer/dev-tool/MCP implementation.

### Admin Automation Endpoints (MCP-Facing)

The app now exposes admin endpoints for deterministic automation tasks. These are intended for MCP and power-user tooling.

All destructive operations support preview mode with `dry_run=true` (default), and only commit when `dry_run=false`.

- `POST /api/admin/ingredients`
- `PUT /api/admin/ingredients/:id`
- `DELETE /api/admin/ingredients/:id?dry_run=true&force=false`
- `POST /api/admin/ingredients/merge`
- `POST /api/admin/tools`
- `PUT /api/admin/tools/:id`
- `DELETE /api/admin/tools/:id?dry_run=true&force=false`
- `POST /api/admin/tools/merge`
- `POST /api/admin/recipes/bulk-update`
- `GET /api/admin/operations?limit=50`

Merge example (preview):

```bash
curl -sS -X POST http://your-app/api/admin/ingredients/merge \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"source_id": 12, "target_name": "Cucumber", "dry_run": true}'
```

Merge example (apply):

```bash
curl -sS -X POST http://your-app/api/admin/ingredients/merge \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"source_id": 12, "target_name": "Cucumber", "dry_run": false}'
```

The merge operation rewrites references in `recipe_ingredients` and `recipe_garnishes`, updates matching garnish text, and deletes the merged source item on apply.

### MCP Sync Handoff (Private GitHub Repos)

This repo includes scaffolding for automatic handoff to the MCP repo.

- Contract export script: `scripts/export_mcp_contract.py`
- Workflow: `.github/workflows/mcp-contract-sync.yml`

Expected behavior:

1. On push to `main`, if API/schema/docs changed, export contract artifacts.
2. Create/update a branch in MCP repo (`Aephir/cocktail-recipes-mcp`) with those artifacts.
3. Open/update a PR in MCP repo with summary metadata.

To enable cross-repo sync, configure a repository secret in this repo:

- The workflow uses `github.token` by default.
- If your runner token cannot write to the MCP repo, update `.github/workflows/mcp-contract-sync.yml` to use a fine-grained PAT or GitHub App token with `contents:write` and `pull_requests:write` for the MCP repo.

### Bulk Importing Recipes

If you have recipes in messy formats (e.g., copied from websites, PDFs, or handwritten notes), use AI to parse them into JSON, then import via the app.

#### Step 1: Parse with AI
Use this prompt with OpenAI GPT-4, Anthropic Claude, or similar AI tools to convert your messy recipe text into structured JSON:

```
Parse the following cocktail recipe text into a JSON array of recipes. Each recipe should follow this structure:
{
  "name": "string (required)",
  "category": "Cocktail|Highball|Collins|Rickey|Buck|Fizz|Julep|Smash|Cobbler|Swizzle|Sling|Toddy|Punch|Cup|Flip|Nog|Fix|Crusta|Frappé|Shrub|Wassail Bowl|Champerelle|Other|Ingredient",
  "subtype": "string or null (only valid for Cocktail, Other, or Ingredient)",
  "score": "integer 1-10, or null/blank for unrated",
  "tags": ["string", "..."],
  "ingredients": [
    {
      "amount": "number or null",
      "unit": "string (e.g. oz, ml, dash)",
      "ingredient_name": "string",
      "ingredient_id": "number or null (optional)",
      "subrecipe_id": "number or null (optional)"
    }
  ],
  "glassware": "string or null",
  "garnishes": [
    {
      "garnish_text": "string",
      "ingredient_id": "number or null"
    }
  ],
  "tools": ["string or { tool_name, tool_id }"],
  "procedure": "string",
  "notes": "string",
  "custom_fields": { "<field_id>": "value" },
  "image_filename": "string or null"
}

Handle variations like:
- Amounts: "2 oz" → amount: 2, unit: "oz"
- Units: "ml", "cl", "dash", etc. (standardize to common units)
- Ingredients: Extract names, ignore brands unless specified
- Tools: e.g., "shaker", "strainer"
- Glassware: move serving vessel terms (e.g., "Nick & Nora glass", "Whisky tumbler") to `glassware`
- Procedure: Convert to numbered steps if not already
- Multiple recipes: Separate into array elements
- Ignore irrelevant text (e.g., ads, images)

Output ONLY valid JSON, no extra text.

Messy text to parse:
[PASTE YOUR MESSY RECIPE TEXT HERE]
```

**Example Input:**
```
Classic Martini
Ingredients: 2.5 oz gin, 0.5 oz dry vermouth, olive or lemon twist
Tools: cocktail shaker, strainer
Shake gin and vermouth with ice, strain into glass, garnish.

Mojito
2 oz white rum, 1 oz lime juice, 2 tsp sugar, soda water, mint leaves
Muddle mint with sugar and lime, add rum and ice, top with soda, stir.
```

**Example Output:**
```json
[
  {
    "name": "Classic Martini",
    "category": "Cocktail",
    "subtype": "Aromatic",
    "score": 5,
    "tags": ["classic", "gin"],
    "ingredients": [
      {"amount": 2.5, "unit": "oz", "ingredient_name": "gin"},
      {"amount": 0.5, "unit": "oz", "ingredient_name": "dry vermouth"},
      {"amount": null, "unit": null, "ingredient_name": "olive or lemon twist"}
    ],
    "garnishes": [
      { "garnish_text": "Olive or lemon twist", "ingredient_id": null }
    ],
    "tools": ["cocktail shaker", "strainer"],
    "procedure": "Shake gin and vermouth with ice, strain into glass, garnish.",
    "notes": "",
    "custom_fields": {}
  },
  {
    "name": "Don's Mix",
    "category": "Ingredient",
    "subtype": "Modifier",
    "score": 5,
    "ingredients": [
      {"amount": 2, "unit": "part", "ingredient_name": "grapefruit juice"},
      {"amount": 1, "unit": "part", "ingredient_name": "cinnamon syrup"}
    ],
    "garnishes": [],
    "tools": [],
    "procedure": "Stir together and refrigerate.",
    "notes": "Used in tiki recipes"
  }
]
```

#### Step 2: Import via App
1. Log in as admin
2. Click "Bulk Import"
3. Paste the JSON array into the textarea
4. Click "Import"
5. Review results (imported count and any errors)

#### API Usage
You can also import directly via API:
```bash
curl -X POST -H "Content-Type: application/json" \
  -d @recipes.json \
  http://your-app/api/bulk-import
```
Authenticate with session cookies (same as web login).

### Managing Custom Fields
- Click "⚙ Fields" (admin only)
- Add fields like "Source" (URL) or "Difficulty" (text)
- Fields appear on all recipes

### Sorting and Filtering
- Sort by Rating (highest first), Alphabetic, or Newest
- Filter by ingredients or tools
- Search by recipe name

## Architecture

- **Backend**: Flask + SQLAlchemy + SQLite
- **Frontend**: Vanilla JavaScript + HTML/CSS
- **Deployment**: Docker + Portainer
- **Security**: Session-based auth, admin-only writes

## Contributing

This is a personal project, but feel free to fork and modify.

## License

MIT