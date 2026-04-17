# Cocktail Book

A private, web-based cocktail recipe database. Manage your collection of cocktail recipes with ingredients, tools, procedures, ratings, and custom fields. Designed for personal use with admin-only editing.

## Features

- **Recipe Management**: Add, edit, and delete cocktail recipes
- **Ingredients & Tools**: Track ingredients with amounts/units and required tools
- **Garnish Support**: Add garnish text or ingredient-based garnish items separately from recipe ingredients
- **Recipe Linking**: Recipes can reference other recipes as ingredients (e.g., for syrups or infusions)
- **Ratings**: Rate recipes 1-10 and sort by rating
- **Custom Fields**: Add flexible fields like source URLs or notes
- **Search & Filter**: Filter by ingredients/tools, search by name
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
3. Set environment variables in Portainer:
   - `SECRET_KEY`: A random secret key (e.g., `openssl rand -hex 32`)
   - `ADMIN_PASSWORD`: Password for the admin user
   - `USER_PASSWORD`: Password for the regular user (optional)
4. Deploy the stack
5. Access at `http://your-portainer-url:port`

The app will automatically create the database and seed users on first run.

### Version
We use releases with standard versioning (vX.Y.Z). There will also be a tag=stable.

#### Use the tag in Portainer
- In the stack settings, set the Git reference to the tag name instead of `main` (e.g., `refs/heads/v0.1.0` or `refs/heads/stable`)
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
- Fill in name, rating (1-10), ingredients, tools, procedure, notes
- Ingredients can be regular items or linked to other recipes
- Upload images if desired

### Bulk Importing Recipes

If you have recipes in messy formats (e.g., copied from websites, PDFs, or handwritten notes), use AI to parse them into JSON, then import via the app.

#### Step 1: Parse with AI
Use this prompt with OpenAI GPT-4, Anthropic Claude, or similar AI tools to convert your messy recipe text into structured JSON:

```
Parse the following cocktail recipe text into a JSON array of recipes. Each recipe should have this exact structure:
{
  "name": "string (recipe name)",
  "score": number (1-10, default 5 if not specified),
  "ingredients": array of { "amount": number or null, "unit": "string", "ingredient_name": "string" },
  "garnishes": array of { "garnish_text": "string", "ingredient_id": number or null },
  "tools": array of "string" (tool names),
  "procedure": "string (multi-line procedure, e.g., '1. Step one\n2. Step two')",
  "notes": "string or null (optional notes)"
}

Handle variations like:
- Amounts: "2 oz" → amount: 2, unit: "oz"
- Units: "ml", "cl", "dash", etc. (standardize to common units)
- Ingredients: Extract names, ignore brands unless specified
- Tools: e.g., "shaker", "strainer"
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
    "score": 5,
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
    "notes": null
  },
  {
    "name": "Mojito",
    "score": 5,
    "ingredients": [
      {"amount": 2, "unit": "oz", "ingredient_name": "white rum"},
      {"amount": 1, "unit": "oz", "ingredient_name": "lime juice"},
      {"amount": 2, "unit": "tsp", "ingredient_name": "sugar"},
      {"amount": null, "unit": null, "ingredient_name": "soda water"},
      {"amount": null, "unit": null, "ingredient_name": "mint leaves"}
    ],
    "garnishes": [
      { "garnish_text": "Mint sprig", "ingredient_id": null }
    ],
    "tools": [],
    "procedure": "Muddle mint with sugar and lime, add rum and ice, top with soda, stir.",
    "notes": null
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
Authenticate with session cookies or API keys if configured.

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